# Perf round — progress notes (delete a task's section when it is fully done)

## Task 1: reports computed in the database — DONE (summary in PROJECT_STATUS.md 2026-11-14)

Load DB: `perf_load` (prepare-database.js + scratchpad/perf/seed-load.sh; admin password changed to `Perf12345x`, PIN 8642).
Bench: scratchpad/perf/bench.sh <db> (starts dist backend on :4390, prints time / bytes / peak RSS).

### Before (c60c929, load DB)
| request | time | size | note |
|---|---|---|---|
| tabs today sales / bestsellers / inventory / customers | 2.1 / 2.0 / 2.4 / 0.55 s | 0.6 kB / 449 kB / 4.4 MB / 1.7 MB | |
| tabs 7days sales / bestsellers / payments / customers | 3.6 / 3.9 / 3.1 / 3.4 s | bestsellers 2.9 MB, customers 2.3 MB | RSS 2.0 GB |
| tabs thisMonth sales / bestsellers / payments / customers | 11.9 / 8.1 / 7.2 / 7.3 s | | peak RSS 4.8 GB |
| tabs thisYear or all (any order tab) | backend OOM crash | | "JavaScript heap out of memory" |
| tabs purchases (any range) | 0.65-0.73 s | | loads all POs |
| dashboard today / month / all | 0.41 / 0.51 / 0.63 s | | already SQL (inventory snapshot in Node) |
| sales-summary all / month | 0.08 / 0.04 s | | already SQL |
| P&L month / all | 0.05 / 0.14 s | | sales part SQL; claims/ledger rows in Node |

### After (step 6 build, same load DB, same bench.sh requests; lists = one page of 50 rows)
| request | before time / size | after time / size |
|---|---|---|
| tabs today sales / bestsellers / inventory / customers | 2.1 / 2.0 / 2.4 / 0.55 s; 0.6 kB / 449 kB / 4.4 MB / 1.7 MB | 0.04 / 0.06 / 0.20 / 0.05 s; 0.6 / 27 / 22 / 15 kB |
| tabs 7days sales / bestsellers / payments / customers | 3.6 / 3.9 / 3.1 / 3.4 s (bestsellers 2.9 MB) | 0.14 / 0.21 / 0.03 / 0.05 s (27 kB) |
| tabs thisMonth sales / bestsellers / payments / customers | 11.9 / 8.1 / 7.2 / 7.3 s | 0.10 / 0.22 / 0.04 / 0.07 s |
| tabs thisYear (all tabs) | OOM crash | 1.1 s, 76 kB |
| tabs all sales / bestsellers / inventory / payments / customers | OOM crash (inventory 2.5 s, 4.4 MB) | 0.35 / 0.33 / 0.22 / 0.07 / 0.09 s |
| tabs all (all tabs) | OOM crash | 1.2 s, 76 kB |
| tabs purchases (any range) | 0.63-0.73 s | 0.77-0.85 s (unchanged code, still in Node) |
| dashboard today / month / all | 0.41 / 0.51 / 0.63 s | 0.14 / 0.30 / 0.55 s |
| P&L month / all | 0.05 / 0.14 s | 0.05 / 0.13 s |
| /reports/analytics (all) | loads up to 50k bills | 400 above 5,000 bills (legacy download, test oracle only) |
| peak RSS of the run | 4.8 GB, then heap OOM | 0.71 GB (order tabs alone stay at ~0.14 GB; the purchases tab adds ~0.1-0.14 GB per call until GC) |

### Plan
1. [x] `backend/src/reports/report-sql.ts`: SQL equivalents of report-tabs.ts (sales by Bangkok day, VAT, best sellers,
       payments + shifts stats, customers, inventory, purchases, claim accounting), row guard (400 Thai message).
2. [x] `reports.service.ts` getReportTabs uses them; paging params (page, limit, q, sort, list); dashboard inventory snapshot in SQL;
       /reports/analytics guarded by the row limit.
3. [x] P&L (planning.service) claims / write-off / ledger sums in SQL.
4. [x] e2e parity test adapted to paging (fetch all pages) + new tricky-dataset test (old JS == new SQL).
5. [x] Frontend ReportsView: server paging/search for bestsellers, inventory, customers; export fetches all pages.
6. [x] EXPLAIN ANALYZE -> indexes (migration 20261123000000_report_indexes + @@index).
7. [x] After-measurements, full verification (backend jest 115, e2e 36/36 x4 fresh DBs; frontend tsc, eslint 0 errors, vitest 154, next build; Playwright 13/13), PROJECT_STATUS entry.

### Decisions / findings
- Legacy quirks kept: PENDING orders count as sales in /reports/tabs (only VOIDED/REFUNDED excluded); orders without payments
  count as CASH; customers' averageTicket is unrounded for 1 bill and Math.round for more; debt-by-name fallback.
- Removed from the response (never read by the page, unbounded): `payments.shifts.list`, `customers.unpaidDebtsList`.
- Unrounded float totals (inventory totalCostVal etc., debt aging sums) may differ in the last bits (~1e-11):
  the old value depended on the heap order of the rows too; e2e compares them to 1e-6 (was flaky 1 in 4 runs).
- Tie order of equal rows in sorted lists was the heap order of the old findMany (not reproducible) -> now deterministic.

### Done
- Steps 1-2: report-sql.ts reviewed, controller passes page/limit/q/sort/list; store-flow e2e parity test now
  fetches every page (limit 3) for bestsellers (3 sorts), inventory (all/deadstock/lowstock), customers and
  compares with the frozen legacy functions: 31/31 e2e pass.
- Step 3: planning.service profitAndLoss uses claimAccountingSql / stockWriteOffSql / ledgerProfitRowsSql.
- Step 4: store-flow e2e "reports: tricky dataset" inserts edge cases with Prisma (Bangkok midnight borders,
  PENDING / payment-less / zero-subtotal / voided bills, packs, returns without lines, DEBT_REDUCTION, same-name
  customers, string profile figures, debts of every age, oversold / zero-cost / inactive / bundle products,
  shifts, claims with string figures, cancelled notes, expense reversal, drawer vs bank adjustments,
  write-offs), reruns the parity check, checks P&L parts and the dashboard stock position against the old
  loops, and paging/search/sort/400s. 36/36 e2e pass.
- Bug found by the tricky data: retail price must be COALESCE(price_level_1, base_price) (old code read a
  Decimal / string, so a price level 1 of 0 is used as 0), fixed in inventory tab + dashboard snapshot.
- Step 5: reports-service.ts types follow the paged response; fetchReportTabs takes page/limit/q/sort/list;
  collectAllPages + fetchAllReportRows (export = every page, limit 500). ReportsView: best sellers / inventory /
  customers render the server page, pagination uses `total`, cards use productCount / listCounts /
  customerCount / totalSpentAll / topCustomers; new search box (debounced 300 ms, server-side) for those tabs
  (there was a `search` state but no input before). vitest reports-service.test.ts (5); Playwright 04-reports
  checks bestsellers paging + CSV export of all rows.
- Step 6 (EXPLAIN ANALYZE on perf_load, scratchpad/perf/sqldump.js prints a report function's SQL):
  bestsellers took 1.7-2.3 s for ANY range, ~1.5 s of it JIT compilation triggered by a bad row estimate
  (UNION of ids + 2 LEFT JOINs estimated 500k rows) -> FULL JOIN: 0.24 s (7 days) / 0.30 s (all).
  Other queries (range all, 100k orders): sales 0.49 s, payments 0.13+0.07 s, customers 0.10 s, inventory
  0.24 s (last sale per product = full order_items join, 0.1 s), all without JIT. Full scans for long ranges
  cannot use indexes; added only audit_logs(action, created_at) (write-offs: 11 -> 2 ms per month on 300k
  log rows, all time 22 -> 10 ms) and customer_claims(created_at). Migration 20261123000000_report_indexes
  (fresh migrate deploy + empty diff checked).
- Purchases tab stays in Node (PO rows bounded by the row guard; claims list = getAllClaims(1, 5000) as before).

## Task 2: POS catalogue, delta sync, images by URL, lighter stock list, scanner lookup, gzip — IN PROGRESS

Branch ccr-8f8b0741-si1a0o (base f9078b0). Load DB perf_load (no images / categories / suppliers in it; see
"perf_img" below for a copy with images). Endpoint list for bench.sh: scratchpad/perf/t2-endpoints.txt
(`ENDPOINTS="$(cat .../t2-endpoints.txt)" bash .../bench.sh perf_load`).

### Before (f9078b0, perf_load)
| request | time | size | note |
|---|---|---|---|
| GET /products | 1.8-2.0 s | 13.5 MB | peak RSS 0.6 -> 0.88 GB after 2 calls; every row carries all stock batches (incl. empty ones) |
| GET /inventory/stock | 1.1 s | 10.7 MB | no consumer in frontend / desktop / tests |
| GET /inventory/low-stock | 1.0 s | 106 kB | loads every product + batch |
| GET /products/lookup (empty q) | 0.31 s | 6.9 kB | groupBy all batches + all products |
| GET /products/lookup?q=<barcode or sku> | 0.09 s | 0.5 kB | |
| GET /products/barcode/:code | 0.015 s | 1.3 kB | unique index already |

### Design (decided)
- Light catalogue row (GET /products and the sync endpoint share one builder): product scalars, barcodes {barcode,label},
  packagingUnits, wholesalePrices, category {id,name,color,icon}, images META {id,name,isCover,sortOrder,url,thumbUrl}
  (no base64), supplierEntries (+ slim `suppliers`), bundleItems {childProductId,quantity,childProduct{id,name,sku,basePrice,priceLevel1}},
  stock/computedStock from one SQL sum. NO stockBatches arrays. GET /products/:id stays full (form / tests).
- Images: GET /api/product-images/:id[?size=thumb] public (img tags cannot send the bearer token; ids are uuids,
  product photos are not secret), decoded from data_url, Cache-Control immutable (image rows are never modified:
  update keeps rows by id, new photos = new rows). Thumbnail: product_images.thumb_data_url made by the browser on
  save (compressImage 240 px); old rows without one serve the full image.
- Delta sync: append-only table product_changes(product_id, xid xid8 default pg_current_xact_id()) filled by triggers
  on products, stock_batches, barcodes, packaging units, images, wholesale prices, product_suppliers, bundle items,
  categories (update) and suppliers (update). Cursor = pg_current_snapshot() of a REPEATABLE READ read; changes =
  rows whose xid is not visible in the cursor snapshot (exact, no clock / in-flight-transaction races) + bundles whose
  children changed; missing ids = deleted. Cursor older than 7 days / from the future / invalid -> full reload.
  Log pruned (> 14 days) at most hourly. Writes are serialized by the business advisory lock and inserts take no row
  locks, so the triggers add no deadlock risk.
- GET /products/sync?since=<cursor> -> {cursor, full, products, deleted}; client keeps cursor per user (cost visibility).
- Frontend: product-store keeps raw rows + cursor; delta merged by a pure function (vitest); no state change when
  nothing changed; offline IndexedDB gets put/delete for the delta (full replace on full load).
- /inventory/stock + low-stock: product scalars + computedStock from SQL sums, no batch arrays.
- gzip: `compression` middleware, SSE (text/event-stream) excluded.
- Scanner: the POS scans against the in-memory catalogue / GET /products/barcode/:code (unique indexes on
  product_barcodes.barcode and products.sku, 12 ms). /products/lookup is the mobile search (substring match on every
  product, cannot use a b-tree): its candidates now come from one SQL query instead of Prisma objects.

### Plan
1. [ ] Notes + baseline (this section).
2. [x] Backend: migration (thumb column, product_changes + triggers), light row builder, GET /products light, sync endpoint,
       image endpoint, update keeps images by id, inventory stock trimmed, lookup speed, compression. Unit + e2e tests.
3. [x] Frontend: product store delta + offline cache delta, image URLs in POS / products page / PO preview, form keeps
       existing images by id + thumbnail on save. vitest.
4. [ ] Measurements after, full verification, PROJECT_STATUS entry.

### Done
- Step 1: baseline measured (table above).
- Step 2 (backend): migration 20261124000000_product_sync (thumb_data_url, product_changes + triggers; fresh deploy
  diff empty), product-catalog.ts (row builder, cursor, data-URL decoding) + spec, GET /products = catalogue rows,
  GET /products/sync, GET /product-images/:id (ProductImagesController, public), update keeps photo rows by id
  (replaceImages; DTO accepts id / thumbDataUrl), /inventory/stock + low-stock without batch rows, lookup candidates
  in one SQL query, compression middleware. Parity on perf_img (copy of perf_load + scratchpad/perf/seed-extras.sh:
  categories, packs, wholesale, suppliers, 50 bundles, 1,000 photos of 30 kB, inactive rows) old build vs new:
  every product row equal except the intended removals (scratchpad/perf/parity-products.js), /inventory/stock and
  low-stock rows equal minus stockBatches, 9 lookup URLs byte-identical. e2e: 8 new tests (sync: full, empty delta,
  create / photo / bundle / stock / sale / price / barcode / category rename / deactivate / receive / delete, full +
  deltas == fresh full, bad / foreign / old cursors, cost stripping; photos: bytes, thumb, 304, 404, keep-by-id,
  old-style replace; stock list) -> 45/45.
- Step 3 (frontend): product-delta.ts (merge + syncSince), product store uses /products/sync (cursor per login token
  and low-stock threshold; no state change on an empty delta; full reload after offline fallback or a failed IndexedDB
  delta write), offline-db applyCachedProductDelta, photos by URL (POS cards = thumb URL, products table = thumb,
  PO preview = full URL, form shows URL / upload data, saves existing photos by id, uploads with a 240 px thumbnail).
  vitest product-delta.test.ts (8, incl. store with mocked API) + product-images.test.ts (3): 165 total.
