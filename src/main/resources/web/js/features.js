/**
 * Feature configuration page — collapsible feature modules over `/api/features`.
 *
 * The backend owns the schema as a two-level tree: groups (broad categories)
 * contain features (individual collapsible modules), each with a list of toggle
 * and parameter fields. Every module renders as a card whose header toggles the
 * body open/closed.
 *
 * A feature's parameters are disabled (dimmed) while its master toggle is off,
 * and every change is saved immediately with a short debounce (no toast).
 */

import {apiCall} from './api.js';
import {onLanguageChange} from './state.js';
import {t} from './i18n.js';
import {escapeHtml} from './util.js';

/** Groups (each with nested features) as returned by GET /api/features. */
let groups = [];

/** Pending debounced save of the most recent change. */
let saveTimer = null;

/** Collapsed feature ids, persisted across re-renders and language switches. */
const collapsed = new Set();

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
    container.innerHTML = groups.map(groupSection).join('');
    applyEnabledState();
}

function groupSection(group) {
    const features = (group.features || []).map(featureCard).join('');
    return `
        <div class="feature-group" data-group="${escapeHtml(group.id)}">
            <div class="feature-group-header">
                <h3>${escapeHtml(t(group.labelKey))}</h3>
            </div>
            <div class="feature-list">${features}</div>
        </div>`;
}

function featureCard(feature) {
    const isCollapsed = collapsed.has(feature.id);
    const body = featureBody(feature);
    return `
        <div class="feature-card ${isCollapsed ? 'collapsed' : ''}" data-feature="${escapeHtml(feature.id)}">
            <button type="button" class="feature-card-header" data-collapse-toggle
                    aria-expanded="${!isCollapsed}">
                <span class="feature-chevron">${chevronSvg()}</span>
                <span class="feature-card-title">${escapeHtml(t(feature.labelKey))}</span>
                <span class="feature-master-toggle"></span>
            </button>
            <div class="feature-card-body">${body}</div>
        </div>`;
}

function chevronSvg() {
    return `<svg fill="none" height="14" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14">
        <polyline points="9 18 15 12 9 6"></polyline></svg>`;
}

function featureBody(feature) {
    const rows = (feature.items || []).map(itemRow).join('');
    return `<div class="feature-items">${rows}</div>`;
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
 * share the `<prefix>.` namespace. The master toggle is also reflected as a
 * small status pill in the card header.
 */
function applyEnabledState() {
    document.querySelectorAll('.feature-card').forEach(card => {
        const master = card.querySelector('input[data-type="boolean"][data-key$=".enabled"]');
        // Reflect master state into the header pill.
        const pill = card.querySelector('.feature-master-toggle');
        if (master && pill) {
            pill.textContent = master.checked ? t('feat.on') : t('feat.off');
            pill.classList.toggle('on', master.checked);
        }
        if (!master) return;
        const prefix = master.dataset.key.slice(0, -'.enabled'.length) + '.';
        card.querySelectorAll(`[data-item-key^="${CSS.escape(prefix)}"]`).forEach(item => {
            const ownToggle = item.querySelector('input[data-type="boolean"]');
            if (ownToggle && ownToggle === master) return;
            item.classList.toggle('feature-disabled', !master.checked);
            item.querySelectorAll('input, select').forEach(el => {
                if (el !== master) el.disabled = !master.checked;
            });
        });
    });
}

/** Persists a single field change, debounced so rapid edits collapse into one request. */
function queueSave(key, value) {
    const item = findItem(key);
    if (item) item.value = value;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(), 350);
}

async function flushSave() {
    const values = {};
    for (const group of groups) {
        for (const feature of group.features || []) {
            for (const item of feature.items || []) {
                const el = document.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
                if (!el) continue;
                values[item.key] = readControlValue(el, item.type);
            }
        }
    }
    // Fire-and-forget; no success toast by design.
    try {
        await apiCall('/features', 'POST', {values});
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
        for (const feature of group.features || []) {
            for (const item of feature.items || []) {
                if (item.key === key) return item;
            }
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
        if (type === 'boolean' && key.endsWith('.enabled')) applyEnabledState();
    });

    // Delegated collapse/expand toggle on card headers.
    container.addEventListener('click', e => {
        const toggle = e.target.closest('[data-collapse-toggle]');
        if (!toggle) return;
        const card = toggle.closest('.feature-card');
        const id = card?.dataset.feature;
        if (!id) return;
        if (collapsed.has(id)) {
            collapsed.delete(id);
        } else {
            collapsed.add(id);
        }
        card.classList.toggle('collapsed', collapsed.has(id));
        card.querySelector('[data-collapse-toggle]')
            ?.setAttribute('aria-expanded', String(!collapsed.has(id)));
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
