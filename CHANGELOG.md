# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [未发布]

### 修复

- **构建产物歧义**：`shadowJar` 的 `archiveClassifier` 为空，与默认的 thin JAR 同名
  （同为 `ZenithProxy-WebUI-<version>.jar`），两个任务竞争覆盖同一个文件，产物可能缺少
  Netty 依赖。现在禁用 thin `jar` 任务，`build/libs` 下只产出唯一可投放的 fat JAR。
- **`pluginManagement` 仓库兜底**：`settings.gradle.kts` 的 `pluginManagement.repositories`
  缺少 `mavenLocal()`，与 `dependencyResolutionManagement` 不一致；现已补齐，
  本地安装的插件可直接解析。

## [1.5.1] - 2026-10-18

### 变更

- **全仓库统一代码格式**：对后端 Java、前端 ES 模块、HTML / CSS 与文档做了一次
  IDE 级格式化，不含任何行为变更。
    - Java：静态字段统一前置，成员按可见性分组；单行 `if` / `catch` 展开为多行块，
      Javadoc 注释统一为块注释形式。
    - JS：命名导入按字母序排列；单行 `if` / `catch` 展开为多行块。
    - HTML：属性按字母序排列，长行按 120 列折行，SVG 图标结构补齐换行。
    - CSS：单行规则展开为多行，兄弟选择器之间补空行分隔。
    - Markdown / JSON：列表缩进层级与数组展开方式归一。

## [1.5.0] - 2026-10-18

### 新增

- **终端命令补全的中文描述**：命令说明由ZenithProxy 核心 jar 提供，只有英文且无法在服务端
  本地化。新增 `web/js/commandDesc.js`，按 **命令名**索引的中文描述表（约 80 条）；
  中文模式下套用该表，英文模式与未收录的命令照旧显示核心原文。
    - 切换语言时会重绘已展开的补全下拉。
    - 按命令名（核心保证的稳定契约）而非英文文案匹配，核心改文案不会导致整表失效。

### 修复

- **日志短语大小写敏感导致漏译**：短语表是 Title Case，但真实日志常在句中把它小写化
  （`Queue complete, entering server`），于是 `Reconnecting in 2s` 渲染成
  `正在重连 in 2s`。正则改用 `i` 标志，并加 `lookupPhrase()` 小写回退查表。
  补齐实测发现的四条缺口：`in 2s`、`Connection reset`、
  `Try waiting and connecting again`、`Cancelling`。
- **侧边栏显示的`v26.1.2` 是死值**：该字符串从项目第一天（`e9b66d4`）起就硬编码在 HTML 里，
  后端从未提供过对应字段（插件实际为 1.4.0），属于误导性占位符。已连同
  `renderVersionBadge()` 一并移除。
- **`/api/` 前缀判断改为大小写不敏感**：原先 `startsWith("/api/")` 大小写敏感，
  `/API/dashboard` 会漏过认证分支落到静态文件处理器，返回 SPA 外壳 HTML（200）而非 401。
  该路径因路由 switch 同样大小写敏感而无法触达任何真实处理器， **不构成数据泄露**，
  但破坏了"`/api/` 下一律需要凭据"的契约。现改用 `regionMatches(true, ...)`。

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
- **日志翻译只对中文生效，且移到客户端**：服务端不再把英文日志翻成中文后再推送，而是下发原始
  英文文本；`js/i18n.js` 仅在访客语言为中文时套用短语表，英文访客看到的始终是未翻译的原文。
  原 `LogTranslator` 更名为 `LogPhrases`——它已不含任何翻译逻辑，仅作为短语表的数据载体，
  通过 `/api/i18n` 下发；原先无人调用的 `translate()` 与预编译正则一并移除。
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
