/**
 * Renderer: paints one frame of the map onto a canvas.
 *
 * Draw order (bottom → top): a coarse fallback layer for cells the active level
 * does not cover yet, then the active level, then the grid, path and markers.
 * It reads the camera and the tile store but never mutates the page.
 */

import {COLOR, GRID_STEPS, TILE_PX} from './constants.js';

/**
 * Makes the canvas' backing store match its CSS box and returns false while the
 * element has no size yet (hidden page).
 *
 * Measured per frame on purpose: the card can be re-laid out at any time, and a
 * stale size shifts every tile *and* every click conversion.
 */
export function syncCanvas(canvas, ctx, camera) {
    if (!canvas || !ctx) return false;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return false;
    if (width !== camera.width || height !== camera.height || canvas.width === 0) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        camera.setViewport(width, height);
    }
    return true;
}

export function drawScene(ctx, camera, store, state, now) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = COLOR.unloaded;
    ctx.fillRect(0, 0, camera.width, camera.height);

    drawTiles(ctx, camera, store, now);
    drawGrid(ctx, camera);
    drawPath(ctx, camera, state);
    drawMarkers(ctx, camera, state);
    store.sweep(now);
}

function drawTiles(ctx, camera, store, now) {
    const level = camera.fetchLevel();
    const range = camera.tileRange(level);
    // Tiles are only fetched while the zoom rests on an integer level, otherwise
    // a mid-transition level would be requested and thrown away.
    const canFetch = !camera.isZooming();
    const missing = [];
    const ready = [];

    for (let x = range.firstX; x <= range.lastX; x++) {
        for (let y = range.firstY; y <= range.lastY; y++) {
            // First fetch is allowed anywhere — the server persists terrain the
            // bot has seen, so ground outside the view distance still arrives.
            // TTL refresh happens only inside the live area, where blocks change.
            const inside = store.isRefreshable(level, x, y);
            const load = canFetch;
            const refresh = canFetch && inside && store.hasLoadedArea();
            const entry = store.get(level, x, y, load, refresh);
            if (entry && entry.state === 'ready' && entry.img) ready.push(entry);
            else missing.push({x, y});
        }
    }

    if (missing.length) {
        // Best-available resolution: a cell that has no tile at the active level
        // is filled with a cached tile from another level (drawn scaled). This is
        // why zooming never blanks ground the bot has already explored.
        const candidates = store.levelsByProximity(level);
        if (candidates.length) {
            const drawn = new Set();
            for (const cell of missing) {
                const cover = store.coveringTile(level, cell.x, cell.y, candidates);
                if (!cover || drawn.has(cover.key)) continue;
                drawn.add(cover.key);
                drawTile(ctx, camera, cover);
                store.touch(cover, now);
            }
        }
    }

    for (const entry of ready) {
        drawTile(ctx, camera, entry);
        store.touch(entry, now);
    }
}

function drawTile(ctx, camera, entry) {
    const size = camera.tileSizePx(entry.level);
    const crisp = Math.abs(size - TILE_PX) < 0.25;
    const span = TILE_PX * Math.pow(2, entry.level);
    const left = camera.toScreenX(entry.x * span);
    const top = camera.toScreenZ(entry.y * span);
    ctx.drawImage(
        entry.img,
        crisp ? Math.round(left) : left,
        crisp ? Math.round(top) : top,
        crisp ? TILE_PX : size,
        crisp ? TILE_PX : size,
    );
}

/** Coordinate grid with edge labels, so positions can be read off the map. */
function drawGrid(ctx, camera) {
    const step = GRID_STEPS.find(candidate => candidate * Math.pow(2, -camera.zoom) >= 90)
        || GRID_STEPS[GRID_STEPS.length - 1];
    const halfWBlocks = (camera.width / 2) * Math.pow(2, camera.zoom);
    const halfHBlocks = (camera.height / 2) * Math.pow(2, camera.zoom);

    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLOR.gridLabel;
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';

    const startX = Math.ceil((camera.cx - halfWBlocks) / step) * step;
    for (let wx = startX; wx <= camera.cx + halfWBlocks; wx += step) {
        const px = Math.round(camera.toScreenX(wx)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, camera.height);
        ctx.stroke();
        ctx.fillText(String(wx), px + 3, 3);
    }
    const startZ = Math.ceil((camera.cz - halfHBlocks) / step) * step;
    for (let wz = startZ; wz <= camera.cz + halfHBlocks; wz += step) {
        const py = Math.round(camera.toScreenZ(wz)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(camera.width, py);
        ctx.stroke();
        ctx.fillText(String(wz), 3, py + 2);
    }
}

function drawPath(ctx, camera, state) {
    const points = state.path;
    if (!points || points.length < 2) {
        if (state.target) drawDashedToTarget(ctx, camera, state, null);
        return;
    }
    const split = Math.min(Math.max(state.progress, 0), points.length - 1);
    strokeSegment(ctx, camera, points, 0, split, COLOR.pathTravelled, 2);
    strokeSegment(ctx, camera, points, split, points.length - 1, COLOR.path, 2.5);
    drawDashedToTarget(ctx, camera, state, points[points.length - 1]);
}

function strokeSegment(ctx, camera, points, from, to, color, width) {
    if (to <= from) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = from; i <= to; i++) {
        const px = camera.toScreenX(points[i][0]);
        const py = camera.toScreenZ(points[i][2]);
        if (i === from) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();
}

/** Dashed hint from the end of the planned segment to the requested target. */
function drawDashedToTarget(ctx, camera, state, lastPoint) {
    if (!state.target) return;
    const start = lastPoint
        ? {x: camera.toScreenX(lastPoint[0]), y: camera.toScreenZ(lastPoint[2])}
        : state.marker;
    if (!start) return;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLOR.pathPlanned;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(camera.toScreenX(state.target.x), camera.toScreenZ(state.target.z));
    ctx.stroke();
    ctx.restore();
}

function drawMarkers(ctx, camera, state) {
    if (state.target) {
        drawTargetMarker(ctx, camera.toScreenX(state.target.x), camera.toScreenZ(state.target.z));
    }
    if (state.marker && state.facing !== null && state.facing !== undefined) {
        drawBotMarker(ctx, state.marker, state.facing);
    }
}

function drawTargetMarker(ctx, x, y) {
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

function drawBotMarker(ctx, marker, yawDegrees) {
    const x = marker.x;
    const y = marker.y;
    // Facing indicator first, so the marker box sits on top of its base.
    const yaw = (yawDegrees || 0) * Math.PI / 180;
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
