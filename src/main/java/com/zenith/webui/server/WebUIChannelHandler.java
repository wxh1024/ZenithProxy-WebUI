package com.zenith.webui.server;

import com.zenith.webui.WebUIPlugin;
import com.zenith.webui.api.*;
import com.zenith.webui.auth.AuthController;
import com.zenith.webui.auth.AuthHandler;
import com.zenith.webui.staticfile.StaticFileHandler;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.*;

import java.util.Map;

/**
 * Netty channel handler — routes incoming HTTP requests to the appropriate handler.
 * Stateless and thread-safe, shared across all connections via {@code @Sharable}.
 */
@ChannelHandler.Sharable
public class WebUIChannelHandler extends SimpleChannelInboundHandler<FullHttpRequest> {

    private final AuthHandler authHandler;
    private final AuthController authController;
    private final CommandHandler commandHandler;
    private final DashboardHandler dashboardHandler;
    private final LogStreamHandler logStreamHandler;
    private final WhitelistHandler whitelistHandler;
    private final I18nHandler i18nHandler;
    private final StaticFileHandler staticFileHandler;

    public WebUIChannelHandler(
            AuthHandler authHandler,
            AuthController authController,
            CommandHandler commandHandler,
            DashboardHandler dashboardHandler,
            LogStreamHandler logStreamHandler,
            WhitelistHandler whitelistHandler,
            I18nHandler i18nHandler,
            StaticFileHandler staticFileHandler) {
        this.authHandler = authHandler;
        this.authController = authController;
        this.commandHandler = commandHandler;
        this.dashboardHandler = dashboardHandler;
        this.logStreamHandler = logStreamHandler;
        this.whitelistHandler = whitelistHandler;
        this.i18nHandler = i18nHandler;
        this.staticFileHandler = staticFileHandler;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest req) {
        String uri = req.uri();
        String path = uri.contains("?") ? uri.substring(0, uri.indexOf('?')) : uri;
        HttpMethod method = req.method();

        // CORS preflight
        if (HttpMethod.OPTIONS.equals(method)) {
            com.zenith.webui.http.HttpHelper.sendCorsResponse(ctx);
            return;
        }

        // Auth endpoints (public)
        if (path.equals("/api/auth/login") && HttpMethod.POST.equals(method)) {
            authController.handleLogin(ctx, req);
            return;
        }
        if (path.equals("/api/auth/logout") && HttpMethod.POST.equals(method)) {
            authController.handleLogout(ctx, req);
            return;
        }
        if (path.equals("/api/auth/status")) {
            authController.handleStatus(ctx, req);
            return;
        }
        // i18n bootstrap is public: the login page needs it before authentication
        if (path.equals("/api/i18n") && HttpMethod.GET.equals(method)) {
            i18nHandler.handleI18n(ctx);
            return;
        }

        // Check authentication for protected resources (with per-channel caching)
        if (!authHandler.checkAuth(ctx, req)) {
            if (path.startsWith("/api/")) {
                AuthHandler.sendUnauthorized(ctx, "Authentication required");
                return;
            }
            AuthHandler.sendRedirect(ctx, "/login.html");
            return;
        }

        // Route to handlers
        try {
            // SSE stream endpoints: register channel for event-driven disconnect on logout
            if (path.equals("/api/logs/stream") || path.equals("/api/dashboard/stream")) {
                String token = AuthHandler.extractToken(req);
                if (token != null) {
                    authHandler.registerSseChannel(token, ctx.channel());
                }
            }

            switch (path) {
                case "/api/commands" -> commandHandler.handleCommands(ctx, req);
                case "/api/logs/stream" -> logStreamHandler.handleLogStream(ctx);
                case "/api/dashboard" -> dashboardHandler.handleDashboard(ctx);
                case "/api/dashboard/stream" -> dashboardHandler.handleDashboardStream(ctx);
                case "/api/whitelist" -> whitelistHandler.handleWhitelist(ctx, req);
                default -> {
                    if (path.startsWith("/api/")) {
                        // Unknown API route: returning index.html would look like a success
                        com.zenith.webui.http.HttpHelper.sendNotFound(ctx);
                    } else {
                        staticFileHandler.handleStaticFile(ctx, path);
                    }
                }
            }
        } catch (Exception e) {
            com.zenith.webui.http.HttpHelper.sendJson(ctx, Map.of("error", "Internal server error"));
        }
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        ctx.close();
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        WebUIPlugin.sseClients.remove(ctx.channel());
        WebUIPlugin.dashboardSseClients.remove(ctx.channel());
        authHandler.unregisterSseChannel(ctx.channel());
    }
}
