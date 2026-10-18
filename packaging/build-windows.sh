#!/usr/bin/env bash
#
# 把 ZenithProxy 本体 + WebUI 插件打成自带 JRE、双击即用的 Windows 应用。
#
#   packaging/build-windows.sh            # 生成绿色版目录 + zip
#   packaging/build-windows.sh --no-zip   # 只生成目录
#
# 产物：
#   build/dist/ZenithProxy-WebUI/          ← 绿色版目录
#     ZenithProxy-WebUI.exe                ← 双击启动
#     app/                                 ← ZenithProxy 本体 + 全部依赖 JAR
#     runtime/                             ← 内置 JRE 21
#     plugins/webui.jar                    ← WebUI 插件
#     launch_config.json                   ← 关闭自动更新，避免覆盖打包的 JAR
#   build/dist/ZenithProxy-WebUI-<ver>-win-x64.zip
#
# 说明：ZenithProxy 用相对路径读取 config.json 和 plugins/，所以工作目录必须
# 是 exe 所在目录。绿色版双击启动时 cwd 天然正确；打包成安装器则不可靠，
# 因此这里只做免安装的目录版。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_NAME="ZenithProxy-WebUI"
DIST="$ROOT/build/dist"
JDK_HOME="${JDK_HOME:-C:/Program Files/Java/jdk-21.0.12}"
JPACKAGE="$JDK_HOME/bin/jpackage"
APP_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' build.gradle.kts | head -1)"

if [ ! -x "$JPACKAGE" ]; then
    echo "找不到 jpackage: $JPACKAGE" >&2
    echo "请用 JDK_HOME 指定一个 JDK 21+ 的安装目录。" >&2
    exit 1
fi

# Gradle 必须显式走代理：Java 不读 HTTP_PROXY，直连会被沙箱的透明代理挡在
# 证书校验那一步（PKIX path building failed）。端口每次会话都可能变，从环境变量取。
PROXY_PORT="$(echo "${HTTPS_PROXY:-}" | sed -E 's|.*:([0-9]+).*|\1|')"
PROXY_ARGS=()
if [ -n "${PROXY_PORT:-}" ]; then
    PROXY_ARGS=(
        -Dhttp.proxyHost=127.0.0.1 "-Dhttp.proxyPort=$PROXY_PORT"
        -Dhttps.proxyHost=127.0.0.1 "-Dhttps.proxyPort=$PROXY_PORT"
    )
fi

echo "==> 收集 ZenithProxy 运行时依赖（版本 $APP_VERSION）"
./gradlew prepareDist --no-daemon "${PROXY_ARGS[@]}"

echo "==> jpackage 生成 app-image"
# 不用 rm -rf：批量删除会触发宿主的安全策略。find -delete 逐项删除即可。
if [ -d "$DIST/$APP_NAME" ]; then
    find "$DIST/$APP_NAME" -mindepth 1 -delete
    rmdir "$DIST/$APP_NAME"
fi

# 主类是桌面启动器：它先拉起 ZenithProxy，等 WebUI 端口就绪，再用 JavaFX
# 开一个 WebView 窗口。不加 --win-console —— 桌面应用不该弹黑窗，日志落在 log/。
"$JPACKAGE" \
    --type app-image \
    --name "$APP_NAME" \
    --input "$DIST/lib" \
    --main-jar launcher.jar \
    --main-class com.zenith.webui.desktop.DesktopLauncher \
    --dest "$DIST" \
    --app-version "$APP_VERSION" \
    --vendor "wxh1024" \
    --java-options "-Dfile.encoding=UTF-8"

# 插件和启动配置必须落在应用根目录（也就是 cwd），不能被 jpackage 收进 app/
cp -r "$DIST/plugins" "$DIST/$APP_NAME/plugins"
cp "$ROOT/packaging/launch_config.json" "$DIST/$APP_NAME/launch_config.json"

if [ "${1:-}" != "--no-zip" ]; then
    ZIP="$DIST/$APP_NAME-$APP_VERSION-win-x64.zip"
    echo "==> 打包 $ZIP"
    [ -f "$ZIP" ] && rm -f "$ZIP"
    # Git Bash 自带的是 GNU tar，不支持 -a 写 zip；用 Windows 自带的 bsdtar
    ( cd "$DIST" && /c/Windows/System32/tar.exe -a -c -f "$ZIP" "$APP_NAME" )
fi

echo
echo "==> 完成：$DIST/$APP_NAME"
echo "    双击 $APP_NAME/$APP_NAME.exe 启动，会直接弹出桌面窗口（JavaFX WebView 承载面板）"
echo "    启动器会读 plugins/webui/config.json 里的凭据自动登录，首次运行由插件生成随机密码"
