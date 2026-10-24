/**
 * Map page — a canvas minimap plus click-to-pathfind.
 *
 * Terrain is not fetched from any online map service: every tile comes from
 * `/api/map/tile`, rendered server-side from the proxy's own live chunk cache.
 * That means the picture shows exactly the area the bot has loaded, and unloaded
 * chunks stay blank instead of showing someone else's snapshot of the world.
 *
 * Bot position, the path Baritone is currently following and the pathing status
 * arrive from `/api/map/state` (1 Hz poll while the page is visible). Clicking
 * the canvas POSTs `/api/map/path`, which drives ZenithProxy's own pathfinder —
 * the browser never computes a route, it only draws what the server reports.
 */

import {API_BASE, apiCall} from './api.js';
import {onLanguageChange} from './state.js';
import {t} from './i18n.js';
import {showNotification} from './util.js';

/** Tile edge in pixels (must match MapTileRenderer.TILE_PX). */
const TILE_PX = 256;
/** A visible tile is re-requested this often so block edits show up. */
const TILE_TTL_MS = 8000;
/** Blocks per pixel. Must match MapHandler.isSupportedScale(). */
const ZOOM_LEVELS = [0.5, 1, 2, 4, 8];
const DEFAULT_ZOOM_INDEX = 1;
/** Grid line spacing candidates, in blocks. */
const GRID_STEPS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
const MAX_CACHED_TILES = 140;
const POLL_MS = 1000;

const COLOR = {
    background: '#11111b',
    unloaded: '#181926',
    grid: 'rgba(110, 115, 141, 0.22)',
    gridLabel: 'rgba(147, 154, 183, 0.7)',
    path: '#8bd5ca',
    pathTravelled: 'rgba(139, 213, 202, 0.28)',
    pathPlanned: 'rgba(139, 213, 202, 0.55)',
    target: '#ed8796',
    bot: '#cad3f5',
    botDark: '#11111b',
};

/** Everything the renderer needs. Mutated in place; never reassigned. */
const view = {
    scale: ZOOM_LEVELS[DEFAULT_ZOOM_INDEX],
    cx: 0,
    cz: 0,
    follow: true,
    width: 0,
    height: 0,
    player: null,
    target: null,
    path: [],
    progress: 0,
    remaining: 0,
    status: 'idle',
    connected: false,
    hover: null,
};

/** `scale/tileX/tileZ` → {img, state, at, pending}. */
const tileCache = new Map();

let canvas = null;
let ctx = null;
let wrap = null;
let resizeObserver = null;
let pollTimer = null;
let drawQueued = false;
let drag = null;
let active = false;

// ── Coordinate helpers ──────────────────────────────────────────────

const tileSpan = () => TILE_PX * view.scale;

const screenX = worldX => (worldX - view.cx) / view.scale + view.width / 2;
const screenY = worldZ => (worldZ - view.cz) / view.scale + view.height / 2;
const worldXAt = px => (px - view.width / 2) * view.scale + view.cx;
const worldZAt = py => (py - view.height / 2) * view.scale + view.cz;

// ── Tiles ───────────────────────────────────────────────────────────

function loadTileImage(tx, tz, entry) {
    if (entry.pending) return;
    entry.pending = true;
    const img = new Image();
    img.onload = () => {
        entry.img = img;
        entry.state = 'ready';
        entry.pending = false;
        requestDraw();
    };
    img.onerror = () => {
        entry.pending = false;
        if (!entry.img) entry.state = 'error';
    };
    img.src = `${API_BASE}/map/tile?x=${tx}&z=${tz}&s=${view.scale}`;
}

/**
 * Returns the tile entry for a coordinate, (re)loading it when it is missing or
 * older than the TTL. The previous image stays on screen while the replacement
 * loads, so panning never flashes blank tiles.
 */
function getTile(tx, tz) {
    const key = `${view.scale}/${tx}/${tz}`;
    const now = Date.now();
    let entry = tileCache.get(key);
    if (!entry) {
        entry = {img: null, state: 'loading', at: now, pending: false};
        tileCache.set(key, entry);
        trimTileCache();
        loadTileImage(tx, tz, entry);
        return entry;
    }
    if (now - entry.at > TILE_TTL_MS) {
        entry.at = now;
        loadTileImage(tx, tz, entry);
    }
    return entry;
}

function trimTileCache() {
    while (tileCache.size > MAX_CACHED_TILES) {
        const oldest = tileCache.keys().next();
        if (oldest.done) break;
        tileCache.delete(oldest.value);
    }
}

// ── Rendering ───────────────────────────────────────────────────────

export function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
        drawQueued = false;
        draw();
    });
}

function draw() {
    if (!ctx || !view.width || !view.height) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(0, 0, view.width, view.height);

    const span = tileSpan();
    const halfWBlocks = (view.width / 2) * view.scale;
    const halfHBlocks = (view.height / 2) * view.scale;
    const firstX = Math.floor((view.cx - halfWBlocks) / span);
    const lastX = Math.floor((view.cx + halfWBlocks) / span);
    const firstZ = Math.floor((view.cz - halfHBlocks) / span);
    const lastZ = Math.floor((view.cz + halfHBlocks) / span);

    for (let tx = firstX; tx <= lastX; tx++) {
        for (let tz = firstZ; tz <= lastZ; tz++) {
            const left = Math.round(screenX(tx * span));
            const top = Math.round(screenY(tz * span));
            // Placeholder shows through transparent (unloaded) pixels.
            ctx.fillStyle = COLOR.unloaded;
            ctx.fillRect(left, top, TILE_PX, TILE_PX);
            const entry = getTile(tx, tz);
            if (entry.state === 'ready' && entry.img) {
                ctx.drawImage(entry.img, left, top, TILE_PX, TILE_PX);
            }
        }
    }

    drawGrid();
    drawPath();
    drawMarkers();
}

/** Coordinate grid + edge labels, so positions can be read off the map directly. */
function drawGrid() {
    const step = GRID_STEPS.find(candidate => candidate / view.scale >= 90) || GRID_STEPS[GRID_STEPS.length - 1];
    const halfWBlocks = (view.width / 2) * view.scale;
    const halfHBlocks = (view.height / 2) * view.scale;

    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLOR.gridLabel;
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';

    const startX = Math.ceil((view.cx - halfWBlocks) / step) * step;
    for (let wx = startX; wx <= view.cx + halfWBlocks; wx += step) {
        const px = Math.round(screenX(wx)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, view.height);
        ctx.stroke();
        ctx.fillText(String(wx), px + 3, 3);
    }
    const startZ = Math.ceil((view.cz - halfHBlocks) / step) * step;
    for (let wz = startZ; wz <= view.cz + halfHBlocks; wz += step) {
        const py = Math.round(screenY(wz)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(view.width, py);
        ctx.stroke();
        ctx.fillText(String(wz), 3, py + 2);
    }
}

function drawPath() {
    if (view.path.length < 2) {
        if (view.target) drawDashedToTarget(null);
        return;
    }
    const points = view.path;
    const split = Math.min(Math.max(view.progress, 0), points.length - 1);

    const strokeSegment = (from, to, color, width) => {
        if (to <= from) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = from; i <= to; i++) {
            const px = screenX(points[i][0]);
            const py = screenY(points[i][2]);
            if (i === from) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    };

    strokeSegment(0, split, COLOR.pathTravelled, 2);
    strokeSegment(split, points.length - 1, COLOR.path, 2.5);
    drawDashedToTarget(points[points.length - 1]);
}

/** Dashed hint from the end of the planned segment to the requested target. */
function drawDashedToTarget(lastPoint) {
    if (!view.target) return;
    const start = lastPoint
        ? {x: screenX(lastPoint[0]), y: screenY(lastPoint[2])}
        : view.player
            ? {x: screenX(view.player.x), y: screenY(view.player.z)}
            : null;
    if (!start) return;
    const end = {x: screenX(view.target.x), y: screenY(view.target.z)};
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLOR.pathPlanned;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
}

function drawMarkers() {
    if (view.target) {
        const x = Math.round(screenX(view.target.x));
        const y = Math.round(screenY(view.target.z));
        ctx.strokeStyle = COLOR.target;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 7, y - 7, 14, 14);
        ctx.beginPath();
        ctx.moveTo(x - 11, y);
        ctx.lineTo(x - 5, y);
        ctx.moveTo(x + 5, y);
        ctx.lineTo(x + 11, y);
        ctx.moveTo(x, y - 11);
        ctx.lineTo(x, y - 5);
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x, y + 11);
        ctx.stroke();
    }
    if (view.player) {
        const x = Math.round(screenX(view.player.x));
        const y = Math.round(screenY(view.player.z));
        // Facing indicator first, so the marker box sits on top of its base.
        const yaw = (view.player.yaw || 0) * Math.PI / 180;
        ctx.strokeStyle = COLOR.bot;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.sin(yaw) * 15, y + Math.cos(yaw) * 15);
        ctx.stroke();

        ctx.fillStyle = COLOR.botDark;
        ctx.fillRect(x - 6, y - 6, 12, 12);
        ctx.strokeStyle = COLOR.bot;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 6, y - 6, 12, 12);
        ctx.fillStyle = COLOR.bot;
        ctx.fillRect(x - 2, y - 2, 4, 4);
    }
}

// ── Layout ──────────────────────────────────────────────────────────

function resize() {
    if (!canvas || !wrap) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    view.width = width;
    view.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestDraw();
}

// ── Interaction ─────────────────────────────────────────────────────

function pointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    return {px: event.clientX - rect.left, py: event.clientY - rect.top};
}

function onPointerDown(event) {
    if (event.button !== 0) return;
    drag = {startX: event.clientX, startY: event.clientY, cx: view.cx, cz: view.cz, moved: false};
    canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
    const {px, py} = pointerPos(event);
    view.hover = {x: Math.floor(worldXAt(px)), z: Math.floor(worldZAt(py))};
    if (drag) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
            view.cx = drag.cx - dx * view.scale;
            view.cz = drag.cz - dy * view.scale;
            view.follow = false;
        }
    }
    updateHoverLabel();
    requestDraw();
}

function onPointerUp(event) {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) return;
    const {px, py} = pointerPos(event);
    goTo(Math.floor(worldXAt(px)), Math.floor(worldZAt(py)));
}

function onPointerLeave() {
    view.hover = null;
    updateHoverLabel();
    requestDraw();
}

function onWheel(event) {
    event.preventDefault();
    const {px, py} = pointerPos(event);
    const anchorX = worldXAt(px);
    const anchorZ = worldZAt(py);
    const index = ZOOM_LEVELS.indexOf(view.scale);
    const next = event.deltaY < 0
        ? Math.max(0, index - 1)
        : Math.min(ZOOM_LEVELS.length - 1, index + 1);
    if (next === index) return;
    view.scale = ZOOM_LEVELS[next];
    // Keep the block under the cursor pinned while zooming.
    view.cx = anchorX - (px - view.width / 2) * view.scale;
    view.cz = anchorZ - (py - view.height / 2) * view.scale;
    view.follow = false;
    requestDraw();
}

async function goTo(x, z) {
    if (!view.connected) {
        showNotification(t('map.err.offline'), 'error');
        return;
    }
    const result = await apiCall('/map/path', 'POST', {x, z});
    if (!result) return;
    if (!result.success) {
        showNotification(t('map.err.' + (result.code || 'failed')), 'error');
        return;
    }
    view.target = result.target;
    showNotification(result.loaded === false ? t('map.warn.unloaded') : t('map.goto', {x, z}),
        result.loaded === false ? 'warning' : 'success');
    updatePanel();
    requestDraw();
    poll();
}

// ── Panel ───────────────────────────────────────────────────────────

const STATUS_STYLE = {
    idle: 'var(--ctp-overlay1)',
    calculating: 'var(--ctp-yellow)',
    pathing: 'var(--ctp-teal)',
    arrived: 'var(--ctp-green)',
    failed: 'var(--ctp-red)',
    offline: 'var(--ctp-red)',
};

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent !== value) el.textContent = value;
}

function updateHoverLabel() {
    const el = document.getElementById('mapHover');
    if (!el) return;
    el.textContent = view.hover ? `X ${view.hover.x}  Z ${view.hover.z}` : '';
}

function updatePanel() {
    const p = view.player;
    setText('mapCoord', p ? `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` : '-');
    setText('mapFacing', p ? `${p.yaw.toFixed(0)}°` : '-');
    setText('mapTarget', view.target ? `${view.target.x}, ${view.target.z}` : '-');
    setText('mapDistance', p && view.target
        ? t('map.blocks', {n: Math.round(Math.hypot(view.target.x - p.x, view.target.z - p.z))})
        : '-');
    setText('mapRemaining', view.path.length ? t('map.blocks', {n: view.remaining}) : '-');

    const statusEl = document.getElementById('mapStatus');
    if (statusEl) {
        statusEl.textContent = t('map.status.' + view.status);
        statusEl.style.color = STATUS_STYLE[view.status] || 'var(--ctp-overlay1)';
    }
    const stopBtn = document.getElementById('mapStopBtn');
    if (stopBtn) {
        const busy = view.status === 'pathing' || view.status === 'calculating';
        stopBtn.disabled = !busy;
    }
    const empty = document.getElementById('mapEmpty');
    // Only claim "not connected" after a poll actually reported it.
    if (empty) empty.style.display = view.status === 'offline' ? 'flex' : 'none';
}

// ── Polling ─────────────────────────────────────────────────────────

async function poll() {
    if (!active) return;
    const data = await apiCall('/map/state');
    if (!data || !active) return;
    view.connected = !!data.connected;
    view.player = data.player || null;
    view.path = Array.isArray(data.path) ? data.path : [];
    view.progress = data.progress || 0;
    view.remaining = data.remaining || 0;
    view.status = data.status || 'idle';
    view.target = data.target || null;
    if (view.follow && view.player) {
        view.cx = view.player.x;
        view.cz = view.player.z;
    }
    updatePanel();
    requestDraw();
}

// ── Public API (also exposed on window for inline handlers) ─────────

export function mapZoomIn() {
    setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(view.scale) + 1)]);
}

export function mapZoomOut() {
    setZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(view.scale) - 1)]);
}

function setZoom(scale) {
    if (scale === view.scale) return;
    view.scale = scale;
    requestDraw();
}

/** Re-centres on the bot and resumes following it. */
export function mapRecenter() {
    view.follow = true;
    if (view.player) {
        view.cx = view.player.x;
        view.cz = view.player.z;
    }
    requestDraw();
}

/** Forces a re-render of every visible tile (also drops the browser's copies). */
export function mapRefresh() {
    for (const [key, entry] of tileCache) {
        if (key.startsWith(`${view.scale}/`)) entry.at = 0;
    }
    requestDraw();
    poll();
}

export async function mapStopPath() {
    const result = await apiCall('/map/stop', 'POST', {});
    if (result && result.success) {
        view.path = [];
        view.progress = 0;
        view.remaining = 0;
        view.status = 'idle';
        updatePanel();
        requestDraw();
    }
}

// ── Lifecycle ───────────────────────────────────────────────────────

export function initMap() {
    wrap = document.getElementById('mapCanvasWrap');
    canvas = document.getElementById('mapCanvas');
    if (!wrap || !canvas) return;
    ctx = canvas.getContext('2d');

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, {passive: false});
    // Right-click on a map is a pan gesture, not a context menu.
    canvas.addEventListener('contextmenu', event => event.preventDefault());

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    resize();

    onLanguageChange(() => {
        updatePanel();
        requestDraw();
    });
}

/** Called by the router when the map page becomes visible. */
export function activateMap() {
    active = true;
    resize();
    updatePanel();
    poll();
    if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
}

/** Called when navigating away — a hidden page must not keep polling. */
export function stopMap() {
    active = false;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
