/**
 * Map tile protocol + shared constants.
 *
 * The tile layout follows the classic slippy-map convention (Leaflet / OSM /
 * Mapbox GL):
 *
 *   - the world is tiled into 256×256 px squares, one per tile;
 *   - `zoom` is a continuous value (fractional zoom, as in Mapbox GL); tiles
 *     live on the integer levels of that axis;
 *   - at level `l` a tile covers `TILE_PX * 2^l` blocks, i.e. `2^l` blocks per
 *     pixel — `l = 0` is 1 block per pixel, positive zooms out, negative zooms
 *     in;
 *   - a tile is addressed by `z/x/y` (zoom, column, row), where `y` is the
 *     north→south row mapped to the world Z axis.
 *
 * Because the proxy only holds the chunks around the bot, the source is
 * *sparse*: tiles outside the loaded area simply have no data and are never
 * requested.
 */

/** Tile edge in pixels — must match MapTileRenderer.TILE_PX. */
export const TILE_PX = 256;

/** Zoom range, in integer levels (`2^zoom` blocks per pixel). */
export const ZOOM_MIN = -4; // 16 px per block — as close as the user can go
export const ZOOM_MAX = 6;  // 64 blocks per pixel — as far as the user can go
export const ZOOM_DURATION_MS = 200;
/**
 * Zoom delta per notch (in levels). The tile pyramid only has integer levels,
 * but fractional zoom (Mapbox GL) lets each notch be much smaller than the 2×
 * between levels — three notches = one level ≈ 1.26× each.
 */
export const ZOOM_NOTCH = 1 / 3;

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

/** Blocks per pixel at a given (fractional) zoom. */
export function blocksPerPixel(zoom) {
    return Math.pow(2, zoom);
}

/** World size (in blocks) of one tile at an integer level. */
export function tileWorld(level) {
    return TILE_PX * Math.pow(2, level);
}
