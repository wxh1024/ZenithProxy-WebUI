package com.zenith.webui.map;

import com.zenith.cache.data.chunk.Chunk;
import com.zenith.cache.data.chunk.ChunkCache;
import com.zenith.feature.map.Brightness;
import com.zenith.mc.block.Block;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.geysermc.mcprotocollib.protocol.data.game.chunk.ChunkSection;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static com.zenith.Globals.BLOCK_DATA;
import static com.zenith.Globals.CACHE;
import static com.zenith.Globals.MAP_BLOCK_COLOR;

/**
 * Renders 256×256 PNG tiles of the world the proxy has loaded, and persists
 * them so ground the bot has already walked stays available as tiles.
 *
 * <p>The live chunk cache only holds the bot's current view distance — chunks
 * unload as it walks away. To keep the map covering the whole walked trail, each
 * tile that has any content is written to a disk cache keyed by
 * {@code <level>/<x>/<y>.png}; when a later request falls on a tile whose live
 * chunks are gone, the persisted copy is served instead of a blank.
 *
 * <p>Colours come from {@code MAP_BLOCK_COLOR} (the vanilla map palette) plus
 * neighbour-height shading, which is what gives terrain its relief.
 */
public final class MapTileRenderer {

    private static final ComponentLogger LOG = ComponentLogger.logger("WebUI");

    /** Edge length of one tile in pixels. */
    public static final int TILE_PX = 256;
    /** A fresh tile is re-rendered after this long (blocks change as the bot walks). */
    private static final long CACHE_TTL_MS = 3_000L;
    private static final int CACHE_MAX_TILES = 64;
    /** Upper bound on persisted tiles; the oldest are pruned beyond it. */
    private static final int MAX_DISK_TILES = 10_000;
    /** Prune the disk cache every N writes (amortised, avoids a scan per write). */
    private static final int PRUNE_EVERY_WRITES = 256;
    /** Marker for "this column has no visible block" (distinct from height 0). */
    private static final long NO_COLUMN = Long.MIN_VALUE;
    /** Vanilla map colour id of water — shaded with a dither instead of relief. */
    private static final int WATER_COLOR_ID = 12;
    /** {@code ChunkSection} reports air as state 0; skipping it early saves lookups. */
    private static final int AIR_STATE_ID = 0;

    private final Map<String, CachedTile> cache = new LinkedHashMap<>(32, 0.75f, true);
    /** Persisted tile root; {@code null} disables the disk cache. */
    private final Path cacheDir;
    private boolean diskReady;
    private int writesSincePrune;

    private record CachedTile(byte[] png, long createdAt) {
    }

    private record RenderResult(byte[] png, boolean hasContent) {
    }

    public MapTileRenderer() {
        this(null);
    }

    public MapTileRenderer(final Path cacheDir) {
        this.cacheDir = cacheDir;
        this.diskReady = cacheDir != null;
        if (cacheDir != null) {
            try {
                Files.createDirectories(cacheDir);
            } catch (final IOException e) {
                diskReady = false;
                LOG.warn("Map tile cache dir unavailable, serving live tiles only: {}", cacheDir);
            }
        }
    }

    /**
     * Returns the PNG for one tile.
     *
     * <p>If the tile has live content it is rendered fresh (and persisted). If
     * the live chunks are gone, the persisted copy is served when present — so
     * terrain the bot walked past keeps appearing on the map.
     *
     * @param level integer zoom level (a tile covers {@code TILE_PX * 2^level} blocks)
     */
    public byte[] tile(final int level, final int tileX, final int tileY) {
        final String key = level + "/" + tileX + "/" + tileY;
        final long now = System.currentTimeMillis();
        synchronized (cache) {
            final CachedTile cached = cache.get(key);
            if (cached != null && now - cached.createdAt() < CACHE_TTL_MS) return cached.png();
        }

        final RenderResult result = render(tileX, tileY, Math.pow(2.0, level));
        if (result.hasContent()) {
            synchronized (cache) {
                cache.put(key, new CachedTile(result.png(), now));
                final Iterator<String> eldest = cache.keySet().iterator();
                while (cache.size() > CACHE_MAX_TILES && eldest.hasNext()) {
                    eldest.next();
                    eldest.remove();
                }
            }
            persist(level, tileX, tileY, result.png());
            return result.png();
        }

        final byte[] persisted = readPersisted(level, tileX, tileY);
        return persisted != null ? persisted : result.png();
    }

    /**
     * Renders a tile and persists it if it has content, without serving it. Used
     * by the trail recorder to capture the bot's surroundings even when the
     * browser is not looking.
     */
    public void record(final int level, final int tileX, final int tileY) {
        final RenderResult result = render(tileX, tileY, Math.pow(2.0, level));
        if (result.hasContent()) persist(level, tileX, tileY, result.png());
    }

    // ── Persistence ────────────────────────────────────────────────

    private Path diskPath(final int level, final int tileX, final int tileY) {
        return cacheDir.resolve(Integer.toString(level))
                .resolve(Integer.toString(tileX))
                .resolve(tileY + ".png");
    }

    private void persist(final int level, final int tileX, final int tileY, final byte[] png) {
        if (!diskReady) return;
        try {
            final Path file = diskPath(level, tileX, tileY);
            Files.createDirectories(file.getParent());
            Files.write(file, png, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            if (++writesSincePrune >= PRUNE_EVERY_WRITES) {
                writesSincePrune = 0;
                prune();
            }
        } catch (final IOException ignored) {
            // Non-fatal: the tile is still served from memory this once.
        }
    }

    private byte[] readPersisted(final int level, final int tileX, final int tileY) {
        if (!diskReady) return null;
        try {
            final Path file = diskPath(level, tileX, tileY);
            return Files.exists(file) ? Files.readAllBytes(file) : null;
        } catch (final IOException e) {
            return null;
        }
    }

    private synchronized void prune() {
        try (final var stream = Files.walk(cacheDir)) {
            final List<Path> files = stream.filter(Files::isRegularFile).collect(Collectors.toList());
            if (files.size() <= MAX_DISK_TILES) return;
            files.sort(Comparator.comparingLong(f -> f.toFile().lastModified()));
            final int excess = files.size() - MAX_DISK_TILES;
            for (int i = 0; i < excess && i < files.size(); i++) {
                try {
                    Files.deleteIfExists(files.get(i));
                } catch (final IOException ignored) {
                }
            }
        } catch (final IOException ignored) {
        }
    }

    // ── Rendering ──────────────────────────────────────────────────

    private RenderResult render(final int tileX, final int tileY, final double scale) {
        final double tileBlocks = TILE_PX * scale;
        final int originX = (int) Math.floor(tileX * tileBlocks);
        final int originZ = (int) Math.floor(tileY * tileBlocks);
        final int[] pixels = new int[TILE_PX * TILE_PX];
        final ChunkCache chunkCache = CACHE.getChunkCache();
        boolean hasContent = false;

        Chunk chunk = null;
        int chunkX = Integer.MIN_VALUE;
        int chunkZ = Integer.MIN_VALUE;

        for (int py = 0; py < TILE_PX; py++) {
            final int blockZ = originZ + (int) Math.floor(py * scale);
            final int rowOffset = py * TILE_PX;
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
                // The chunk cache is mutated on the game thread while this runs;
                // a torn read on one column must not take down the whole tile.
                final long column;
                try {
                    column = topColumn(chunk, blockX & 15, blockZ & 15);
                } catch (final RuntimeException e) {
                    previousHeight = Integer.MIN_VALUE;
                    continue;
                }
                if (column == NO_COLUMN) {
                    previousHeight = Integer.MIN_VALUE;
                    continue;
                }
                final int height = (int) (column >> 8);
                final int colorId = (int) (column & 0xFF);
                pixels[rowOffset + px] = colorOf(colorId, brightnessFor(colorId, height, previousHeight, blockX, blockZ));
                hasContent = true;
                previousHeight = height;
            }
        }
        return new RenderResult(encode(pixels), hasContent);
    }

    /**
     * Picks the shade for one column: water uses an alternating dither (depth is
     * not tracked), everything else uses the height delta against the previous
     * column, mirroring the vanilla map renderer.
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
     * <p>Height maps are intentionally not cached by ZenithProxy (they go stale
     * on block updates), so the column is scanned downward — but whole sections
     * are skipped when they hold no blocks at all.
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
            throw new UncheckedIOException("Failed to encode map tile", e);
        }
        return out.toByteArray();
    }
}
