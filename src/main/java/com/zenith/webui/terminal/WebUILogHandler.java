package com.zenith.webui.terminal;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.core.UnsynchronizedAppenderBase;
import com.zenith.webui.WebUIPlugin;

import java.util.regex.Pattern;

/**
 * Logback appender that forwards log events to the WebUI SSE broadcast.
 * Registered on the root logger during WebUIServer startup.
 */
public class WebUILogHandler extends UnsynchronizedAppenderBase<ILoggingEvent> {
    private static final Pattern ANSI_PATTERN = Pattern.compile("\\x1B\\[[0-9;]*[A-Za-z]");
    private static final String[] IGNORED_PREFIXES = {
            "com.sun.net.httpserver",
            "jdk.httpserver",
            "com.zenith.webui.auth",     // Auth events contain sensitive data (username, IP)
            "WebUI-Auth"                 // AuthManager logger — same reason
    };

    @Override
    protected void append(ILoggingEvent event) {
        WebUIPlugin inst = WebUIPlugin.instance; // volatile read snapshot to avoid null after stop()
        if (inst == null) return;
        if (event.getLevel() == Level.DEBUG) return;
        String logger = event.getLoggerName();
        if (logger == null || logger.isEmpty()) logger = "root";
        for (String prefix : IGNORED_PREFIXES) {
            if (logger.startsWith(prefix)) return;
        }
        String level = event.getLevel().toString();
        String message = ANSI_PATTERN.matcher(event.getFormattedMessage()).replaceAll("");
        IThrowableProxy tp = event.getThrowableProxy();
        if (tp != null) {
            message += " " + tp.getClassName() + (tp.getMessage() != null ? ": " + tp.getMessage() : "");
        }
        inst.broadcastLog(level, logger, message);
    }
}
