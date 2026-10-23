package com.zenith.webui.api;

import com.zenith.Proxy;
import com.zenith.webui.WebUIPlugin;
import com.zenith.webui.http.HttpHelper;
import com.zenith.webui.queue.QueueParser;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.DefaultHttpResponse;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpResponse;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.util.CharsetUtil;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static com.zenith.Globals.CACHE;
import static com.zenith.Globals.CONFIG;
import static com.zenith.Globals.MC_VERSION;

/**
 * Handles /api/dashboard and /api/dashboard/stream endpoints.
 * Builds the aggregated dashboard payload as a POJO and lets Gson serialize it.
 */
public class DashboardHandler {
    private final AtomicLong lastNetTime = new AtomicLong(0);
    private final AtomicLong lastBytesIn = new AtomicLong(0);
    private final AtomicLong lastBytesOut = new AtomicLong(0);
    private ScheduledExecutorService streamExecutor;

    public DashboardHandler() {
    }

    /**
     * Read total RX/TX byte counters from /proc/net/dev.
     * Returns {@code {0, 0}} on platforms without procfs (Windows/macOS).
     */
    private static long[] readNetworkTotals() {
        long totalIn = 0, totalOut = 0;
        try {
            List<String> lines = Files.readAllLines(Path.of("/proc/net/dev"));
            for (String line : lines) {
                line = line.trim();
                if (line.contains(":") && !line.startsWith("Inter") && !line.startsWith("face")) {
                    String[] parts = line.split(":");
                    if (parts.length >= 2) {
                        String[] stats = parts[1].trim().split("\\s+");
                        if (stats.length >= 10) {
                            totalIn += Long.parseLong(stats[0]);
                            totalOut += Long.parseLong(stats[8]);
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return new long[]{totalIn, totalOut};
    }

    private static double round1(double value) {
        return Double.isFinite(value) ? Math.round(value * 10.0) / 10.0 : 0;
    }

    private static double round2(double value) {
        return Double.isFinite(value) ? Math.round(value * 100.0) / 100.0 : 0;
    }

    private static QueueData getQueueData() {
        String server = CONFIG.client.server.address;
        if (server == null) {
            return new QueueData(false, 0, 0, "");
        }

        String serverLower = server.toLowerCase();

        if (serverLower.contains("3c3u.org")) {
            return new QueueData(
                    QueueParser.is3cQueue(),
                    Math.max(QueueParser.positionInQueue, 0),
                    QueueParser.onlinePlayers,
                    QueueParser.queuePos
            );
        }

        if (serverLower.contains("2b2t.org")) {
            return new QueueData(
                    Proxy.getInstance().isInQueue(),
                    Proxy.getInstance().getQueuePosition(),
                    0,
                    ""
            );
        }

        return new QueueData(false, 0, 0, "");
    }

    public void handleDashboard(ChannelHandlerContext ctx) {
        HttpHelper.sendJson(ctx, buildDashboardData(), HttpHelper.GSON_NULLS);
    }

    public void handleDashboardStream(ChannelHandlerContext ctx) {
        HttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.OK);
        response.headers().set(HttpHeaderNames.CONTENT_TYPE, "text/event-stream");
        response.headers().set(HttpHeaderNames.CACHE_CONTROL, "no-cache");
        response.headers().set(HttpHeaderNames.CONNECTION, "keep-alive");
        response.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        ctx.writeAndFlush(response);
        WebUIPlugin.dashboardSseClients.add(ctx.channel());
    }

    public void startStream() {
        if (streamExecutor != null) return;
        streamExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "webui-dashboard-stream");
            t.setDaemon(true);
            return t;
        });
        streamExecutor.scheduleAtFixedRate(() -> {
            try {
                if (WebUIPlugin.dashboardSseClients.isEmpty()) return;
                pushDashboardHeartbeat();
            } catch (Exception ignored) {
            }
        }, 0, 1, TimeUnit.SECONDS);
    }

    public void stopStream() {
        if (streamExecutor != null) {
            streamExecutor.shutdownNow();
            streamExecutor = null;
        }
    }

    /**
     * Pure heartbeat push — no token validation. Token validity is enforced
     * once at SSE connection setup and event-driven on logout/password-change
     * (see {@link com.zenith.webui.auth.AuthManager#invalidateToken}).
     */
    private void pushDashboardHeartbeat() {
        String frame = HttpHelper.sseFrame(buildDashboardData(), HttpHelper.GSON_NULLS);
        // Use retainedDuplicate pattern — one allocation for all clients (same as broadcastSSE)
        ByteBuf template = Unpooled.copiedBuffer(frame, CharsetUtil.UTF_8);
        try {
            List<Channel> dead = new ArrayList<>(2);
            for (Channel ch : WebUIPlugin.dashboardSseClients) {
                if (!ch.isActive()) {
                    dead.add(ch);
                    continue;
                }
                ByteBuf dup = template.retainedDuplicate();
                try {
                    ch.writeAndFlush(new io.netty.handler.codec.http.DefaultHttpContent(dup))
                            .addListener(f -> {
                                if (!f.isSuccess()) ch.close();
                            });
                } catch (Exception e) {
                    // Ownership never transferred — release the retained duplicate.
                    dup.release();
                    ch.close();
                    dead.add(ch);
                }
            }
            if (!dead.isEmpty()) {
                WebUIPlugin.dashboardSseClients.removeAll(dead);
            }
        } finally {
            template.release();
        }
    }

    /**
     * Snapshot the proxy state into a {@link DashboardData} POJO. Each section is
     * guarded individually so a failing subsystem degrades one field group instead
     * of breaking the whole payload.
     */
    private DashboardData buildDashboardData() {
        DashboardData data = new DashboardData();

        Proxy proxy = Proxy.getInstance();

        // --- Status ---
        if (proxy != null) {
            try {
                data.connected = proxy.isConnected();
                data.uptime = Math.max(0L, System.currentTimeMillis() - proxy.getStartTime());
            } catch (Exception ignored) {
            }
        }

        QueueData qd = getQueueData();
        data.inQueue = qd.inQueue;
        data.queuePosition = qd.position;
        data.queueOnlinePlayers = qd.onlinePlayers;
        data.queuePos = qd.queuePos != null ? qd.queuePos : "";
        data.version = MC_VERSION != null ? MC_VERSION : "";

        try {
            var client = proxy != null ? proxy.getClient() : null;
            if (client != null && client.isConnected()) {
                var protoVer = client.getProtocolVersion();
                if (protoVer != null) data.viaVersion = "via " + protoVer.getName();
            }
        } catch (Exception ignored) {
        }

        data.username = CONFIG.authentication.username != null ? CONFIG.authentication.username : "";
        String proxyAddress = CONFIG.server.getProxyAddress();
        data.proxyAddress = proxyAddress != null ? proxyAddress : "";

        // --- System ---
        double cpuLoad = -1;
        try {
            java.lang.management.OperatingSystemMXBean osBean =
                    java.lang.management.ManagementFactory.getOperatingSystemMXBean();
            double load = osBean.getSystemLoadAverage();
            if (load >= 0 && Double.isFinite(load)) cpuLoad = round2(load);
        } catch (Exception ignored) {
        }
        data.system.cpuLoad = cpuLoad;

        Runtime rt = Runtime.getRuntime();
        long usedMem = rt.totalMemory() - rt.freeMemory();
        long maxMem = rt.maxMemory();
        data.system.memoryPercent = maxMem > 0 ? round2(usedMem * 100.0 / maxMem) : 0;

        long now = System.currentTimeMillis();
        long[] totals = readNetworkTotals();
        long totalIn = totals[0];
        long totalOut = totals[1];
        long prevTime = lastNetTime.getAndSet(now);
        long prevIn = lastBytesIn.getAndSet(totalIn);
        long prevOut = lastBytesOut.getAndSet(totalOut);
        if (prevTime > 0) {
            double elapsed = (now - prevTime) / 1000.0;
            // Guard against interface counters resetting (e.g. adapter reconnect)
            if (elapsed > 0 && totalIn >= prevIn && totalOut >= prevOut) {
                data.system.netBytesPerSecIn = round1((totalIn - prevIn) / elapsed);
                data.system.netBytesPerSecOut = round1((totalOut - prevOut) / elapsed);
            }
        }

        // --- Latency ---
        try {
            var client = proxy != null ? proxy.getClient() : null;
            boolean clientConnected = client != null && client.isConnected();
            data.latency.botLatency = clientConnected ? client.getPing() : -1;
            for (var session : proxy.getActiveConnections().getArray()) {
                if (session != null) {
                    data.latency.players.add(
                            new DashboardData.PlayerPing(session.getName(), session.getPing()));
                }
            }
        } catch (Exception ignored) {
            data.latency = new DashboardData.LatencyInfo();
        }

        // --- Player ---
        try {
            var client = proxy != null ? proxy.getClient() : null;
            boolean clientConnected = client != null && client.isConnected();
            data.player.connected = clientConnected;
            if (clientConnected) {
                var thePlayer = CACHE.getPlayerCache().getThePlayer();
                if (thePlayer != null) {
                    data.player.health = thePlayer.getHealth();
                    data.player.food = thePlayer.getFood();
                }
            }
        } catch (Exception ignored) {
            data.player = new DashboardData.PlayerInfo();
        }

        return data;
    }

    private record QueueData(boolean inQueue, int position, int onlinePlayers, String queuePos) {
    }
}
