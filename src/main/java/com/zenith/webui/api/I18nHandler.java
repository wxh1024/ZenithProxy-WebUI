package com.zenith.webui.api;

import com.zenith.webui.config.WebUIConfig;
import com.zenith.webui.http.HttpHelper;
import com.zenith.webui.terminal.LogPhrases;
import io.netty.channel.ChannelHandlerContext;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Handles {@code GET /api/i18n} — the public bootstrap payload for the frontend.
 *
 * <p>Contains the server-configured default language plus the English→Chinese log
 * phrase table, so the browser can render log lines in the visitor's language
 * without a second round trip per message.
 */
public class I18nHandler {

    private final WebUIConfig config;

    public I18nHandler(WebUIConfig config) {
        this.config = config;
    }

    public void handleI18n(ChannelHandlerContext ctx) {
        Map<String, Object> data = new LinkedHashMap<>();
        String lang = config.language == null ? "auto" : config.language;
        data.put("defaultLanguage", lang);
        data.put("supported", new String[]{"zh", "en"});
        data.put("logPhrases", LogPhrases.table());
        HttpHelper.sendJson(ctx, data);
    }
}