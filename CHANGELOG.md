# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [未发布]

### 新增

- **国际化 (i18n) + 英文支持**：仪表板与登录页完整支持中文 / 英文。
  - 语言优先级：`?lang=` 查询参数 → 界面内切换器（`localStorage`）→ `config.json`
    的 `language` → `navigator.languages` → `zh`
  - 新增 `config.json` 的 `language` 字段（`auto` / `zh` / `en`，默认 `auto`）
  - 新增公开端点 `GET /api/i18n`，返回默认语言、支持语言与日志短语表
  - 侧边栏与登录页新增语言切换下拉框
  - HTML 改用 `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` 绑定，
    移除原先中英并排的 `.bilingual` 标记
- **`README.en.md`**：完整英文文档（安装、配置、API、模块架构、故障排除、许可证），
  README 顶部互相链接

### 变更

- **前端拆分为原生 ES 模块**（无构建步骤）：`web/app.js`（1075 行）拆为 `web/js/` 下
  11 个模块 —— `i18n` / `api` / `state` / `dashboard` / `commands` / `terminal` /
  `whitelist` / `server` / `util` / `app` / `login`。模块间不循环引用，共享状态集中在
  `state.js`。
- **日志翻译从服务端移到客户端**：服务端不再把英文日志翻成中文后再推送，而是下发原始
  英文文本，由 `js/i18n.js` 按访客语言翻译。英文访客因此能看到可读的英文日志，而不是
  被强制翻译的中文。`LogTranslator` 保留为短语表的唯一来源，通过 `/api/i18n` 下发。
- 移除全部 `中/ EN` 双语拼接字符串（前端通知、事件广播），改为按语言取值。
- 静态文件服务：带扩展名的路径（`.js` / `.css` / `.png`）未命中时返回 404，
  不再回退到 `index.html` —— 否则缺失的 JS 模块会以 MIME 错误这种更难排查的形式失败。

### 许可证

- 项目改为 **AGPL-3.0-or-later**（GNU Affero 通用公共许可证 v3 或更高版本）开源，
  新增根目录 `LICENSE`（官方英文全文）。
- `shadowJar` 清单新增 `License` 与 `Implementation-Vendor` 字段。
- README 增加许可证徽章、许可义务说明（分发附带源码、修改同样开源、AGPL 第 13 条网络服务条款）。

### 文档

- 新增 GitHub Wiki：安装与部署、配置说明、功能说明、API 参考、架构与代码结构、
  认证与安全、开发与发布、常见问题。

### 构建

- **移除入库的 `libs/ZenithProxy.jar`（约 58 MB）**，改为通过 `maven.2b2t.vc` 解析
  `com.zenith:ZenithProxy:3.7.3+1.21.4`（`compileOnly`）。版本集中在 `build.gradle.kts`
  的 `zenithProxyVersion`，`libs/` 已加入 `.gitignore`。
- Git 历史已重写以彻底移除该 JAR，克隆体积从 ~58 MB 降到几 MB。

## [1.4.0] - 2026-10-17

### 变更

- **JSON 统一由 Gson 序列化**：日志 SSE、标题推送、仪表盘响应不再手工拼接字符串。
  旧的 `escapeJson` 只处理了引号/反斜杠/换行，聊天或日志中的控制字符会产出非法 JSON 并导致
  浏览器 `JSON.parse` 失败。
- 新增 `api/DashboardData`、`terminal/LogEntry` 两个 DTO，字段名与前端契约保持一致。
- 仪表盘使用 `serializeNulls` 的 Gson，保证 `player.health` / `player.food` 在离线时为显式 `null`。
- 移除未使用的 Lombok 插件；编译统一指定 UTF-8 编码。
- `build.gradle.kts` 的 `version` 成为唯一版本来源，`archiveVersion` 跟随它。

### 修复

- **静态文件路径穿越**：`/C:/Windows/...` 这类绝对路径在 Windows 上可逃出 `plugins/webui/web/`，
  现对解析后的路径做目录包含校验。
- **登出后认证缓存未失效**：通道级 30 秒缓存可能在 token 已撤销后继续放行请求，
  现由 `AuthManager.epoch()` 在登出/改密时立即失效。
- **`/webui enable` 重复启动**：重复执行会重复注册包处理器、Logback appender 与事件订阅，
  现检测到服务已运行即返回。
- **`stop()` 关闭 AuthManager**：禁用 WebUI 会连带停掉 token 清理任务，重新启用后不再清理过期 token。
- **默认密码**：`WebUIConfig.AuthConfig.password` 默认值由 `admin` 改为空，缺失密码的配置会重新生成随机密码。
- **`enabled` 配置项未生效**：文档中声明但代码从未读取，现按配置决定是否自动启动。
- **速率限制统计错误**：成功登录也计入失败次数，且成功不清零；现仅统计失败并在成功时清零，
  密码比较改为不短路的常量时间比较。
- **未知 `/api/*` 路径返回 index.html**：现返回 404；不支持的方法返回 405 而不是挂起。
- **认证日志泄漏到前端**：`WebUI-Auth` logger 含用户名与 IP，现加入忽略前缀。
- **网络速率统计**：网卡计数器重置时会算出负值，且基准值在异常分支不更新；现已做单调性保护。
- 仪表盘 `uptime` 在启动时间缺失时可能为负数，现钳制为 0。

### 新增

- **GitHub Actions CI**（`.github/workflows/build.yml`）：JDK 21 构建、版本一致性校验、
  上传 fat JAR 产物；推送 `v*` 标签自动创建 GitHub Release 并附带 JAR。

## [1.3.0] - 2026-08-07

- 内存与 CPU 占用优化。
- SSE 广播复用 ByteBuf，日志 JSON 一次序列化，文件缓存改为真 LRU。

## [1.2.0] - 2026-08-07

- 登录限流竞态修复、认证模块精简。
- Token 过期时同步清理 SSE 通道。

## [1.1.0] - 2026-08-07

- 3c3u.org 队列完成检测、命令自动补全增强、线程安全改进。

## [1.0.0] - 2026-08-07

- 首个版本：仪表盘、终端、玩家/白名单管理、SSE 日志、Cookie 认证。
