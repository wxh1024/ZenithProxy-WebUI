/**
 * Command discovery and fuzzy autocomplete for the terminal input.
 *
 * Scores each server command against the typed query using a cascade of
 * increasingly loose matchers (exact → prefix → word boundary → substring →
 * fuzzy → multi-word), so `ssw` still finds `server switch`.
 */

import { API_BASE } from './api.js';
import { state, LIMITS } from './state.js';
import { escapeHtml } from './util.js';
import { isZh } from './i18n.js';
import { zhCommandDescription } from './commandDesc.js';

/** Fallback command list; replaced by `GET /api/commands` on load. */
const KNOWN_COMMANDS = [
    'help', 'connect', 'disconnect', 'reconnect', 'cancel',
    'auth', 'whitelist', 'friend', 'ignore', 'kick',
    'server', 'server switch', 'transfer',
    'status', 'debug', 'plugins', 'update',
    'autoReconnect', 'autoDisconnect', 'autoReply', 'autoRespawn',
    'autoEat', 'autoFish', 'autoMend', 'autoTotem', 'autoDrop', 'autoArmor', 'autoOmen',
    'antiAFK', 'antiKick', 'antiLeak',
    'chatRelay', 'chatHistory', 'extraChat', 'chatSchema',
    'commandConfig', 'database', 'theme',
    'inventory', 'click', 'respawn',
    'killAura', 'raycast',
    'pathfinder', 'tasks', 'waypoints',
    'map', 'displayCoords', 'coordinateObfuscation',
    'queueStatus', 'queueWarning', 'prio', 'activeHours',
    'connectionTest', 'clientConnection', 'serverConnection',
    'packetLog', 'schematic', 'replay',
    'stats', 'playtime', 'sessionTimeLimit', 'seen',
    'skin', 'tablist', 'spectator', 'spook',
    'stalk', 'spawnPatrol', 'visualRange',
    'spammer', 'sendMessage', 'rateLimiter',
    'tickRate', 'releaseChannel', 'viaVersion',
    'multi', 'terminal', 'shutdown',
    'jvmArgs', 'unsupported',
    'modulePriority', 'actionLimiter',
    'chatColor', 'chatFormat',
    'discordManage', 'discordNotifications',
    'license',
];

/** Accepts both the legacy string array and the newer object array. */
function normalizeCommands(cmds) {
    if (!cmds || !cmds.length) return [];
    if (typeof cmds[0] === 'string') return cmds.map(name => ({ name }));
    return cmds;
}

state.commands = normalizeCommands(KNOWN_COMMANDS);

// ── Scoring ─────────────────────────────────────────────────────────

/** camelCase / digit / separator boundaries, e.g. "aR" → "autoReconnect". */
function wordBoundaryMatch(target, q) {
    const boundaries = [0];
    for (let i = 1; i < target.length; i++) {
        if (target[i] !== target[i].toLowerCase() && target[i - 1] === target[i - 1].toLowerCase()) {
            boundaries.push(i);
        }
        if (target[i - 1] === ' ' || target[i - 1] === '-' || target[i - 1] === '_') {
            boundaries.push(i);
        }
    }
    for (let i = 1; i < target.length; i++) {
        if (/\d/.test(target[i]) !== /\d/.test(target[i - 1])) boundaries.push(i);
    }
    for (const b of boundaries) {
        if (target.startsWith(q, b)) return 600 - target.length + b;
    }
    return -1;
}

/** All characters of `q` appear in order in `target` (gaps allowed). */
function fuzzyMatch(target, q) {
    let ti = 0, qi = 0, gaps = 0;
    while (ti < target.length && qi < q.length) {
        if (target[ti] === q[qi]) { ti++; qi++; } else { ti++; gaps++; }
    }
    return qi === q.length ? 150 - gaps : -1;
}

/** "server sw" → "server switch": all but the last word must match exactly. */
function multiWordMatch(target, q) {
    const qWords = q.split(/\s+/).filter(Boolean);
    const tWords = target.split(/\s+/).filter(Boolean);
    if (qWords.length <= 1 || qWords.length > tWords.length) return -1;

    let score = 700;
    for (let i = 0; i < qWords.length - 1; i++) {
        if (tWords[i] !== qWords[i]) return -1;
    }
    const lastT = tWords[qWords.length - 1];
    if (lastT.startsWith(qWords[qWords.length - 1])) score += 100 - lastT.length;
    else if (lastT.includes(qWords[qWords.length - 1])) score += 20;
    else return -1;
    return score;
}

/** Scores one command (name + aliases) against the query; higher is better. */
function scoreCommand(cmd, q) {
    const targets = [cmd.name.toLowerCase(), ...(cmd.aliases || []).map(a => a.toLowerCase())];
    let best = -1, bestAlias = null;

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        let score = -1;
        if (target === q) score = 1000;
        else if (target.startsWith(q)) score = 800 - target.length;
        else score = wordBoundaryMatch(target, q);
        if (score < 0 && target.includes(q)) score = 300;
        if (score < 0) score = fuzzyMatch(target, q);
        if (score < 0) score = multiWordMatch(target, q);

        if (score > best) {
            best = score;
            bestAlias = i > 0 ? cmd.aliases[i - 1] : null;
        }
    }
    if (best >= 0 && bestAlias) cmd._aliasMatch = bestAlias;
    return best;
}

/** Wraps the matched span of `name` in a highlight span. */
function highlightMatch(name, q) {
    if (!q) return escapeHtml(name);
    const lower = name.toLowerCase();
    const qLower = q.toLowerCase();

    let start = -1, end = -1;
    if (lower.startsWith(qLower)) {
        start = 0;
        end = qLower.length;
    } else if (lower.includes(qLower)) {
        start = lower.indexOf(qLower);
        end = start + qLower.length;
    } else {
        let qi = 0, first = -1, last = -1;
        for (let i = 0; i < lower.length && qi < qLower.length; i++) {
            if (lower[i] === qLower[qi]) {
                if (first === -1) first = i;
                last = i;
                qi++;
            }
        }
        if (qi === qLower.length) { start = first; end = last + 1; }
    }

    if (start >= 0) {
        return escapeHtml(name.substring(0, start))
            + '<span class="autocomplete-highlight">' + escapeHtml(name.substring(start, end)) + '</span>'
            + escapeHtml(name.substring(end));
    }
    return escapeHtml(name);
}

// ── Dropdown state ──────────────────────────────────────────────────

let suggestions = [];
let selectedIndex = -1;
let resultCache = null;
let cacheKey = '';

const dropdown = () => document.getElementById('autocompleteDropdown');
const input = () => document.getElementById('terminalInput');

/**
 * Rebuilds the suggestion list for the current input value.
 * Reuses the previous result set when the query merely grew, which keeps
 * typing latency flat on large command lists.
 */
/**
 * Picks the description shown in the dropdown.
 * Chinese mode uses the local commandDesc table (the core jar only ships
 * English); English mode passes the core text through untouched. Commands
 * missing from the table fall back to the core description in both modes.
 */
function describeCommand(cmd) {
    if (isZh()) return zhCommandDescription(cmd.name) || cmd.description || '';
    return cmd.description || '';
}

export function showAutocomplete(value) {
    const dd = dropdown();
    if (!dd) return;
    const q = value.trim().toLowerCase();

    const cacheValid = resultCache && q.startsWith(cacheKey);
    if (!q) {
        suggestions = state.commands.slice(0, LIMITS.MAX_SUGGESTIONS);
    } else if (cacheValid) {
        suggestions = resultCache.filter(c => c._score >= 0);
    } else {
        const scored = state.commands
            .map(c => ({ ...c, _score: scoreCommand(c, q) }))
            .filter(c => c._score >= 0)
            .sort((a, b) => b._score - a._score)
            .slice(0, LIMITS.MAX_SUGGESTIONS);
        suggestions = scored;
        resultCache = scored;
        cacheKey = q;
    }

    if (!suggestions.length) { hideAutocomplete(); return; }
    selectedIndex = -1;

    dd.innerHTML = suggestions.map((c, i) => {
        const desc = describeCommand(c);
        const descHtml = desc ? `<span class="autocomplete-desc">${escapeHtml(desc)}</span>` : '';
        const aliasHint = c._aliasMatch ? `<span class="autocomplete-alias-hint">← ${escapeHtml(c._aliasMatch)}</span>` : '';
        return `<div class="autocomplete-item" data-index="${i}">
            <span class="autocomplete-name">${highlightMatch(c.name, q)}</span>${aliasHint}${descHtml}
        </div>`;
    }).join('');
    dd.classList.add('visible');
}

export function navigateAutocomplete(delta) {
    const items = dropdown()?.querySelectorAll('.autocomplete-item');
    if (!items || !items.length) return;
    if (selectedIndex >= 0) items[selectedIndex].classList.remove('selected');
    selectedIndex += delta;
    if (selectedIndex < 0) selectedIndex = items.length - 1;
    if (selectedIndex >= items.length) selectedIndex = 0;
    items[selectedIndex].classList.add('selected');
    items[selectedIndex].scrollIntoView({ block: 'nearest' });
}

/**
 * Completes the typed word with the selected command.
 * Multi-word prefixes keep the earlier words the user already typed.
 */
function completeWith(cmd) {
    const el = input();
    if (!el || !cmd) return;
    const typed = el.value.trim().split(/\s+/).filter(Boolean);
    if (typed.length > 1) {
        const words = cmd.name.split(/\s+/);
        typed[typed.length - 1] = words[words.length - 1];
        el.value = typed.join(' ') + ' ';
    } else {
        el.value = cmd.name + ' ';
    }
}

export function selectAutocomplete() {
    if (selectedIndex >= 0 && selectedIndex < suggestions.length) completeWith(suggestions[selectedIndex]);
    hideAutocomplete();
}

export function selectAutocompleteAt(index) {
    completeWith(suggestions[index]);
    hideAutocomplete();
    input()?.focus();
}

export function isAutocompleteVisible() {
    return dropdown()?.classList.contains('visible') ?? false;
}

export function hasSelection() {
    return selectedIndex >= 0;
}

export function hideAutocomplete() {
    selectedIndex = -1;
    resultCache = null;
    cacheKey = '';
    const dd = dropdown();
    if (!dd) return;
    dd.classList.remove('visible');
    dd.innerHTML = '';
}

// ── Server command list ─────────────────────────────────────────────

/** Fetches the authoritative command list (names + aliases + descriptions). */
export async function loadCommands() {
    try {
        const r = await fetch(API_BASE + '/commands', { credentials: 'include' });
        if (r.status === 401) { window.location.href = '/login.html'; return; }
        const d = await r.json();
        if (Array.isArray(d) && d.length > 0) {
            state.commands = normalizeCommands(d).sort((a, b) => a.name.localeCompare(b.name));
            state.aliasMap = {};
            for (const cmd of state.commands) {
                if (Array.isArray(cmd.aliases)) {
                    for (const alias of cmd.aliases) state.aliasMap[alias.toLowerCase()] = cmd.name;
                }
            }
        }
    } catch { /* keep the built-in list */ }
}