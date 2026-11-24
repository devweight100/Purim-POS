'use strict';
/**
 * URLs the desktop app opens on the server (docs/round-start-dashboard.md).
 * The app starts on the start screen (/start: หน้าขาย (POS) / หลังบ้าน); the page itself sends a POS-only user
 * straight to the POS and a selling device that cannot reach the server straight to the POS (offline selling).
 * Ctrl+Shift+1 / menu "หน้าขาย" open the POS directly; Ctrl+Shift+2 opens the user's first back-office page through
 * /start (menu-shortcuts.js; F1 / F2 belong to the page).
 */
const DEFAULT_SERVER = 'http://localhost:3000';

/** Server base without trailing slashes ('' or missing -> the local server). */
function serverBase(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  return clean || DEFAULT_SERVER;
}

/** base + route ('/x' or 'x'). */
function appUrl(base, route) {
  const r = String(route || '/');
  return serverBase(base) + (r.startsWith('/') ? r : '/' + r);
}

/** Where the app goes once a server is found, and after "เชื่อมต่อ" on the server screen. */
function startUrl(base) {
  return appUrl(base, '/start');
}

/** Ctrl+Shift+1 / menu: the POS directly. */
function posUrl(base) {
  return appUrl(base, '/pos');
}

/** Ctrl+Shift+2 / menu: the first back-office page this user may open (decided by the start screen). */
function backOfficeUrl(base) {
  return appUrl(base, '/start?go=backoffice');
}

module.exports = { DEFAULT_SERVER, serverBase, appUrl, startUrl, posUrl, backOfficeUrl };
