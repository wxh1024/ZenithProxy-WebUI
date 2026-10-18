package com.zenith.webui.authbypass;

import com.zenith.webui.config.WebUIConfig;

/**
 * Shared volatile state so auth-bypass packet handlers can read the
 * latest config without a compile-time dependency on WebUIPlugin.
 */
public final class AuthBypasserState {

    private static volatile WebUIConfig.AuthBypasserConfig config;
    private static volatile boolean enabled;

    private AuthBypasserState() {
    }

    public static WebUIConfig.AuthBypasserConfig getConfig() {
        return enabled ? config : null;
    }

    public static void update(WebUIConfig.AuthBypasserConfig config) {
        AuthBypasserState.config = config;
        AuthBypasserState.enabled = config != null && config.enabled;
    }

    public static boolean isEnabled() {
        return enabled;
    }
}
