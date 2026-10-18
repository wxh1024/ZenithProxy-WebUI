/**
 * Terminal page — log stream, scrollback buffer, command input and export.
 */

import { apiCall, createStream } from './api.js';
import { state, LIMITS, onLanguageChange } from './state.js';
import { t, translateLog, localeTag } from './i18n.js';
import { escapeHtml, showNotification } from './util.js';
import {
    hideAutocomplete, isAutocompleteVisible, hasSelection, navigateAutocomplete,
    selectAutocomplete, selectAutocompleteAt, showAutocomplete,
} from './commands.js';

let stopLogStream = null;
let welcomeRendered = false;

const output = () => document.getElementById('terminalOutput');
const inputEl = () => document.getElementById('terminalInput');

// ── Rendering ───────────────────────────────────────────────────────

/** Builds the localized welcome banner shown at the top of an empty terminal. */
export function welcomeHtml() {
    return `
        <div class="terminal-welcome">
            <p style="color:var(--ctp-green);">${escapeHtml(t('term.welcome'))}</p>
            <p style="color:var(--ctp-overlay1);">${escapeHtml(t('term.lastLogin'))} <span id="lastLogin"></span></p>
            <p style="color:var(--ctp-overlay0);font-size:0.75rem;margin-top:4px;">${escapeHtml(t('term.hint'))}</p>
        </div>`;
}

function stamp() {
    return new Date().toLocaleTimeString(localeTag());
}

function lastLoginStamp() {
    return new Date().toLocaleString(localeTag(), {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
}

/** Re-renders every buffered log line (used on page entry and language switch). */
export function refreshTerminalLogs() {
    const out = output();
    if (!out) return;
    out.innerHTML = welcomeHtml();
    renderWelcomeTimestamp();
    for (const log of state.logs) {
        out.appendChild(buildLogLine(log));
    }
    out.scrollTop = out.scrollHeight;
}

function buildLogLine(log) {
    const entry = document.createElement('div');
    entry.className = 'terminal-line terminal-line-log';
    entry.innerHTML = `<span class="log-ts">${escapeHtml(stamp())}</span>` +
        `<span class="log-lv ${escapeHtml(String(log.level).toLowerCase())}">${escapeHtml(log.level)}</span>` +
        `<span class="log-msg">[${escapeHtml(log.logger)}] ${escapeHtml(translateLog(log.message))}</span>`;
    return entry;
}

/** Appends one log entry to the buffer and (when visible) to the DOM. */
export function addLogEntry(log) {
    state.logs.push(log);
    // Cap memory: keep at most 2x the visible line budget.
    if (state.logs.length > LIMITS.MAX_TERMINAL_LINES * 2) {
        state.logs.splice(0, state.logs.length - LIMITS.MAX_TERMINAL_LINES);
    }
    state.terminalLogCount++;
    updateTerminalCounts();
    if (state.page !== 'terminal') return;
    const out = output();
    if (!out) return;
    out.appendChild(buildLogLine(log));
    if (state.terminalScrollLocked) out.scrollTop = out.scrollHeight;
    while (out.children.length > LIMITS.MAX_TERMINAL_LINES) out.removeChild(out.firstChild);
}

export function appendTerminalLine(text, className) {
    const out = output();
    if (!out) return;
    const line = document.createElement('div');
    line.className = `terminal-line ${className}`;
    line.textContent = text;
    out.appendChild(line);
    if (state.terminalScrollLocked) out.scrollTop = out.scrollHeight;
    while (out.children.length > LIMITS.MAX_TERMINAL_LINES) out.removeChild(out.firstChild);
}

export function clearTerminal() {
    const out = output();
    if (!out) return;
    out.innerHTML = welcomeHtml();
    renderWelcomeTimestamp();
    state.logs = [];
    state.terminalLogCount = 0;
    state.terminalCmdCount = 0;
    updateTerminalCounts();
}

function renderWelcomeTimestamp() {
    const el = document.getElementById('lastLogin');
    if (el) el.textContent = lastLoginStamp();
}

export function updateTerminalCounts() {
    const text = t('term.counts', { c: state.terminalCmdCount, l: state.terminalLogCount });
    const [cmdPart, logPart] = text.split('·').map(s => s.trim());
    const cmdEl = document.getElementById('terminalCmdCount');
    const logEl = document.getElementById('terminalLogCount');
    if (cmdEl) cmdEl.textContent = cmdPart;
    if (logEl) logEl.textContent = logPart;
}

function updateTerminalStatus() {
    const el = document.getElementById('terminalStatus');
    if (el) {
        el.textContent = t('status.connected');
        el.style.color = 'var(--ctp-green)';
    }
}

/** Downloads the visible scrollback plus the command history as a .txt file. */
export function exportTerminalContent() {
    const out = output();
    if (!out) return;
    const lines = [];
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    lines.push('='.repeat(60), `${t('term.export.title')} — ${now}`, '='.repeat(60), '');
    for (const el of out.children) lines.push(el.textContent);
    if (state.commandHistory.length > 0) {
        lines.push('', '-'.repeat(60), t('term.export.history'), '-'.repeat(60));
        state.commandHistory.forEach((c, i) => lines.push(`  [${i + 1}] ${c}`));
    }
    lines.push('', '='.repeat(60), t('term.export.end'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    a.download = `zenithproxy-terminal-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    showNotification(t('term.exported'), 'success');
}

// ── Command execution ───────────────────────────────────────────────

export async function sendTerminalCommand(command) {
    if (!command.trim()) return;
    state.commandHistory.push(command);
    state.historyIndex = -1;
    state.terminalCmdCount++;
    updateTerminalCounts();
    appendTerminalLine(`${state.username}@zenith:~$ ${command}`, 'terminal-line-command');

    const result = await apiCall('/commands', 'POST', { command });
    if (!result) {
        appendTerminalLine(t('term.requestFailed'), 'terminal-line-error');
        return;
    }
    if (result.output && Array.isArray(result.output) && result.output.length > 0) {
        result.output.forEach(line => appendTerminalLine(line, 'terminal-line-output'));
    } else if (!result.success) {
        appendTerminalLine(`${t('notify.error')}: ${result.error || 'Unknown'}`, 'terminal-line-error');
    }
    // An empty successful response needs no output.
}

function recallHistory(delta) {
    const el = document.getElementById('terminalInput');
    const history = state.commandHistory;
    if (delta > 0) {
        if (state.historyIndex < history.length - 1) {
            state.historyIndex++;
            el.value = history[history.length - 1 - state.historyIndex];
        }
    } else if (state.historyIndex > 0) {
        state.historyIndex--;
        el.value = history[history.length - 1 - state.historyIndex];
    } else {
        state.historyIndex = -1;
        el.value = '';
    }
}

// ── Wiring ──────────────────────────────────────────────────────────

export function initTerminal() {
    const el = document.getElementById('terminalInput');
    const out = output();
    if (!el || !out) return;
    out.tabIndex = 0;

    renderWelcomeTimestamp();

    // Scroll lock: released when the user scrolls up, restored at the bottom.
    out.addEventListener('wheel', () => {
        setTimeout(() => {
            state.terminalScrollLocked = out.scrollHeight - out.scrollTop - out.clientHeight < 60;
        }, 0);
    }, { passive: true });

    out.addEventListener('keydown', e => {
        if (e.key === 'PageUp') {
            e.preventDefault();
            out.scrollTop -= out.clientHeight - 40;
            state.terminalScrollLocked = false;
        } else if (e.key === 'PageDown') {
            e.preventDefault();
            out.scrollTop += out.clientHeight - 40;
            if (out.scrollHeight - out.scrollTop - out.clientHeight < 60) state.terminalScrollLocked = true;
        } else if (e.key === 'End') {
            e.preventDefault();
            out.scrollTop = out.scrollHeight;
            state.terminalScrollLocked = true;
        }
    });

    el.addEventListener('keydown', e => {
        if (isAutocompleteVisible()) {
            if (e.key === 'ArrowDown') { e.preventDefault(); navigateAutocomplete(1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); navigateAutocomplete(-1); return; }
            if (e.key === 'Tab') { e.preventDefault(); selectAutocomplete(); return; }
            if (e.key === 'Escape') { hideAutocomplete(); return; }
            if (e.key === 'Enter' && hasSelection()) { e.preventDefault(); selectAutocomplete(); return; }
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = el.value;
            el.value = '';
            hideAutocomplete();
            sendTerminalCommand(cmd);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            recallHistory(1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            recallHistory(-1);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            showAutocomplete(el.value);
        } else if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault();
            clearTerminal();
        } else if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) {
            e.preventDefault();
            appendTerminalLine('^C', 'terminal-line-info');
            el.value = '';
        }
    });

    el.addEventListener('input', () => {
        if (isAutocompleteVisible()) showAutocomplete(el.value);
    });

    // Delegated so re-rendered dropdown items need no inline handlers.
    document.getElementById('autocompleteDropdown')?.addEventListener('mousedown', e => {
        const item = e.target.closest('.autocomplete-item');
        if (item) {
            e.preventDefault();
            selectAutocompleteAt(Number(item.dataset.index));
        }
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.terminal-input-wrapper')) hideAutocomplete();
    });

    // The add-player field shares the same Enter-to-submit behaviour.
    const wlInput = document.getElementById('whitelistAddInput');
    wlInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('webui:add-whitelist-player'));
        }
    });

    updateTerminalStatus();
    updateTerminalCounts();
}

/** Opens the log SSE stream once for the whole session. */
export function initLogStream() {
    if (stopLogStream) return;
    stopLogStream = createStream('/api/logs/stream', addLogEntry);
}

export function activateTerminal() {
    refreshTerminalLogs();
}

export function initTerminalPage() {
    initTerminal();
    onLanguageChange(() => {
        updateTerminalStatus();
        updateTerminalCounts();
        refreshTerminalLogs();
        // Descriptions are language-dependent; repaint an open dropdown.
        if (isAutocompleteVisible()) showAutocomplete(inputEl()?.value || '');
    });
}