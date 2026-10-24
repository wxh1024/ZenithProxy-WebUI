package com.zenith.webui;

import com.google.gson.JsonObject;
import com.zenith.event.chat.*;
import com.zenith.event.client.ClientConnectEvent;
import com.zenith.event.client.ClientDisconnectEvent;
import com.zenith.event.client.ClientOnlineEvent;
import com.zenith.event.queue.*;
import com.zenith.network.client.ClientSession;
import com.zenith.network.codec.PacketCodecRegistries;
import com.zenith.network.codec.PacketHandlerCodec;
import com.zenith.network.codec.PacketHandlerStateCodec;
import com.zenith.plugin.api.PluginAPI;
import com.zenith.plugin.api.ZenithProxyPlugin;
import com.zenith.webui.api.*;
import com.zenith.webui.auth.AuthController;
import com.zenith.webui.auth.AuthHandler;
import com.zenith.webui.auth.AuthManager;
import com.zenith.webui.command.WebUICommand;
import com.zenith.webui.config.ConfigManager;
import com.zenith.webui.http.HttpHelper;
import com.zenith.webui.terminal.LogEntry;
import com.zenith.webui.terminal.WebUILogHandler;
import com.zenith.webui.queue.QueueParser;
import com.zenith.webui.server.WebUIChannelHandler;
import com.zenith.webui.server.WebUIServer;
import com.zenith.webui.staticfile.StaticFileHandler;
import com.zenith.webui.authbypass.AuthBypasserState;
import com.zenith.webui.authbypass.AuthBypasserUuidHandler;
import com.zenith.webui.authbypass.AuthBypasserAuthHandler;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.handler.codec.http.DefaultHttpContent;
import io.netty.util.CharsetUtil;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.title.ClientboundClearTitlesPacket;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.title.ClientboundSetSubtitleTextPacket;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.title.ClientboundSetTitleTextPacket;
import org.geysermc.mcprotocollib.protocol.packet.login.serverbound.ServerboundHelloPacket;
import org.geysermc.mcprotocollib.protocol.packet.login.clientbound.ClientboundHelloPacket;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;

import static com.zenith.Globals.*;

/**
 * WebUI plugin — thin orchestrator that wires together all sub-components.
 *
 * <h3>Package map</h3>
 * <pre>
 * server/      — Netty HTTP server bootstrap + channel request routing
 * http/        — Static HTTP response helpers + shared Gson instance
 * api/         — Endpoint handlers: commands, dashboard, log-stream, whitelist
 * log/ (terminal/) — Log message translation + Logback SSE appender
 * staticfile/  — Static file serving with bounded file cache
 * command/     — /webui enable|disable|status command
 * auth/        — Token-based auth (login/logout/status, cookie + Bearer)
 * config/      — Plugin config JSON I/O (auto-generates password on first run)
 * queue/       — 3c3u.org / 2b2t.org queue-position packet parsing
 * </pre>
 */
public class WebUIPlugin implements ZenithProxyPlugin {
    // ── Shared mutable state (accessed cross-package) ─────────
    public static final int LOG_BUFFER_MAX = 500;
    public static final ConcurrentLinkedDeque<LogEntry> logBuffer = new ConcurrentLinkedDeque<>();
    /**
     * Approximate log buffer size counter — avoids O(n) {@code ConcurrentLinkedDeque.size()}.
     */
    public static final AtomicInteger logBufferApproxSize = new AtomicInteger(0);
    public static final List<Channel> sseClients = new CopyOnWriteArrayList<>();
    public static final List<Channel> dashboardSseClients = new CopyOnWriteArrayList<>();
    static final AtomicLong logPollCounter = new AtomicLong(0);
    private static final ComponentLogger LOG = ComponentLogger.logger("WebUI");
    private static final String PLUGIN_ID = "webui";
    // ── Adventure serialiser ──────────────────────────────────
    private static final LegacyComponentSerializer LEGACY_SERIALIZER =
            LegacyComponentSerializer.legacySection();
    // ── Singleton instance ────────────────────────────────────
    public static volatile WebUIPlugin instance;
    // ── Component graph ───────────────────────────────────────
    private ConfigManager configManager;
    private AuthManager authManager;
    private AuthHandler authHandler;
    private AuthController authController;
    private DashboardHandler dashboardHandler;
    private WebUIServer server;
    private WebUILogHandler logHandler;

    private static String componentToPlainText(net.kyori.adventure.text.Component c) {
        return c == null ? "" : LEGACY_SERIALIZER.serialize(c);
    }

    // ═══════════════════════════════════════════════════════════
    //  Plugin lifecycle
    // ═══════════════════════════════════════════════════════════

    /**
     * Push a title packet to log-stream SSE clients. Called by {@link TitlePacketHandler}.
     */
    public static void pushTitle(String text) {
        if (text == null || text.isEmpty()) return;
        JsonObject payload = new JsonObject();
        payload.addProperty("type", "title");
        payload.addProperty("text", text);
        broadcastSSE(sseClients, HttpHelper.sseFrame(payload));
    }

    // ═══════════════════════════════════════════════════════════
    //  Start / Stop  (public — also driven by /webui command)
    // ═══════════════════════════════════════════════════════════

    /**
     * Write a pre-built SSE data frame to every active channel in {@code clients}.
     * Collects dead channels for batch removal — avoids CopyOnWriteArrayList.removeIf
     * which copies the entire array even when nothing is removed.
     *
     * @param sseFrame pre-built SSE frame string (format: "data: {...}\n\n")
     */
    public static void broadcastSSE(List<Channel> clients, String sseFrame) {
        ByteBuf template = Unpooled.copiedBuffer(sseFrame, CharsetUtil.UTF_8);
        List<Channel> dead = new ArrayList<>(2);
        for (Channel ch : clients) {
            if (!ch.isActive()) {
                dead.add(ch);
                continue;
            }
            ByteBuf dup = template.retainedDuplicate();
            try {
                ch.writeAndFlush(new DefaultHttpContent(dup))
                        .addListener(f -> {
                            if (!f.isSuccess()) ch.close();
                        });
            } catch (Exception e) {
                // writeAndFlush threw before taking ownership of the buffer, so the
                // duplicate retained above has no reader — release it or the frame
                // leaks one reference count per failure.
                dup.release();
                ch.close();
                dead.add(ch);
            }
        }
        if (!dead.isEmpty()) {
            clients.removeAll(dead);
        }
        template.release();
    }

    @Override
    public void onLoad(PluginAPI api) {
        instance = this;

        // Config
        Path pluginDir = Path.of("plugins", PLUGIN_ID);
        configManager = new ConfigManager(pluginDir);
        configManager.loadOrCreate();

        // Auth
        authManager = new AuthManager(configManager.getConfig().auth);
        authHandler = new AuthHandler(authManager, configManager.getConfig());
        authController = new AuthController(authManager);

        // Auth bypasser state init
        AuthBypasserState.update(configManager.getConfig().authBypasser);

        // Handlers
        dashboardHandler = new DashboardHandler();
        WebUIChannelHandler channelHandler = new WebUIChannelHandler(
                authHandler, authController,
                new CommandHandler(),
                dashboardHandler,
                new LogStreamHandler(),
                new WhitelistHandler(),
                new FeatureHandler(),
                new BasicConfigHandler(),
                new I18nHandler(configManager.getConfig()),
                new MapHandler(),
                new StaticFileHandler(pluginDir));

        // Server
        int port = configManager.getConfig().port;
        server = new WebUIServer(port, channelHandler);

        // Command
        api.registerCommand(new WebUICommand(
                this::start, this::stop, () -> server != null && server.isRunning(), port));

        // Go
        if (configManager.getConfig().enabled) {
            boolean ok = start();
            LOG.info("WebUI plugin loaded!{}",
                    ok ? " Access at http://localhost:" + port : " (server failed to start, check logs)");
        } else {
            LOG.info("WebUI plugin loaded but disabled in plugins/webui/config.json — use /webui enable to start");
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Startup helpers
    // ═══════════════════════════════════════════════════════════

    /**
     * Full start: server → packet handlers → log appender → events → dashboard stream.
     */
    public boolean start() {
        instance = this;
        // Idempotent: re-running would register duplicate packet codecs, log appenders
        // and event subscribers, so bail out while the server is already up.
        if (server != null && server.isRunning()) return true;
        if (!server.start()) return false;

        AuthBypasserState.update(configManager.getConfig().authBypasser);
        registerPacketHandlers();
        registerLogAppender();
        subscribeEvents();
        dashboardHandler.startStream();
        return true;
    }

    /**
     * Stop the server and detach every runtime hook. Safe to call repeatedly.
     */
    public void stop() {
        EVENT_BUS.unsubscribe(this);
        if (dashboardHandler != null) dashboardHandler.stopStream();
        detachLogAppender();
        if (server != null) server.stop();
        // The auth manager outlives stop()/start(): it owns the token store, and
        // its cleanup task is a daemon thread. Shutting it down would break re-enable.
        instance = null;
    }

    private void registerPacketHandlers() {
        try {
            var c = PacketHandlerCodec.clientBuilder()
                    .setId("webui-title-handler").setPriority(100)
                    .allStates(PacketHandlerStateCodec.<ClientSession>clientBuilder()
                            .inbound(ClientboundSetTitleTextPacket.class, new TitlePacketHandler()).build())
                    .build();
            PacketCodecRegistries.CLIENT_REGISTRY.register(c);
            LOG.info("Title packet handler registered");
        } catch (Exception e) {
            LOG.warn("Failed to register Title packet handler", e);
        }

        try {
            var c = PacketHandlerCodec.clientBuilder()
                    .setId("webui-queue-parser").setPriority(100)
                    .allStates(PacketHandlerStateCodec.<ClientSession>clientBuilder()
                            .inbound(ClientboundSetSubtitleTextPacket.class, new QueueParser())
                            .inbound(ClientboundClearTitlesPacket.class, new QueueParser.ClearHandler()).build())
                    .build();
            PacketCodecRegistries.CLIENT_REGISTRY.register(c);
            LOG.info("Queue parser registered");
        } catch (Exception e) {
            LOG.warn("Failed to register Queue parser", e);
        }

        registerAuthBypasserHandlers();
    }

    private void registerAuthBypasserHandlers() {
        if (!configManager.getConfig().authBypasser.enabled) {
            return;
        }
        try {
            var stateCodec = PacketHandlerStateCodec.<ClientSession>clientBuilder()
                    .outbound(ServerboundHelloPacket.class, new AuthBypasserUuidHandler())
                    .inbound(ClientboundHelloPacket.class, new AuthBypasserAuthHandler())
                    .build();
            var codec = PacketHandlerCodec.<ClientSession>clientBuilder()
                    .setId("webui-authbypass")
                    .setPriority(100000)
                    .state(org.geysermc.mcprotocollib.protocol.data.ProtocolState.LOGIN, stateCodec)
                    .build();
            PacketCodecRegistries.CLIENT_REGISTRY.register(codec);
            LOG.info("AuthBypasser packet handlers registered (rewriteOfflineUuid={}, bypassAuthenticateHello={})",
                    configManager.getConfig().authBypasser.rewriteOfflineUuid,
                    configManager.getConfig().authBypasser.bypassAuthenticateHello);
        } catch (Exception e) {
            LOG.warn("Failed to register AuthBypasser handlers: {}", e.getMessage());
        }
    }

    private void registerLogAppender() {
        logHandler = new WebUILogHandler();
        LoggerContext ctx = (LoggerContext) org.slf4j.LoggerFactory.getILoggerFactory();
        ctx.getLogger(Logger.ROOT_LOGGER_NAME).addAppender(logHandler);
        logHandler.start();
    }

    // ═══════════════════════════════════════════════════════════
    //  Log broadcasting
    // ═══════════════════════════════════════════════════════════

    private void detachLogAppender() {
        if (logHandler == null) return;
        LoggerContext ctx = (LoggerContext) org.slf4j.LoggerFactory.getILoggerFactory();
        ctx.getLogger(Logger.ROOT_LOGGER_NAME).detachAppender(logHandler);
        logHandler.stop();
        logHandler = null;
    }

    private void subscribeEvents() {
        EVENT_BUS.subscribe(this, PublicChatEvent.class, e -> {
            try {
                broadcastLog("CHAT", "Chat",
                        "<" + (e.sender() != null ? e.sender().getName() : "Unknown") + "> "
                                + componentToPlainText(e.component()));
            } catch (Exception ignored) {
            }
        });
        EVENT_BUS.subscribe(this, SystemChatEvent.class, e -> {
            try {
                broadcastLog("INFO", "System", componentToPlainText(e.component()));
            } catch (Exception ignored) {
            }
        });
        EVENT_BUS.subscribe(this, WhisperChatEvent.class, e -> {
            try {
                broadcastLog("CHAT", "Whisper",
                        (e.outgoing() ? "→" : "←") + " "
                                + (e.sender() != null ? e.sender().getName() : "Unknown") + " → "
                                + (e.receiver() != null ? e.receiver().getName() : "Unknown") + ": "
                                + componentToPlainText(e.component()));
            } catch (Exception ignored) {
            }
        });
        EVENT_BUS.subscribe(this, DeathMessageChatEvent.class, e -> {
            try {
                broadcastLog("INFO", "Death", componentToPlainText(e.component()));
            } catch (Exception ignored) {
            }
        });
        EVENT_BUS.subscribe(this, ClientConnectEvent.class, e ->
                broadcastLog("INFO", "Client", "Connecting to server..."));
        EVENT_BUS.subscribe(this, ClientOnlineEvent.class, e -> {
            QueueParser.reset();
            broadcastLog("INFO", "Client", "Now online");
        });
        EVENT_BUS.subscribe(this, ClientDisconnectEvent.class, e -> {
            QueueParser.reset();
            broadcastLog("WARN", "Client", "Disconnected: " + e.reason());
        });
        EVENT_BUS.subscribe(this, QueueStartEvent.class, e ->
                broadcastLog("INFO", "Queue", "Entered queue"));
        EVENT_BUS.subscribe(this, QueuePositionUpdateEvent.class, e ->
                broadcastLog("INFO", "Queue", "Queue position: " + e.position()));
        EVENT_BUS.subscribe(this, QueueCompleteEvent.class, e -> {
            QueueParser.reset();
            broadcastLog("INFO", "Queue", "Queue complete, entering server");
        });
    }

    /**
     * Called by {@link WebUILogHandler} and event subscribers.
     */
    public void broadcastLog(String level, String logger, String message) {
        // Messages stay in their original English form; the frontend translates
        // them per visitor language (see web/js/i18n.js).
        LogEntry entry = new LogEntry(
                level, logger, message,
                System.currentTimeMillis(), logPollCounter.getAndIncrement());
        // Gson produces the SSE payload — one serialization serves every client.
        String sseFrame = HttpHelper.sseFrame(entry);

        logBuffer.addLast(entry);
        // Use counter instead of O(n) ConcurrentLinkedDeque.size()
        if (logBufferApproxSize.incrementAndGet() > LOG_BUFFER_MAX) {
            if (logBuffer.pollFirst() != null) logBufferApproxSize.decrementAndGet();
        }
        broadcastSSE(sseClients, sseFrame);
    }
}
