package com.zenith.webui.api;

import com.google.gson.JsonObject;
import com.zenith.webui.http.HttpHelper;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.util.CharsetUtil;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.zenith.Globals.*;

/**
 * Handles /api/whitelist — whitelist status query and management (CRUD).
 */
public class WhitelistHandler {

    public void handleWhitelist(ChannelHandlerContext ctx, FullHttpRequest req) {
        if (HttpMethod.GET.equals(req.method())) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("enabled", CONFIG.server.extra.whitelist.enable);
            data.put("kickmsg", CONFIG.server.extra.whitelist.kickmsg);
            data.put("autoAddClient", CONFIG.server.extra.whitelist.autoAddClient);
            List<Map<String, Object>> entries = new ArrayList<>();
            for (var entry : CONFIG.server.extra.whitelist.whitelist) {
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("username", entry.getUsername());
                e.put("uuid", entry.getUuid().toString());
                entries.add(e);
            }
            data.put("whitelist", entries);
            HttpHelper.sendJson(ctx, data);
        } else if (HttpMethod.POST.equals(req.method())) {
            try {
                String body = req.content().toString(CharsetUtil.UTF_8);
                if (body == null || body.isEmpty()) {
                    HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Empty request body"));
                    return;
                }
                JsonObject json = HttpHelper.GSON.fromJson(body, JsonObject.class);
                if (json == null || !json.has("action")) {
                    HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Missing action field"));
                    return;
                }
                String action = json.get("action").getAsString();
                switch (action) {
                    case "toggle" -> {
                        if (!json.has("enabled")) {
                            HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Missing enabled field"));
                            return;
                        }
                        CONFIG.server.extra.whitelist.enable = json.get("enabled").getAsBoolean();
                        HttpHelper.sendJson(ctx, Map.of("success", true, "enabled",
                                CONFIG.server.extra.whitelist.enable));
                    }
                    case "add" -> {
                        if (!json.has("username")) {
                            HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Missing username field"));
                            return;
                        }
                        String username = json.get("username").getAsString();
                        var result = PLAYER_LISTS.getWhitelist().add(username);
                        if (result.isPresent()) {
                            HttpHelper.sendJson(ctx, Map.of("success", true, "username",
                                    result.get().getUsername(), "uuid", result.get().getUuid().toString()));
                        } else {
                            HttpHelper.sendJson(ctx, Map.of("success", false, "error",
                                    "无法解析用户名 / Could not resolve username"));
                        }
                    }
                    case "remove" -> {
                        if (!json.has("username")) {
                            HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Missing username field"));
                            return;
                        }
                        String username = json.get("username").getAsString();
                        PLAYER_LISTS.getWhitelist().remove(username);
                        HttpHelper.sendJson(ctx, Map.of("success", true));
                    }
                    case "updateConfig" -> {
                        if (json.has("kickmsg"))
                            CONFIG.server.extra.whitelist.kickmsg = json.get("kickmsg").getAsString();
                        if (json.has("autoAddClient"))
                            CONFIG.server.extra.whitelist.autoAddClient = json.get("autoAddClient").getAsBoolean();
                        HttpHelper.sendJson(ctx, Map.of("success", true));
                    }
                    default -> HttpHelper.sendJson(ctx,
                            Map.of("success", false, "error", "Unknown action: " + action));
                }
            } catch (Exception e) {
                HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Whitelist operation failed"));
            }
        } else {
            HttpHelper.sendError(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, "Method Not Allowed");
        }
    }
}
