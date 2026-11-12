import path from 'node:path';

/**
 * Settings shared by the Playwright config, the global setup and the specs.
 *
 * Defaults match CI (backend on 3001, which next.config.ts rewrites /api to; frontend on 3000).
 * Locally, run on other ports and build the frontend with the matching backend address:
 *   API_INTERNAL_URL=http://127.0.0.1:4313 npx next build
 *   E2E_BACKEND_PORT=4313 E2E_FRONTEND_PORT=4413 DATABASE_URL=postgresql://...:5433/pos_e2e_test npm run test:e2e
 */
export const FRONTEND_DIR = path.resolve(__dirname, '..');
export const BACKEND_DIR = path.resolve(FRONTEND_DIR, '..', 'backend');

export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 3001);
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 3000);
export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

/** Compiled backend entry (`npm run build` in backend/ -> dist/backend/src/main.js; shared/ is compiled alongside). */
export const BACKEND_MAIN = process.env.E2E_BACKEND_MAIN || path.join(BACKEND_DIR, 'dist', 'backend', 'src', 'main.js');

/** Accounts. admin's default password is changed by the global setup; cashier1 keeps the default
 *  so the forced password change can be tested in the browser. */
export const ADMIN = { username: 'admin', defaultPassword: 'admin123', password: 'Admin#E2e2026', pin: '7391' };
export const CASHIER = { username: 'cashier1', defaultPassword: 'cashier123', password: 'Cashier#E2e2026', pin: '8264' };
