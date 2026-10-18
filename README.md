# ZenithProxy Web UI

[![Build](https://github.com/wxh1024/ZenithProxy-WebUI/actions/workflows/build.yml/badge.svg)](https://github.com/wxh1024/ZenithProxy-WebUI/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/wxh1024/ZenithProxy-WebUI?sort=semver)](https://github.com/wxh1024/ZenithProxy-WebUI/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![ZenithProxy](https://img.shields.io/badge/ZenithProxy-plugin-6f42c1)](https://github.com/rfresh2/ZenithProxy)
[![Minecraft](https://img.shields.io/badge/Minecraft-1.21.4-62B47A?logo=minecraft&logoColor=white)](https://github.com/rfresh2/ZenithProxy)
[![Java](https://img.shields.io/badge/Java-21-ED8F03?logo=openjdk&logoColor=white)](https://adoptium.net/)
[![Downloads](https://img.shields.io/github/downloads/wxh1024/ZenithProxy-WebUI/total)](https://github.com/wxh1024/ZenithProxy-WebUI/releases)

基于浏览器的 ZenithProxy 管理面板，提供实时状态监控、命令执行、白名单管理和日志查看功能。

[English](README.en.md) | 简体中文

> 本项目以 [GNU Affero 通用公共许可证 v3.0 或更高版本](LICENSE)（AGPL-3.0-or-later）开源。
>
> 完整技术文档（安装、配置、API、架构、安全、开发与发布）见 [Wiki](../../wiki)。

## 功能特性

- **状态监控仪表板**: 实时显示代理连接状态、当前用户、代理地址、运行时间、玩家连接数、队列位置
- **系统资源监控**: CPU 占用、内存占用、网络流量、延迟波动的实时图表（Chart.js）
- **服务器控制**: 一键连接/断开/重连/关闭代理
- **配置管理**: 图形化编辑认证、客户端、服务器配置，保存后提示重启生效
- **命令终端**: 在网页中执行 ZenithProxy 命令，支持自动补全、命令历史、快捷键（Tab/↑↓/Ctrl+L/Ctrl+C）
- **日志查看器**: SSE 实时推送系统日志，支持日志级别颜色区分、导出
- **玩家列表**: 查看当前连接的玩家（控制器/观察者），支持踢出操作
- **白名单管理**: 启用/禁用白名单、添加/移除玩家、配置踢出消息、自动添加机器人账户
- **国际化 (i18n)**: 自动识别浏览器语言，支持中文/英文一键切换；日志按访客语言翻译
- **模块化前端**: 原生 ES 模块拆分，无构建步骤
- **用户认证**: Cookie 认证 + 速率限制，首次启动自动生成随机密码

## 安装与启用

### 1. 构建插件

方式一：从 [Releases](https://github.com/wxh1024/ZenithProxy-WebUI/releases) 下载已编译的 JAR。

方式二：本地构建（需要 JDK 21 和访问 `maven.2b2t.vc` 的网络）：

```bash
./gradlew shadowJar
```

输出文件：`build/libs/ZenithProxy-WebUI-1.4.0.jar`

### 2. 安装插件

将 `ZenithProxy-WebUI-1.4.0.jar` 复制到 ZenithProxy 的 `plugins/` 目录。

### 3. 配置文件

插件首次启动时会在 `plugins/webui/config.json` 生成配置并自动创建随机密码：

```json
{
  "enabled": true,
  "port": 8080,
  "language": "auto",
  "auth": {
    "enabled": true,
    "username": "admin",
    "password": "<16位随机密码>"
  }
}
```

### 4. 命令管理

```
webui enable        # 启用 Web UI
webui disable       # 禁用 Web UI
webui status        # 查看 Web UI 状态
```

### 5. 访问

启动 ZenithProxy 后，在浏览器中访问：

```
http://localhost:8080
```

## 配置选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | true | 是否在插件加载时自动启动 Web UI |
| `port` | 8080 | HTTP 服务器端口 |
| `language` | auto | 默认界面语言：`auto`（跟随浏览器）、`zh` 或 `en` |
| `auth.enabled` | true | 是否启用登录认证 |
| `auth.username` | admin | 登录用户名 |
| `auth.password` | 随机生成 | 登录密码（首次启动自动生成并输出到日志） |

> 要禁用认证，将 `auth.enabled` 设为 `false` 即可。

## API 端点

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/auth/login` | POST | 否 | 登录 `{"username": "...", "password": "..."}` → 设置 HttpOnly Cookie |
| `/api/auth/logout` | POST | 否 | 清除认证 Cookie |
| `/api/auth/status` | GET | 否 | 返回 `{"authenticated": true/false, "username": "..."}` |
| `/api/dashboard` | GET | 是 | 聚合仪表盘数据（连接状态、队列、版本、运行时间、玩家、CPU、内存、网络、延迟） |
| `/api/dashboard/stream` | GET | 是 | SSE 实时推送仪表盘数据（每秒） |
| `/api/commands` | GET | 是 | 获取可用命令列表 |
| `/api/commands` | POST | 是 | 执行命令 `{"command": "..."}` |
| `/api/logs/stream` | GET | 是 | SSE 实时日志推送（推送最近 500 条历史 + 实时日志） |
| `/api/whitelist` | GET | 是 | 获取白名单状态、列表、配置信息 |
| `/api/whitelist` | POST | 是 | 白名单管理 `{"action": "toggle/add/remove/updateConfig", ...}` |

> `/api/status`, `/api/players`, `/api/queue`, `/api/system`, `/api/latency` 等独立端点已合并到 `/api/dashboard`（聚合返回）。前端不依赖这些独立端点。

## 国际化

仪表板与登录页均支持中英双语，语言优先级：

1. `?lang=en` / `?lang=zh` 查询参数（便于分享指定语言的链接）
2. 界面内的语言切换器（保存在 `localStorage`）
3. `config.json` 中的 `language`（当其不为 `auto` 时）
4. `navigator.languages` —— 浏览器自身的语言偏好
5. 最终回退到 `zh`

日志翻译只对中文生效：日志本身即英文，服务端始终下发原文不做任何翻译；
浏览器仅在所选语言为中文时套用短语表。因此英文访客看到的永远是未翻译的原始英文，
不存在"被强制翻成中文"的情况。

## 命令

| 命令 | 说明 |
|------|------|
| `webui enable` | 启用 Web UI（可重复调用，幂等安全） |
| `webui disable` | 禁用 Web UI |
| `webui status` | 查看 Web UI 状态 |

## 前端页面

| 页面 | 说明 |
|------|------|
| 仪表板 | 代理状态、服务器控制按钮、系统资源图表 |
| 配置管理 | 认证/客户端/服务器配置编辑 |
| 终端日志 | 命令执行、日志查看、导出 |
| 玩家列表 | 玩家管理、白名单管理 |

## 前端快捷键

| 快捷键 | 说明 |
|--------|------|
| `Tab` | 命令自动补全 |
| `↑` / `↓` | 浏览命令历史 |
| `Ctrl+L` | 清空终端 |
| `Ctrl+C` | 取消当前输入 |

## 技术栈

- **后端**: Java 21, Netty NIO (零拷贝文件传输), Gson, Logback
- **前端**: 原生 HTML/CSS/ES 模块（无框架、无构建步骤）, Chart.js
- **实时传输**: SSE (Server-Sent Events)
- **构建**: Gradle + Shadow JAR

## 认证机制

- 使用 `webui_token` HttpOnly Cookie（SameSite=Lax, Path=/）
- 也支持 `Authorization: Bearer <token>` Header
- Token 有效期 24 小时（`auth.tokenExpiry` 可调），不做滑动续期，到期需重新登录
- 速率限制：同一 IP 每分钟最多 5 次登录失败（登录成功会清零计数）
- SSE 连接同样需要认证（通过 Cookie 自动传递），Token 失效时连接被立即关闭
- 30 秒的通道级认证缓存会在登出/改密时通过认证代数（epoch）立即失效

## 故障排除

### 无法访问 Web UI

1. 检查 `plugins/webui/config.json` 中端口配置
2. 检查端口是否被占用：`lsof -i :8080`
3. 查看 ZenithProxy 启动日志确认 WebUI 是否成功启动

### 忘记密码

查看 ZenithProxy 启动日志中的首次生成密码提示：
```
Created WebUI config with defaults (random password generated)
Default username: admin, password: xxxxxxxx
```
或直接编辑 `plugins/webui/config.json` 中的 `auth.password`。

### 命令执行失败

1. 检查命令语法是否正确
2. 查看终端日志中的错误信息

### 日志不显示

1. 确认 Web UI 服务已启动
2. 检查浏览器控制台是否有网络错误
3. SSE EventSource 依赖同源 Cookie，确保非跨域访问

## 安全注意事项

- 首次启动自动生成随机密码，请查看日志获取
- 默认启用认证，建议保持 `auth.enabled: true`
- 仅在本地网络使用
- 不要将 Web UI 暴露在公共网络上
- 生产环境建议配置反向代理（如 Nginx）并启用 HTTPS

## 项目结构

```
src/main/java/com/zenith/webui/
  WebUIPlugin.java          # 插件入口：生命周期、SSE 广播、日志缓冲区
  TitlePacketHandler.java   # Title 包拦截处理
  api/                      # /api 处理器：命令、仪表盘、日志流、白名单
  auth/                     # Token 认证：过滤器、管理器、登录/登出
  authbypass/               # 离线认证绕过包处理器
  command/                  # /webui enable|disable|status
  config/                   # 配置数据类与 config.json 管理
  http/HttpHelper.java      # HTTP 响应工具 + 共享 Gson + SSE 帧构造
  queue/QueueParser.java    # 3c3u.org / 2b2t.org 队列位置解析
  server/                   # Netty 启动与请求路由
  staticfile/               # 静态文件服务（LRU 缓存）
  terminal/                 # 日志翻译、Logback Appender、LogEntry

src/main/resources/
  web/
    index.html              # 主前端页面
    login.html              # 登录页面
    styles.css              # 样式（Catppuccin Macchiato 配色）
    js/                     # 前端 ES 模块（见下表）
  zenithproxy.plugin.json   # 插件元数据
```

## 前端模块划分

| 模块 | 职责 |
|------|------|
| `js/i18n.js` | 翻译表、语言解析、`t()`、日志翻译 |
| `js/api.js` | fetch 封装、SSE（指数退避重连）、会话辅助 |
| `js/state.js` | 共享可变状态（日志、历史、连接状态、限额） |
| `js/dashboard.js` | 状态卡片、队列渲染、四个 Chart.js 图表 |
| `js/commands.js` | 命令发现与模糊补全打分 |
| `js/terminal.js` | 日志流、滚动缓冲、命令输入、导出 |
| `js/whitelist.js` | 白名单增删改查 |
| `js/server.js` | 连接/断开/重连/关闭磁贴 |
| `js/util.js` | HTML 转义、Toast、延迟着色 |
| `js/app.js` | 入口：认证、导航、语言切换、模块装配 |
| `js/login.js` | 登录页控制器 |

模块之间不循环引用：共享数据统一放在 `state.js` 中按实时绑定导入。
静态资源优先从 classpath（`/web/`）读取，再回退到 `plugins/webui/web/`，
因此整个 `web/` 目录都可在运行时被覆盖。

## CI 与发布

`.github/workflows/build.yml` 在每次 push / PR 时用 JDK 21 构建，并上传
`ZenithProxy-WebUI-<version>.jar` 作为 workflow 产物（保留 30 天）。

发布新版本：

```bash
# 同步修改 build.gradle.kts 与 zenithproxy.plugin.json 中的 version
git commit -am "chore: release v1.4.0"
git tag v1.4.0
git push origin main --tags
```

推送 `v*` 标签后，CI 会自动构建并创建 GitHub Release，附带 fat JAR。
版本号不一致时 CI 会直接失败。

## 开源许可

本项目采用 **GNU Affero 通用公共许可证第 3 版（或更高版本）**，全文见 [LICENSE](LICENSE)。

```
ZenithProxy WebUI — browser-based management dashboard for ZenithProxy
Copyright (C) 2026 wxh1024

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
```

这意味着你可以自由使用、修改和分发本项目，但需要遵守以下义务：

- **分发时附带源码**：分发本插件（包括打包进整合包或二次分发的 JAR）时，必须一并提供
  完整对应的源码，或给出可获取源码的书面承诺。
- **修改同样开源**：基于本项目的衍生作品必须继续以 AGPL-3.0 授权。
- **网络服务条款（AGPL 第 13 条）**：这是 AGPL 与 GPL 的关键差异。如果你修改了本项目并通过
  网络向他人提供访问（例如把带 Web UI 的 ZenithProxy 作为公开服务运行），必须向这些用户
  提供获取修改后源码的途径（通常在界面上放置“源码”链接即可）。
- **保留声明**：不得移除源码中的版权声明与许可声明。

自行搭建、供个人或团队内部使用（未对外提供服务）不触发源码提供义务。

第三方依赖的许可见各自项目：[Netty](https://netty.io/)（Apache-2.0）、
[Gson](https://github.com/google/gson)（Apache-2.0）、[Chart.js](https://www.chartjs.org/)（MIT）。
ZenithProxy 通过 `maven.2b2t.vc` 以 `compileOnly` 引入，不随本项目分发。
