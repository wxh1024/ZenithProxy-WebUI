/**
 * Application entry point — auth gate, navigation, language switcher and
 * feature-module wiring.
 */

import {fetchSession, logout} from './api.js';
import {emitLanguageChange, state} from './state.js';
import {applyTranslations, getLanguage, init as initI18n, setLanguage, t} from './i18n.js';
import {activateDashboard, initDashboard, loadDashboard, stopDashboardStream} from './dashboard.js';
import {activateTerminal, clearTerminal, exportTerminalContent, initLogStream, initTerminalPage} from './terminal.js';
import {loadCommands} from './commands.js';
import {
    addWhitelistPlayer,
    initWhitelist,
    loadWhitelist,
    toggleWhitelist,
    updateWhitelistConfig,
} from './whitelist.js';
import {serverConnect, serverDisconnect, serverReconnect, serverShutdown} from './server.js';
import {initFeatures, loadFeatures} from './features.js';
import {initBasicConfig, loadBasicConfig} from './basic.js';

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
        case 'features':
            loadFeatures();
            break;
        case 'basic':
            loadBasicConfig();
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
        emitLanguageChange(e.detail.lang);
    });
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

    if (!await initAuth()) return;

    initNavigation();
    initLanguageSwitcher();
    initDashboard();
    initTerminalPage();
    initWhitelist();
    initFeatures();
    initBasicConfig();

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

export {navigateTo, clearTerminal, exportTerminalContent, loadDashboard, t};