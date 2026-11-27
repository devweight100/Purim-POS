# AGENTS.md — Working standard for every AI agent on Purim POS

Read this whole file before you change anything. It applies to every agent (Claude, Antigravity/Gemini, Codex, …).
Then read `PROJECT_STATUS.md` (newest entries at the bottom of the dated sections) and the `docs/<feature>.md` file of the area you touch.

> สรุปสำหรับเจ้าของร้าน: ไฟล์นี้คือกติกากลางของโปรเจกต์ ทุก AI ที่มาทำงานต่อต้องอ่านก่อนเริ่ม
> ระบบนี้ใช้งานจริงในร้านทุกวัน ข้อมูลเป็นของจริง ห้ามทำอะไรที่เสี่ยงทำข้อมูลหายหรือทำให้หน้าร้านขายไม่ได้

---

## 1. What this project is

Purim POS is the point-of-sale and back-office system of a Thai retail shop (toys / construction & general goods).
It is **LIVE**: real sales, real stock, real money, every day. The owner is not a programmer and talks in Thai.

| Part | Folder | Tech |
|---|---|---|
| Backend API | `backend/` | NestJS + Prisma 6.19.3 + PostgreSQL 16 |
| Web app (POS, back office, mobile, online shop) | `frontend/` | Next.js 16 (App Router), React, Zustand, Tailwind, Base UI, Playwright, Vitest |
| Shared business rules | `shared/src/` | TypeScript used by BOTH backend and frontend |
| Desktop client | `desktop/` | Electron; it only loads the web app from the shop's server PC (terminal id bridge, printing, shortcuts) |
| Installers / release | `Installer/`, `.github/workflows/release.yml` | Windows installers built by GitHub Actions on a version tag |
| Docs | `docs/`, `PROJECT_STATUS.md` | one doc per feature/round, plus the running status log |

Main areas: POS (หน้าขาย, keyboard + barcode scanner, shifts, held bills, offline outbox), products / stock (FIFO batches, packaging units, bundles),
customers & points, purchase orders & payables, supplier returns, claims, finance, reports, LINE online shop (LIFF) + LINE staff notifications,
exports with manager PIN, audit log.

Topology in the shop: one **server PC** (PostgreSQL + backend + Next.js, Windows service) and several **client PCs** running the Electron desktop app.
The online shop is exposed to the internet only through a Cloudflare Tunnel limited to `/shop` and `/api/public/shop/*`.

---

## 2. The owner's standing rules (always apply)

1. **Ask before acting when unsure** — "สงสัยตรงไหนถามก่อนลงมือ ข้อไหนไม่สงสัยก็ลงมือทำได้เลย". Ask short, concrete questions with a recommended option.
2. **Keyboard first.** Every screen must be usable without a mouse: Enter moves to the next field / confirms, Esc closes, ↑/↓ in lists, focus lands in the right field when a dialog opens. Enter must never accidentally submit a big form.
3. **No horizontal scroll** at 1366×768, 1920×1080 and 1093×614 (= 1366×768 at 125% Windows scaling).
4. **Spacing:** gaps between buttons ≥ 8 px, ≥ 16 px from the window edge. Follow `docs/ui-style.md` for colours, sizes and components.
5. **After ANY visible UI change, send before/after screenshots** of every changed screen at the 3 sizes above (deviceScaleFactor 2). Take the BEFORE shots on the old code first.
6. **UI text is Thai.** Code, comments, commit messages and docs are English (Thai only where it is UI text or a quote of the owner).
7. **Report to the owner in Thai**, plainly: what changed, what they will see, anything they must do (e.g. update the desktop client, create a release).
8. Never put secrets (tokens, passwords, LINE channel secrets, the owner's e-mail) in code, docs, commits or chat.

---

## 3. Things that MUST NOT break (read before touching these areas)

### Data and database
- The database has real data. **Migrations must be additive and safe for existing rows** (new nullable columns or defaults; data migrations must keep every existing value meaning the same). Never edit a migration that is already applied; add a new one in `backend/prisma/migrations/`.
- After a schema change: `npx prisma generate`, and check `prisma migrate diff` is empty on a fresh database. Try the migration on a copy of a database with data when it touches existing rows.
- **Do not upgrade Prisma** (pinned at 6.19.3; the "Update available 8.x" notice is ignored on purpose). Do not bump major versions of Next.js, NestJS, Electron or other core packages without the owner's OK.
- PostgreSQL/backend is the single source of truth. `localStorage` only for UI preferences; IndexedDB only for the offline product cache and the offline sales outbox.

### Business rules
- **One rule, one place:** every calculation used by both server and screens (prices, price levels, PO totals/discounts/VAT, loyalty points, quantities, Bangkok dates, money rounding, online-shop prices, public-exposure rules) lives in `shared/src/`. Never copy it into `backend/src` or `frontend/src/lib`. The server always recomputes; client-sent prices/totals/factors are never trusted.
- **Reports are computed by the server in SQL** (`backend/src/reports/report-sql.ts`; `report-tabs.ts` is the readable spec and e2e parity tests check both). Pages must not download rows to add them up; long lists are paged by the server.
- **Dates are Asia/Bangkok.** Day boundaries use Bangkok midnight (`shared/src/bangkok-date.ts`), never UTC or the PC's local midnight. Back-office date pages open on "today" by default.
- **Cost vs price:** `costPrice` = cost the user typed (0 = not entered); selling prices are `priceLevel1..5` / `basePrice`. Tables show typed cost, else FIFO stock cost. Stock value and COGS are FIFO-based (`stock batches`).
- **SKU and barcode are different identifiers.** Never copy SKU into barcode. Products can have several barcodes and pack barcodes.
- **Packaging units:** quantities on PO lines are in the line's unit (`unit_factor`); stock is always in base units. Receiving adds qty × factor.
- **Product list order** is fixed (`created_at`, then `id`). Never order by `ctid` or rely on physical row order.
- **Replaced/deleted products:** document lines keep `snapshot_name` / `snapshot_sku`; old ids map through `product_replacements`. Old bills must keep showing the original name and price.
- **Shifts:** a shift belongs to one user on one terminal; a terminal has at most one open shift. Offline sales are sent only while their owner is logged in.
- **Loyalty points:** member rate if filled and > 0, else the shop rate (`shared/src/loyalty.ts`). Point changes are written to the audit log, never silently overwritten.
- **Document numbers** come from the server sequences (`docs/document-numbers.md`). Printing a delivery note / picking slip never takes a receipt number, creates a sale or moves stock.
- **Permissions** are enforced on the server (`@Roles`, `@RequirePermissions`); the UI only hides buttons. Exports need a manager/admin PIN token.

### POS keyboard & scanner (`docs/pos-keyboard-scan.md`, `docs/pos-keys-refresh.md`)
- A global scan detector treats ≥ 4 keys ≤ 35 ms apart + Enter/Tab as a barcode scan anywhere on the POS. Do not break it; tests that type must type slower than that (e.g. 90 ms per key).
- After payment the focus returns to the scan box (or the member picker when that setting is on).
- Number pads accept keyboard digits immediately (`data-pad-field`, `PinPad`, `pad-keys`). F-keys: F2 = quantity, F4 = price; desktop global shortcuts use Ctrl+Shift+….

### Online shop / LINE (`docs/online-shop.md`)
- Tunnel isolation has 3 layers (gateway, Next `proxy.ts`, backend middleware). Only `/shop`, `/api/public/shop/*` and needed static files may be reachable from the internet. Never widen this.
- Links sent in LINE messages go through `https://liff.line.me/<LIFF ID>/...` (`shopLink`), not the plain web address.
- The Messaging API token and channel secret are write-only (never returned by the API).
- The POS never creates, edits or deletes the LINE rich menu.

### Desktop client
- Changes under `desktop/` require the owner to update every client PC. Avoid them unless necessary and say so clearly in the report. Changes in `frontend/` / `backend/` reach clients through the server update only.

---

## 4. Routine for every task (do this every time)

1. `git pull` and read: this file → `PROJECT_STATUS.md` → the feature doc(s) → the code.
2. Unclear requirement → ask the owner first (Thai, with a recommended option).
3. UI change → take **BEFORE screenshots** on the current code at 1366×768, 1920×1080, 1093×614.
4. Implement with the smallest safe change; keep server rules in `shared/` / backend; keep keyboard flow.
5. Add/adjust tests: Vitest for pure logic, backend e2e for API/DB behaviour, Playwright for screens and keyboard flows. Never delete, skip or weaken a test to get green — find the root cause.
6. Run the full verification (section 5). All must pass.
7. Take **AFTER screenshots**; check no horizontal scroll and the spacing rules.
8. Write/update `docs/<feature>.md` (decisions, root causes, what was not done) and add a dated entry to `PROJECT_STATUS.md`.
9. Commit (clear English message), push. Screenshots and build output are NEVER committed (no PNGs except app icons in `frontend/public`; no `dist/`, `test-results/`, installers).
10. Report to the owner in Thai with the screenshots, and say whether a new release and/or a desktop client update is needed.

---

## 5. Verification commands

Backend (`backend/`):
```
npx tsc --noEmit -p tsconfig.json
npx jest
# e2e on a NEW EMPTY database whose name contains "test" (the suite runs migrate deploy itself)
DATABASE_URL=postgresql://postgres@localhost:5432/pos_e2e_test npm run test:e2e
```
Frontend (`frontend/`):
```
npx tsc --noEmit
npm run lint          # must stay at 0 errors
npx vitest run
npx next build
npm run test:e2e      # Playwright full suite on a fresh database; see frontend/e2e/env.ts for ports and env vars
```
Shared: covered by the backend jest and frontend vitest runs (`shared/test/`). Desktop: `cd desktop && npm test`.
After schema changes also check `prisma migrate diff` (migrations vs schema) is empty on a fresh database.
Stop the servers you started and drop the test databases afterwards.

Next.js 16 differs from older versions: read `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before writing Next-specific code.

---

## 6. Git and releases

- Work on `main` (owner's instruction); keep commits small and pushed. No force-push, no history rewrite.
- **Release** = a Git tag `vX.Y.Z` (e.g. `v1.5.16` — **no dot after the v**; `v.1.5.16` breaks the update) on `main`. GitHub Actions (`release.yml`) builds 5 assets in ~20–30 min: Server setup, Client setup, `client-version.json`, `Purim-POS-Server-Payload.zip`, `SHA256SUMS.txt`. The owner can also create it in GitHub → Releases → New release (tag `vX.Y.Z`, target `main`, title `Purim POS vX.Y.Z`).
- Check existing tags first (`git ls-remote --tags origin`) and use the next patch number.
- Optional Thai release notes: `docs/release-notes/vX.Y.Z.md` (used automatically by the workflow when present).
- Installers are release assets only; never commit `.exe` files.
- The server update runs migrations automatically (`backend/scripts/prepare-database.js`). Mention every new migration in the report.

---

## 7. Where to find things

- `PROJECT_STATUS.md` — history of every round, rules for future agents, verification log.
- `docs/ui-style.md` — UI standard. `docs/pos-keyboard-scan.md`, `docs/pos-keys-refresh.md` — POS keys and scanner.
- `docs/online-shop.md`, `docs/online-orders-flow.md` — LINE shop and back-office online orders.
- `docs/po-grid-entry.md` — purchase order grid and pack units. `docs/pos-member-picker.md` — member picker, delivery note.
- `docs/round-shift-today-bundle-replace.md` — shifts, today default, bundles, product replacement, points, member import.
- `docs/document-numbers.md`, `docs/pos-price-level.md`, `docs/promptpay-qr.md`, `docs/perf-notes.md`, `docs/agent-blueprint/` — deeper references.
- Thai guides for the shop are in `Installer/Server/*.txt` (e.g. LINE online shop + Cloudflare Tunnel setup).
