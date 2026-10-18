/**
 * Server control tiles — thin wrappers that map the four dashboard buttons
 * onto proxy commands, reporting the outcome through localized toasts.
 */

import { apiCall } from './api.js';
import { t } from './i18n.js';
import { showNotification } from './util.js';

/** Runs a proxy command and shows a success/failure toast. */
async function run(command, okKey, failKey) {
    const r = await apiCall('/commands', 'POST', { command });
    if (r && r.success) {
        showNotification(t(okKey), 'success');
    } else {
        showNotification(t(failKey, { err: r?.error || 'Error' }), 'error');
    }
}

export const serverConnect = () => run('connect', 'notify.connecting', 'notify.connectFailed');
export const serverDisconnect = () => run('disconnect', 'notify.disconnected', 'notify.disconnectFailed');
export const serverReconnect = () => run('reconnect', 'notify.reconnecting', 'notify.reconnectFailed');

export async function serverShutdown() {
    if (!confirm(t('notify.shutdownConfirm'))) return;
    await run('shutdown', 'notify.shuttingDown', 'notify.shutdownFailed');
}