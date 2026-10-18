package com.zenith.webui.auth;

import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.zenith.webui.config.WebUIConfig;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.*;
import io.netty.util.AttributeKey;

import java.nio.charset.StandardCharsets;

/**
 * Handles authentication checks for incoming requests.
 * Uses per-channel auth caching to avoid redundant token validation
 * on HTTP keep-alive connections.
 */
public class AuthHandler {
    /**
     * Per-channel auth cache: avoids re-validating token on every request over the same TCP connection.
     */
    private static final AttributeKey<Long> AUTH_CACHE_KEY = AttributeKey.valueOf("webui_auth_ts");
    /**
     * Auth generation the cached result belongs to — bumped on logout/password change.
     */
    private static final AttributeKey<Long> AUTH_EPOCH_KEY = AttributeKey.valueOf("webui_auth_epoch");
    /**
     * Re-validate token at most once per cache window (30s). Zero cost for bursts of requests.
     */
    private static final long AUTH_CACHE_MS = 30_000;
    // Paths that don't require authentication
    private static final String[] PUBLIC_PATHS = {
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/status",
            "/login.html",
            "/favicon.ico"
    };
    private final AuthManager authManager;
    private final WebUIConfig config;

    public AuthHandler(AuthManager authManager, WebUIConfig config) {
        this.authManager = authManager;
        this.config = config;
    }

    private static void clearCache(Channel channel) {
        channel.attr(AUTH_CACHE_KEY).set(null);
        channel.attr(AUTH_EPOCH_KEY).set(null);
    }

    /**
     * Validate that a file path stays within allowed directories
     *
     * @return true if path is safe, false if traversal detected
     */
    public static boolean isSafePath(String path) {
        if (path == null) return false;
        // Normalize and check for traversal
        String normalized = path.replace("\\", "/");
        if (normalized.contains("..") || normalized.contains("//")) return false;
        if (normalized.contains("\0")) return false;
        // Must start with / and not contain drive letters (Windows)
        if (!normalized.startsWith("/")) return false;
        return true;
    }

    /**
     * Extract authentication token from request (cookie or Bearer header).
     * Shared utility — also used by {@link AuthController} and {@link com.zenith.webui.server.WebUIChannelHandler}.
     */
    public static String extractToken(FullHttpRequest request) {
        // Try Authorization header first
        String authHeader = request.headers().get(HttpHeaderNames.AUTHORIZATION);
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }

        // Try cookie
        String cookieHeader = request.headers().get(HttpHeaderNames.COOKIE);
        if (cookieHeader != null) {
            String[] cookies = cookieHeader.split(";");
            for (String cookie : cookies) {
                String[] parts = cookie.trim().split("=", 2);
                if (parts.length == 2 && "webui_token".equals(parts[0].trim())) {
                    return parts[1].trim();
                }
            }
        }

        return null;
    }

    /**
     * Send unauthorized response (safe from JSON injection)
     */
    public static void sendUnauthorized(ChannelHandlerContext ctx, String message) {
        JsonObject json = new JsonObject();
        json.add("error", new JsonPrimitive(message));
        json.add("code", new JsonPrimitive(401));
        byte[] bytes = json.toString().getBytes(StandardCharsets.UTF_8);

        HttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.UNAUTHORIZED);
        response.headers().set(HttpHeaderNames.CONTENT_TYPE, "application/json");
        response.headers().set(HttpHeaderNames.WWW_AUTHENTICATE, "Bearer realm=\"webui\"");
        response.headers().set(HttpHeaderNames.CONTENT_LENGTH, bytes.length);
        ctx.write(response);
        ctx.write(new DefaultHttpContent(Unpooled.wrappedBuffer(bytes)));
        ctx.writeAndFlush(LastHttpContent.EMPTY_LAST_CONTENT).addListener(ChannelFutureListener.CLOSE);
    }

    /**
     * Send redirect to login page
     */
    public static void sendRedirect(ChannelHandlerContext ctx, String location) {
        HttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.FOUND);
        response.headers().set(HttpHeaderNames.LOCATION, location);
        response.headers().set(HttpHeaderNames.CONTENT_LENGTH, 0);
        ctx.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE);
    }

    // ── SSE channel registration (event-driven disconnect on logout/password-change) ──

    /**
     * Check if request is authenticated, with per-channel caching.
     *
     * @return true if authenticated or public path, false otherwise
     */
    public boolean checkAuth(ChannelHandlerContext ctx, FullHttpRequest request) {
        // If auth is disabled globally, allow all requests
        if (config != null && !config.auth.enabled) {
            return true;
        }

        String path = request.uri();
        // Strip query string for path matching
        if (path.contains("?")) path = path.substring(0, path.indexOf('?'));

        // Check public paths
        for (String publicPath : PUBLIC_PATHS) {
            if (path.equals(publicPath)) {
                return true;
            }
        }

        // Static assets (no /api/ prefix) are public: the login page must load
        // its CSS and JS before authenticating.
        //
        // The prefix test is case-insensitive on purpose. A case-sensitive
        // startsWith("/api/") lets "/API/dashboard" slip past this branch into
        // the static file handler, which answers with the SPA shell instead of
        // rejecting the request. The routing switch is case-sensitive too, so
        // such a path can never reach a real handler — but answering 401 keeps
        // the contract that everything under /api/ needs credentials.
        if (!path.regionMatches(true, 0, "/api/", 0, 5)) {
            return true;
        }

        // Per-channel auth cache: skip validation if recently authenticated on this TCP channel
        // AND no token has been revoked since (logout / password change bumps the epoch).
        Channel ch = ctx.channel();
        Long cachedTs = ch.attr(AUTH_CACHE_KEY).get();
        Long cachedEpoch = ch.attr(AUTH_EPOCH_KEY).get();
        long now = System.currentTimeMillis();
        long currentEpoch = AuthManager.epoch();
        if (cachedTs != null && cachedEpoch != null && cachedEpoch == currentEpoch
                && (now - cachedTs) < AUTH_CACHE_MS) {
            return true;
        }

        // Extract token from cookie or header
        String token = extractToken(request);
        if (token == null) {
            clearCache(ch);
            return false;
        }

        // Validate token
        String username = authManager.validateToken(token);
        if (username != null) {
            ch.attr(AUTH_CACHE_KEY).set(now);
            ch.attr(AUTH_EPOCH_KEY).set(currentEpoch);
            return true;
        }
        clearCache(ch);
        return false;
    }

    /**
     * Get authenticated username from request
     */
    public String getUsername(FullHttpRequest request) {
        String token = extractToken(request);
        if (token == null) return null;
        return authManager.validateToken(token);
    }

    /**
     * Register an SSE channel for a token so it can be closed when the token is revoked.
     */
    public void registerSseChannel(String token, Channel channel) {
        authManager.registerChannel(token, channel);
    }

    /**
     * Unregister an SSE channel (called on channelInactive).
     */
    public void unregisterSseChannel(Channel channel) {
        authManager.unregisterChannel(channel);
    }
}
