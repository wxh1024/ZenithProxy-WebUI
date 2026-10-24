/**
 * Tile store: the browser-side tile cache.
 *
 * <p>Owns image loading, freshness and eviction. It knows nothing about pixels
 * beyond the tile geometry, and nothing about the bot — geometry comes in from
 * the camera, the "loaded area" comes in from `/api/map/state`.
 *
 * <p>The policy it implements:
 * <ul>
 *   <li>a tile is only (re)requested when it overlaps the chunks the proxy has
 *       loaded — outside that area the server has nothing new to say;</li>
 *   <li>everything else is served from cache, so ground the bot has walked past
 *       keeps rendering instead of turning blank;</li>
 *   <li>failed loads back off and retry, because a tile rendered while the world
 *       was being mutated can fail once and then succeed;</li>
 *   <li>eviction never touches a tile drawn in the last {@link EVICT_GRACE_MS},
 *       and prefers stale snapshots over fresh ones.</li>
 * </ul>
 */

import {EVICT_GRACE_MS, MAX_CACHED_TILES, TILE_PX, TILE_TTL_MS} from './constants.js';

export class TileStore {
    /**
     * @param {string} baseUrl API root (e.g. `http://host/api`)
     * @param {{maxTiles?: number, ttlMs?: number}} options
     */
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        this.maxTiles = options.maxTiles ?? MAX_CACHED_TILES;
        this.ttlMs = options.ttlMs ?? TILE_TTL_MS;
        /** `${level}/${tx}/${tz}` → entry */
        this.entries = new Map();
        /** level → number of cached tiles (candidate list for the fallback draw). */
        this.levelCounts = new Map();
        /** Block bounds of the loaded chunks, or null when unknown/offline. */
        this.loaded = null;
        /** Called when a tile finishes loading, so the page can redraw. */
        this.onTileLoaded = null;
    }

    static key(level, tx, tz) {
        return `${level}/${tx}/${tz}`;
    }

    /** Loaded-chunk bounds from `/api/map/state`; `null` disables the clamp. */
    setLoadedArea(area) {
        this.loaded = area;
    }

    /** True when a tile overlaps the chunks the proxy currently has loaded. */
    isRefreshable(level, tx, tz) {
        const area = this.loaded;
        if (!area) return true;
        const span = TILE_PX * level;
        const minX = tx * span;
        const minZ = tz * span;
        return minX + span > area.minX && minX < area.maxX
            && minZ + span > area.minZ && minZ < area.maxZ;
    }

    /**
     * Entry for a tile. `wantFetch` allows a load/refresh; without it only
     * already-cached tiles are returned (`null` when nothing is known yet).
     */
    get(level, tx, tz, wantFetch) {
        const key = TileStore.key(level, tx, tz);
        const now = Date.now();
        let entry = this.entries.get(key);
        if (!entry) {
            if (!wantFetch) return null;
            entry = {
                key, level, tx, tz,
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
        const stale = entry.state !== 'ready' || now - entry.loadedAt > this.ttlMs;
        if (wantFetch && stale && !entry.pending && now >= entry.retryAt) {
            this.#load(entry);
        }
        return entry;
    }

    /**
     * Nearest cached tile from another level covering the same ground, used as
     * the fallback when the active level has a hole. Without this, every zoom
     * step would blank the parts of the map that only exist at other levels.
     *
     * @param {number[]} candidates level list already sorted by proximity
     */
    coveringTile(activeLevel, tx, tz, candidates) {
        const span = TILE_PX * activeLevel;
        const minX = tx * span;
        const minZ = tz * span;
        for (const level of candidates) {
            const otherSpan = TILE_PX * level;
            const otherX = Math.floor(minX / otherSpan);
            const otherZ = Math.floor(minZ / otherSpan);
            const entry = this.entries.get(TileStore.key(level, otherX, otherZ));
            if (entry && entry.state === 'ready' && entry.img) return entry;
        }
        return null;
    }

    /** Levels currently holding tiles, nearest to `activeLevel` first. */
    levelsByProximity(activeLevel) {
        return [...this.levelCounts.keys()]
            .filter(level => level !== activeLevel)
            .sort((a, b) => Math.abs(Math.log(a / activeLevel)) - Math.abs(Math.log(b / activeLevel)));
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
            // A render racing a world update can fail once and succeed after;
            // back off so a genuinely broken tile cannot spin the network.
            entry.retryAt = Date.now() + Math.min(4000, 400 * entry.attempts);
            if (!entry.img) entry.state = 'error';
        };
        img.src = `${this.baseUrl}/map/tile?x=${entry.tx}&z=${entry.tz}&s=${entry.level}`;
    }

    /**
     * Trims the cache back to budget. Called once per frame; a no-op unless the
     * store is over budget.
     */
    sweep(now = Date.now()) {
        const over = this.entries.size - this.maxTiles;
        if (over <= 0) return;
        const candidates = [];
        for (const entry of this.entries.values()) {
            if (now - entry.touchedAt < EVICT_GRACE_MS) continue;
            // Snapshots from outside the loaded area cannot be rebuilt by the
            // server, so they go last.
            const rebuildable = this.isRefreshable(entry.level, entry.tx, entry.tz);
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
