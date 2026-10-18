/**
 * Whitelist page — full CRUD over `/api/whitelist`, which writes straight into
 * the main ZenithProxy CONFIG object (persistence handled by the proxy).
 */

import { apiCall } from './api.js';
import { onLanguageChange } from './state.js';
import { t } from './i18n.js';
import { escapeHtml, showNotification } from './util.js';

export async function loadWhitelist() {
    const data = await apiCall('/whitelist');
    if (!data) return;

    document.getElementById('whitelistEnabled').checked = data.enabled;
    document.getElementById('whitelistAutoAdd').checked = data.autoAddClient;
    document.getElementById('whitelistKickMsg').value = data.kickmsg || '';

    const list = document.getElementById('whitelistList');
    if (!list) return;
    if (!data.whitelist || !data.whitelist.length) {
        list.innerHTML = `<div class="whitelist-empty">${escapeHtml(t('wl.empty'))}</div>`;
        return;
    }
    list.innerHTML = data.whitelist.map(x => `
        <div class="whitelist-entry">
            <span class="whitelist-entry-name">${escapeHtml(x.username)}</span>
            <span class="whitelist-entry-uuid">${escapeHtml(x.uuid)}</span>
            <button class="btn btn-danger btn-sm" data-remove="${escapeHtml(x.username)}">${escapeHtml(t('action.remove'))}</button>
        </div>`).join('');
}

export async function toggleWhitelist(enabled) {
    await apiCall('/whitelist', 'POST', { action: 'toggle', enabled });
    showNotification(t(enabled ? 'wl.enabled' : 'wl.disabled'), 'success');
}

export async function addWhitelistPlayer() {
    const input = document.getElementById('whitelistAddInput');
    const username = input.value.trim();
    if (!username) return;
    const r = await apiCall('/whitelist', 'POST', { action: 'add', username });
    if (r && r.success) {
        input.value = '';
        showNotification(t('wl.added', { name: r.username }), 'success');
        loadWhitelist();
    } else {
        showNotification(t('wl.addFailed', { err: r?.error || 'Error' }), 'error');
    }
}

export async function removeWhitelistPlayer(username) {
    const r = await apiCall('/whitelist', 'POST', { action: 'remove', username });
    if (r && r.success) {
        showNotification(t('wl.removed', { name: username }), 'success');
        loadWhitelist();
    } else {
        showNotification(t('wl.removeFailed', { err: r?.error || 'Error' }), 'error');
    }
}

export async function updateWhitelistConfig() {
    const kickmsg = document.getElementById('whitelistKickMsg').value;
    const autoAddClient = document.getElementById('whitelistAutoAdd').checked;
    await apiCall('/whitelist', 'POST', { action: 'updateConfig', kickmsg, autoAddClient });
    showNotification(t('wl.saved'), 'success');
}

export function initWhitelist() {
    // Delegated remove button + Enter-to-add, so re-renders need no rebinding.
    document.getElementById('whitelistList')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-remove]');
        if (btn) removeWhitelistPlayer(btn.dataset.remove);
    });
    document.addEventListener('webui:add-whitelist-player', addWhitelistPlayer);
    onLanguageChange(() => loadWhitelist());
}