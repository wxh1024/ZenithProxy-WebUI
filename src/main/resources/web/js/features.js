/**
 * Feature configuration page — grouped toggles + parameters over `/api/features`.
 *
 * The backend owns the schema (groups of labelled fields with types, bounds and
 * enum options), so this module renders generically: every toggle/param is driven
 * by the returned `groups` payload rather than hard-coded HTML.
 *
 * A feature's parameters are disabled (dimmed) while its master toggle is off,
 * and every change is saved immediately with a short debounce.
 */

import {apiCall} from './api.js';
import {onLanguageChange} from './state.js';
import {t} from './i18n.js';
import {escapeHtml, showNotification} from './util.js';

/** Groups + items as returned by GET /api/features. */
let groups = [];

/** Pending debounced save of the most recent change. */
let saveTimer = null;

/** Root node for the group list. */
const containerId = 'featureGroups';

export async function loadFeatures() {
    const data = await apiCall('/features');
    if (!data || !data.groups) return;
    groups = data.groups;
    render();
}

/** Rebuilds the DOM from the current `groups` state. */
function render() {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = groups.map(groupCard).join('');
    // Toggle/param interactions are bound once via delegation in initFeatures().
    applyEnabledState();
}

function groupCard(group) {
    const items = (group.items || []).map(itemRow).join('');
    return `
        <div class="feature-group" data-group="${escapeHtml(group.id)}">
            <div class="feature-group-header">
                <h3>${escapeHtml(t(group.labelKey))}</h3>
            </div>
            <div class="feature-items">${items}</div>
        </div>`;
}

function itemRow(item) {
    const id = `feat-${item.key.replace(/\./g, '-')}`;
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
        default: // string
            control = `
                <input type="text" id="${id}" data-key="${escapeHtml(item.key)}"
                       data-type="string" value="${escapeHtml(String(item.value ?? ''))}">`;
    }
    return `
        <div class="feature-item" data-item-key="${escapeHtml(item.key)}">
            <label class="feature-label" for="${id}">${label}</label>
            <div class="feature-control">${control}</div>
        </div>`;
}

/**
 * Disables a feature's parameters while its master toggle is off.
 * A master toggle is a boolean field named `<prefix>.enabled`; sibling items
 * share the `<prefix>.` namespace.
 */
function applyEnabledState() {
    document.querySelectorAll('[data-group]').forEach(groupEl => {
        groupEl.querySelectorAll('[data-type="boolean"][data-key$=".enabled"]').forEach(master => {
            const prefix = master.dataset.key.slice(0, -'.enabled'.length) + '.';
            groupEl.querySelectorAll(`[data-item-key^="${CSS.escape(prefix)}"]`).forEach(item => {
                const ownToggle = item.querySelector('input[data-type="boolean"]');
                // Skip the master itself.
                if (ownToggle && ownToggle === master) return;
                item.classList.toggle('feature-disabled', !master.checked);
                item.querySelectorAll('input, select').forEach(el => {
                    if (el !== master) el.disabled = !master.checked;
                });
            });
        });
    });
}

/** Persists a single field change, debounced so rapid edits collapse into one request. */
function queueSave(key, value) {
    // Update local model for re-render consistency.
    const item = findItem(key);
    if (item) item.value = value;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(), 350);
}

async function flushSave() {
    const values = {};
    for (const group of groups) {
        for (const item of group.items) {
            const el = document.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
            if (!el) continue;
            values[item.key] = readControlValue(el, item.type);
        }
    }
    const result = await apiCall('/features', 'POST', {values});
    if (result && result.success) {
        showNotification(t('feat.saved'), 'success');
    } else {
        showNotification(t('feat.saveFailed', {err: result?.error || 'Error'}), 'error');
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
        for (const item of group.items) {
            if (item.key === key) return item;
        }
    }
    return null;
}

export function initFeatures() {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Delegated change handling: toggles, number/string inputs and selects all
    // funnel through one listener, so re-renders need no rebinding.
    container.addEventListener('change', e => {
        const el = e.target.closest('[data-key]');
        if (!el) return;
        const key = el.dataset.key;
        const type = el.dataset.type;
        const value = readControlValue(el, type);
        queueSave(key, value);
        // Reflect master-toggle changes on dependent parameters immediately.
        if (type === 'boolean' && key.endsWith('.enabled')) applyEnabledState();
    });

    // Commit any pending debounced save before the user leaves the page.
    window.addEventListener('beforeunload', () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            flushSave();
        }
    });

    onLanguageChange(() => render());
}
