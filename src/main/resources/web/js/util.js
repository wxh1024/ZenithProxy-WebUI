/** Shared DOM / formatting helpers. */

import {t} from './i18n.js';

/** Single-pass HTML escaping — cheaper and safer than chained replaces. */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    })[m]);
}

export function getPingClass(ping) {
    if (ping < 0) return '';
    if (ping <= 100) return 'ping-good';
    if (ping <= 200) return 'ping-medium';
    return 'ping-bad';
}

/** Transient toast in the top-right corner. */
export function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.textContent = message;
    const colors = {
        success: 'var(--success-color)',
        error: 'var(--error-color)',
        warning: 'var(--warning-color)',
    };
    n.style.cssText = `position:fixed;top:16px;right:16px;padding:12px 20px;border-radius:4px;` +
        `color:var(--ctp-crust);font-weight:500;font-size:0.85rem;z-index:1000;opacity:0;` +
        `transform:translateY(-8px);transition:opacity 0.2s,transform 0.2s;` +
        `background:${colors[type] || 'var(--info-color)'};`;
    document.body.appendChild(n);
    requestAnimationFrame(() => {
        n.style.opacity = '1';
        n.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
        n.style.opacity = '0';
        n.style.transform = 'translateY(-8px)';
        setTimeout(() => n.remove(), 200);
    }, 3000);
}

/** Extracts a human-readable message from an API error payload. */
export function errorText(result, fallbackKey = 'notify.error') {
    if (!result) return t(fallbackKey);
    return result.error || t(fallbackKey);
}