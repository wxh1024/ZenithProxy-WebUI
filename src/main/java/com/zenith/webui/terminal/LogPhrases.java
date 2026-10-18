package com.zenith.webui.terminal;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The English → Chinese phrase table for common log messages.
 *
 * <p><b>This class does not translate anything.</b> The server streams log messages
 * in their original English form; translation happens in the browser
 * ({@code web/js/i18n.js}) and only when the visitor's language is Chinese.
 * English visitors see the untranslated original.
 *
 * <p>This class exists purely as the single source of truth for the phrase table,
 * which {@code I18nHandler} serves through {@code GET /api/i18n}. The browser sorts
 * the keys by length descending so longer phrases win — for example
 * "Disconnected from server" must match before "Disconnected".
 */
public final class LogPhrases {
    private LogPhrases() {}

    private static final Map<String, String> TABLE = new LinkedHashMap<>();

    static {
        TABLE.put("Connecting to server", "正在连接服务器");
        TABLE.put("Connected to server", "已连接服务器");
        TABLE.put("Disconnected from server", "已从服务器断开");
        TABLE.put("Connection lost", "连接已丢失");
        TABLE.put("Reconnecting", "正在重连");
        TABLE.put("Reconnected", "已重连");
        TABLE.put("Login failed", "登录失败");
        TABLE.put("Login successful", "登录成功");
        TABLE.put("Authenticating", "正在认证");
        TABLE.put("Authentication failed", "认证失败");
        TABLE.put("Queue started", "已进入队列");
        TABLE.put("Queue complete", "队列完成");
        TABLE.put("Queue position", "队列位置");
        TABLE.put("Left queue", "已离开队列");
        TABLE.put("Player joined", "玩家已加入");
        TABLE.put("Player left", "玩家已离开");
        TABLE.put("Now online", "已上线");
        TABLE.put("Now offline", "已离线");
        TABLE.put("Bot started", "机器人已启动");
        TABLE.put("Bot stopped", "机器人已停止");
        TABLE.put("Bot crashed", "机器人已崩溃");
        TABLE.put("Anti-cheat detected", "检测到反作弊");
        TABLE.put("Kicked by server", "被服务器踢出");
        TABLE.put("Banned by server", "被服务器封禁");
        TABLE.put("AutoTotem", "自动图腾");
        TABLE.put("AutoEat", "自动进食");
        TABLE.put("AutoFish", "自动钓鱼");
        TABLE.put("AutoMend", "自动修补");
        TABLE.put("AutoDisconnect", "自动断开");
        TABLE.put("AutoRespawn", "自动重生");
        TABLE.put("AutoReply", "自动回复");
        TABLE.put("Module enabled", "模块已启用");
        TABLE.put("Module disabled", "模块已禁用");
        TABLE.put("Config saved", "配置已保存");
        TABLE.put("Config loaded", "配置已加载");
        TABLE.put("Failed to", "未能");
        TABLE.put("Switching to server", "正在切换服务器");
        TABLE.put("Server switch", "服务器切换");
        TABLE.put("Error", "错误");
        TABLE.put("Warning", "警告");
        TABLE.put("Entered queue", "已进入队列");
        TABLE.put("Entering server", "正在进入服务器");
        TABLE.put("Disconnected", "已断开连接");
        TABLE.put("Connecting", "正在连接");
        // Fragments seen in real AutoReconnect / disconnect lines.
        TABLE.put("in 2s", "2 秒后");
        TABLE.put("Connection reset", "连接被重置");
        TABLE.put("Try waiting and connecting again", "请稍候重试连接");
        TABLE.put("Cancelling", "正在取消");
    }

    /** Raw {@code English -> Chinese} phrase table, served to the browser as JSON. */
    public static Map<String, String> table() {
        return Collections.unmodifiableMap(TABLE);
    }
}