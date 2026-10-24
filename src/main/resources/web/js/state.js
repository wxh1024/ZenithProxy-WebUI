/**
 * Cross-module mutable state.
 *
 * Kept in one module so dashboard/terminal/whitelist can coordinate without
 * circular imports: modules import the live bindings here, never each other.
 */

export const state = {
    /** Logged-in username shown in the prompt. */
    username: 'root',
    /** Currently visible page id (`dashboard` | `map` | `terminal` | `players` …). */
    page: 'dashboard',

    /** Buffered log entries, capped at MAX_TERMINAL_LINES * 2. */
    logs: [],
    commandHistory: [],
    historyIndex: -1,
    terminalCmdCount: 0,
    terminalLogCount: 0,

    /** Terminal auto-scroll is suspended while the user scrolls up. */
    terminalScrollLocked: true,

    /** Commands advertised by the server, with alias lookup. */
    commands: [],
    aliasMap: {},

    /** Dashboard / queue connection bookkeeping. */
    connected: false,
    queueInitialized: false,
    queueConnectedTime: 0,

    /** Language-change listeners registered by feature modules. */
    languageListeners: [],
};

/** Registers a callback fired on every language switch. */
export function onLanguageChange(fn) {
    state.languageListeners.push(fn);
}

export function emitLanguageChange(lang) {
    for (const fn of state.languageListeners) {
        try {
            fn(lang);
        } catch (e) {
            console.error('language listener failed', e);
        }
    }
}

export const LIMITS = {
    MAX_DATA_POINTS: 60,
    MAX_TERMINAL_LINES: 500,
    MAX_SUGGESTIONS: 20,
    /** Grace period before the queue card switches to "loading…". */
    QUEUE_LOADING_DELAY: 5000,
};