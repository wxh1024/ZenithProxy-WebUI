/**
 * Camera: the map's view transform plus its zoom ladder.
 *
 * Pure geometry — no DOM, no tiles. The renderer and the tile store both read
 * "what is on screen" from here, so screen↔world conversions exist in exactly
 * one place.
 */

import {MAX_SCALE, MIN_SCALE, TILE_PX, ZOOM_DURATION_MS, ZOOM_STEP} from './constants.js';

/** Zoom ladder, furthest first; built from MAX down so both ends are exact. */
export const ZOOM_LEVELS = (() => {
    const levels = [];
    for (let scale = MAX_SCALE; scale >= MIN_SCALE - 1e-9; scale /= ZOOM_STEP) {
        levels.unshift(Math.round(scale * 10000) / 10000);
    }
    return levels;
})();

/** Index of the ladder rung closest to `scale` (log distance, so steps feel even). */
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

export class Camera {
    constructor(scale = 1) {
        this.scale = scale;      // animated value (blocks per pixel)
        this.tileScale = scale;  // settled ladder rung the tile grid belongs to
        this.cx = 0;
        this.cz = 0;
        this.width = 0;
        this.height = 0;
        /** Follow the bot until the user pans or zooms at the cursor. */
        this.follow = true;
        this.animation = null;
    }

    setViewport(width, height) {
        this.width = width;
        this.height = height;
    }

    // ── transforms ────────────────────────────────────────────────

    toScreenX(worldX) {
        return (worldX - this.cx) / this.scale + this.width / 2;
    }

    toScreenZ(worldZ) {
        return (worldZ - this.cz) / this.scale + this.height / 2;
    }

    toWorldX(px) {
        return (px - this.width / 2) * this.scale + this.cx;
    }

    toWorldZ(py) {
        return (py - this.height / 2) * this.scale + this.cz;
    }

    centreOn(x, z) {
        this.cx = x;
        this.cz = z;
    }

    // ── zoom ──────────────────────────────────────────────────────

    isZooming() {
        return this.animation !== null;
    }

    /**
     * Moves `steps` rungs along the ladder (positive = further out). The world
     * point under the anchor stays under the anchor for the whole transition.
     */
    zoomBy(steps, anchorPx, anchorPy) {
        if (!steps) return false;
        const reference = this.animation ? this.animation.to : this.scale;
        const index = Math.min(ZOOM_LEVELS.length - 1,
            Math.max(0, nearestLevelIndex(reference) + steps));
        const target = ZOOM_LEVELS[index];
        if (Math.abs(target - reference) < 1e-9) return false;
        this.zoomTo(target, anchorPx, anchorPy);
        return true;
    }

    zoomTo(target, anchorPx, anchorPy) {
        const px = Number.isFinite(anchorPx) ? anchorPx : this.width / 2;
        const py = Number.isFinite(anchorPy) ? anchorPy : this.height / 2;
        this.animation = {
            from: this.scale,
            to: target,
            start: performance.now(),
            worldX: this.toWorldX(px),
            worldZ: this.toWorldZ(py),
            px,
            py,
        };
    }

    /**
     * Advances the transition; returns true while it is still running.
     * Interpolation is geometric — equal ratios per unit time read as smooth.
     */
    advanceZoom(now) {
        const anim = this.animation;
        if (!anim) return false;
        const t = Math.min(1, Math.max(0, (now - anim.start) / ZOOM_DURATION_MS));
        const eased = 1 - Math.pow(1 - t, 3);
        this.scale = anim.from * Math.pow(anim.to / anim.from, eased);
        // Pin the anchored block: the centre has to move as the scale changes.
        this.cx = anim.worldX - (anim.px - this.width / 2) * this.scale;
        this.cz = anim.worldZ - (anim.py - this.height / 2) * this.scale;
        if (t < 1) return true;
        this.scale = anim.to;
        this.tileScale = anim.to;
        this.animation = null;
        return false;
    }

    /** Jumps to the end of a running transition. */
    finishZoom() {
        if (!this.animation) return;
        this.scale = this.animation.to;
        this.tileScale = this.animation.to;
        this.animation = null;
    }

    // ── tiles ─────────────────────────────────────────────────────

    /** Screen size of one tile of `level`, in pixels. */
    tileSize(level) {
        return (TILE_PX * level) / this.scale;
    }

    /** Tile index range of `level` covering the viewport. */
    tileRange(level) {
        const span = TILE_PX * level;
        const halfW = (this.width / 2) * this.scale;
        const halfH = (this.height / 2) * this.scale;
        return {
            span,
            firstX: Math.floor((this.cx - halfW) / span),
            lastX: Math.floor((this.cx + halfW) / span),
            firstZ: Math.floor((this.cz - halfH) / span),
            lastZ: Math.floor((this.cz + halfH) / span),
        };
    }
}
