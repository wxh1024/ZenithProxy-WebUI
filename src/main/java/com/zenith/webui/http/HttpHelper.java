package com.zenith.webui.http;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.*;

import java.nio.charset.StandardCharsets;

/**
 * HTTP response utility methods. Stateless, shared by all handlers.
 * <p>
 * Every JSON payload — including SSE frames — is produced by Gson.
 * No response body is assembled by hand.
 */
public final class HttpHelper {
    /**
     * Shared Gson instance used for all JSON responses.
     */
    public static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    /**
     * Gson variant that keeps {@code null} fields. The dashboard payload relies on
     * explicit nulls (e.g. {@code player.health} when the bot is offline), which the
     * default Gson would silently drop.
     */
    public static final Gson GSON_NULLS = new GsonBuilder()
            .disableHtmlEscaping()
            .serializeNulls()
            .create();
    private static final String CONTENT_TYPE_JSON = "application/json; charset=utf-8";
    private static final String CONTENT_TYPE_TEXT = "text/plain; charset=utf-8";

    private HttpHelper() {
    }

    public static void sendJson(ChannelHandlerContext ctx, Object obj) {
        sendJson(ctx, obj, GSON);
    }

    public static void sendJson(ChannelHandlerContext ctx, Object obj, Gson gson) {
        writeBody(ctx, HttpResponseStatus.OK, gson.toJson(obj).getBytes(StandardCharsets.UTF_8),
                CONTENT_TYPE_JSON);
    }

    /**
     * JSON payload with an explicit status code. Used for error paths so a failed
     * request cannot be mistaken for a successful one — {@link #sendJson(ChannelHandlerContext, Object)}
     * always answers {@code 200}.
     */
    public static void sendJson(ChannelHandlerContext ctx, HttpResponseStatus status, Object obj) {
        writeBody(ctx, status, GSON.toJson(obj).getBytes(StandardCharsets.UTF_8), CONTENT_TYPE_JSON);
    }

    /**
     * Serialize {@code payload} into a complete Server-Sent Events frame ("data: {...}\n\n").
     */
    public static String sseFrame(Object payload) {
        return sseFrame(payload, GSON);
    }

    /**
     * SSE frame built with a specific Gson configuration (e.g. {@link #GSON_NULLS}).
     */
    public static String sseFrame(Object payload, Gson gson) {
        return "data: " + gson.toJson(payload) + "\n\n";
    }

    public static void sendBytes(ChannelHandlerContext ctx, byte[] content, String contentType) {
        writeBody(ctx, HttpResponseStatus.OK, content, contentType);
    }

    public static void sendNotFound(ChannelHandlerContext ctx) {
        writeBody(ctx, HttpResponseStatus.NOT_FOUND,
                "404 Not Found".getBytes(StandardCharsets.UTF_8), CONTENT_TYPE_TEXT);
    }

    /**
     * Send a plain-text status response (405 Method Not Allowed and friends).
     */
    public static void sendError(ChannelHandlerContext ctx, HttpResponseStatus status, String message) {
        writeBody(ctx, status, message.getBytes(StandardCharsets.UTF_8), CONTENT_TYPE_TEXT);
    }

    public static void sendCorsResponse(ChannelHandlerContext ctx) {
        HttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.NO_CONTENT);
        response.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        response.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, OPTIONS");
        response.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_HEADERS, "Content-Type, Authorization");
        response.headers().set(HttpHeaderNames.ACCESS_CONTROL_MAX_AGE, 86400);
        response.headers().set(HttpHeaderNames.CONTENT_LENGTH, 0);
        ctx.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE);
    }

    public static String getContentType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (path.endsWith(".json")) return CONTENT_TYPE_JSON;
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private static void writeBody(ChannelHandlerContext ctx, HttpResponseStatus status,
                                  byte[] body, String contentType) {
        HttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, status);
        response.headers().set(HttpHeaderNames.CONTENT_TYPE, contentType);
        response.headers().set(HttpHeaderNames.CONTENT_LENGTH, body.length);
        response.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        ctx.write(response);
        ctx.write(new DefaultHttpContent(Unpooled.wrappedBuffer(body)));
        ctx.writeAndFlush(LastHttpContent.EMPTY_LAST_CONTENT);
    }
}
