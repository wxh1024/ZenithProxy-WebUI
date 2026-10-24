/**
 * Camera: the map's continuous view transform.
 *
 * Modeled on Mapbox GL's fractional zoom: `zoom` is a float, and the tile grid
 * lives on the integer levels of that axis. The camera owns the world↔screen
 * conversion — it exists nowhere else — plus the animated zoom transition.
 */

import {blocksPerPixel, TILE_PX, ZOOM_DURATION_MS, ZOOM_MAX, ZOOM_MIN} from './constants.js';

export class Camera {
    constructor(zoom = 0) {
        this.zoom = zoom;
        this.cx = 0;
        this.cz = 0;
        this.width = 0;
        this.height = 0;
        /** Follow the bot until the user pans or zooms at the cursor. */
        this.follow = true;
        /** {from, to, start, worldX, worldZ, px, py} while a transition runs. */
        this.animation = null;
    }

    setViewport(width, height) {
        this.width = width;
        this.height = height;
    }

    // ── transforms ────────────────────────────────────────────────

    toScreenX(worldX) {
        return (worldX - this.cx) / blocksPerPixel(this.zoom) + this.width / 2;
    }

    toScreenZ(worldZ) {
        return (worldZ - this.cz) / blocksPerPixel(this.zoom) + this.height / 2;
    }

    toWorldX(px) {
        return (px - this.width / 2) * blocksPerPixel(this.zoom) + this.cx;
    }

    toWorldZ(py) {
        return (py - this.height / 2) * blocksPerPixel(this.zoom) + this.cz;
    }

    centreOn(x, z) {
        this.cx = x;
        this.cz = z;
    }

    // ── zoom ──────────────────────────────────────────────────────

    isZooming() {
        return this.animation !== null;
    }

    /** The integer level whose tiles should be fetched. */
    fetchLevel() {
        return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(this.zoom)));
    }

    /**
     * Animates a zoom change of `delta` levels (positive = out, and `delta` may
     * be fractional — see {@link ZOOM_NOTCH}). The world point under the anchor
     * stays fixed throughout. Because zoom is interpolated as a float, the
     * transition is smooth even between the integer tile levels.
     */
    zoomBy(delta, anchorPx, anchorPy) {
        if (!delta) return false;
        const target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom + delta));
        if (target === this.zoom && !this.animation) return false;
        const px = Number.isFinite(anchorPx) ? anchorPx : this.width / 2;
        const py = Number.isFinite(anchorPy) ? anchorPy : this.height / 2;
        this.animation = {
            from: this.zoom,
            to: target,
            start: performance.now(),
            worldX: this.toWorldX(px),
            worldZ: this.toWorldZ(py),
            px,
            py,
        };
        return true;
    }

    /** Advances the transition; returns true while it is still running. */
    advanceZoom(now) {
        const anim = this.animation;
        if (!anim) return false;
        const t = Math.min(1, Math.max(0, (now - anim.start) / ZOOM_DURATION_MS));
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        this.zoom = anim.from + (anim.to - anim.from) * eased;
        // Pin the anchored block: the centre has to move as the zoom changes.
        this.cx = anim.worldX - (anim.px - this.width / 2) * blocksPerPixel(this.zoom);
        this.cz = anim.worldZ - (anim.py - this.height / 2) * blocksPerPixel(this.zoom);
        if (t < 1) return true;
        this.zoom = anim.to;
        this.animation = null;
        return false;
    }

    /** Jumps to the end of a running transition. */
    finishZoom() {
        if (!this.animation) return;
        this.zoom = this.animation.to;
        this.animation = null;
    }

    // ── tiles ─────────────────────────────────────────────────────

    /** Screen size in pixels of a tile of `level` at the current zoom. */
    tileSizePx(level) {
        return TILE_PX * Math.pow(2, level - this.zoom);
    }

    /** Integer tile index range of `level` covering the viewport. */
    tileRange(level) {
        const span = TILE_PX * Math.pow(2, level);
        const halfW = (this.width / 2) * blocksPerPixel(this.zoom);
        const halfH = (this.height / 2) * blocksPerPixel(this.zoom);
        return {
            span,
            firstX: Math.floor((this.cx - halfW) / span),
            lastX: Math.floor((this.cx + halfW) / span),
            firstY: Math.floor((this.cz - halfH) / span),
            lastY: Math.floor((this.cz + halfH) / span),
        };
    }
}
