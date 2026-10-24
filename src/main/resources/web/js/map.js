/**
 * Map page controller.
 *
 * Wires three small modules together and owns everything that is page-shaped:
 * lifecycle, polling, pointer input, the coordinate panel and toasts.
 *
 *   map/camera.js     view transform + zoom ladder (pure geometry)
 *   map/tileStore.js  browser tile cache (loading, TTL, eviction)
 *   map/renderer.js   one frame of canvas output
 *
 * Terrain comes from `/api/map/tile`, rendered server-side from the proxy's own
 * chunk cache — no online tile service is involved, so the picture is exactly
 * what the bot has loaded. Only tiles overlapping that loaded area are
 * requested; everything else on screen is a cached snapshot, which is why
 * explored ground keeps rendering instead of going blank.
 *
 * Bot state comes from `/api/map/state` (2 Hz) and the marker is tweened between
 * samples, so movement reads as motion instead of a jump every half second.
 */

import {API_BASE, apiCall} from './api.js';
import {onLanguageChange} from './state.js';
import {t} from './i18n.js';
import {showNotification} from './util.js';
import {POLL_MS} from './map/constants.js';
import {Camera} from './map/camera.js';
import {TileStore} from './map/tileStore.js';
import {drawScene, syncCanvas} from './map/renderer.js';

/** Wheel pixels that add up to one notch. */
const WHEEL_NOTCH = 100;
/** A position jump this large is a teleport, not movement — do not tween it. */
const TELEPORT_BLOCKS = 64;

const camera = new Camera(1);
const store = new TileStore(API_BASE);

/** Everything the renderer needs to know about the bot. */
const state = {
    connected: false,
    player: null,
    marker: null,
    facing: null,
    path: [],
    progress: 0,
    remaining: 0,
    target: null,
    status: 'idle',
    hover: null,
};

/** Marker tween between two samples (dead reckoning over the poll interval). */
const motion = {
    active: false,
    x: 0,
    z: 0,
    fromX: 0,
    fromZ: 0,
    toX: 0,
    toZ: 0,
    start: 0,
    duration: POLL_MS,
};

let canvas = null;
let ctx = null;
let wrap = null;
let pollTimer = null;
let frameQueued = false;
let drag = null;
let wheelDelta = 0;
let active = false;

// ── Frame loop ──────────────────────────────────────────────────────

function requestFrame() {
    if (frameQueued) return;
    frameQueued = true;
    // rAF never fires in a hidden tab, so scheduling it there would latch
    // `frameQueued` at true and freeze the map for good.
    if (document.hidden) {
        frameQueued = false;
        renderFrame();
        return;
    }
    requestAnimationFrame(() => {
        frameQueued = false;
        renderFrame();
    });
}

function renderFrame() {
    if (!syncCanvas(canvas, ctx, camera)) return;
    const now = performance.now();
    const zooming = camera.advanceZoom(now);
    const moving = advanceMotion(now);
    updateMarkerScreen();
    drawScene(ctx, camera, store, state, Date.now());
    if (zooming || moving) requestFrame();
}

// ── Marker motion ───────────────────────────────────────────────────

function startMotion(previous, next) {
    if (Math.hypot(next.x - previous.x, next.z - previous.z) > TELEPORT_BLOCKS) {
        // Teleport / respawn: sliding there would look like a glitch.
        motion.active = false;
        motion.x = next.x;
        motion.z = next.z;
        return;
    }
    motion.fromX = previous.x;
    motion.fromZ = previous.z;
    motion.toX = next.x;
    motion.toZ = next.z;
    motion.x = previous.x;
    motion.z = previous.z;
    motion.start = performance.now();
    motion.duration = POLL_MS;
    motion.active = true;
}

/** Advances the tween; returns true while it is still running. */
function advanceMotion(now) {
    if (!motion.active) return false;
    const progress = Math.min(1, (now - motion.start) / Math.max(1, motion.duration));
    motion.x = motion.fromX + (motion.toX - motion.fromX) * progress;
    motion.z = motion.fromZ + (motion.toZ - motion.fromZ) * progress;
    if (progress >= 1) motion.active = false;
    return motion.active;
}

/** Converts the interpolated world position into the marker's screen point. */
function updateMarkerScreen() {
    if (!state.player) {
        state.marker = null;
        state.facing = null;
        return;
    }
    const worldX = motion.active ? motion.x : state.player.x;
    const worldZ = motion.active ? motion.z : state.player.z;
    if (camera.follow && !camera.isZooming()) camera.centreOn(worldX, worldZ);
    state.marker = {x: camera.toScreenX(worldX), y: camera.toScreenZ(worldZ)};
    state.facing = state.player.yaw;
}

// ── Polling ─────────────────────────────────────────────────────────

async function poll() {
    if (!active) return;
    const data = await apiCall('/map/state');
    if (!data || !active) return;

    const previous = state.player
        ? {x: motion.active ? motion.x : state.player.x, z: motion.active ? motion.z : state.player.z}
        : null;

    state.connected = !!data.connected;
    state.player = data.player || null;
    state.path = Array.isArray(data.path) ? data.path : [];
    state.progress = data.progress || 0;
    state.remaining = data.remaining || 0;
    state.status = data.status || 'idle';
    state.target = data.target || null;
    store.setLoadedArea(data.view || null);

    if (state.player) startMotion(previous || state.player, state.player);
    else motion.active = false;

    updatePanel();
    requestFrame();
}

// ── Interaction ─────────────────────────────────────────────────────

function pointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    return {px: event.clientX - rect.left, py: event.clientY - rect.top};
}

function onPointerDown(event) {
    if (event.button !== 0) return;
    drag = {startX: event.clientX, startY: event.clientY, cx: camera.cx, cz: camera.cz, moved: false};
    canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
    const {px, py} = pointerPos(event);
    state.hover = {x: Math.floor(camera.toWorldX(px)), z: Math.floor(camera.toWorldZ(py))};
    if (drag) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
            camera.centreOn(drag.cx - dx * camera.scale, drag.cz - dy * camera.scale);
            camera.follow = false;
        }
    }
    updateHoverLabel();
    requestFrame();
}

function onPointerUp(event) {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) return;
    const {px, py} = pointerPos(event);
    goTo(Math.floor(camera.toWorldX(px)), Math.floor(camera.toWorldZ(py)));
}

function onPointerLeave() {
    state.hover = null;
    updateHoverLabel();
    requestFrame();
}

/** Wheel accumulates before moving a rung, so a flick zooms a sane amount. */
function onWheel(event) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 300 : 1;
    wheelDelta += event.deltaY * unit;
    const steps = Math.trunc(wheelDelta / WHEEL_NOTCH);
    if (!steps) return;
    wheelDelta -= steps * WHEEL_NOTCH;
    const {px, py} = pointerPos(event);
    camera.follow = false;
    zoomStep(steps, px, py);
}

async function goTo(x, z) {
    if (!state.connected) {
        showNotification(t('map.err.offline'), 'error');
        return;
    }
    const result = await apiCall('/map/path', 'POST', {x, z});
    if (!result) return;
    if (!result.success) {
        showNotification(t('map.err.' + (result.code || 'failed')), 'error');
        return;
    }
    state.target = result.target;
    showNotification(result.loaded === false ? t('map.warn.unloaded') : t('map.goto', {x, z}),
        result.loaded === false ? 'warning' : 'success');
    updatePanel();
    requestFrame();
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
    el.textContent = state.hover
        ? `X ${state.hover.x}  Z ${state.hover.z}  ×${(1 / camera.scale).toFixed(1)}`
        : '';
}

function updatePanel() {
    const player = state.player;
    setText('mapCoord', player ? `${player.x.toFixed(0)}, ${player.y.toFixed(0)}, ${player.z.toFixed(0)}` : '-');
    setText('mapFacing', player ? `${player.yaw.toFixed(0)}°` : '-');
    setText('mapTarget', state.target ? `${state.target.x}, ${state.target.z}` : '-');
    setText('mapDistance', player && state.target
        ? t('map.blocks', {n: Math.round(Math.hypot(state.target.x - player.x, state.target.z - player.z))})
        : '-');
    setText('mapRemaining', state.path.length ? t('map.blocks', {n: state.remaining}) : '-');

    const statusEl = document.getElementById('mapStatus');
    if (statusEl) {
        statusEl.textContent = t('map.status.' + state.status);
        statusEl.style.color = STATUS_STYLE[state.status] || 'var(--ctp-overlay1)';
    }
    const stopBtn = document.getElementById('mapStopBtn');
    if (stopBtn) stopBtn.disabled = !(state.status === 'pathing' || state.status === 'calculating');

    const empty = document.getElementById('mapEmpty');
    // Only claim "not connected" after a poll actually reported it.
    if (empty) empty.style.display = state.status === 'offline' ? 'flex' : 'none';
}

// ── Public API (also exposed on window for inline handlers) ─────────

function zoomStep(steps, anchorPx, anchorPy) {
    if (camera.zoomBy(steps, anchorPx, anchorPy)) requestFrame();
}

export function mapZoomIn() {
    // Lower scale = closer, so zooming in walks the ladder backwards.
    zoomStep(-1);
}

export function mapZoomOut() {
    zoomStep(1);
}

/** Re-centres on the bot and resumes following it. */
export function mapRecenter() {
    camera.finishZoom();
    camera.follow = true;
    if (state.player) {
        camera.centreOn(motion.active ? motion.x : state.player.x,
            motion.active ? motion.z : state.player.z);
    }
    requestFrame();
}

export async function mapStopPath() {
    const result = await apiCall('/map/stop', 'POST', {});
    if (!result || !result.success) return;
    state.path = [];
    state.progress = 0;
    state.remaining = 0;
    state.status = 'idle';
    updatePanel();
    requestFrame();
}

// ── Lifecycle ───────────────────────────────────────────────────────

export function initMap() {
    wrap = document.getElementById('mapCanvasWrap');
    canvas = document.getElementById('mapCanvas');
    if (!wrap || !canvas) return;
    ctx = canvas.getContext('2d');
    store.onTileLoaded = requestFrame;

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, {passive: false});
    // Right-click on a map is a pan gesture, not a context menu.
    canvas.addEventListener('contextmenu', event => event.preventDefault());

    new ResizeObserver(requestFrame).observe(wrap);

    // A background tab stops rAF and throttles timers; refresh as soon as the
    // page is visible again instead of waiting for the next poll.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        requestFrame();
        if (active) poll();
    });

    onLanguageChange(() => {
        updatePanel();
        requestFrame();
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
