package com.zenith.webui.desktop;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 桌面版入口：先把 ZenithProxy 拉起来，等 WebUI 端口就绪，再开一个原生窗口。
 *
 * <p>这里刻意不继承 {@code javafx.application.Application}。JavaFX 在 classpath 上
 * （而不是 module path）时，JDK 会拒绝启动「main 类继承 Application」的应用，报
 * "JavaFX runtime components are missing"。用一个普通类做入口、转手调
 * {@code Application.launch} 就能绕开这条检查，代价是 JavaFX 的 jar 必须整体在
 * classpath 上（打包时放进 {@code app/}）。
 */
public final class DesktopLauncher {

    private static final int DEFAULT_PORT = 8080;
    private static final Path WEBUI_CONFIG = Path.of("plugins", "webui", "config.json");
    private static final Duration STARTUP_TIMEOUT = Duration.ofSeconds(90);

    private DesktopLauncher() {}

    public static void main(String[] args) {
        Thread proxy = new Thread(() -> {
            try {
                // 走 ZenithProxy 自己的插件引导流程：发现 plugins/ 下的 JAR、装配
                // mixin、再反射调用 com.zenith.Proxy.main
                com.zenith.ProxyLaunchWrapper.main(args);
            } catch (Throwable t) {
                t.printStackTrace();
                System.exit(1);
            }
        }, "zenith-proxy");
        // 保持 daemon：窗口关掉后 JVM 直接退出，不用再去收尸 ZenithProxy 的线程
        proxy.setDaemon(true);
        proxy.start();

        int port = readPort();
        if (!waitForPort(port, STARTUP_TIMEOUT)) {
            System.err.println("WebUI 未在 " + STARTUP_TIMEOUT.toSeconds() + " 秒内就绪（端口 " + port + "）");
            System.exit(1);
        }

        String[] credentials = readCredentials();
        WebViewWindow.openWindow(port, credentials[0], credentials[1]);
    }

    /** 端口以 WebUI 插件自己的配置为准，读不到才退回默认值。 */
    private static int readPort() {
        Matcher m = Pattern.compile("\"port\"\\s*:\\s*(\\d+)").matcher(readConfig());
        return m.find() ? Integer.parseInt(m.group(1)) : DEFAULT_PORT;
    }

    /** 返回 {username, password}；首次运行时插件会生成随机密码并写进这个文件。 */
    private static String[] readCredentials() {
        String json = readConfig();
        String user = extract(json, "username");
        String pass = extract(json, "password");
        return new String[] {user.isEmpty() ? "admin" : user, pass};
    }

    private static String extract(String json, String key) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
        return m.find() ? m.group(1) : "";
    }

    private static String readConfig() {
        try {
            return Files.exists(WEBUI_CONFIG)
                ? Files.readString(WEBUI_CONFIG, StandardCharsets.UTF_8)
                : "";
        } catch (IOException e) {
            return "";
        }
    }

    private static boolean waitForPort(int port, Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", port), 500);
                return true;
            } catch (IOException ignored) {
                // 还没起来，继续等
            }
            try {
                Thread.sleep(250);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }
}
