/**
 * Shared constants for the map page.
 *
 * Kept in one module so the camera, the tile store and the renderer agree on
 * the tile geometry and the zoom ladder without importing each other.
 */

/** Tile edge in pixels — must match MapTileRenderer.TILE_PX. */
export const TILE_PX = 256;

/** Blocks per pixel at the closest/furthest zoom. Server accepts this range. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
/** Ladder ratio per notch — small steps, so one click is not a jump. */
export const ZOOM_STEP = 1.25;
/** Duration of a zoom transition. */
export const ZOOM_DURATION_MS = 190;

/** Bot state sample interval. */
export const POLL_MS = 500;
/** A tile inside the loaded area is re-rendered this often. */
export const TILE_TTL_MS = 4000;
/** Decoded tiles kept in the browser (~256 KB each). */
export const MAX_CACHED_TILES = 180;
/** A tile drawn within this window is never evicted. */
export const EVICT_GRACE_MS = 2000;

/** Grid line spacing candidates, in blocks. */
export const GRID_STEPS = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

export const COLOR = {
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
