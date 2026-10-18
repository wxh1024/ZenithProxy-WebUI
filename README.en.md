# ZenithProxy Web UI

[![Build](https://github.com/wxh1024/ZenithProxy-WebUI/actions/workflows/build.yml/badge.svg)](https://github.com/wxh1024/ZenithProxy-WebUI/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/wxh1024/ZenithProxy-WebUI?sort=semver)](https://github.com/wxh1024/ZenithProxy-WebUI/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![ZenithProxy](https://img.shields.io/badge/ZenithProxy-plugin-6f42c1)](https://github.com/rfresh2/ZenithProxy)
[![Minecraft](https://img.shields.io/badge/Minecraft-1.21.4-62B47A?logo=minecraft&logoColor=white)](https://github.com/rfresh2/ZenithProxy)
[![Java](https://img.shields.io/badge/Java-21-ED8F03?logo=openjdk&logoColor=white)](https://adoptium.net/)
[![Downloads](https://img.shields.io/github/downloads/wxh1024/ZenithProxy-WebUI/total)](https://github.com/wxh1024/ZenithProxy-WebUI/releases)

English | [简体中文](README.md)

A browser-based management dashboard for ZenithProxy: live status monitoring, whitelist
management, command execution and a real-time log viewer.

> Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).
>
> Full technical documentation lives in the [Wiki](../../wiki).

## Features

- **Status dashboard** — proxy connection state, bot account, proxy address, uptime, player
  connections and queue position, refreshed every second over SSE
- **System metrics** — live CPU, memory, network throughput and latency charts (Chart.js)
- **Server control** — one-click connect / disconnect / reconnect / shutdown
- **Command terminal** — run ZenithProxy commands from the browser with fuzzy autocomplete,
  command history and shortcuts (Tab / ↑↓ / Ctrl+L / Ctrl+C)
- **Log viewer** — SSE-pushed log stream with per-level colouring and text export
- **Whitelist management** — enable/disable the whitelist, add or remove players, configure the
  kick message and auto-add the bot account
- **Internationalization** — automatic browser-language detection with a manual
  Chinese/English switcher; log lines are translated per visitor
- **Authentication** — HttpOnly cookie auth with rate limiting and an auto-generated password

## Installation

### 1. Get the plugin

Download a prebuilt JAR from [Releases](https://github.com/wxh1024/ZenithProxy-WebUI/releases),
or build it locally (requires JDK 21 and network access to `maven.2b2t.vc`):

```bash
./gradlew shadowJar
```

Output: `build/libs/ZenithProxy-WebUI-1.4.0.jar`

### 2. Install

Copy `ZenithProxy-WebUI-1.4.0.jar` into the ZenithProxy `plugins/` directory.

### 3. Configuration

On first launch the plugin writes `plugins/webui/config.json` and generates a random password:

```json
{
  "enabled": true,
  "port": 8080,
  "language": "auto",
  "auth": {
    "enabled": true,
    "username": "admin",
    "password": "<16-char random password>"
  }
}
```

### 4. Commands

```
webui enable        # start the Web UI server
webui disable       # stop the Web UI server
webui status        # show the current Web UI status
```

### 5. Open the dashboard

```
http://localhost:8080
```

## Configuration options

| Option | Default | Description |
|------|---------|-------------|
| `enabled` | `true` | Start the Web UI server automatically on plugin load |
| `port` | `8080` | HTTP listen port |
| `language` | `auto` | Default UI language: `auto` (follow the browser), `zh` or `en` |
| `auth.enabled` | `true` | Require a login |
| `auth.username` | `admin` | Login username |
| `auth.password` | random | Login password (generated and logged on first run) |

> To disable authentication, set `auth.enabled` to `false`.

## Internationalization

The dashboard and the login page are fully bilingual. The active language is resolved in this
order:

1. `?lang=en` / `?lang=zh` query parameter — useful for sharing a link in a given language
2. the in-app language switcher (persisted in `localStorage`)
3. `language` from `config.json` (when it is not `auto`)
4. `navigator.languages` — the browser's own preference
5. `zh` as the final fallback

Log lines are translated per visitor too: the server streams the original English text and
the browser renders it in the selected language, so an English visitor sees readable English
rather than a Chinese-only translation.

## API endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/i18n` | GET | No | Default language, supported languages and the log phrase table |
| `/api/auth/login` | POST | No | Login with `{"username", "password"}` → sets an HttpOnly cookie |
| `/api/auth/logout` | POST | No | Clears the auth cookie |
| `/api/auth/status` | GET | No | `{"authenticated": bool, "username": "..."}` |
| `/api/dashboard` | GET | Yes | Aggregated dashboard payload (connection, queue, version, uptime, players, CPU, memory, network, latency) |
| `/api/dashboard/stream` | GET | Yes | SSE stream, one dashboard frame per second |
| `/api/commands` | GET | Yes | Lists available command names, aliases and descriptions |
| `/api/commands` | POST | Yes | Executes `{"command": "..."}` and returns the parsed output |
| `/api/logs/stream` | GET | Yes | SSE log stream (last 500 entries, then live) |
| `/api/whitelist` | GET | Yes | Whitelist status, entries, kick message, auto-add flag |
| `/api/whitelist` | POST | Yes | `{"action": "toggle/add/remove/updateConfig", ...}` |

## Frontend pages

| Page | Description |
|------|-------------|
| Dashboard | Proxy status, server control tiles, system metric charts |
| Terminal | Command execution, live logs, export |
| Whitelist | Whitelist toggle, player list, kick message, auto-add |

## Keyboard shortcuts

| Shortcut | Description |
|----------|-------------|
| `Tab` | Command autocomplete |
| `↑` / `↓` | Browse command history |
| `Ctrl+L` | Clear the terminal |
| `Ctrl+C` | Cancel the current input |

## Tech stack

- **Backend** — Java 21, Netty NIO, Gson, Logback
- **Frontend** — vanilla HTML/CSS/ES modules (no framework, no build step), Chart.js
- **Realtime** — Server-Sent Events
- **Build** — Gradle + Shadow JAR

## Frontend architecture

The frontend is split into ES modules under `src/main/resources/web/js/`:

| Module | Responsibility |
|--------|----------------|
| `i18n.js` | Translation tables, language resolution, `t()`, log-line translation |
| `api.js` | `fetch` wrapper, SSE helper with exponential-backoff reconnect, session helpers |
| `state.js` | Shared mutable state (logs, history, connection flags, limits) |
| `dashboard.js` | Status cards, queue rendering, the four Chart.js charts |
| `commands.js` | Command discovery and fuzzy autocomplete scoring |
| `terminal.js` | Log stream, scrollback, command input, export |
| `whitelist.js` | Whitelist CRUD |
| `server.js` | Connect/disconnect/reconnect/shutdown tiles |
| `util.js` | HTML escaping, toasts, ping colouring |
| `app.js` | Entry point: auth gate, navigation, language switcher, module wiring |
| `login.js` | Login page controller |

Modules never import each other cyclically — shared values live in `state.js` and are imported
as live bindings. Static assets are served from the classpath (`/web/`) first and fall back to
`plugins/webui/web/`, so the whole `web/` tree can be overridden at runtime.

## Authentication

- HttpOnly cookie `webui_token` (SameSite=Lax, Path=/); `Authorization: Bearer <token>` also works
- Tokens expire after 24 hours (`auth.tokenExpiry`); there is no sliding renewal
- Rate limiting: at most 5 failed logins per minute per IP (a success resets the counter)
- SSE connections are authenticated too and are closed immediately when the token is revoked
- A 30-second per-channel auth cache is invalidated immediately on logout or password change
  via an auth epoch counter

## Troubleshooting

**Cannot reach the Web UI**

1. Check the port in `plugins/webui/config.json`
2. Check whether the port is in use: `lsof -i :8080`
3. Look for the WebUI startup line in the ZenithProxy console

**Forgot the password**

The first-run password is printed to the ZenithProxy log:

```
Created WebUI config with defaults (random password generated)
Default username: admin, password: xxxxxxxx
```

You can also edit `auth.password` directly in `plugins/webui/config.json`.

**Commands fail**

1. Verify the command syntax
2. Read the error line in the terminal log

**Logs do not appear**

1. Confirm the Web UI server is running
2. Check the browser console for network errors
3. `EventSource` relies on same-origin cookies — do not access the UI cross-origin

## Security notes

- A random password is generated on first run; read it from the log
- Authentication is enabled by default — keep `auth.enabled: true`
- Use it on a local network only
- Do not expose the Web UI to the public internet
- For production, put it behind a reverse proxy (e.g. Nginx) with HTTPS

## Project structure

```
src/main/java/com/zenith/webui/
  WebUIPlugin.java          # plugin entrypoint: lifecycle, SSE broadcast, log buffer
  TitlePacketHandler.java   # title packet interception
  api/                      # /api handlers: commands, dashboard, i18n, log stream, whitelist
  auth/                     # token auth: filter, manager, login/logout controller
  authbypass/               # offline-auth bypass packet handlers
  command/                  # /webui enable|disable|status
  config/                   # config data class + config.json manager
  http/HttpHelper.java      # response helpers + shared Gson + SSE frame builder
  queue/QueueParser.java    # 3c3u.org / 2b2t.org queue-position parsing
  server/                   # Netty bootstrap + request routing
  staticfile/               # static file serving with a bounded LRU cache
  terminal/                 # log translation, Logback appender, LogEntry DTO

src/main/resources/
  web/
    index.html              # dashboard page
    login.html              # login page
    styles.css              # styles (Catppuccin Macchiato palette)
    js/                     # frontend ES modules
  zenithproxy.plugin.json   # plugin metadata
```

## CI and releases

`.github/workflows/build.yml` builds with JDK 21 on every push and PR and uploads
`ZenithProxy-WebUI-<version>.jar` as a workflow artifact (kept for 30 days).

```bash
# bump the version in BOTH build.gradle.kts and zenithproxy.plugin.json
git commit -am "chore: release v1.4.0"
git tag v1.4.0
git push origin main --tags
```

Pushing a `v*` tag triggers a GitHub Release with the fat JAR attached. CI fails if the two
version fields disagree.

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later** — see
[LICENSE](LICENSE).

```
ZenithProxy WebUI — browser-based management dashboard for ZenithProxy
Copyright (C) 2026 wxh1024

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
```

You may use, modify and redistribute this project freely, subject to:

- **Ship the source**: redistributing the plugin (including bundled in a modpack or a
  re-distributed JAR) requires you to provide the complete corresponding source, or a written
  offer to obtain it.
- **Derivative works stay AGPL**: modifications must be released under AGPL-3.0 as well.
- **Network use (AGPL §13)**: if you modify this project and offer it over a network (for
  example running a modified ZenithProxy with the Web UI as a public service), you must offer
  those users access to your modified source — usually a "Source" link in the UI is enough.
- **Keep the notices**: do not remove copyright or license headers.

Self-hosting for personal or internal team use, without offering it to others, does not trigger
the source-offer obligation.

Third-party licenses: [Netty](https://netty.io/) (Apache-2.0),
[Gson](https://github.com/google/gson) (Apache-2.0), [Chart.js](https://www.chartjs.org/) (MIT).
ZenithProxy is pulled from `maven.2b2t.vc` as `compileOnly` and is not redistributed here.