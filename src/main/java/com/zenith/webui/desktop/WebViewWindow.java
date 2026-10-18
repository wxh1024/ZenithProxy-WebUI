package com.zenith.webui.desktop;

import javafx.application.Application;
import javafx.application.Platform;
import javafx.concurrent.Worker;
import javafx.scene.Scene;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;
import javafx.stage.Stage;

/**
 * 用 JavaFX 的 WebView 承载 WebUI 页面，做成一个独立窗口。
 *
 * <p>页面本身还是 ZenithProxy 内嵌的 HTTP 服务提供的，窗口只负责显示 —— 这样
 * 后端逻辑、SSE 推送、静态资源全都不用改，桌面壳和插件形态共用同一套前端。
 */
public final class WebViewWindow extends Application {

    private static int port = 8080;
    private static String username = "admin";
    private static String password = "";

    private boolean loginAttempted;

    static void openWindow(int port, String username, String password) {
        WebViewWindow.port = port;
        WebViewWindow.username = username;
        WebViewWindow.password = password;
        Application.launch(WebViewWindow.class);
    }

    @Override
    public void start(Stage stage) {
        WebView view = new WebView();
        WebEngine engine = view.getEngine();

        // 首次加载完成后自动登录一次。WebUI 的鉴权是 HttpOnly cookie，
        // 在 WebView 的上下文里发这个请求就能拿到，之后所有请求自动带上。
        // 只尝试一次：成功后 location.replace('/') 会重新触发 SUCCEEDED，
        // 不加这个标志会变成刷新死循环。
        engine.getLoadWorker().stateProperty().addListener((obs, oldState, state) -> {
            if (state != Worker.State.SUCCEEDED || loginAttempted) return;
            loginAttempted = true;
            engine.executeScript(loginScript());
        });

        engine.load("http://127.0.0.1:" + port + "/");

        stage.setScene(new Scene(view, 1440, 900));
        stage.setTitle("ZenithProxy WebUI");
        stage.setOnCloseRequest(event -> Platform.exit());
        stage.show();
    }

    private String loginScript() {
        return """
            (function () {
                fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ username: "%s", password: "%s" })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (d && d.success) { location.replace('/'); } })
                    .catch(function () {});
            })();
            """.formatted(escape(username), escape(password));
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
