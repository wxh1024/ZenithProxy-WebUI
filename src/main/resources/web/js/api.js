/** Thin fetch wrapper around the WebUI REST API. */

export const API_BASE = window.location.origin + '/api';

/**
 * Calls a JSON endpoint. Returns `null` on network failure or after a
 * 401 (which redirects to the login page).
 */
export async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const opts = {
            method,
            headers: {'Content-Type': 'application/json'},
            credentials: 'include',
        };
        if (body) opts.body = JSON.stringify(body);
        const r = await fetch(API_BASE + endpoint, opts);
        if (r.status === 401) {
            window.location.href = '/login.html';
            return null;
        }
        return await r.json();
    } catch {
        return null;
    }
}

/**
 * Creates an EventSource with exponential-backoff reconnection.
 * `onMessage` receives the already-parsed JSON payload.
 */
export function createStream(url, onMessage) {
    let source = null;
    let delay = 1000;
    const MAX_DELAY = 30000;

    const connect = () => {
        source = new EventSource(url);
        source.onmessage = event => {
            try {
                onMessage(JSON.parse(event.data));
            } catch { /* malformed frame — drop it */
            }
        };
        source.onopen = () => {
            delay = 1000;
        };
        source.onerror = () => {
            source.close();
            source = null;
            setTimeout(connect, delay);
            delay = Math.min(delay * 2, MAX_DELAY);
        };
    };

    connect();
    return () => {
        if (source) {
            source.close();
            source = null;
        }
    };
}

/** Resolves the logged-in username, redirecting to the login page when anonymous. */
export async function fetchSession() {
    try {
        const response = await fetch('/api/auth/status', {credentials: 'include'});
        const data = await response.json();
        if (!data.authenticated) {
            window.location.href = '/login.html';
            return null;
        }
        return data.username || 'root';
    } catch {
        window.location.href = '/login.html';
        return null;
    }
}

/** Clears the auth cookie and returns to the login page. */
export async function logout() {
    try {
        await fetch('/api/auth/logout', {method: 'POST', credentials: 'include'});
    } catch { /* already logged out */
    }
    window.location.href = '/login.html';
}