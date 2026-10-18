package com.zenith.webui.terminal;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Static utility for translating common English log messages to Chinese.
 * Uses a single pre-compiled regex for one-pass translation instead of
 * iterating with {@link String#replace} (which internally compiles a
 * Pattern each time).
 *
 * Keys are sorted by length descending so longer matches take priority.
 *
 * <p><b>Note:</b> translation now happens on the frontend ({@code web/js/i18n.js})
 * so that English visitors see the original English log lines. This class is kept
 * as the single source of truth for the phrase table and is served to the browser
 * through {@code GET /api/i18n/log-phrases}.
 */
public final class LogTranslator {
    private LogTranslator() {}

    private static final LinkedHashMap<String, String> LOG_TRANSLATIONS = new LinkedHashMap<>();
    private static final List<Map.Entry<String, String>> SORTED_TRANSLATIONS;
    private static final Pattern TRANSLATION_PATTERN;

    static {
        LOG_TRANSLATIONS.put("Connecting to server", "正在连接服务器");
        LOG_TRANSLATIONS.put("Connected to server", "已连接服务器");
        LOG_TRANSLATIONS.put("Disconnected from server", "已从服务器断开");
        LOG_TRANSLATIONS.put("Connection lost", "连接已丢失");
        LOG_TRANSLATIONS.put("Reconnecting", "正在重连");
        LOG_TRANSLATIONS.put("Reconnected", "已重连");
        LOG_TRANSLATIONS.put("Login failed", "登录失败");
        LOG_TRANSLATIONS.put("Login successful", "登录成功");
        LOG_TRANSLATIONS.put("Authenticating", "正在认证");
        LOG_TRANSLATIONS.put("Authentication failed", "认证失败");
        LOG_TRANSLATIONS.put("Queue started", "已进入队列");
        LOG_TRANSLATIONS.put("Queue complete", "队列完成");
        LOG_TRANSLATIONS.put("Queue position", "队列位置");
        LOG_TRANSLATIONS.put("Left queue", "已离开队列");
        LOG_TRANSLATIONS.put("Player joined", "玩家已加入");
        LOG_TRANSLATIONS.put("Player left", "玩家已离开");
        LOG_TRANSLATIONS.put("Now online", "已上线");
        LOG_TRANSLATIONS.put("Now offline", "已离线");
        LOG_TRANSLATIONS.put("Bot started", "机器人已启动");
        LOG_TRANSLATIONS.put("Bot stopped", "机器人已停止");
        LOG_TRANSLATIONS.put("Bot crashed", "机器人已崩溃");
        LOG_TRANSLATIONS.put("Anti-cheat detected", "检测到反作弊");
        LOG_TRANSLATIONS.put("Kicked by server", "被服务器踢出");
        LOG_TRANSLATIONS.put("Banned by server", "被服务器封禁");
        LOG_TRANSLATIONS.put("AutoTotem", "自动图腾");
        LOG_TRANSLATIONS.put("AutoEat", "自动进食");
        LOG_TRANSLATIONS.put("AutoFish", "自动钓鱼");
        LOG_TRANSLATIONS.put("AutoMend", "自动修补");
        LOG_TRANSLATIONS.put("AutoDisconnect", "自动断开");
        LOG_TRANSLATIONS.put("AutoRespawn", "自动重生");
        LOG_TRANSLATIONS.put("AutoReply", "自动回复");
        LOG_TRANSLATIONS.put("Module enabled", "模块已启用");
        LOG_TRANSLATIONS.put("Module disabled", "模块已禁用");
        LOG_TRANSLATIONS.put("Config saved", "配置已保存");
        LOG_TRANSLATIONS.put("Config loaded", "配置已加载");
        LOG_TRANSLATIONS.put("Failed to", "未能");
        LOG_TRANSLATIONS.put("Switching to server", "正在切换服务器");
        LOG_TRANSLATIONS.put("Server switch", "服务器切换");
        LOG_TRANSLATIONS.put("Error", "错误");
        LOG_TRANSLATIONS.put("Warning", "警告");
        LOG_TRANSLATIONS.put("Entered queue", "已进入队列");
        LOG_TRANSLATIONS.put("Entering server", "正在进入服务器");
        LOG_TRANSLATIONS.put("Disconnected", "已断开连接");
        LOG_TRANSLATIONS.put("Connecting", "正在连接");

        SORTED_TRANSLATIONS = new ArrayList<>(LOG_TRANSLATIONS.entrySet());
        SORTED_TRANSLATIONS.sort((a, b) -> Integer.compare(b.getKey().length(), a.getKey().length()));

        // Build a single alternation regex: (longestKey|secondLongest|...)
        StringBuilder sb = new StringBuilder();
        for (var entry : SORTED_TRANSLATIONS) {
            if (sb.length() > 0) sb.append('|');
            sb.append(Pattern.quote(entry.getKey()));
        }
        TRANSLATION_PATTERN = Pattern.compile(sb.toString());
    }

    /**
     * One-pass translation: single regex scan replaces all matching substrings.
     * Avoids the 35x Pattern.compile + full-scan overhead of the old per-key loop.
     *
     * <p>Only used by the server-side console output; the WebUI frontend applies the
     * same table client-side so English visitors get the untranslated original.
     */
    public static String translate(String message) {
        if (message == null || message.isEmpty()) return message;
        Matcher m = TRANSLATION_PATTERN.matcher(message);
        return m.replaceAll(match -> LOG_TRANSLATIONS.get(match.group()));
    }

    /** Raw {@code English -> Chinese} phrase table, longest key first. */
    public static Map<String, String> phraseTable() {
        return LOG_TRANSLATIONS;
    }
}