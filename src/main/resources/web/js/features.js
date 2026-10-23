/**
 * Feature configuration page — admin-panel style collapsible module cards.
 *
 * The backend owns the schema as a two-level tree: groups (categories) contain
 * features (modules), each with a list of fields. Rendering follows the common
 * admin-panel pattern:
 *
 *   - Category chips at the top filter the visible cards.
 *   - Each module renders as a card whose header holds a chevron, the module
 *     name and its master on/off switch (a boolean field named `*.enabled`).
 *   - Clicking the header collapses/expands; the switch toggles the module.
 *   - Parameters live in the body and are dimmed/disabled while off.
 *
 * Changes save immediately with a short debounce, no toast.
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

/** Currently selected category filter ('all' or a group id). */
let activeFilter = 'all';

/** Root node for the page body. */
const containerId = 'featureGroups';

export async function loadFeatures() {
    const data = await apiCall('/features');
    if (!data || !data.groups) return;
    groups = data.groups;
    render();
}

/** Rebuilds the whole page (chips + cards) from the current `groups` state. */
function render() {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `${filterChips()}${groups.map(groupSection).join('')}`;
    applyFilter();
    applyEnabledState();
}

// ── Category filter chips ────────────────────────────────────────────

function filterChips() {
    const chips = [
        {id: 'all', labelKey: 'feat.filter.all', count: countFeatures()},
        ...groups.map(g => ({id: g.id, labelKey: g.labelKey, count: (g.features || []).length})),
    ];
    return `
        <div class="feature-chips">
            ${chips.map(c => `
                <button type="button"
                        class="feature-chip ${c.id === activeFilter ? 'active' : ''}"
                        data-filter="${escapeHtml(c.id)}">
                    ${escapeHtml(t(c.labelKey))}
                    <span class="feature-chip-count">${c.count}</span>
                </button>`).join('')}
        </div>`;
}

function countFeatures() {
    return groups.reduce((n, g) => n + (g.features || []).length, 0);
}

/** Shows only the sections matching the active chip filter. */
function applyFilter() {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('[data-group-section]').forEach(section => {
        const show = activeFilter === 'all' || section.dataset.groupSection === activeFilter;
        section.classList.toggle('hidden', !show);
    });
}

// ── Sections and cards ───────────────────────────────────────────────

function groupSection(group) {
    return `
        <div class="feature-section" data-group-section="${escapeHtml(group.id)}">
            <div class="feature-section-header">
                <h3>${escapeHtml(t(group.labelKey))}</h3>
                <span class="feature-section-count">${(group.features || []).length}</span>
            </div>
            <div class="feature-list">
                ${(group.features || []).map(featureCard).join('')}
            </div>
        </div>`;
}

/**
 * One module card. The master `*.enabled` switch (if any) is lifted out of the
 * body into the header; the remaining fields render as parameter rows.
 *
 * Cards with no parameters have no body to reveal, so they render without a
 * chevron or collapse interaction — just a static title + master switch.
 */
function featureCard(feature) {
    const items = feature.items || [];
    const master = items.find(i => i.type === 'boolean' && i.key.endsWith('.enabled'));
    const params = master ? items.filter(i => i !== master) : items;
    const hasParams = params.length > 0;
    const isCollapsed = hasParams && collapsed.has(feature.id);

    const header = hasParams
        ? `
            <button type="button" class="feature-card-titlebar" data-collapse-toggle
                    aria-expanded="${!isCollapsed}" aria-label="${escapeHtml(t(feature.labelKey))}">
                <span class="feature-chevron">${chevronSvg()}</span>
                <span class="feature-card-title">${escapeHtml(t(feature.labelKey))}</span>
            </button>`
        : `
            <div class="feature-card-titlebar static">
                <span class="feature-card-title">${escapeHtml(t(feature.labelKey))}</span>
            </div>`;

    return `
        <div class="feature-card ${hasParams ? 'collapsible' : 'static-card'} ${isCollapsed ? 'collapsed' : ''} ${master ? 'has-master' : ''}"
             data-feature="${escapeHtml(feature.id)}">
            <div class="feature-card-header">
                ${header}
                ${master ? masterSwitch(master) : ''}
            </div>
            ${hasParams ? `
            <div class="feature-card-body">
                <div class="feature-card-body-inner">
                    ${params.map(itemRow).join('')}
                </div>
            </div>` : ''}
        </div>`;
}

function masterSwitch(master) {
    const id = `feat-${master.key.replace(/\./g, '-')}`;
    return `
        <label class="toggle feature-master-switch">
            <input type="checkbox" id="${id}" data-key="${escapeHtml(master.key)}"
                   data-type="boolean" data-master ${master.value ? 'checked' : ''}>
            <span class="toggle-slider"></span>
        </label>`;
}

function chevronSvg() {
    return `<svg fill="none" height="14" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14">
        <polyline points="9 18 15 12 9 6"></polyline></svg>`;
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
 * Disables a module's parameters while its master switch is off.
 * The master switch lives in the card header; sibling parameter rows share
 * the `<prefix>.` namespace.
 */
function applyEnabledState() {
    document.querySelectorAll('.feature-card.has-master').forEach(card => {
        const master = card.querySelector('input[data-master]');
        if (!master) return;
        const prefix = master.dataset.key.slice(0, -'.enabled'.length) + '.';
        card.querySelectorAll(`[data-item-key^="${CSS.escape(prefix)}"]`).forEach(item => {
            item.classList.toggle('feature-disabled', !master.checked);
            item.querySelectorAll('input, select').forEach(el => {
                el.disabled = !master.checked;
            });
        });
    });
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
        for (const feature of group.features || []) {
            for (const item of feature.items || []) {
                const el = document.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
                if (!el) continue;
                values[item.key] = readControlValue(el, item.type);
            }
        }
    }
    // Fire-and-forget; no toast by design.
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

// ── Init ─────────────────────────────────────────────────────────────

export function initFeatures() {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Delegated change handling: master switch, parameter toggles, number and
    // text inputs and selects all funnel through one listener.
    container.addEventListener('change', e => {
        const el = e.target.closest('[data-key]');
        if (!el) return;
        queueSave(el.dataset.key, readControlValue(el, el.dataset.type));
        if (el.dataset.type === 'boolean') applyEnabledState();
    });

    // Category chips filter the visible sections.
    container.addEventListener('click', e => {
        const chip = e.target.closest('[data-filter]');
        if (chip) {
            activeFilter = chip.dataset.filter;
            container.querySelectorAll('.feature-chip').forEach(c =>
                c.classList.toggle('active', c.dataset.filter === activeFilter));
            applyFilter();
            return;
        }
        // Collapse/expand toggle on the card title bar.
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
        toggle.setAttribute('aria-expanded', String(!collapsed.has(id)));
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
