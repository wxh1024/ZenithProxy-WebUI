/**
 * Tile store: the browser-side sparse tile cache.
 *
 * Owns image loading, freshness and eviction — no canvas, no bot state. The
 * layout is the standard `z/x/y` slippy-map grid (see constants.js), but the
 * source is *sparse*: tiles outside the loaded area are never requested.
 *
 * Responsibilities, and nothing else:
 *   - fetch a tile (with backoff retry) and report when it arrives;
 *   - answer "is this tile fresh?" and "does it overlap the loaded area?";
 *   - serve cached tiles from any level as a fallback for the renderer;
 *   - evict under memory pressure without ever dropping a tile drawn moments ago.
 */

import {EVICT_GRACE_MS, MAX_CACHED_TILES, TILE_TTL_MS, tileWorld} from './constants.js';

export class TileStore {
    /**
     * @param {string} baseUrl API root (e.g. `http://host/api`)
     * @param {{maxTiles?: number, ttlMs?: number}} options
     */
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        this.maxTiles = options.maxTiles ?? MAX_CACHED_TILES;
        this.ttlMs = options.ttlMs ?? TILE_TTL_MS;
        /** `level/x/y` → entry */
        this.entries = new Map();
        /** level → count (the fallback lookup walks these). */
        this.levelCounts = new Map();
        /** Loaded-chunk bounds `{minX,minZ,maxX,maxZ}`; null disables the clamp. */
        this.loaded = null;
        /** Called when a tile finishes loading, so the page can redraw. */
        this.onTileLoaded = null;
    }

    static key(level, x, y) {
        return `${level}/${x}/${y}`;
    }

    /** Loaded-chunk bounds from `/api/map/state`. */
    setLoadedArea(area) {
        this.loaded = area;
    }

    /** True once the server has reported the loaded area (not offline/unknown). */
    hasLoadedArea() {
        return this.loaded != null;
    }

    /** True when a tile overlaps the chunks the proxy currently has loaded. */
    isRefreshable(level, x, y) {
        const area = this.loaded;
        if (!area) return true;
        const span = tileWorld(level);
        const minX = x * span;
        const minZ = y * span;
        return minX + span > area.minX && minX < area.maxX
            && minZ + span > area.minZ && minZ < area.maxZ;
    }

    /**
     * Entry for a tile.
     *
     * <p>{@code load} allows the first fetch (anywhere — persisted terrain from
     * outside the view distance is pulled once), {@code refresh} allows a TTL
     * re-fetch (only inside the live area, where the world changes). Without
     * {@code load}, only already-cached tiles are returned.
     */
    get(level, x, y, load, refresh) {
        const key = TileStore.key(level, x, y);
        const now = Date.now();
        let entry = this.entries.get(key);
        if (!entry) {
            if (!load) return null;
            entry = {
                key, level, x, y,
                img: null,
                state: 'idle',
                pending: false,
                attempts: 0,
                loadedAt: 0,
                retryAt: 0,
                touchedAt: now,
            };
            this.entries.set(key, entry);
            this.levelCounts.set(level, (this.levelCounts.get(level) || 0) + 1);
        }
        if (entry.pending || now < entry.retryAt) return entry;
        if (entry.state !== 'ready' && load) {
            this.#load(entry);
        } else if (entry.state === 'ready' && refresh && now - entry.loadedAt > this.ttlMs) {
            this.#load(entry);
        }
        return entry;
    }

    /**
     * Nearest cached tile from another level covering the same ground — the
     * renderer's fallback so that zooming never blanks a cell that exists at
     * some other resolution.
     *
     * @param {number[]} candidates levels sorted by proximity to `level`
     */
    coveringTile(level, x, y, candidates) {
        const span = tileWorld(level);
        const minX = x * span;
        const minZ = y * span;
        for (const other of candidates) {
            const otherSpan = tileWorld(other);
            const otherX = Math.floor(minX / otherSpan);
            const otherY = Math.floor(minZ / otherSpan);
            const entry = this.entries.get(TileStore.key(other, otherX, otherY));
            if (entry && entry.state === 'ready' && entry.img) return entry;
        }
        return null;
    }

    /** Levels currently holding tiles, nearest to `level` first. */
    levelsByProximity(level) {
        return [...this.levelCounts.keys()]
            .filter(other => other !== level)
            .sort((a, b) => Math.abs(a - level) - Math.abs(b - level));
    }

    /** Marks a tile as drawn this frame (protects it from eviction). */
    touch(entry, now = Date.now()) {
        entry.touchedAt = now;
    }

    #load(entry) {
        entry.pending = true;
        const img = new Image();
        img.onload = () => {
            entry.img = img;
            entry.state = 'ready';
            entry.pending = false;
            entry.attempts = 0;
            entry.loadedAt = Date.now();
            this.onTileLoaded?.();
        };
        img.onerror = () => {
            entry.pending = false;
            entry.attempts += 1;
            // A render racing a world update can fail once then succeed; back off
            // so a genuinely broken tile cannot spin the network.
            entry.retryAt = Date.now() + Math.min(4000, 400 * entry.attempts);
            if (!entry.img) entry.state = 'error';
        };
        img.src = `${this.baseUrl}/map/tile?z=${entry.level}&x=${entry.x}&y=${entry.y}`;
    }

    /** Trims the cache back to budget; a no-op unless over budget. */
    sweep(now = Date.now()) {
        const over = this.entries.size - this.maxTiles;
        if (over <= 0) return;
        const candidates = [];
        for (const entry of this.entries.values()) {
            if (now - entry.touchedAt < EVICT_GRACE_MS) continue;
            // Snapshots from outside the loaded area cannot be rebuilt by the
            // server, so they go last.
            const rebuildable = this.isRefreshable(entry.level, entry.x, entry.y);
            candidates.push({entry, rank: rebuildable ? 0 : 1});
        }
        candidates.sort((a, b) => a.rank - b.rank || a.entry.touchedAt - b.entry.touchedAt);
        for (let i = 0; i < over && i < candidates.length; i++) {
            this.#remove(candidates[i].entry);
        }
    }

    #remove(entry) {
        this.entries.delete(entry.key);
        const count = (this.levelCounts.get(entry.level) || 1) - 1;
        if (count > 0) this.levelCounts.set(entry.level, count);
        else this.levelCounts.delete(entry.level);
    }
}
