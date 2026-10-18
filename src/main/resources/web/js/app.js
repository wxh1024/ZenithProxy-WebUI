/**
 * Application entry point — auth gate, navigation, language switcher and
 * feature-module wiring.
 */

import { fetchSession, logout } from './api.js';
import { state, emitLanguageChange } from './state.js';
import { init as initI18n, applyTranslations, setLanguage, getLanguage, t } from './i18n.js';
import { initDashboard, activateDashboard, stopDashboardStream, loadDashboard } from './dashboard.js';
import { initTerminalPage, activateTerminal, initLogStream, clearTerminal, exportTerminalContent } from './terminal.js';
import { loadCommands } from './commands.js';
import {
    initWhitelist, loadWhitelist, toggleWhitelist, addWhitelistPlayer,
    updateWhitelistConfig,
} from './whitelist.js';
import { serverConnect, serverDisconnect, serverReconnect, serverShutdown } from './server.js';

// ── Navigation ──────────────────────────────────────────────────────

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });
}

/**
 * Shows `page` and activates its data sources. The dashboard SSE stream is
 * closed when leaving the page so background tabs don't burn bandwidth.
 */
function navigateTo(page) {
    state.page = page;
    document.querySelectorAll('.nav-item').forEach(item =>
        item.classList.toggle('active', item.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page)?.classList.add('active');

    switch (page) {
        case 'dashboard':
            activateDashboard();
            break;
        case 'terminal':
            activateTerminal();
            break;
        case 'players':
            loadWhitelist();
            break;
        default:
            break;
    }
    if (page !== 'dashboard') stopDashboardStream();
}

// ── Language switcher ───────────────────────────────────────────────

function initLanguageSwitcher() {
    const select = document.getElementById('languageSelect');
    if (!select) return;
    select.value = getLanguage();
    select.addEventListener('change', () => setLanguage(select.value));

    window.addEventListener('webui:languagechange', e => {
        select.value = e.detail.lang;
        renderVersionBadge();
        emitLanguageChange(e.detail.lang);
    });
}

function renderVersionBadge() {
    const el = document.getElementById('version');
    if (el && el.dataset.version) el.textContent = 'v' + el.dataset.version;
}

// ── Auth gate ───────────────────────────────────────────────────────

async function initAuth() {
    const username = await fetchSession();
    if (!username) return false; // fetchSession already redirected
    state.username = username;

    const userInfo = document.getElementById('userInfo');
    if (userInfo) userInfo.style.display = 'block';
    const terminalUsername = document.getElementById('terminalUsername');
    const terminalPromptUser = document.getElementById('terminalPromptUser');
    if (terminalUsername) terminalUsername.textContent = username;
    if (terminalPromptUser) terminalPromptUser.textContent = username;
    return true;
}

// ── Boot ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // Language must resolve before the first paint of localized text.
    await initI18n();
    applyTranslations();
    renderVersionBadge();

    if (!await initAuth()) return;

    initNavigation();
    initLanguageSwitcher();
    initDashboard();
    initTerminalPage();
    initWhitelist();

    // Inline onclick handlers in index.html resolve against these bindings.
    Object.assign(window, {
        navigateTo,
        logout,
        clearTerminal,
        exportTerminalContent,
        loadDashboard,
        toggleWhitelist,
        addWhitelistPlayer,
        updateWhitelistConfig,
        serverConnect,
        serverDisconnect,
        serverReconnect,
        serverShutdown,
    });

    loadCommands();
    initLogStream();
    activateDashboard();
});

export { navigateTo, clearTerminal, exportTerminalContent, loadDashboard, t };