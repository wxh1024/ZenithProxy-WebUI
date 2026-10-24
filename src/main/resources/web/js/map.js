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
 *
 * Zoom is continuous-ish: each notch moves 1.25× along a level ladder (so one
 * notch is a small step), and the scale itself is animated geometrically between
 * levels. Tiles are only requested for the settled level — during the ~190 ms
 * transition the previous level's tiles are stretched under the new ones, so no
 * frame is ever left with a hole.
 */

import {API_BASE, apiCall} from './api.js';
import {onLanguageChange} from './state.js';
import {t} from './i18n.js';
import {showNotification} from './util.js';

/** Tile edge in pixels (must match MapTileRenderer.TILE_PX). */
const TILE_PX = 256;
/** A visible tile is re-requested this often so block edits show up. */
const TILE_TTL_MS = 4000;
/** Blocks per pixel. Must stay inside MapHandler's accepted range. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** Ladder ratio per zoom notch — 1.25 is a deliberately small step. */
const ZOOM_STEP = 1.25;
/** Duration of the zoom transition. */
const ZOOM_DURATION_MS = 190;
const DEFAULT_SCALE = 1;
/** Grid line spacing candidates, in blocks. */
const GRID_STEPS = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
const MAX_CACHED_TILES = 150;
/** Absolute ceiling — reached only if nothing can be dropped without a hole. */
const HARD_CACHED_TILES = 320;
const POLL_MS = 1000;
/** Wheel pixels that add up to one notch. */
const WHEEL_NOTCH = 100;

/** Zoom ladder, furthest first. Built from MAX down so the extremes are exact. */
const ZOOM_LEVELS = (() => {
    const levels = [];
    for (let scale = MAX_SCALE; scale >= MIN_SCALE - 1e-9; scale /= ZOOM_STEP) {
        levels.unshift(Math.round(scale * 10000) / 10000);
    }
    return levels;
})();

const COLOR = {
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
    /** Current zoom, animated; only equal to a ladder value once settled. */
    scale: DEFAULT_SCALE,
    /** Ladder level the visible tiles belong to. */
    tileScale: DEFAULT_SCALE,
    /** Previous level, drawn underneath until the current one has loaded. */
    prevTileScale: 0,
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

/** Zoom transition state (geometric interpolation around a fixed world anchor). */
const zoomAnim = {
    active: false,
    from: 1,
    to: 1,
    start: 0,
    anchorWorldX: 0,
    anchorWorldZ: 0,
    anchorPx: 0,
    anchorPy: 0,
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
let wheelDelta = 0;
let active = false;

// ── Coordinate helpers ──────────────────────────────────────────────

const screenX = worldX => (worldX - view.cx) / view.scale + view.width / 2;
const screenY = worldZ => (worldZ - view.cz) / view.scale + view.height / 2;
const worldXAt = px => (px - view.width / 2) * view.scale + view.cx;
const worldZAt = py => (py - view.height / 2) * view.scale + view.cz;

// ── Tiles ───────────────────────────────────────────────────────────

function loadTileImage(tx, tz, scale, entry) {
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
    img.src = `${API_BASE}/map/tile?x=${tx}&z=${tz}&s=${scale}`;
}

/**
 * Returns the tile entry for a coordinate at a zoom level, (re)loading it when
 * missing or stale. `fetch` is false for the fallback layer, which only draws
 * whatever happens to be cached.
 *
 * <p>The previous image stays on screen while a replacement loads, so panning
 * and refresh never flash blank tiles.
 */
function getTile(tx, tz, scale, fetchTile) {
    const key = `${scale}/${tx}/${tz}`;
    const now = Date.now();
    let entry = tileCache.get(key);
    if (!entry) {
        entry = {img: null, state: 'idle', at: now, touched: now, pending: false, level: scale, tx, tz};
        tileCache.set(key, entry);
        trimTileCache();
    }
    if (fetchTile && !entry.pending && (entry.state !== 'ready' || now - entry.at > TILE_TTL_MS)) {
        entry.at = now;
        loadTileImage(tx, tz, scale, entry);
    }
    return entry;
}

/**
 * Evicts cached tiles, but never at the cost of a hole on screen.
 *
 * <p>Two guarantees:
 * <ol>
 *   <li>a level that is currently drawn (the settled level and the fallback
 *       level under a running transition) is never evicted;</li>
 *   <li>an older tile is only dropped once the active level already has a
 *       <em>loaded</em> tile covering the same ground. If the new level still
 *       has gaps, the old tile stays — a missing tile would flash background.</li>
 * </ol>
 *
 * <p>Least-recently-drawn goes first. The list can therefore stay above the
 * soft budget (nothing is safely droppable yet); the hard ceiling is a memory
 * guard only, since every decoded tile costs ~256 KB.
 */
function trimTileCache() {
    const over = tileCache.size - MAX_CACHED_TILES;
    if (over <= 0) return;
    const kept = new Set([String(view.tileScale), String(view.prevTileScale)]);
    const candidates = [];
    for (const [key, entry] of tileCache) {
        if (kept.has(String(entry.level))) continue;
        candidates.push({key, entry});
    }
    candidates.sort((a, b) => (a.entry.touched || 0) - (b.entry.touched || 0));

    let remaining = over;
    const blocked = [];
    for (const candidate of candidates) {
        if (remaining <= 0) break;
        if (!hasReplacement(candidate.entry)) {
            blocked.push(candidate);
            continue;
        }
        tileCache.delete(candidate.key);
        remaining--;
    }
    if (tileCache.size <= HARD_CACHED_TILES) return;
    for (const candidate of blocked) {
        if (tileCache.size <= HARD_CACHED_TILES) break;
        tileCache.delete(candidate.key);
    }
}

/** True when the active level has a loaded tile for every block of `entry`. */
function hasReplacement(entry) {
    const span = TILE_PX * entry.level;
    const activeSpan = TILE_PX * view.tileScale;
    const firstX = Math.floor(entry.tx * span / activeSpan);
    const lastX = Math.floor(((entry.tx + 1) * span) / activeSpan - 1e-9);
    const firstZ = Math.floor(entry.tz * span / activeSpan);
    const lastZ = Math.floor(((entry.tz + 1) * span) / activeSpan - 1e-9);
    for (let tx = firstX; tx <= lastX; tx++) {
        for (let tz = firstZ; tz <= lastZ; tz++) {
            const replacement = tileCache.get(`${view.tileScale}/${tx}/${tz}`);
            if (!replacement || replacement.state !== 'ready') return false;
        }
    }
    return true;
}

/** True when every visible tile of the active level is loaded. */
function activeLevelReady() {
    const span = TILE_PX * view.tileScale;
    const halfW = (view.width / 2) * view.scale;
    const halfH = (view.height / 2) * view.scale;
    const firstX = Math.floor((view.cx - halfW) / span);
    const lastX = Math.floor((view.cx + halfW) / span);
    const firstZ = Math.floor((view.cz - halfH) / span);
    const lastZ = Math.floor((view.cz + halfH) / span);
    for (let tx = firstX; tx <= lastX; tx++) {
        for (let tz = firstZ; tz <= lastZ; tz++) {
            const entry = tileCache.get(`${view.tileScale}/${tx}/${tz}`);
            if (!entry || entry.state !== 'ready') return false;
        }
    }
    return true;
}

// ── Rendering ───────────────────────────────────────────────────────

export function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    // rAF never fires in a hidden tab, so scheduling it there would latch
    // `drawQueued` at true and freeze the map forever after the tab is hidden once.
    if (document.hidden) {
        drawQueued = false;
        draw();
        return;
    }
    requestAnimationFrame(() => {
        drawQueued = false;
        draw();
        if (zoomAnim.active) requestDraw();
    });
}

/**
 * Keeps the drawing coordinate space equal to the canvas' real CSS box.
 *
 * <p>Measuring once on activation is not enough: the element can be re-laid out
 * later (window resize, panel/grid reflow), and a stale width shifts every
 * drawn tile plus every screen→world conversion, which desynchronises both the
 * picture and click targets. Re-checking per frame is a couple of layout reads.
 */
function syncCanvasSize() {
    if (!canvas || !ctx) return false;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return false;
    if (width === view.width && height === view.height) return true;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    view.width = width;
    view.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
}

function draw() {
    if (!syncCanvasSize()) return;
    if (zoomAnim.active) stepZoom();

    ctx.imageSmoothingEnabled = false;
    // One flat "no data" tone behind everything: painting per-tile rectangles
    // instead leaves the uncovered strip on the right/bottom a different shade,
    // which reads as a mask laid over part of the map.
    ctx.fillStyle = COLOR.unloaded;
    ctx.fillRect(0, 0, view.width, view.height);

    // While a zoom settles, the old level is stretched underneath so the screen
    // is never empty; once the new level loads it covers the fallback completely.
    if (view.prevTileScale && view.prevTileScale !== view.tileScale) {
        drawTileLayer(view.prevTileScale, false);
    }
    drawTileLayer(view.tileScale, true);

    drawGrid();
    drawPath();
    drawMarkers();
}

function drawTileLayer(scale, fetchTiles) {
    const span = TILE_PX * scale;
    const size = span / view.scale;
    // Snapped drawing only when this layer is shown 1:1 — fractional sizes would
    // otherwise blur the pixel-art tiles.
    const crisp = Math.abs(size - TILE_PX) < 0.25;
    const halfWBlocks = (view.width / 2) * view.scale;
    const halfHBlocks = (view.height / 2) * view.scale;
    const firstX = Math.floor((view.cx - halfWBlocks) / span);
    const lastX = Math.floor((view.cx + halfWBlocks) / span);
    const firstZ = Math.floor((view.cz - halfHBlocks) / span);
    const lastZ = Math.floor((view.cz + halfHBlocks) / span);
    const now = Date.now();

    for (let tx = firstX; tx <= lastX; tx++) {
        const left = screenX(tx * span);
        const drawLeft = crisp ? Math.round(left) : left;
        for (let tz = firstZ; tz <= lastZ; tz++) {
            const entry = getTile(tx, tz, scale, fetchTiles);
            entry.touched = now;
            if (entry.state !== 'ready' || !entry.img) continue;
            const top = crisp ? Math.round(screenY(tz * span)) : screenY(tz * span);
            const drawSize = crisp ? TILE_PX : size;
            ctx.drawImage(entry.img, drawLeft, top, drawSize, drawSize);
        }
    }
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

// ── Zoom ────────────────────────────────────────────────────────────

/** Index of the ladder rung closest to `scale` (log distance, so it feels even). */
function nearestLevelIndex(scale) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < ZOOM_LEVELS.length; i++) {
        const distance = Math.abs(Math.log(scale / ZOOM_LEVELS[i]));
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
        }
    }
    return best;
}

/**
 * Moves `steps` rungs along the ladder: positive = further out, negative =
 * closer in. The world point under the anchor stays under the anchor for the
 * whole transition.
 */
function zoomStep(steps, anchorPx, anchorPy) {
    if (!steps) return;
    const reference = zoomAnim.active ? zoomAnim.to : view.scale;
    const index = Math.min(ZOOM_LEVELS.length - 1,
        Math.max(0, nearestLevelIndex(reference) + steps));
    const target = ZOOM_LEVELS[index];
    if (Math.abs(target - reference) < 1e-9) return;
    zoomTo(target, anchorPx, anchorPy);
}

function zoomTo(targetScale, anchorPx, anchorPy) {
    const px = Number.isFinite(anchorPx) ? anchorPx : view.width / 2;
    const py = Number.isFinite(anchorPy) ? anchorPy : view.height / 2;
    zoomAnim.from = view.scale;
    zoomAnim.to = targetScale;
    zoomAnim.anchorWorldX = worldXAt(px);
    zoomAnim.anchorWorldZ = worldZAt(py);
    zoomAnim.anchorPx = px;
    zoomAnim.anchorPy = py;
    zoomAnim.start = performance.now();
    zoomAnim.active = true;
    requestDraw();
}

/** Geometric interpolation — equal ratios per unit time, which reads as smooth. */
function stepZoom() {
    const elapsed = (performance.now() - zoomAnim.start) / ZOOM_DURATION_MS;
    const t = Math.min(1, Math.max(0, elapsed));
    const eased = 1 - Math.pow(1 - t, 3);
    view.scale = zoomAnim.from * Math.pow(zoomAnim.to / zoomAnim.from, eased);
    // Pin the anchored block: the centre has to move as the scale changes.
    view.cx = zoomAnim.anchorWorldX - (zoomAnim.anchorPx - view.width / 2) * view.scale;
    view.cz = zoomAnim.anchorWorldZ - (zoomAnim.anchorPy - view.height / 2) * view.scale;
    if (t < 1) return;

    view.scale = zoomAnim.to;
    zoomAnim.active = false;
    if (view.tileScale !== zoomAnim.to) {
        view.prevTileScale = view.tileScale;
        view.tileScale = zoomAnim.to;
    }
    // The fallback level is only insurance while the new level is still
    // loading; drop it as soon as the viewport is fully covered.
    if (view.prevTileScale && activeLevelReady()) view.prevTileScale = 0;
    // The cursor may not move while the buttons are used, so refresh the
    // magnification readout once the level settles.
    if (view.hover) updateHoverLabel();
}

/** Jumps to the end of a running transition (used before re-centring). */
function finishZoom() {
    if (!zoomAnim.active) return;
    zoomAnim.active = false;
    view.scale = zoomAnim.to;
    if (view.tileScale !== zoomAnim.to) {
        view.prevTileScale = view.tileScale;
        view.tileScale = zoomAnim.to;
    }
}

// ── Layout ──────────────────────────────────────────────────────────

/** Called by the ResizeObserver — the size itself is re-read on every draw. */
function requestLayout() {
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

/**
 * Wheel accumulates before moving a rung, so a trackpad flick or a fast mouse
 * wheel zooms a sensible amount instead of jumping several levels at once.
 */
function onWheel(event) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 300 : 1;
    wheelDelta += event.deltaY * unit;
    const steps = Math.trunc(wheelDelta / WHEEL_NOTCH);
    if (!steps) return;
    wheelDelta -= steps * WHEEL_NOTCH;
    const {px, py} = pointerPos(event);
    view.follow = false;
    zoomStep(steps, px, py);
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
    el.textContent = view.hover ? `X ${view.hover.x}  Z ${view.hover.z}  ×${(1 / view.scale).toFixed(1)}` : '';
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
    // Lower scale = closer. The anchor stays the view centre so the bot does not
    // slide off screen while zooming from the buttons.
    zoomStep(-1);
}

export function mapZoomOut() {
    zoomStep(1);
}

/** Re-centres on the bot and resumes following it. */
export function mapRecenter() {
    finishZoom();
    view.follow = true;
    if (view.player) {
        view.cx = view.player.x;
        view.cz = view.player.z;
    }
    requestDraw();
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

    resizeObserver = new ResizeObserver(requestLayout);
    resizeObserver.observe(wrap);

    // A background tab stops rAF and throttles timers; refresh as soon as the
    // page is visible again instead of waiting for the next poll to catch up.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        requestDraw();
        if (active) poll();
    });

    onLanguageChange(() => {
        updatePanel();
        requestDraw();
    });
}

/** Called by the router when the map page becomes visible. */
export function activateMap() {
    active = true;
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
