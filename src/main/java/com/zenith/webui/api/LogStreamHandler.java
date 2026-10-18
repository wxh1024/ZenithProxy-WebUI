package com.zenith.webui.api;

import com.zenith.webui.WebUIPlugin;
import com.zenith.webui.http.HttpHelper;
import com.zenith.webui.terminal.LogEntry;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.DefaultHttpContent;
import io.netty.handler.codec.http.DefaultHttpResponse;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpResponse;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.util.CharsetUtil;

/**
 * Handles /api/logs/stream — Server-Sent Events stream of log messages.
 */
public class LogStreamHandler {

    public void handleLogStream(ChannelHandlerContext ctx) {
        HttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.OK);
        response.headers().set(HttpHeaderNames.CONTENT_TYPE, "text/event-stream");
        response.headers().set(HttpHeaderNames.CACHE_CONTROL, "no-cache");
        response.headers().set(HttpHeaderNames.CONNECTION, "keep-alive");
        response.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        ctx.writeAndFlush(response);

        // Replay recent history. Each entry is serialized by Gson at connect time —
        // the buffer stores plain objects, never pre-baked JSON strings.
        int historySize = Math.min(WebUIPlugin.logBufferApproxSize.get(), WebUIPlugin.LOG_BUFFER_MAX);
        StringBuilder sb = new StringBuilder(Math.max(historySize, 0) * 160);
        for (LogEntry entry : WebUIPlugin.logBuffer) {
            sb.append(HttpHelper.sseFrame(entry));
        }
        if (sb.length() > 0) {
            try {
                ByteBuf buf = Unpooled.copiedBuffer(sb.toString(), CharsetUtil.UTF_8);
                ctx.writeAndFlush(new DefaultHttpContent(buf));
            } catch (Exception ignored) {
            }
        }

        WebUIPlugin.sseClients.add(ctx.channel());
    }
}
