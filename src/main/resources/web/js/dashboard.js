/**
 * Dashboard page — status cards, queue display and the four live charts.
 *
 * Data arrives two ways: an initial REST fetch and a 1 Hz SSE stream
 * (`/api/dashboard/stream`). Both funnel into `renderDashboard()`.
 */

import {apiCall, createStream} from './api.js';
import {LIMITS, onLanguageChange, state} from './state.js';
import {formatUptime, localeTag, t} from './i18n.js';
import {escapeHtml, getPingClass} from './util.js';

const chartColors = {
    cpu: 'rgba(198, 160, 246, 1)', cpuBg: 'rgba(198, 160, 246, 0.15)',
    memory: 'rgba(166, 218, 149, 1)', memoryBg: 'rgba(166, 218, 149, 0.15)',
    netIn: 'rgba(138, 173, 244, 1)', netInBg: 'rgba(138, 173, 244, 0.15)',
    netOut: 'rgba(245, 169, 127, 1)', netOutBg: 'rgba(245, 169, 127, 0.15)',
    grid: 'rgba(110, 115, 141, 0.15)', text: '#8087a2',
};

let cpuChart = null, memoryChart = null, networkChart = null, latencyChart = null;
let chartsInitialized = false;
let stopStream = null;

// ── Charts ──────────────────────────────────────────────────────────

function pushChartData(chart, value, label) {
    pushChartDataMulti(chart, [value], label);
}

function pushChartDataMulti(chart, values, label) {
    for (let i = 0; i < values.length; i++) {
        chart.data.datasets[i].data.push(values[i]);
    }
    chart.data.labels.push(label);
    if (chart.data.datasets[0].data.length > LIMITS.MAX_DATA_POINTS) {
        for (let i = 0; i < chart.data.datasets.length; i++) {
            chart.data.datasets[i].data.shift();
        }
        chart.data.labels.shift();
    }
    autoScaleChart(chart);
    chart.update('none');
}

/** Keeps the Y axis stable: only rescale on a >10% change, with 20% headroom. */
function autoScaleChart(chart) {
    let maxVal = 0;
    for (const ds of chart.data.datasets) {
        for (const v of ds.data) {
            if (v > maxVal) maxVal = v;
        }
    }
    const newMax = Math.max(maxVal * 1.2, 10);
    const currentMax = chart.options.scales.y.max;
    if (currentMax === undefined || currentMax === null
        || Math.abs(newMax - currentMax) / currentMax > 0.1) {
        chart.options.scales.y.max = Math.ceil(newMax);
    }
}

function makeTimeLabels(count) {
    const labels = [], now = new Date();
    for (let i = count - 1; i >= 0; i--) {
        labels.push(new Date(now - i * 5000).toLocaleTimeString(localeTag(), {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
        }));
    }
    return labels;
}

function makeChartOptions(unit, max) {
    const yScale = {
        display: true, min: 0,
        grid: {color: chartColors.grid},
        ticks: {
            color: chartColors.text, font: {size: 10}, maxTicksLimit: 5,
            callback: v => v + (unit || ''),
        },
    };
    if (max !== undefined && max !== null) yScale.max = max;
    return {
        responsive: true, maintainAspectRatio: false, animation: {duration: 0},
        interaction: {intersect: false, mode: 'index'},
        plugins: {
            legend: {display: false},
            tooltip: {
                backgroundColor: 'rgba(30,32,48,0.95)', titleColor: '#cad3f5',
                bodyColor: '#b8c0e0', borderColor: 'rgba(91,96,120,0.5)',
                borderWidth: 1, padding: 8,
            },
        },
        scales: {
            x: {
                display: true, grid: {color: chartColors.grid},
                ticks: {color: chartColors.text, font: {size: 10}, maxTicksLimit: 6},
            },
            y: yScale,
        },
    };
}

function makeDS(label, color, bg) {
    return {
        label, data: [], borderColor: color, backgroundColor: bg,
        borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0,
        fill: true, tension: 0.3,
    };
}

function legendOptions(unit, max) {
    const base = makeChartOptions(unit, max);
    return {
        ...base,
        plugins: {
            ...base.plugins,
            legend: {
                display: true, position: 'top',
                labels: {color: chartColors.text, boxWidth: 12, padding: 10, font: {size: 11}},
            },
        },
    };
}

function initCharts() {
    if (chartsInitialized) return;
    chartsInitialized = true;
    const tl = makeTimeLabels(LIMITS.MAX_DATA_POINTS);
    cpuChart = new Chart(document.getElementById('cpuChart'), {
        type: 'line',
        data: {labels: tl, datasets: [makeDS(t('chart.cpu.label'), chartColors.cpu, chartColors.cpuBg)]},
        options: makeChartOptions('%', 100),
    });
    memoryChart = new Chart(document.getElementById('memoryChart'), {
        type: 'line',
        data: {labels: tl, datasets: [makeDS(t('chart.memory.label'), chartColors.memory, chartColors.memoryBg)]},
        options: makeChartOptions('%', 100),
    });
    networkChart = new Chart(document.getElementById('networkChart'), {
        type: 'line',
        data: {
            labels: tl,
            datasets: [
                makeDS(t('chart.network.in'), chartColors.netIn, chartColors.netInBg),
                makeDS(t('chart.network.out'), chartColors.netOut, chartColors.netOutBg),
            ],
        },
        options: legendOptions('', undefined),
    });
    latencyChart = new Chart(document.getElementById('latencyChart'), {
        type: 'line',
        data: {
            labels: tl,
            datasets: [
                makeDS(t('chart.latency.bot'), 'rgba(238,212,159,1)', 'rgba(238,212,159,0.15)'),
                makeDS(t('chart.latency.player'), 'rgba(138,173,244,1)', 'rgba(138,173,244,0.15)'),
            ],
        },
        options: legendOptions('ms', 200),
    });
}

/** Chart legends and time labels are locale-dependent — refresh them on switch. */
function localizeCharts() {
    if (!chartsInitialized) return;
    const setLabel = (chart, key, label) => {
        if (chart) chart.data.datasets[key].label = label;
    };
    setLabel(cpuChart, 0, t('chart.cpu.label'));
    setLabel(memoryChart, 0, t('chart.memory.label'));
    setLabel(networkChart, 0, t('chart.network.in'));
    setLabel(networkChart, 1, t('chart.network.out'));
    setLabel(latencyChart, 0, t('chart.latency.bot'));
    setLabel(latencyChart, 1, t('chart.latency.player'));
    for (const chart of [cpuChart, memoryChart, networkChart, latencyChart]) {
        chart.update('none');
    }
}

// ── Cards ───────────────────────────────────────────────────────────

function setStatus(el, connected) {
    el.textContent = connected ? t('status.connected') : t('status.disconnected');
    el.style.color = connected ? 'var(--success-color)' : 'var(--error-color)';
}

function renderQueue(q) {
    const posEl = document.getElementById('queuePosText');
    const onlineEl = document.getElementById('queueOnlineText');
    if (!posEl) return;

    if (!state.connected) {
        posEl.textContent = '-';
        posEl.style.color = 'var(--ctp-overlay1)';
        if (onlineEl) onlineEl.textContent = '';
        return;
    }

    // Show a brief loading state right after connecting, but not when the
    // queue simply drains (that transition is instant and known).
    const wasInQueue = q && q.inQueue && q.position > 0;
    if (!wasInQueue && state.queueConnectedTime > 0) {
        const elapsed = Date.now() - state.queueConnectedTime;
        if (elapsed < LIMITS.QUEUE_LOADING_DELAY) {
            posEl.textContent = t('queue.loading');
            posEl.style.color = 'var(--ctp-overlay0)';
            if (onlineEl) onlineEl.textContent = '';
            return;
        }
        state.queueConnectedTime = 0;
    }

    if (wasInQueue) {
        posEl.textContent = t('queue.position', {n: q.position});
        posEl.style.color = 'var(--ctp-yellow)';
        if (onlineEl) {
            onlineEl.textContent = q.onlinePlayers > 0 ? t('queue.online', {n: q.onlinePlayers}) : '';
        }
        state.queueConnectedTime = 0;
    } else {
        posEl.textContent = t('queue.entered');
        posEl.style.color = 'var(--ctp-green)';
        if (onlineEl) {
            onlineEl.textContent = q && q.onlinePlayers > 0 ? t('queue.online', {n: q.onlinePlayers}) : '';
        }
        state.queueConnectedTime = 0;
    }
}

function renderVersion(d) {
    const mcEl = document.getElementById('mcVersion');
    if (!mcEl || !d.version) return;
    const viaEl = document.getElementById('viaVersion');
    if (viaEl) {
        // viaVersion lives inside mcVersion, so rebuild instead of overwriting textContent.
        mcEl.textContent = '';
        mcEl.appendChild(document.createTextNode(d.version));
        mcEl.appendChild(viaEl);
        viaEl.textContent = d.viaVersion || '';
    } else {
        mcEl.textContent = d.version;
    }
}

function renderPlayerStats(pl) {
    const el = document.getElementById('playerStats');
    if (!el) return;
    if (pl && pl.connected && pl.health !== null) {
        const hpColor = pl.health > 10 ? 'var(--success-color)' : pl.health > 5 ? 'var(--warning-color)' : 'var(--error-color)';
        const foodColor = pl.food > 10 ? 'var(--success-color)' : pl.food > 5 ? 'var(--warning-color)' : 'var(--error-color)';
        el.innerHTML = `<span style="color:${hpColor}">hp ${pl.health}/20</span> &nbsp; ` +
            `<span style="color:${foodColor}">hu ${pl.food}/20</span>`;
    } else {
        el.textContent = '-';
        el.style.color = 'var(--ctp-overlay1)';
    }
}

function renderLatencyDetail(lat) {
    const detail = document.getElementById('latencyDetail');
    if (!detail || !lat) return;
    const parts = [`<div class="latency-item"><span class="player-name">${escapeHtml(t('chart.latency.bot'))}</span>` +
    `<span class="ping-value ${getPingClass(lat.botLatency)}">${lat.botLatency}ms</span></div>`];
    if (lat.players && lat.players.length > 0) {
        for (const p of lat.players) {
            parts.push(`<div class="latency-item"><span class="player-name">${escapeHtml(p.name)}</span>` +
                `<span class="ping-value ${getPingClass(p.ping)}">${escapeHtml(String(p.ping))}ms</span></div>`);
        }
    }
    detail.innerHTML = parts.join('');
}

/** Renders one dashboard payload (from REST or SSE). */
export function renderDashboard(d) {
    if (!d) return;
    const now = new Date().toLocaleTimeString(localeTag(), {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const statusEl = document.getElementById('proxyStatus');
    if (statusEl) setStatus(statusEl, d.connected);

    const usernameEl = document.getElementById('currentUsername');
    if (usernameEl) usernameEl.textContent = d.username || '-';
    const addressEl = document.getElementById('proxyAddress');
    if (addressEl) addressEl.textContent = d.proxyAddress || '-';
    renderVersion(d);

    const pc = document.getElementById('playerConnection');
    const hasPlayers = d.latency && d.latency.players && d.latency.players.length > 0;
    if (pc) {
        pc.textContent = hasPlayers ? t('status.connected') : t('status.noConnection');
        pc.style.color = hasPlayers ? 'var(--success-color)' : 'var(--ctp-overlay1)';
    }

    const wasConnected = state.connected;
    state.connected = d.connected || false;
    if (state.connected && !wasConnected && state.queueInitialized) state.queueConnectedTime = Date.now();
    if (!state.connected) {
        state.queueConnectedTime = 0;
        state.queueInitialized = true;
    } else {
        state.queueInitialized = true;
    }

    renderQueue({inQueue: d.inQueue, position: d.queuePosition, onlinePlayers: d.queueOnlinePlayers});

    const uptimeEl = document.getElementById('uptime');
    if (uptimeEl && d.uptime) uptimeEl.textContent = formatUptime(d.uptime);

    renderPlayerStats(d.player);

    const sys = d.system;
    if (sys && cpuChart) pushChartData(cpuChart, Math.max(0, sys.cpuLoad || 0), now);
    if (sys && memoryChart) pushChartData(memoryChart, sys.memoryPercent || 0, now);
    if (sys && networkChart) {
        pushChartDataMulti(networkChart, [
            Math.round((sys.netBytesPerSecIn || 0) / 1024 * 10) / 10,
            Math.round((sys.netBytesPerSecOut || 0) / 1024 * 10) / 10,
        ], now);
    }

    const lat = d.latency;
    if (lat && latencyChart) {
        const botLat = d.connected ? (lat.botLatency || 0) : 0;
        let avgPlayerPing = 0;
        if (lat.players && lat.players.length > 0) {
            let sum = 0;
            for (const p of lat.players) sum += (p.ping || 0);
            avgPlayerPing = Math.round(sum / lat.players.length);
        }
        pushChartDataMulti(latencyChart, [botLat, avgPlayerPing], now);
        renderLatencyDetail(lat);
    }
}

/** One-shot fetch used on page entry and before the SSE stream warms up. */
export async function loadDashboard() {
    const d = await apiCall('/dashboard');
    if (d) renderDashboard(d);
}

/** Opens the 1 Hz dashboard SSE stream. Idempotent. */
export function startDashboardStream() {
    if (stopStream) return;
    stopStream = createStream('/api/dashboard/stream', d => {
        if (state.page !== 'dashboard') return;
        renderDashboard(d);
    });
    // Fetch immediately so the cards fill in before the first SSE frame.
    loadDashboard();
}

export function stopDashboardStream() {
    if (stopStream) {
        stopStream();
        stopStream = null;
    }
}

/** Entry point called by main.js when the dashboard page becomes visible. */
export function activateDashboard() {
    initCharts();
    startDashboardStream();
}

export function initDashboard() {
    initCharts();
    onLanguageChange(() => {
        localizeCharts();
        // Re-render cards so status/uptime text picks up the new language.
        loadDashboard();
    });
}