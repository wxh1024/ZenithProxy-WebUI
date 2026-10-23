/**
 * Basic (connection) configuration page — the bot's core connection settings,
 * kept fully separate from the feature toggles in features.js.
 *
 * The backend owns the schema as a flat list of groups, each with a list of
 * fields (full CONFIG paths). Unlike features.js there are no collapsible
 * cards or master switches — this is a simple grouped form for connection
 * fundamentals: target server, authentication account, heartbeat, proxy bind.
 *
 * Changes save immediately with a short debounce, no toast (same UX as the
 * feature page).
 */

import {apiCall} from './api.js';
import {onLanguageChange} from './state.js';
import {t} from './i18n.js';
import {escapeHtml} from './util.js';

/** Groups (each with a flat list of fields) as returned by GET /api/basic. */
let groups = [];

/** Pending debounced save of the most recent change. */
let saveTimer = null;

/** Root node for the page body. */
const containerId = 'basicGroups';

export async function loadBasicConfig() {
    const data = await apiCall('/basic');
    if (!data || !data.groups) return;
    groups = data.groups;
    render();
}

/** Rebuilds the whole page from the current `groups` state. */
function render() {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = groups.map(groupSection).join('');
}

function groupSection(group) {
    return `
        <div class="basic-section">
            <div class="basic-section-header">
                <h3>${escapeHtml(t(group.labelKey))}</h3>
            </div>
            <div class="basic-items">
                ${(group.items || []).map(itemRow).join('')}
            </div>
        </div>`;
}

function itemRow(item) {
    const id = `basic-${item.key.replace(/\./g, '-')}`;
    const label = escapeHtml(t(item.labelKey));
    let control;
    switch (item.type) {
        case 'boolean':
            control = `
                <label class="toggle">
                    <input type="checkbox" id="${id}" data-key="${escapeHtml(item.key)}"
                           data-type="boolean" ${item.value ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>`;
            break;
        case 'int':
        case 'float':
            control = `
                <input type="number" id="${id}" data-key="${escapeHtml(item.key)}"
                       data-type="${item.type}" value="${escapeHtml(String(item.value ?? ''))}"
                       ${item.min != null ? `min="${item.min}"` : ''}
                       ${item.max != null ? `max="${item.max}"` : ''}
                       step="${item.type === 'int' ? '1' : 'any'}">`;
            break;
        case 'enum':
            control = `
                <select id="${id}" data-key="${escapeHtml(item.key)}" data-type="enum">
                    ${(item.options || []).map(o =>
                        `<option value="${escapeHtml(o)}" ${o === item.value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
                </select>`;
            break;
        default: // string (including UUID, rendered as text)
            control = `
                <input type="text" id="${id}" data-key="${escapeHtml(item.key)}"
                       data-type="string" value="${escapeHtml(String(item.value ?? ''))}">`;
    }
    return `
        <div class="basic-item">
            <label class="basic-label" for="${id}">${label}</label>
            <div class="basic-control">${control}</div>
        </div>`;
}

// ── Saving ───────────────────────────────────────────────────────────

/** Persists changes, debounced so rapid edits collapse into one request. */
function queueSave(key, value) {
    const item = findItem(key);
    if (item) item.value = value;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(), 350);
}

async function flushSave() {
    const values = {};
    for (const group of groups) {
        for (const item of group.items || []) {
            const el = document.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
            if (!el) continue;
            values[item.key] = readControlValue(el, item.type);
        }
    }
    try {
        await apiCall('/basic', 'POST', {values});
    } catch { /* ignore — the next edit retries */
    }
}

function readControlValue(el, type) {
    if (type === 'boolean') return el.checked;
    if (type === 'int') return parseInt(el.value, 10) || 0;
    if (type === 'float') return parseFloat(el.value) || 0;
    return el.value;
}

function findItem(key) {
    for (const group of groups) {
        for (const item of group.items || []) {
            if (item.key === key) return item;
        }
    }
    return null;
}

// ── Init ─────────────────────────────────────────────────────────────

export function initBasicConfig() {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('change', e => {
        const el = e.target.closest('[data-key]');
        if (!el) return;
        queueSave(el.dataset.key, readControlValue(el, el.dataset.type));
    });

    window.addEventListener('beforeunload', () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            flushSave();
        }
    });

    onLanguageChange(() => render());
}
