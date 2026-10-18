/**
 * i18n — translation core.
 *
 * Resolution order for the active language:
 *   1. `?lang=` query parameter (highest priority, shareable links)
 *   2. `localStorage.webui_lang` (the in-app switcher's choice)
 *   3. `defaultLanguage` from `GET /api/i18n` (config.json `language`)
 *   4. `navigator.languages` (browser auto-detection)
 *   5. `zh` fallback
 *
 * All UI strings live in TRANSLATIONS below. HTML is bound through
 * `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` attributes,
 * so `applyTranslations()` re-renders the whole page on language change.
 */

const STORAGE_KEY = 'webui_lang';

/** Runtime state, populated by `init()`. */
let currentLang = 'zh';
let serverDefault = 'auto';
/** English -> Chinese log phrase table fetched from the server. */
let logPhrases = {};
let logPhraseKeys = [];
let logPattern = null;
let bootstrapped = false;

export const TRANSLATIONS = {
    zh: {
        'app.title': 'ZenithProxy WebUI',
        'app.plugin': 'ZenithProxy WebUI 插件',

        'nav.dashboard': '仪表板',
        'nav.terminal': '终端日志',
        'nav.players': '白名单管理',
        'nav.logout': '登出',
        'nav.language': '语言',

        'page.dashboard.title': '状态监控仪表板',
        'page.terminal.title': '终端日志',
        'page.players.title': '白名单管理',

        'action.connect': '连接',
        'action.disconnect': '断开',
        'action.reconnect': '重连',
        'action.shutdown': '关闭',
        'action.export': '导出',
        'action.clear': '清空',
        'action.save': '保存',
        'action.add': '添加',
        'action.remove': '移除',

        'title.connect': '连接到服务器',
        'title.disconnect': '断开与服务器的连接',
        'title.reconnect': '重新连接服务器',
        'title.shutdown': '关闭代理',

        'card.proxyStatus': '代理状态',
        'card.botAccount': '机器人账号',
        'card.proxyAddress': '代理地址',
        'card.uptime': '运行时间',
        'card.players': '玩家连接',
        'card.queue': '队列',
        'card.health': '血量 / 饱食度',
        'card.version': 'Minecraft 版本',

        'chart.cpu': 'CPU 占用',
        'chart.memory': '内存占用',
        'chart.network': '网络流量',
        'chart.latency': '延迟波动',
        'chart.cpu.label': 'CPU',
        'chart.memory.label': '内存',
        'chart.network.in': '入站',
        'chart.network.out': '出站',
        'chart.latency.bot': '机器人→服务器',
        'chart.latency.player': '玩家→机器人',

        'status.connected': '已连接',
        'status.disconnected': '未连接',
        'status.noConnection': '无连接',

        'queue.loading': '正在加载...',
        'queue.position': '队列位置: {n}',
        'queue.online': '在线人数: {n}',
        'queue.entered': '已进入',

        'uptime.h': '{h}时 {m}分 {s}秒',
        'uptime.d': '{d}天 {h}时 {m}分',

        'term.welcome': 'Welcome to ZenithProxy Terminal',
        'term.lastLogin': '上次登录:',
        'term.hint': "输入 'help' 查看可用命令 | Tab: 补全 | ↑/↓: 历史 | Ctrl+L: 清空",
        'term.placeholder': '输入命令...',
        'term.counts': '命令: {c} · 日志: {l}',
        'term.export.title': 'ZenithProxy 终端导出',
        'term.export.history': '命令历史',
        'term.export.end': '结束',
        'term.exported': '已导出',
        'term.requestFailed': '请求失败',

        'wl.enable': '启用白名单',
        'wl.autoAdd': '自动添加机器人账户',
        'wl.kickmsg': '踢出消息',
        'wl.addPlaceholder': '输入玩家名称',
        'wl.empty': '白名单为空',
        'wl.enabled': '白名单已启用',
        'wl.disabled': '白名单已禁用',
        'wl.added': '已添加 {name}',
        'wl.removed': '已移除 {name}',
        'wl.addFailed': '添加失败: {err}',
        'wl.removeFailed': '移除失败: {err}',
        'wl.saved': '配置已保存',

        'notify.connecting': '正在连接服务器...',
        'notify.connectFailed': '连接失败: {err}',
        'notify.disconnected': '已断开连接',
        'notify.disconnectFailed': '断开失败: {err}',
        'notify.reconnecting': '正在重连...',
        'notify.reconnectFailed': '重连失败: {err}',
        'notify.shuttingDown': '正在关闭...',
        'notify.shutdownFailed': '关闭失败: {err}',
        'notify.shutdownConfirm': '确定要关闭代理吗?',
        'notify.error': '错误',

        'login.title': 'ZenithProxy WebUI 登录',
        'login.subtitle': '请登录以继续',
        'login.username': '用户名',
        'login.password': '密码',
        'login.usernamePlaceholder': '请输入用户名',
        'login.passwordPlaceholder': '请输入密码',
        'login.submit': '登 录',
        'login.submitting': '登录中...',
        'login.failed': '登录失败',
        'login.networkError': '网络错误，请重试',
        'login.footer': 'ZenithProxy WebUI 插件',
    },

    en: {
        'app.title': 'ZenithProxy WebUI',
        'app.plugin': 'ZenithProxy WebUI Plugin',

        'nav.dashboard': 'Dashboard',
        'nav.terminal': 'Terminal',
        'nav.players': 'Whitelist',
        'nav.logout': 'Log out',
        'nav.language': 'Language',

        'page.dashboard.title': 'Status Dashboard',
        'page.terminal.title': 'Terminal Logs',
        'page.players.title': 'Whitelist Management',

        'action.connect': 'Connect',
        'action.disconnect': 'Disconnect',
        'action.reconnect': 'Reconnect',
        'action.shutdown': 'Shutdown',
        'action.export': 'Export',
        'action.clear': 'Clear',
        'action.save': 'Save',
        'action.add': 'Add',
        'action.remove': 'Remove',

        'title.connect': 'Connect to the server',
        'title.disconnect': 'Disconnect from the server',
        'title.reconnect': 'Reconnect to the server',
        'title.shutdown': 'Shut down the proxy',

        'card.proxyStatus': 'Proxy Status',
        'card.botAccount': 'Bot Account',
        'card.proxyAddress': 'Proxy Address',
        'card.uptime': 'Uptime',
        'card.players': 'Players',
        'card.queue': 'Queue',
        'card.health': 'Health / Food',
        'card.version': 'Minecraft Version',

        'chart.cpu': 'CPU Usage',
        'chart.memory': 'Memory Usage',
        'chart.network': 'Network Traffic',
        'chart.latency': 'Latency',
        'chart.cpu.label': 'CPU',
        'chart.memory.label': 'Mem',
        'chart.network.in': 'In',
        'chart.network.out': 'Out',
        'chart.latency.bot': 'Bot→Server',
        'chart.latency.player': 'Player→Bot',

        'status.connected': 'Connected',
        'status.disconnected': 'Disconnected',
        'status.noConnection': 'No connection',

        'queue.loading': 'Loading...',
        'queue.position': 'Queue position: {n}',
        'queue.online': 'Online: {n}',
        'queue.entered': 'In server',

        'uptime.h': '{h}h {m}m {s}s',
        'uptime.d': '{d}d {h}h {m}m',

        'term.welcome': 'Welcome to ZenithProxy Terminal',
        'term.lastLogin': 'Last login:',
        'term.hint': "Type 'help' for available commands | Tab: autocomplete | Up/Down: history | Ctrl+L: clear",
        'term.placeholder': 'Type a command...',
        'term.counts': 'Commands: {c} · Logs: {l}',
        'term.export.title': 'ZenithProxy Terminal Export',
        'term.export.history': 'Command History',
        'term.export.end': 'End',
        'term.exported': 'Exported',
        'term.requestFailed': 'Request failed',

        'wl.enable': 'Enable whitelist',
        'wl.autoAdd': 'Auto-add bot account',
        'wl.kickmsg': 'Kick message',
        'wl.addPlaceholder': 'Player name',
        'wl.empty': 'Whitelist is empty',
        'wl.enabled': 'Whitelist enabled',
        'wl.disabled': 'Whitelist disabled',
        'wl.added': 'Added {name}',
        'wl.removed': 'Removed {name}',
        'wl.addFailed': 'Add failed: {err}',
        'wl.removeFailed': 'Remove failed: {err}',
        'wl.saved': 'Config saved',

        'notify.connecting': 'Connecting to server...',
        'notify.connectFailed': 'Connect failed: {err}',
        'notify.disconnected': 'Disconnected',
        'notify.disconnectFailed': 'Disconnect failed: {err}',
        'notify.reconnecting': 'Reconnecting...',
        'notify.reconnectFailed': 'Reconnect failed: {err}',
        'notify.shuttingDown': 'Shutting down...',
        'notify.shutdownFailed': 'Shutdown failed: {err}',
        'notify.shutdownConfirm': 'Are you sure you want to shut down the proxy?',
        'notify.error': 'Error',

        'login.title': 'ZenithProxy WebUI Login',
        'login.subtitle': 'Please sign in to continue',
        'login.username': 'Username',
        'login.password': 'Password',
        'login.usernamePlaceholder': 'Enter your username',
        'login.passwordPlaceholder': 'Enter your password',
        'login.submit': 'Sign In',
        'login.submitting': 'Signing in...',
        'login.failed': 'Sign-in failed',
        'login.networkError': 'Network error, please retry',
        'login.footer': 'ZenithProxy WebUI Plugin',
    },
};

const SUPPORTED = ['zh', 'en'];

/** Normalizes any BCP-47 tag to a supported language code. */
function normalizeTag(tag) {
    if (!tag) return null;
    const lower = String(tag).toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('en')) return 'en';
    return null;
}

/** First supported language among the browser's preferred tags. */
function detectBrowserLanguage() {
    const tags = navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
    for (const tag of tags) {
        const lang = normalizeTag(tag);
        if (lang) return lang;
    }
    return null;
}

function readQueryLang() {
    try {
        return normalizeTag(new URLSearchParams(window.location.search).get('lang'));
    } catch {
        return null;
    }
}

function readStoredLang() {
    try {
        return normalizeTag(localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

/**
 * Resolves the language and loads the server-side log phrase table.
 * Safe to call more than once; subsequent calls are no-ops.
 */
export async function init() {
    if (bootstrapped) return currentLang;
    bootstrapped = true;

    try {
        const res = await fetch('/api/i18n', {credentials: 'include'});
        if (res.ok) {
            const data = await res.json();
            serverDefault = data.defaultLanguage || 'auto';
            setLogPhrases(data.logPhrases || {});
        }
    } catch {
        // Offline or endpoint unavailable — fall back to a built-in mini table.
        setLogPhrases(FALLBACK_LOG_PHRASES);
    }

    currentLang =
        readQueryLang()
        || readStoredLang()
        || normalizeTag(serverDefault)
        || detectBrowserLanguage()
        || 'zh';

    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
    return currentLang;
}

/** Persists an explicit choice and re-renders the page. */
export function setLanguage(lang) {
    const normalized = normalizeTag(lang);
    if (!normalized) return;
    currentLang = normalized;
    try {
        localStorage.setItem(STORAGE_KEY, normalized);
    } catch { /* private mode — ignore */
    }
    document.documentElement.lang = normalized === 'zh' ? 'zh-CN' : 'en';
    applyTranslations();
    window.dispatchEvent(new CustomEvent('webui:languagechange', {detail: {lang: normalized}}));
}

export function getLanguage() {
    return currentLang;
}

export function isZh() {
    return currentLang === 'zh';
}

/** Translate `key`, substituting `{name}` placeholders from `params`. */
export function t(key, params) {
    const table = TRANSLATIONS[currentLang] || TRANSLATIONS.zh;
    let value = table[key];
    if (value === undefined) value = TRANSLATIONS.zh[key];
    if (value === undefined) return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (m, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m);
}

/** BCP-47 tag for Intl formatting in the active language. */
export function localeTag() {
    return currentLang === 'zh' ? 'zh-CN' : 'en-US';
}

/**
 * Walks the DOM and fills every `data-i18n*` bound element.
 * Elements keep their original text as the zh fallback, so a missing
 * key degrades to readable Chinese instead of an empty label.
 */
export function applyTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = t(el.dataset.i18nHtml);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    const docTitle = document.querySelector('title[data-i18n-doc]');
    if (docTitle) docTitle.textContent = t(docTitle.dataset.i18nDoc);
}

/** Formats an uptime in ms using the locale-aware compact form. */
export function formatUptime(ms) {
    const total = Math.floor(ms / 1000);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600) % 24;
    const d = Math.floor(total / 86400);
    return d > 0
        ? t('uptime.d', {d, h, m})
        : t('uptime.h', {h, m, s});
}

/**
 * Translates a raw English log line into the active language.
 * Chinese output uses the server-provided phrase table; English passes through.
 */
export function translateLog(message) {
    if (!message || currentLang !== 'zh') return message;
    if (!logPattern) return message;
    return message.replace(logPattern, m => lookupPhrase(m) || m);
}

/**
 * Case-insensitive phrase lookup.
 *
 * The table is written in Title Case ("Entering server") but real log lines
 * lowercase it mid-sentence ("Queue complete, entering server"). A
 * case-sensitive alternation silently misses those, leaving stray English
 * inside an otherwise translated line.
 */
function lookupPhrase(matched) {
    if (logPhrases[matched]) return logPhrases[matched];
    const lower = matched.toLowerCase();
    for (const key of logPhraseKeys) {
        if (key.toLowerCase() === lower) return logPhrases[key];
    }
    return null;
}

function setLogPhrases(table) {
    logPhrases = table || {};
    // Longest phrase first so "Disconnected from server" wins over "Disconnected".
    logPhraseKeys = Object.keys(logPhrases).sort((a, b) => b.length - a.length);
    if (!logPhraseKeys.length) {
        logPattern = null;
        return;
    }
    const escaped = logPhraseKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // The 'i' flag handles casing; lookupPhrase resolves the original casing.
    logPattern = new RegExp(escaped.join('|'), 'gi');
}

/** Minimal table used when `GET /api/i18n` is unreachable. */
const FALLBACK_LOG_PHRASES = {
    'Connecting to server': '正在连接服务器',
    'Connected to server': '已连接服务器',
    'Disconnected from server': '已从服务器断开',
    'Connection lost': '连接已丢失',
    Reconnecting: '正在重连',
    Reconnected: '已重连',
    'Login failed': '登录失败',
    'Queue started': '已进入队列',
    'Queue complete': '队列完成',
    'Queue position': '队列位置',
    'Left queue': '已离开队列',
    'Now online': '已上线',
    'Now offline': '已离线',
    'Bot started': '机器人已启动',
    'Bot stopped': '机器人已停止',
    'Bot crashed': '机器人已崩溃',
    'Kicked by server': '被服务器踢出',
    'Banned by server': '被服务器封禁',
    'Entered queue': '已进入队列',
    'Config saved': '配置已保存',
    'Config loaded': '配置已加载',
    Error: '错误',
    Warning: '警告',
};