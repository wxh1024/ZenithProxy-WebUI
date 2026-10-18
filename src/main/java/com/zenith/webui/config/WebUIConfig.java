package com.zenith.webui.config;

public class WebUIConfig {
    public int port = 8080;
    /** Whether the HTTP server starts automatically on plugin load. */
    public boolean enabled = true;

    /**
     * Default UI language: {@code "auto"} (follow the browser), {@code "zh"} or {@code "en"}.
     * The frontend still lets each visitor override it via the in-page language switcher;
     * this value is only the fallback used before the browser preference is known.
     */
    public String language = "auto";

    // Authentication settings
    public AuthConfig auth = new AuthConfig();

    public WebUIConfig() {}

    public static class AuthConfig {
        public boolean enabled = true;
        public String username = "admin";
        // Intentionally blank: ConfigManager generates a random password on first run.
        // Defaulting to a well-known value would silently ship an admin/admin instance.
        public String password = "";
        public long tokenExpiry = 24 * 60 * 60 * 1000; // 24 hours

        public AuthConfig() {}
    }

    // Auth bypasser settings — fixes offline login for hybrid-auth servers (e.g. 3C network)
    public AuthBypasserConfig authBypasser = new AuthBypasserConfig();

    public static class AuthBypasserConfig {
        public boolean enabled = true;
        public boolean rewriteOfflineUuid = true;
        public boolean bypassAuthenticateHello = true;

        public AuthBypasserConfig() {}
    }
}
