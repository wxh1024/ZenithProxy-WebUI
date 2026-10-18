/**
 * Login page controller.
 *
 * Shares the i18n module with the dashboard, so an English visitor sees an
 * English login form — including before authentication, since `/api/i18n`
 * is a public endpoint.
 */

import { init as initI18n, applyTranslations, setLanguage, getLanguage, t } from './i18n.js';

const form = document.getElementById('loginForm');
const errorMessage = document.getElementById('errorMessage');
const loginBtn = document.getElementById('loginBtn');
const languageSelect = document.getElementById('languageSelect');

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
}

/** Skips the login form entirely when a valid session cookie already exists. */
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status', { credentials: 'include' });
        const data = await response.json();
        if (data.authenticated) window.location.href = '/';
    } catch {
        // Not logged in — stay on the login page.
    }
}

form.addEventListener('submit', async e => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    loginBtn.disabled = true;
    loginBtn.textContent = t('login.submitting');
    errorMessage.classList.remove('show');

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include',
        });
        const data = await response.json();
        if (data.success) {
            window.location.href = '/';
            return;
        }
        showError(data.error === 'Invalid username or password'
            ? t('login.failed')
            : (data.error || t('login.failed')));
    } catch {
        showError(t('login.networkError'));
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = t('login.submit');
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await initI18n();
    applyTranslations();
    languageSelect.value = getLanguage();
    languageSelect.addEventListener('change', () => setLanguage(languageSelect.value));
    checkAuthStatus();
});