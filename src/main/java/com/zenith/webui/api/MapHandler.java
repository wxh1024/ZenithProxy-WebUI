package com.zenith.webui.api;

import com.google.gson.JsonObject;
import com.zenith.Proxy;
import com.zenith.cache.data.chunk.Chunk;
import com.zenith.feature.pathfinder.PathingRequestFuture;
import com.zenith.feature.pathfinder.behavior.PathingBehavior;
import com.zenith.feature.pathfinder.calc.IPath;
import com.zenith.feature.pathfinder.executor.PathExecutor;
import com.zenith.feature.pathfinder.goals.GoalXZ;
import com.zenith.mc.block.BlockPos;
import com.zenith.webui.http.HttpHelper;
import com.zenith.webui.map.MapTileRenderer;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.util.CharsetUtil;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static com.zenith.Globals.BARITONE;
import static com.zenith.Globals.CACHE;

/**
 * Handles the map page endpoints:
 *
 * <ul>
 *   <li>{@code GET  /api/map/tile}  — 256×256 PNG tile of the loaded world</li>
 *   <li>{@code GET  /api/map/state} — bot position, live path and pathing status</li>
 *   <li>{@code POST /api/map/path}  — pathfind the bot to a block position</li>
 *   <li>{@code POST /api/map/stop}  — abort the current path</li>
 * </ul>
 *
 * <p>Pathfinding is delegated to ZenithProxy's own Baritone port, so the map
 * shares one path planner with the in-game {@code path} command instead of
 * growing a second one. The client never computes a path: it polls
 * {@code /api/map/state} and draws whatever the executor is currently following.
 *
 * <p>Error payloads carry a machine-readable {@code code} because the server
 * does not translate UI strings — the browser maps the code to a phrase.
 */
public class MapHandler {

    /** Minecraft world border limit — anything beyond cannot be walked to. */
    private static final int MAX_COORD = 30_000_000;
    /** Upper bound on path vertices sent to the browser; longer paths are sampled. */
    private static final int MAX_PATH_POINTS = 600;
    /**
     * Zoom range, in integer tile levels (slippy-map convention): at level z a
     * tile covers {@code TILE_PX * 2^z} blocks, i.e. {@code 2^z} blocks per
     * pixel. Must match {@code ZOOM_MIN} / {@code ZOOM_MAX} in js/map/constants.js.
     */
    private static final int MIN_ZOOM = -4;
    private static final int MAX_ZOOM = 6;

    private final MapTileRenderer renderer = new MapTileRenderer();
    /** The path request issued from this page; {@code null} until the first click. */
    private volatile Session session;

    /** Path request tracked for status reporting (separate from any other module's pathing). */
    private static final class Session {
        final int x;
        final int z;
        /** {@code calculating} | {@code arrived} | {@code failed} | {@code idle}. */
        volatile String status = "calculating";

        Session(final int x, final int z) {
            this.x = x;
            this.z = z;
        }
    }

    private record PathInfo(List<int[]> points, int progress, long remaining) {
    }

    // ── GET /api/map/tile ───────────────────────────────────────────────

    public void handleTile(final ChannelHandlerContext ctx, final FullHttpRequest req) {
        if (!HttpMethod.GET.equals(req.method())) {
            HttpHelper.sendError(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, "Method Not Allowed");
            return;
        }
        // Slippy-map addressing: z = integer zoom, x/y = tile column/row.
        final Integer zoom = intParam(req.uri(), "z");
        final Integer tileX = intParam(req.uri(), "x");
        final Integer tileY = intParam(req.uri(), "y");
        if (zoom == null || tileX == null || tileY == null) {
            HttpHelper.sendError(ctx, HttpResponseStatus.BAD_REQUEST, "Missing z/x/y");
            return;
        }
        if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
            HttpHelper.sendError(ctx, HttpResponseStatus.BAD_REQUEST, "Zoom out of range");
            return;
        }
        // At level z a tile covers TILE_PX * 2^z blocks (2^z blocks per pixel).
        final double scale = Math.pow(2.0, zoom);
        final long span = (long) Math.ceil(MapTileRenderer.TILE_PX * scale);
        if (Math.abs((long) tileX * span) > MAX_COORD + span || Math.abs((long) tileY * span) > MAX_COORD + span) {
            HttpHelper.sendError(ctx, HttpResponseStatus.BAD_REQUEST, "Tile out of range");
            return;
        }
        final byte[] png = renderer.tile(tileX, tileY, scale);
        HttpHelper.sendBytes(ctx, png, "image/png", "no-store");
    }

    // ── GET /api/map/state ──────────────────────────────────────────────

    public void handleState(final ChannelHandlerContext ctx) {
        final boolean connected = isConnected();
        final PathInfo path = pathInfo();
        final Session current = session;

        final Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("connected", connected);
        payload.put("player", playerSnapshot());
        payload.put("status", status(connected, path, current));
        payload.put("path", path.points());
        payload.put("progress", path.progress());
        payload.put("remaining", path.remaining());
        payload.put("target", current == null ? null : Map.of("x", current.x, "z", current.z));
        // Bounds of the loaded chunks: the page only asks for tiles inside them,
        // so a zoomed-out view does not request a dozen empty tiles.
        payload.put("view", loadedArea());
        // Explicit nulls matter: the browser clears its markers when these are null.
        HttpHelper.sendJson(ctx, payload, HttpHelper.GSON_NULLS);
    }

    // ── POST /api/map/path ──────────────────────────────────────────────

    public void handlePath(final ChannelHandlerContext ctx, final FullHttpRequest req) {
        if (!HttpMethod.POST.equals(req.method())) {
            HttpHelper.sendError(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, "Method Not Allowed");
            return;
        }
        final JsonObject body = readBody(ctx, req);
        if (body == null) return;
        if (!body.has("x") || !body.has("z")) {
            reject(ctx, HttpResponseStatus.BAD_REQUEST, "Missing x/z", "badRequest");
            return;
        }
        final int x = body.get("x").getAsInt();
        final int z = body.get("z").getAsInt();
        if (Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD) {
            reject(ctx, HttpResponseStatus.BAD_REQUEST, "Target out of range", "range");
            return;
        }
        if (!isConnected()) {
            reject(ctx, HttpResponseStatus.CONFLICT, "Bot is not connected", "offline");
            return;
        }
        if (!isAlive()) {
            reject(ctx, HttpResponseStatus.CONFLICT, "Bot is not alive", "dead");
            return;
        }

        // Pathing into unloaded terrain usually fails: tell the browser up front, but
        // still try — the chunk may load while the search runs.
        final boolean loaded = isChunkLoaded(x, z);
        final Session next = new Session(x, z);
        session = next;

        final PathingRequestFuture future = BARITONE.pathTo(new GoalXZ(x, z));
        future.addExecutedListener(completed ->
                next.status = completed.isAccepted() ? "arrived" : "failed");
        // The listener is skipped when the future already finished (e.g. already there).
        if (future.isCompleted()) next.status = future.isAccepted() ? "arrived" : "failed";

        final Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", true);
        response.put("target", Map.of("x", x, "z", z));
        response.put("loaded", loaded);
        HttpHelper.sendJson(ctx, response);
    }

    // ── POST /api/map/stop ──────────────────────────────────────────────

    public void handleStop(final ChannelHandlerContext ctx, final FullHttpRequest req) {
        if (!HttpMethod.POST.equals(req.method())) {
            HttpHelper.sendError(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, "Method Not Allowed");
            return;
        }
        try {
            BARITONE.stop();
        } catch (final Exception ignored) {
            // A cancelled path is the desired state either way.
        }
        final Session current = session;
        if (current != null) current.status = "idle";
        HttpHelper.sendJson(ctx, Map.of("success", true));
    }

    // ── State assembly ──────────────────────────────────────────────────

    /**
     * Mirrors the running path into a compact payload. Only the segment the
     * executor holds is known here — Baritone plans ahead one segment at a time,
     * so the browser draws a dashed line from the segment end to the target.
     */
    private PathInfo pathInfo() {
        final List<int[]> points = new ArrayList<>();
        int progress = 0;
        double remaining = 0;
        try {
            final PathingBehavior behavior = BARITONE.getPathingBehavior();
            final Optional<IPath> currentPath = behavior.getPath();
            if (currentPath.isPresent()) {
                final List<BlockPos> positions = currentPath.get().positions();
                if (!positions.isEmpty()) {
                    final int step = Math.max(1, (int) Math.ceil(positions.size() / (double) MAX_PATH_POINTS));
                    for (int i = 0; i < positions.size(); i += step) {
                        points.add(toPoint(positions.get(i)));
                    }
                    final int[] last = toPoint(positions.get(positions.size() - 1));
                    if (!Arrays.equals(points.get(points.size() - 1), last)) points.add(last);
                    final PathExecutor executor = behavior.getCurrent();
                    if (executor != null) {
                        progress = Math.min(points.size() - 1, executor.getPosition() / step);
                    }
                    for (int i = Math.max(0, progress); i + 1 < points.size(); i++) {
                        remaining += horizontalDistance(points.get(i), points.get(i + 1));
                    }
                }
            }
        } catch (final Exception ignored) {
            // Disconnected mid-tick: report an empty path rather than failing the poll.
        }
        return new PathInfo(points, progress, Math.round(remaining));
    }

    private static int[] toPoint(final BlockPos pos) {
        return new int[]{pos.x(), pos.y(), pos.z()};
    }

    private static double horizontalDistance(final int[] a, final int[] b) {
        final double dx = a[0] - b[0];
        final double dz = a[2] - b[2];
        return Math.sqrt(dx * dx + dz * dz);
    }

    /**
     * Block bounds of every chunk the proxy currently holds.
     *
     * <p>Derived from the cache keys rather than "centre ± view distance": the
     * server does not necessarily send a full square, and an honest box means
     * the browser never requests a tile that cannot contain any terrain.
     */
    private Map<String, Object> loadedArea() {
        try {
            final var chunkCache = CACHE.getChunkCache();
            final var chunks = chunkCache.getCache();
            if (chunks == null || chunks.isEmpty()) return null;
            int minChunkX = Integer.MAX_VALUE;
            int minChunkZ = Integer.MAX_VALUE;
            int maxChunkX = Integer.MIN_VALUE;
            int maxChunkZ = Integer.MIN_VALUE;
            for (final long key : chunks.keySet().toLongArray()) {
                final int chunkX = Chunk.longToChunkX(key);
                final int chunkZ = Chunk.longToChunkZ(key);
                if (chunkX < minChunkX) minChunkX = chunkX;
                if (chunkX > maxChunkX) maxChunkX = chunkX;
                if (chunkZ < minChunkZ) minChunkZ = chunkZ;
                if (chunkZ > maxChunkZ) maxChunkZ = chunkZ;
            }
            final Map<String, Object> area = new LinkedHashMap<>();
            area.put("minX", minChunkX << 4);
            area.put("minZ", minChunkZ << 4);
            area.put("maxX", (maxChunkX << 4) + 16);
            area.put("maxZ", (maxChunkZ << 4) + 16);
            return area;
        } catch (final Exception e) {
            return null;
        }
    }

    private Map<String, Object> playerSnapshot() {
        try {
            // The player cache keeps a default entity while disconnected, which would
            // otherwise render a bot marker sitting at 0,0 in a blank world.
            if (!isConnected()) return null;
            final var playerCache = CACHE.getPlayerCache();
            if (playerCache.getThePlayer() == null) return null;
            final Map<String, Object> player = new LinkedHashMap<>();
            player.put("x", round(playerCache.getX()));
            player.put("y", round(playerCache.getY()));
            player.put("z", round(playerCache.getZ()));
            player.put("yaw", round(playerCache.getYaw()));
            return player;
        } catch (final Exception e) {
            return null;
        }
    }

    private static double round(final double value) {
        if (!Double.isFinite(value)) return 0;
        return Math.round(value * 100.0) / 100.0;
    }

    /**
     * Pathing wins over the request state: another module (spawn patrol, follow)
     * may be driving the bot, and the map must show that path too.
     */
    private String status(final boolean connected, final PathInfo path, final Session current) {
        if (!connected) return "offline";
        if (!path.points().isEmpty()) return "pathing";
        if (searchInProgress()) return "calculating";
        return current == null ? "idle" : current.status;
    }

    private static boolean searchInProgress() {
        try {
            return BARITONE.getPathingBehavior().getInProgress().isPresent();
        } catch (final Exception e) {
            return false;
        }
    }

    private static boolean isConnected() {
        try {
            final Proxy proxy = Proxy.getInstance();
            return proxy != null && proxy.isConnected();
        } catch (final Exception e) {
            return false;
        }
    }

    private static boolean isAlive() {
        try {
            final var playerCache = CACHE.getPlayerCache();
            return playerCache.getThePlayer() == null || playerCache.isAlive();
        } catch (final Exception e) {
            return false;
        }
    }

    private static boolean isChunkLoaded(final int x, final int z) {
        try {
            return CACHE.getChunkCache().isChunkLoaded(x >> 4, z >> 4);
        } catch (final Exception e) {
            return false;
        }
    }

    // ── Request helpers ─────────────────────────────────────────────────

    /** Reads and parses the JSON body, answering {@code 400} itself on failure. */
    private static JsonObject readBody(final ChannelHandlerContext ctx, final FullHttpRequest req) {
        final String body = req.content().toString(CharsetUtil.UTF_8);
        if (body == null || body.isEmpty()) {
            reject(ctx, HttpResponseStatus.BAD_REQUEST, "Empty request body", "badRequest");
            return null;
        }
        try {
            final JsonObject json = HttpHelper.GSON.fromJson(body, JsonObject.class);
            if (json == null) {
                reject(ctx, HttpResponseStatus.BAD_REQUEST, "Empty request body", "badRequest");
                return null;
            }
            return json;
        } catch (final Exception e) {
            reject(ctx, HttpResponseStatus.BAD_REQUEST, "Malformed JSON", "badRequest");
            return null;
        }
    }

    private static void reject(final ChannelHandlerContext ctx, final HttpResponseStatus status,
                               final String message, final String code) {
        HttpHelper.sendJson(ctx, status, Map.of("success", false, "error", message, "code", code));
    }

    private static String queryParam(final String uri, final String name) {
        final int start = uri.indexOf('?');
        if (start < 0) return null;
        for (final String part : uri.substring(start + 1).split("&")) {
            final int eq = part.indexOf('=');
            final String key = eq < 0 ? part : part.substring(0, eq);
            if (!key.equals(name)) continue;
            if (eq < 0) return "";
            try {
                return URLDecoder.decode(part.substring(eq + 1), StandardCharsets.UTF_8);
            } catch (final Exception e) {
                return null;
            }
        }
        return null;
    }

    private static Integer intParam(final String uri, final String name) {
        final String raw = queryParam(uri, name);
        if (raw == null || raw.isEmpty()) return null;
        try {
            return Integer.parseInt(raw);
        } catch (final NumberFormatException e) {
            return null;
        }
    }
}
