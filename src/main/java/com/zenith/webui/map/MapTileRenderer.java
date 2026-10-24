package com.zenith.webui.map;

import com.zenith.cache.data.chunk.Chunk;
import com.zenith.cache.data.chunk.ChunkCache;
import com.zenith.feature.map.Brightness;
import com.zenith.mc.block.Block;
import org.geysermc.mcprotocollib.protocol.data.game.chunk.ChunkSection;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

import static com.zenith.Globals.BLOCK_DATA;
import static com.zenith.Globals.CACHE;
import static com.zenith.Globals.MAP_BLOCK_COLOR;

/**
 * Renders 256×256 PNG tiles of the world the proxy has currently loaded.
 *
 * <p>There is no external tile server: every pixel is derived from the live chunk
 * cache, so the map shows exactly what the bot can see and nothing else. Columns
 * whose chunk is not loaded stay transparent and the browser paints the
 * background through them.
 *
 * <p>Colours come from {@code MAP_BLOCK_COLOR} (the vanilla map palette) plus the
 * same neighbour-height shading the vanilla map item uses, which is what gives
 * terrain its relief instead of a flat blob of green.
 *
 * <p>Tiles are cached with a short TTL — blocks change as the bot walks — in an
 * access-ordered LRU so panning never re-renders the same tile twice in a row.
 */
public final class MapTileRenderer {

    /** Edge length of one tile in pixels. */
    public static final int TILE_PX = 256;
    /** A cached tile older than this is re-rendered (world edits, bot movement). */
    private static final long CACHE_TTL_MS = 6_000L;
    private static final int CACHE_MAX_TILES = 64;
    /** Marker for "this column has no visible block" (distinct from height 0). */
    private static final long NO_COLUMN = Long.MIN_VALUE;
    /** Vanilla map colour id of water — shaded with a dither instead of relief. */
    private static final int WATER_COLOR_ID = 12;
    /** {@code ChunkSection} reports air as state 0; skipping it early saves lookups. */
    private static final int AIR_STATE_ID = 0;

    private final Map<String, CachedTile> cache = new LinkedHashMap<>(32, 0.75f, true);

    private record CachedTile(byte[] png, long createdAt) {
    }

    /**
     * Returns the PNG for one tile, rendering it when the cached copy is stale.
     *
     * @param tileX tile index along X (one tile covers {@code TILE_PX * scale} blocks)
     * @param tileZ tile index along Z
     * @param scale blocks per pixel (0.5 = two pixels per block)
     */
    public byte[] tile(final int tileX, final int tileZ, final double scale) {
        final String key = scale + "/" + tileX + "/" + tileZ;
        final long now = System.currentTimeMillis();
        synchronized (cache) {
            final CachedTile cached = cache.get(key);
            if (cached != null && now - cached.createdAt() < CACHE_TTL_MS) return cached.png();
        }
        // Render outside the lock: two concurrent requests may duplicate work, but
        // blocking other tiles behind a slow render is far worse for panning.
        final byte[] png = render(tileX, tileZ, scale);
        synchronized (cache) {
            cache.put(key, new CachedTile(png, now));
            final Iterator<String> eldest = cache.keySet().iterator();
            while (cache.size() > CACHE_MAX_TILES && eldest.hasNext()) {
                eldest.next();
                eldest.remove();
            }
        }
        return png;
    }

    private byte[] render(final int tileX, final int tileZ, final double scale) {
        final double tileBlocks = TILE_PX * scale;
        final int originX = (int) Math.floor(tileX * tileBlocks);
        final int originZ = (int) Math.floor(tileZ * tileBlocks);
        final int[] pixels = new int[TILE_PX * TILE_PX];
        final ChunkCache chunkCache = CACHE.getChunkCache();

        Chunk chunk = null;
        int chunkX = Integer.MIN_VALUE;
        int chunkZ = Integer.MIN_VALUE;

        for (int py = 0; py < TILE_PX; py++) {
            final int blockZ = originZ + (int) Math.floor(py * scale);
            final int rowOffset = py * TILE_PX;
            // Vanilla shades a column against the previous column of the same row.
            int previousHeight = Integer.MIN_VALUE;
            for (int px = 0; px < TILE_PX; px++) {
                final int blockX = originX + (int) Math.floor(px * scale);
                final int cx = blockX >> 4;
                final int cz = blockZ >> 4;
                if (cx != chunkX || cz != chunkZ) {
                    chunk = chunkCache.get(cx, cz);
                    chunkX = cx;
                    chunkZ = cz;
                }
                if (chunk == null) {
                    previousHeight = Integer.MIN_VALUE;
                    continue;
                }
                final long column = topColumn(chunk, blockX & 15, blockZ & 15);
                if (column == NO_COLUMN) {
                    previousHeight = Integer.MIN_VALUE;
                    continue;
                }
                final int height = (int) (column >> 8);
                final int colorId = (int) (column & 0xFF);
                pixels[rowOffset + px] = colorOf(colorId, brightnessFor(colorId, height, previousHeight, blockX, blockZ));
                previousHeight = height;
            }
        }
        return encode(pixels);
    }

    /**
     * Picks the shade for one column: water uses an alternating dither (depth is not
     * tracked), everything else uses the height delta against the previous column,
     * mirroring the vanilla map renderer.
     */
    private static Brightness brightnessFor(final int colorId, final int height,
                                            final int previousHeight, final int blockX, final int blockZ) {
        final boolean even = ((blockX + blockZ) & 1) == 0;
        if (colorId == WATER_COLOR_ID) return even ? Brightness.HIGH : Brightness.NORMAL;
        final int previous = previousHeight == Integer.MIN_VALUE ? height : previousHeight;
        final double delta = (height - previous) * 4.0 / 5.0 + (even ? 0.5 : -0.5) * 0.4;
        if (delta > 0.6) return Brightness.HIGH;
        if (delta < -0.6) return Brightness.LOW;
        return Brightness.NORMAL;
    }

    private static int colorOf(final int colorId, final Brightness brightness) {
        return MAP_BLOCK_COLOR.calculateRGBColorI(MAP_BLOCK_COLOR.getColor(colorId), brightness);
    }

    /**
     * Finds the highest block in a column that has a map colour.
     *
     * <p>Height maps are intentionally not cached by ZenithProxy (they go stale on
     * block updates), so the column is scanned downward — but whole sections are
     * skipped when they hold no blocks at all, which is the common case for the
     * sky above the surface.
     *
     * @return {@code (height << 8) | mapColorId}, or {@link #NO_COLUMN}
     */
    private static long topColumn(final Chunk chunk, final int relX, final int relZ) {
        final ChunkSection[] sections = chunk.getSections();
        final int minSection = chunk.getMinSection();
        for (int i = sections.length - 1; i >= 0; i--) {
            final ChunkSection section = sections[i];
            if (section == null || section.isBlockCountEmpty()) continue;
            final int baseY = (i + minSection) << 4;
            for (int y = 15; y >= 0; y--) {
                final int stateId = section.getBlock(relX, y, relZ);
                if (stateId == AIR_STATE_ID) continue;
                final Block block = BLOCK_DATA.getBlockDataFromBlockStateId(stateId);
                if (block == null || block.isAir()) continue;
                final int colorId = block.mapColorId();
                // 0 means "not on the map" (glass, barrier, plants) — keep looking down.
                if (colorId <= 0) continue;
                return ((long) (baseY + y) << 8) | colorId;
            }
        }
        return NO_COLUMN;
    }

    private static byte[] encode(final int[] pixels) {
        final BufferedImage image = new BufferedImage(TILE_PX, TILE_PX, BufferedImage.TYPE_INT_ARGB);
        image.setRGB(0, 0, TILE_PX, TILE_PX, pixels, 0, TILE_PX);
        final ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
        try {
            ImageIO.write(image, "png", out);
        } catch (final IOException e) {
            // A PNG writer is always present in a JDK; treat a failure as a bug.
            throw new UncheckedIOException("Failed to encode map tile", e);
        }
        return out.toByteArray();
    }
}
