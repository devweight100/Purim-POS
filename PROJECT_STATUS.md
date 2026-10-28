# Purim POS Project Status

Last updated: 2026-10-26

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
