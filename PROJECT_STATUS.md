# Purim POS Project Status

Last updated: 2026-11-05

## Goal

Make the POS production-ready by using PostgreSQL/backend APIs as the source of truth for business data. Browser storage should be limited to UI preferences, auth/session state, and explicit offline cache only.

## Current Architecture

- Frontend: Next.js app in `frontend/`
- Backend: NestJS API in `backend/`
- Database: PostgreSQL through Prisma (`backend/prisma/schema.prisma`)
- Offline cache: IndexedDB in `frontend/src/lib/offline-db.ts` for product lookup and offline order queue
- Real-time multi-terminal sync: `frontend/src/components/common/ClientDbSync.tsx` polls and synchronizes shared business state across all terminals every 15 seconds and on window focus/online events.

## Completed In This Session

- Product CSV import now keeps product code/SKU separate from barcode.
- Scientific notation identifiers such as `8.85871E+12` are normalized before import.
- Duplicate import logic now primarily matches by SKU. Barcode matching is only used when an imported row has no SKU.
- Conflicting duplicate barcodes inside the same import file are skipped so PostgreSQL unique barcode constraints do not merge unrelated SKUs or fail the import.
- Product list barcode display now reads barcodes from multiple supported shapes (`barcodes`, `units`, direct `barcode`, etc.).
- Bulk product delete was added to the product list.
- Admin Panel now has a guarded "clear all products" action.
- Product list now avoids overriding backend-formatted products with `custom_products` after successful backend imports.
- Added PostgreSQL-backed persistence for product packaging units, product images, product wholesale price steps, and supplier-specific cost entries (`ProductSupplier`).
- Product create/update/list APIs now persist and return `packagingUnits`, `images`, `wholesalePrices`, `suppliers`, and `supplierEntries`.
- Product create/edit UI now saves product packaging units, images, and wholesale prices to backend first. Browser storage is only used as an emergency fallback when backend save fails.
- Admin "clear all products" now calls a backend `DELETE /api/products` endpoint guarded by `@Roles('ADMIN')` before clearing browser product caches.
- Store settings are now backend-first. The settings page loads/saves through `/api/settings` (mutation endpoints guarded by `@Roles('ADMIN', 'MANAGER')`), while localStorage remains a mirror for synchronous receipt/PDF rendering.
- Added database fields for settings used by the UI: `branch_name`, `receipt_header`, and `vat_rate`.
- Added PostgreSQL-backed cash movement tracking for shifts through `cash_movements` and `POST /api/shifts/:id/cash-movements`.
- Shift summaries now separate `qrSales` (`QR_PROMPTPAY`), `transferSales` (`TRANSFER`), `cashOut` (general drawer outs), and `cashRefunds` (claim/void cash refunds) with zero double-deduction, and preserve closed shifts' historical cash counts.
- Order checkout, order void, PO receiving, and claim exchanges now record `STOCK_OUT_POS`, `STOCK_IN_VOID`, `STOCK_IN_PO`, and `STOCK_OUT_CLAIM` entries in PostgreSQL `audit_logs` so `/api/inventory/movements` is complete across all terminals.
- Blocked payment method edits on orders belonging to already-closed shifts, and required an active open shift when voiding a cash order from a previously closed shift (recording the cash refund on the current open shift).
- Expanded `ClaimsService` and `SupplierReturnsService` to persist full claim resolution metadata, replacement warranty records (`/api/claims/warranties`), claim inventory metadata (`/api/claims/inventory`), and supplier return note items/deductions (`/api/supplier-returns`) in PostgreSQL.
- Enforced server-side RBAC (`RolesGuard`, `@Roles`, `@RequirePermissions`) and live user active/permission verification in `JwtStrategy`.
- Upgraded `ReportsService` (`GET /api/reports/analytics`), `ReportsView.tsx`, and `reports-service.ts` to query full PostgreSQL records without 1,000-order truncation, calculate FIFO batch inventory valuation, and never substitute `basePrice` (selling price) for `costPrice`.
- Added PostgreSQL database backup endpoints (`GET /api/server-control/backups`, `POST /api/server-control/backup`) in `ServerControlService`.

## 2026-11-05 Review Fixes (security, migrations, payables, stock/cost)

- **Auth**: `POST /auth/register` and `PATCH /auth/users/*` now require `ADMIN` (`GET /auth/users` allows ADMIN/MANAGER). The last active ADMIN cannot be demoted or disabled. PINs must be 4-6 digits and unique.
- **JWT secret**: no more `fallback_secret`. `JWT_SECRET` (>= 32 chars) is used if set; otherwise a random secret is generated once into `backend/.jwt-secret` (git-ignored). Existing tokens become invalid after upgrade (users log in again). `JwtStrategy` no longer maps unknown ADMIN tokens to another admin and no longer trusts token claims when the DB is unreachable.
- **Login throttling**: 5 failed password attempts per IP+username, or 5 failed PIN attempts per IP, lock that key for 15 minutes (HTTP 429). In-memory, single backend instance.
- **Migrations**: added `20260901000000_baseline` so `prisma migrate deploy` can build a new database from scratch, and `20261105000000_fix_thai_defaults` (repairs mojibake defaults/rows for `products.unit` and `store_settings.store_name`). Schema comments/defaults re-encoded as UTF-8.
  - **Existing databases must run once:** `npx prisma migrate resolve --applied 20260901000000_baseline` (and `--applied` for any older migration not yet recorded), then `npx prisma migrate deploy`.
- **Payables**: a PO becomes payable only when goods are received (`PARTIALLY_RECEIVED`/`RECEIVED`/`COMPLETED`); payable amount is capped at received value minus paid. `POST /payables/settle-multiple` requires `clientVoucherId` (idempotent). Frontend no longer falls back to local-only vouchers. Credit notes are applied only via payment vouchers: `DeductReturnNoteModal`, the auto-deduct on return-note creation and `POST /supplier-returns/:id/deduct` were removed.
- **Sales/stock**: `CREDIT_DEBT` lines must be > 0 and the debt equals the sum of all credit lines. Units sold beyond stock are costed at `costPrice` or the latest purchase cost, never `basePrice`. Inventory valuation and dashboard low-stock now net negative (oversold) batches.
- Verified on 2026-11-05: backend + frontend build; fresh DB `migrate deploy` matches schema (empty diff); upgrade path of an old DB repairs Thai defaults; API checks (security 10/10, data 12/12) and an Electron desktop run (login lock, open shift, cash sale, duplicate PIN, payables, inventory value, cashier blocked) all passed.
- Follow-up (same day): login page and the "no access" page no longer show or pre-fill default credentials; clicking a PO row now opens the (previously unreachable) PO detail dialog with received value / paid / outstanding and a PDF button; payables show the received value as the bill amount ("จาก PO ฿…" when it differs); fixed React error #310 in `PurchaseOrderPdfModal` (hook after early return) that made the PO PDF crash from every entry point. Verified in the Electron desktop app (5/5 checks).

## 2026-11-06 Review Round 3 (high + medium priority items)

- **Forced password change**: logging in with a known default password/PIN (e.g. `admin123`, `cashier123`, `1234`, `0000`) sets `users.must_change_password`; `JwtAuthGuard` then rejects every API except `/auth/me`, `/auth/change-password`, `/auth/default-pin` with `403 MUST_CHANGE_PASSWORD`. New page `/change-password`; `AuthGuard` redirects there. Default PINs can no longer be assigned.
- **Permissions**: only the shift owner (or ADMIN/MANAGER) can close a shift or add cash movements. `POST /inventory/stock-batch` needs `MANAGE_INVENTORY` and goes through the audited adjustment path. `/claims` needs `MANAGE_CLAIMS` or `POS_SELL` (claim-inventory writes need `MANAGE_CLAIMS`/`MANAGE_INVENTORY`); `/supplier-returns` needs `MANAGE_CLAIMS` or `MANAGE_PURCHASES`.
- **Price floor**: checkout rejects a unit price below the lowest configured price (price levels, packaging-unit prices, applicable wholesale steps) unless the user is ADMIN/MANAGER or has `POS_DISCOUNT`/`ALL`.
- **Claims in profit**: exchange claims record the FIFO cost of the replacement and cash/transfer refunds in `customer_claims.metadata.accounting`; `/reports/analytics` returns `claimAccounting` (plus supplier recoveries from DEFECTIVE return-note items). Sales report shows net profit after claims.
- **VAT**: `orders.vat_rate` / `orders.vat_amount` stored per bill (rate from store settings, VAT-inclusive). Cart uses the settings rate instead of a hard-coded 7%. Sales report shows output VAT.
- **localStorage**: PO create/edit/issue/status are API-first (status change limited to DRAFT→ISSUED and cancel). Supplier return-note create/update/cancel/restore/status wait for the backend and roll the local cache back on failure. Debts are never derived from browser-cached bills. Removed unused `components/claims/*SupplierReturn*` modals.
- **Stock adjustments**: FIFO order, cannot reduce below net on-hand stock, audit log records `costValue`.
- **Shift summary**: `cash_movements.category` (`GENERAL` / `REFUND` / `DEBT_PAYMENT`, backfilled) replaces reason-text matching; `CREDIT_NOTE` payments reported separately from credit sales.
- **Payables**: a bill paid up to the received value but still awaiting goods shows "จ่ายครบตามที่รับ (รอรับของ)" instead of PAID.
- **Debts**: due date defaults to the customer's credit terms (30 days); past-due debts become `OVERDUE`; list totals follow the active filters.
- Migration: `20261106000000_password_cash_category_vat`.
- Verified: backend + frontend build; API checks 25/25; headless browser check of the forced password change flow 3/3.

## 2026-11-07 Finance Phase 1 (money accounts, ledger, expenses, transfers)

- New tables (migration `20261107000000_finance_ledger`): `money_accounts` (CASH_DRAWER per terminal, CASH_SAFE, BANK per `bank_accounts` row, CARD_CLEARING), append-only `money_transactions` ledger (reversal rows, never edits), `expense_categories` (10 defaults seeded), `expenses`; `payments.bank_account_id`.
- Automatic postings (same DB transaction as the business action, `backend/src/finance/ledger.ts`):
  - sale: cash → terminal drawer, QR/transfer → selected bank (default bank if none), card → card clearing; void / payment edit → reversal (cross-shift cash refund comes from today's drawer)
  - shift open: float safe → drawer; shift close: over/short row, then counted cash drawer → safe
  - POS cash in/out (`/shifts/:id/cash-movements`) → drawer; debt receipts → drawer or bank; supplier vouchers → chosen account (safe/default bank), cancel → reversal; transfer claim refunds → bank
- `/api/finance/*` (permission `MANAGE_FINANCE`; ADMIN/MANAGER always): accounts + balances, opening balance (once per account), adjust-to-actual with reason, transfers (deposit cash, withdraw cash, exchange, card payout) with cancel, owner capital/draw, expense categories, expenses (receipt image, cancel = reversal), ledger listing, summary (balances + in/out by kind + expenses by category; transfers/openings excluded, reversals netted).
- Moving money into/out of a drawer outside the POS also writes a cash movement on that drawer's open shift, so shift expected cash stays correct; drawers can only be used while a shift is open.
- Frontend: `/finance` page (menu "การเงิน"), POS sends `bankAccountId` for QR payments, debt payment sends the selected bank, supplier payment modal can choose the paying account.
- **Go-live:** set an opening balance for the safe and every bank account on the first day; existing open shifts have no float posted (close and reopen them after upgrading).
- Verified: backend + frontend build; finance API scenario 19/19; headless /finance page check 4/4.

## 2026-11-07 Finance Phase 2 + cashier cash purposes

- POS cash drawer modal: every cash in/out now has a purpose that is posted to the ledger.
  - OUT: store expense (category required → `expenses` row paid from the drawer), cash drop to safe (transfer), deposit to bank (transfer), other
  - IN: change float from safe (transfer), withdrawal / coin exchange from a bank (transfer), other income (`OTHER_INCOME`), other
  - API: `POST /shifts/:id/cash-movements` accepts `purpose`, `expenseCategoryId`, `bankAccountId`; cashiers (`POS_SELL`) can read expense categories.
- `GET /finance/overview`: supplier bills still to pay (received value, by due date: overdue / today / 7 / 30 days / later; due date = PO due date or bill date + supplier credit terms), receivables (debtor count, total, overdue, aging buckets, top debtors), 30-day cash position.
- `GET /finance/summary` adds a `daily` in/out series. `/finance` page shows the overview sections and a daily chart.
- Verified: phase 2 API checks (13, incl. totals matching the debts and payables pages), headless POS drawer + finance page checks 5/5.

## 2026-11-07 Finance Phase 3 (recurring expenses, forecast, P&L, bank reconciliation)

- Migration `20261108000000_finance_phase3`: `recurring_expenses`, `bank_reconciliations`, `money_transactions.reconciled_at / reconciliation_id`.
- Recurring expenses (`/finance/recurring`): monthly / weekly / yearly rules (day 29-31 clamps to month end), reminder days, pay (creates a normal expense from safe/bank, idempotent `clientId`, advances to next occurrence), skip with reason, enable/disable. Overdue + due-soon shown on the finance overview and subtracted from the 30-day position.
- Cash forecast (`/finance/forecast?days=30|60|90`): balances now + customer debts on their due dates − received supplier bills and recurring expenses on their due dates; overdue bills/expenses assumed paid today, overdue receivables excluded (shown separately); daily series, lowest balance, first negative day. Future sales are not projected.
- Profit & loss (`/finance/profit-loss?from&to`): sales incl. VAT − output VAT = revenue; − FIFO COGS = gross profit; − claims (replacement cost + refunds − supplier recovery), − stock write-offs (`STOCK_ADJUST_SUB` cost value), − expenses by category = operating profit; ± other income, shift over/short, account adjustments = net profit. CSV export + print.
- Bank reconciliation (`/finance/reconcile/:accountId`): tick ledger rows found on the statement (or upload the bank CSV for automatic matching by amount ± 3 days), compare cleared balance with the statement balance, optionally book the difference (fees / interest) as a reconciled adjustment. Ticked rows cannot be reconciled twice.
- `/finance` page has tabs: overview, recurring expenses, cash forecast, P&L, bank reconciliation.
- Verified: phase 3 API checks 14/14, headless tab checks 5/5.

## 2026-11-06 Returns, debt receipt cancel, supplier returns from PO, offsite backup, tests

- Migration `20261109000000_returns_debt_cancel_backup`: `order_returns`, `order_return_items`, `orders.returned_amount`, `debt_payments.cancelled_at/cancel_reason/cancelled_by`, `store_settings.backup_offsite_dir`.
- Partial returns (`POST /orders/:id/returns`, same rights as void): choose items/quantities, restock or not (damaged), refund by cash (from the open shift drawer), transfer (bank) or by reducing the bill's debt; refund includes the bill-discount share; points earned are taken back pro rata. Partially returned bills cannot be voided or have payments edited. P&L and the sales report subtract returns (VAT and restocked COGS too). UI: "รับคืนสินค้า" on the orders page.
- Debt receipt cancel (`POST /debts/payments/:id/cancel`, ADMIN/MANAGER): debt goes back up; money leaves the drawer (shift still open) or the safe (shift closed) / bank. Cancelled receipts are excluded from installments. UI: "ยกเลิก" in the debt payment history.
- Return received goods to the supplier: "คืนสินค้าให้บริษัท" on the PO detail opens the supplier return note form linked to that PO (stock is deducted, the credit note is deducted when paying the supplier).
- Offsite backup: every backup is also copied to `store_settings.backup_offsite_dir` (or `BACKUP_OFFSITE_DIR`), keeping the newest 30 (`BACKUP_OFFSITE_KEEP`). Settings page: folder + write test, status, download button. Added the missing `GET /server-control/backup-status` and `POST /server-control/backup-verify` routes. JSON fallback snapshot now includes finance/returns tables.
- Tests: unit (`npx jest`: recurring dates, payable cap, login throttle, price floor) and e2e (`npm run test:e2e` against a NEW empty database whose name contains "test": security, sale, partial return, credit + receipt cancel, shift close, PO/return note/payment, finance totals). `.github/workflows/ci.yml` runs build + unit + e2e with a Postgres service, and frontend type check + build.
- Verified: unit 18/18, e2e 15/15, API backup checks 7/7, headless UI checks 9/9.

## 2026-11-06 Manager approval with PIN (mode 1) + remote-request structure (mode 2)

- Migration `20261110000000_approvals`: `approval_requests`, `orders.approval_id`, `store_settings.approval_rules`.
- Rules (`/approvals/rules/current`, edit ADMIN): max discount % per role (default CASHIER 10%, WAREHOUSE 0%), below-cost needs approval, below-price-floor needs approval. ADMIN and MANAGER never need approval. Discount % = line discounts + bill discount (excluding points and claim discounts) / gross; claim replacement lines are ignored.
- Checkout: when a rule is hit the server answers `409 APPROVAL_REQUIRED` with the reasons and a server-signed ticket (HMAC, 10 min) bound to the exact bill (seller, customer, items, prices, discounts, total). This replaces the old hard block for prices below the floor.
- Mode 1: `POST /approvals/pin { ticket, pin }` — a different user with ADMIN/MANAGER role or `APPROVE_OVERRIDES` permission types their PIN on the till; PIN attempts are throttled. Returns a single-use approval id; the bill is resubmitted with `approvalId`, consumed inside the sale transaction (rejected if the bill changed, expired or already used). The order stores `approvalId`.
- Mode 2 (backend ready, no UI yet): `POST /approvals/requests` (PENDING), `GET /approvals/:id` (poll), `POST /approvals/:id/decide` (approver), realtime event `approval`; consumed the same way.
- UI: PIN pad dialog in the payment screen; `/approvals` page (history + rules); permission `APPROVE_OVERRIDES`.
- Verified: e2e 23/23 (8 approval cases), headless POS approval flow 3/3.

## Production Readiness Work In Progress

### Product Data

Backend currently persists:

- Product master rows
- Product barcodes
- Product packaging units (`product_packaging_units`)
- Product images (`product_images`)
- Product wholesale price steps (`product_wholesale_prices`)
- Categories
- Supplier links through `ProductSupplier`
- Stock batches

Frontend still stores some product-related data in browser storage:

- `pkg_<productId>` packaging units as fallback only after backend save failure
- `img_<productId>` product images as fallback only after backend save failure
- `ws_<productId>` wholesale price steps as fallback only after backend save failure
- `custom_products` fallback copies after backend failures only

Next implementation target:

- Migrate supplier-specific product cost entries from product form into `ProductSupplier`.
- Remove remaining product fallback reads once migration confidence is high.
- Add backend validation/error messages for duplicate SKUs and duplicate barcodes so import failures are easier to understand.

### Other Browser Storage Still To Migrate

- `custom_stock_movements`
- `custom_purchase_orders`
- `custom_suppliers`
- `custom_customers`
- `custom_claims`
- `custom_claim_replacements`
- `custom_supplier_return_notes`
- `custom_payment_vouchers`
- `custom_bank_accounts`
- `pos_shifts_history`
- `pos_shift_closure_summaries`
- `pos_cash_transactions`
- `pos_completed_orders`
- `pos_store_settings_v2`

Some corresponding database tables already exist. The remaining work is to remove frontend-only services and route every business mutation through backend APIs.

## Priority Order To Reach Production-Ready

1. Sales and stock integrity: verify POS checkout, void order, FIFO stock deduction, receiving stock, and product import using only backend state.
2. Cash and shift integrity: finish replacing frontend shift-store local summaries with backend shift APIs. Cash movements now persist to DB, but some local state remains for UI immediacy.
3. Claims and supplier returns: expand backend schemas to store full claim resolution details, replacement warranty records, supplier return items, and credit-note application history. Current backend has claim and supplier-return note basics, but frontend services still hold richer business state in localStorage.
4. Customer loyalty and debts: verify all point earning/redeeming and debt payment flows mutate backend customer/debt records only.
5. Reports: make report pages consume backend report APIs or backend-backed entities only; remove fallback reads from `pos_orders` and other browser keys.
6. Device-only preferences: keep cash drawer hardware settings and UI preferences local because they are terminal-specific, not business records.

## Rules For Future Agents

- Update this file every time code changes affect persistence, API contracts, import behavior, or production readiness.
- Treat PostgreSQL/backend as the source of truth.
- Do not use `localStorage` for business records unless explicitly documenting it as a temporary fallback.
- IndexedDB is acceptable only for offline cache/outbox behavior and must sync from/to backend.
- Be careful with product `basePrice`: in backend schema it is the selling/base price, while the product page has historically used `basePrice` as display cost. Prefer explicit `costPrice` for cost and `priceLevel1`/`basePrice` for selling price.
- Product code/SKU and barcode are separate identifiers. Never copy SKU into barcode just because barcode is blank.
- **Git workflow (owner's instruction, 2026-11-07)**: work directly on `main` and push to `origin/main` when done (no feature branches or pull requests). Commit code first, then rebuild the installers and commit them separately, so the version recorded in the installers matches the code.
- **Desktop Application Policy (Installer Folder Only)**: All desktop application executables, scripts, and deployment files for both **Server** (`Installer/Server/`) and **Client** (`Installer/Client/`) must be updated and maintained strictly in the `Installer` directory only. Never scatter or distribute installers outside the `Installer` directory.

## Verification Log

- 2026-09-02: `frontend` `npm run build` passed after product import, barcode, checkbox, admin clear, and product cost display fixes.
- 2026-09-02: Added migration `20260902000000_product_persistence` and executed it against local PostgreSQL `pos_purim` on `localhost:5433`.
- 2026-09-02: `npx prisma validate` passed.
- 2026-09-02: `npx prisma generate` initially failed with EPERM because the backend process locked Prisma's query engine DLL. Stopping the backend process on port 3001 allowed generate to pass.
- 2026-09-02: `backend` `npm run build` passed after Prisma Client generation.
- 2026-09-02: `frontend` `npm run build` passed after product persistence changes.
- 2026-09-02: Backend restart compiled successfully and mapped `DELETE /api/products`, but one restart attempt hit `EADDRINUSE` because another process was already listening on port 3001.
- 2026-09-02: Added migration `20260902001000_store_settings_fields` and applied it to local PostgreSQL.
- 2026-09-02: Added migration `20260902002000_cash_movements` and applied it to local PostgreSQL.
- 2026-09-02: `backend` and `frontend` `npm run build` passed after settings and cash movement persistence changes.
- 2026-09-02: Backend dev server restarted successfully and mapped `POST /api/shifts/:id/cash-movements`.
- 2026-10-26: Completed multi-agent production readiness upgrade across Shift/Cash integrity, Stock Movement DB audit logs, Customer Claims & Replacement Warranties, Supplier Return Notes, Server-side RBAC (`RolesGuard`), `ClientDbSync` 15s multi-terminal real-time sync, Executive Reports backend analytics (`GET /api/reports/analytics`), and Database Backup APIs (`POST /api/server-control/backup`). Both `backend` (`npm run build`) and `frontend` (`npm run build` - 32 routes) passed with zero TypeScript errors.
- 2026-11-07: Installers rebuilt as one file per machine. `Installer/Server/Purim-POS-Server-Setup.exe` (NSIS, built by `Installer/build-installers.sh server`): copies the source code to `C:\PurimPOS` and runs `Installer/Server/setup/install-server.ps1`. That script installs Node.js 22 and Docker Desktop if they are missing, reuses the existing `pos-purim-db` container (copying `.env`, `.jwt-secret`, uploads and backups from the old checkout), runs `pg_dump` before any change, then runs `npm ci` and `backend/scripts/prepare-database.js`. prepare-database.js clears failed migrations, baselines databases that have no migration history, runs `migrate deploy`, seeds a database that has no users, and reports drift. The script then builds the backend and frontend, opens TCP 3000 in the firewall to the LAN subnet only, adds a Startup shortcut, desktop and Start-menu shortcuts and a "repair" shortcut, and starts `Installer/Server/setup/purim-server.js`, a production launcher that restarts the backend and frontend if they crash and writes logs to `logs/`. `Installer/Client/Purim-POS-Client-Setup.exe` is the Electron 1.1.0 NSIS installer, per machine. The old dev-mode ServerManager, bat files and portable exe were removed from `Installer/`. Verified on Linux: prepare-database ran correctly for an existing database, a fresh one, a legacy one without history and a failed-P3009 one. A clean install from the payload passed npm ci, the database step, both builds and the launcher (login OK). Both installers also extracted and installed silently under wine, and the uninstaller kept the data. The PowerShell steps have not been run on real Windows.
- 2026-11-07: Added "อัปเดต Purim POS จาก GitHub" shortcut (`Installer/Server/setup/update-from-github.ps1`): fine-grained read-only token stored with DPAPI in `update-token.dat`, compares `VERSION.json` with latest commit on `main`, downloads zipball, replaces program files (keeps .env/uploads/backups/logs), then runs install-server.ps1 (backup, migrate, build, restart). Not yet run on real Windows.
- 2026-11-07: Added `/monitor` pixel-art store monitor (canvas scene drawn from code in `frontend/src/components/monitor/pixel-engine.ts`): one counter per terminal with cashier/customer sprites and screen colour by action (idle/scanning/payment/drawer/claim/void), offline "Z" (orange = shift still open), HUD (online count, busy, today sales/bills, open shifts, pending approvals), server status bars, inspect panel with live cart, and an event log derived from telemetry diffs. `GET /api/server-control/telemetry` now requires login + VIEW_REPORTS (it was public and exposed sales/carts), `/master-control` is no longer a public route, per-terminal sales use `shift.terminalId`, fake "SERVER-POS-01" placeholder removed, terminals with an open shift but no heartbeat are listed. Server installer adds a "มอนิเตอร์ร้าน Purim POS" desktop shortcut.
- 2026-11-07: Receipt printing fixed.
  - The desktop app (1.2.0, `desktop/escpos-raster.js`) prints 80mm/58mm receipts as an ESC/POS raster image. Chromium renders the receipt with print media and the bitmap is sent RAW to the spooler, followed by a feed and a partial cut (GS V 66 0). This fixes Thai printing as "????" on thermal drivers that swap in device fonts, and the missing paper cut. If the raster path fails, it falls back to driver printing. Config keys: `receiptPrintMode` (`raster` or `driver`), `paperDots` (576, or 384 for 58mm, guessed from the printer name), `autoCut`.
  - The print-preview window after payment came from a `window.print()` script embedded in the HTML sent to the desktop app. The frontend no longer sends it, and main.js strips `<script>`.
  - Receipts printed from the hidden off-screen container used to print blank because the hiding inline styles were copied. Fixed in `printableMarkup`.
  - Verified by capturing the real receipt HTML from a cash sale and decoding the ESC/POS output back to an image under xvfb. The raw spooler step has not been run on a real Windows printer.
- 2026-11-07: The POS list layout has the program logo at top-left (links to the dashboard) and its bottom buttons on one row. The desktop window menu bar is hidden; its shortcuts still work and Alt shows it.
- 2026-11-07: Server installer changes.
  - The server installer now carries and silently installs the Purim POS desktop app. It reinstalls the app only when the setup file's SHA-256 changes.
  - The desktop keeps only the app icon: the old server/shop/monitor/update icons are removed. Start/stop/repair live in Start > Purim POS Server.
  - The installer grants Users Modify on the install folder so the server can update itself.
  - "Update from GitHub" moved to the monitor page: an ADMIN-only `UpdatePanel` calls `/api/server-control/update/{status,check,token,run}` (`ServerUpdateService`).
  - The backend starts `update-from-github.ps1 -Mode run` through `cmd /c start`, so the updater survives the server stop. Progress goes to `logs/update-status.json`. `install-server.ps1 -NoElevate` skips the admin-only steps.
  - The PowerShell flows have not been run on Windows.
- 2026-11-07: VAT on sales is a store-wide setting: `store_settings.vat_enabled`, migration `20261111000000_store_vat_enabled`, default off. The setting is on Settings > ข้อมูลร้าน.
  - Checkout uses the store setting and ignores the terminal's flag.
  - The per-terminal "ถอด VAT 7%" toggle is gone. The cart follows the setting through the `purim:store-settings` event.
  - When VAT is off, the POS, payment card and receipts show no VAT section at all.
  - Purchases have no VAT logic and are unaffected.
  - New e2e test (24/24).
- 2026-11-07: Receipt printing speed (desktop app 1.2.2).
  - The winspool helper used to be a new PowerShell process compiling C# for every receipt, which took about 2-4 s. It is now a long-running helper (`RawPrintHost`) started 3 s after app launch, which takes one stdin line per job. If the helper is unavailable, printing falls back to the old one-shot path.
  - The offscreen render window is reused, and the fixed sleeps were replaced by waiting two animation frames.
  - The frontend renders the receipt with `flushSync` instead of a 120 ms delay.
  - Measured under xvfb, render + encode: first receipt about 0.8 s, then about 70 ms. Output is identical across runs.
  - Per-print timings are written to `%APPDATA%/purim-pos-desktop/print-log.txt`.
- 2026-11-07: Version visibility.
  - Builds are stamped with the source version: `backend/scripts/version-info.js` writes `dist/build-info.json` after `nest build`, and `next.config.ts` sets `NEXT_PUBLIC_BUILD_INFO`. The source version is the git HEAD plus a modified flag, or `VERSION.json` in installed copies.
  - Public `GET /api/version` returns the running build, the source on disk and whether they match.
  - The UI shows "เวอร์ชัน YYYY.MM.DD · sha" in the sidebar footer and on the login page, with a details dialog, and a "เวอร์ชันระบบ" card in Settings. It warns when the code on disk is newer than the running build (git pull without rebuild/restart), when the web page differs from the backend, and when the desktop app is too old (no `getAppVersion`, app 1.2.3).
  - Installer process: commit the code first, then build the installers, so the commit recorded in `VERSION.json` matches the code.
- 2026-11-07: Purchase VAT per line. Migration `20261112000000_purchase_vat`.
  - Each PO line stores `vatType` (NONE, INCLUDED or EXCLUDED), `vatRate`, line discount, discount amount, net, VAT and total. Each PO stores its bill discount, discount amount, subtotal (before VAT), VAT and total (owed).
  - The server prices bills with `backend/src/purchase-orders/po-calc.ts`: line discount, then the bill discount spread by line value, then VAT per line. `frontend/src/lib/po-calc.ts` is a copy of it.
  - This fixes an old bug: the server used to ignore the discounts and VAT entered on screen, so the payable total and stock cost were wrong.
  - Stock cost per unit is the gross (VAT included), or the net when the shop is VAT-registered. `stock_batches.unit_cost` is now DECIMAL(14,4).
  - payableNow, the finance overview and the forecast use each line's gross per unit.
  - UI: per-line VAT select and rate; "ตั้ง VAT ทุกรายการ" applies one setting to all lines; the summary shows the amount before VAT and the purchase VAT. The detail dialog and the PDF show VAT per line.
  - Tests: unit 25/25 (new po-calc spec) and e2e 25/25 (new purchase VAT test).
- 2026-11-07: Server control panel and project cleanup.
  - Added "Purim POS Server.exe" (C# WinForms, .NET Framework 4.x). Source: `Installer/Server/control/ServerControl.cs`; build with `Installer/build-installers.sh control` (needs mono-mcs).
    - Shows status (launcher, backend+DB, frontend), start/stop/restart, the LAN addresses for client machines, the log tail, and buttons for the app, the monitor, logs and repair.
    - Minimizes to the tray; single instance.
    - `--autostart` runs at Windows logon (Startup shortcut) and starts the server hidden.
    - install-server.ps1, the NSIS installer and the updater put the exe at the install root. The Start menu entry "Purim POS Server" replaces the old start/stop shortcuts; the desktop still shows only the app icon.
  - Cleanup:
    - Moved the root dev launchers to `tools/dev/` (start-dev / stop-dev).
    - Removed the duplicate CSV, unused Next boilerplate SVGs, one-off scripts (`apply-reliability-migration.cjs`, `backup-db.ps1`) and the boilerplate READMEs.
    - Replaced the 1x1 placeholder PWA icons with real 192/512 renders of icon.svg.
    - Added a Thai root `README.md` (layout + daily use).
- 2026-11-07: Shop fixes and client-app updates (desktop 1.3.0).
  - Client startup:
    - Shows a splash, then tries the last server (4 s timeout, 3 attempts), localhost, this machine's IPs, then an automatic LAN scan. The search screen appears only if all of these fail.
    - The probe is `/login` and accepts any status below 500.
    - `did-fail-load` ignores sub-frames and ERR_ABORTED, which used to throw the app back to the search screen.
  - Closing a shift: the shift summary could not be dismissed. CloseShiftModal's `[open]` effect hid the summary in the same tick it was opened, leaving the dialog stuck while closing. Fixed; the summary is also rendered only while it is shown.
  - The list-mode POS bottom bar now has เปิดกะ / ปิดกะ buttons (they existed only in touch mode).
  - Client-app updates:
    - The server serves `Installer/Client/Purim-POS-Client-Setup.exe` with `client-version.json` (version, sha256, size; written by build-installers.sh) at public `GET /api/client-app/latest` and `/api/client-app/download`.
    - `desktop/app-updater.js` checks, downloads, verifies the SHA-256 and runs the installer with `/S` through `start /wait` (UAC), then relaunches.
    - The app offers the update about 5 s after the shop screen loads. The version dialog shows "อัปเดตแอปเครื่องนี้"; older apps get a download link instead.
    - The server installer and the updater also carry `client-version.json`.
- 2026-11-09: Full QA pass and fixes (desktop 1.4.0). Seven test agents exercised every area via the API and the UI (orders, stock/PO, payables/debts, security/claims, finance/reports, printed documents, all pages); ~90 verified defects were then fixed. Migration `20261120000000_qa_fixes` adds `users.token_version`, `store_settings.low_stock_threshold` (default 5) and `store_settings.cash_movement_approval_limit` (default 1000, 0 = always).
  - Owner decisions: product create/edit needs MANAGE_INVENTORY and cost is shown only with VIEW_COST; back-dated orders stay allowed (offline sync); drawer cash in/out above the limit needs a manager PIN; cart and held bills persist on the device; A4 documents use a separate A4 printer (Windows dialog if unset); reprints say "สำเนา (COPY)" / "พิมพ์ซ้ำ"; thermal receipts with VAT are "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ"; document dates are dd/MM/yyyy Buddhist year in Asia/Bangkok; one low-stock threshold everywhere and stock value at cost; cash supplier payments cannot overdraw the safe; suppliers with unpaid bills cannot be deactivated; returns restore redeemed points pro rata; cashiers still see all bills/shifts; a supplier settlement discount only lowers the amount paid (no income entry); overselling stays allowed.
  - Sales: credit bills refund cash only up to what was paid (rest by debt reduction); claim/points discounts verified server-side; bad input gives 400; shift open/close amounts validated; full returns leave no 0.01 residue; cross-shift voids book to the voider's own shift; voiding a credit sale keeps payment history; shift summary uses real discounts, excludes voids, nets returns, shows the SHF code and open state.
  - Stock/PO: Thai-layout barcode conversion only for Thai input (hyphenated SKUs scan); pack-unit PO lines become base units; server errors are no longer shown as success; bulk upsert is partial-update and transactional; duplicate/invalid data gives 4xx; /inventory/adjust validates type and amount; CSV parser matches headers exactly.
  - Money: customer credit fields need MANAGE_DEBTS; supplier credit notes are computed from items; restore/cancel of supplier returns no longer inflates stock; used credit notes cannot be cancelled; bank account default is transactional; debt payments reject unknown banks.
  - Security/claims: PIN brute-force lockout fixed and no name leak; settings PATCH whitelisted; /server-control ping needs auth; uploads image-only (5 MB); TZ defaults to Asia/Bangkok; JWT carries tokenVersion (password/PIN/role change revokes old tokens); claim refunds capped by the bill and posted to the drawer server-side; claim status state machine; document search no longer returns password/PIN hashes.
  - Reports: one returns-netting rule shared by P&L, sales summary, dashboard and all report tabs; Bangkok day boundaries; dashboard maps CREDIT_DEBT to credit and aggregates on the server (no 1000-order cap); concurrent first load of finance no longer creates duplicate accounts; real .xlsx export and safe CSV.
  - Documents: A4 receipts paginate (header repeats, totals on the last page); one shared reprint mapper; payment labels incl. CREDIT_DEBT; PO PDF shows line discount/VAT; thaiBahtText fixed for เอ็ด in millions; PDF download fixed for Tailwind oklch colours; single print() call.
  - UI: scanner +/- no longer edit quantities while scanning; F3 opens one dialog; discount > 100% rejected; settings has the two new fields; users page uses a real dialog and confirms deactivation.
  - Tests: backend unit 76/76, e2e 25/25 on a fresh DB, frontend tsc and `next build` pass; Playwright smoke over all pages as admin and cashier (no crashes or 5xx). Not tested: real Windows printers/cash drawer and the Electron A4 print dialog.
- 2026-11-09: Desktop 1.4.1, white/frozen client window at the shop (server green, browser fine, Ctrl+Shift+S dead).
  - Likely cause: GPU/driver problem on the mini PC (Chrome copes, Electron froze). Could not be reproduced on Linux; the app now handles it and logs it.
  - A page that stops answering for ~15 s (pinged every 5 s, plus Electron's `unresponsive`) or a GPU process crash restarts the app with hardware acceleration off (`disableGpu` in the config, also `--disable-gpu`). If it freezes again with GPU off, the page is restarted once, then the server screen is shown with the reason.
  - The start-up screen shows each step (server tried, attempt n/3, LAN scan progress). A server counts as found only if `/api/version` answers like Purim POS (another program on port 3000, or a frontend whose backend is down, is skipped). A server page that does not finish loading in 25 s falls back to the server screen with the reason.
  - The server screen shows why it appeared, the log file path, and a "จอขาว/ค้าง? เปิดใหม่แบบไม่ใช้การ์ดจอ" toggle. Log: `%APPDATA%\purim-pos-desktop\purim-pos.log` (userData; rotated at 1 MB).
  - Verified under Xvfb with a real server, a never-loading page and a page that freezes. Not run on Windows.
