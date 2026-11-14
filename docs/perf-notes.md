# Perf round — progress notes (delete a task's section when it is fully done)

## Task 4: follow-ups (payables on the server, supplier-return PO list, debt queries, customer sync) — IN PROGRESS

Branch ccr-8f8b0741-si1a0o (base b67c198). perf_load survived the container restart (the cluster lives in /tmp/pgdata;
started with pg_ctl on :5433; fully migrated). Added realistic payables: scratchpad/perf/seed-payables.sql (every PO
owes its total, 600 vouchers over 1,800 POs: partial, discount, credit notes, every 50th cancelled; 400 credit notes)
-> 3,236 UNPAID / 900 PARTIALLY_PAID / 864 PAID POs. Endpoints: scratchpad/perf/t4-endpoints.txt, raw t4-before.txt.

### Before (b67c198 build, perf_load; uncompressed / gzip)
| request | time | size | used by |
|---|---|---|---|
| /purchase-orders?limit=1000 (server caps 500) | 0.27-0.32 s | 2.1 MB / 39 kB | payables page + supplier returns page (newest 500 POs only) |
| /payables/vouchers?limit=200 | 0.04-0.05 s | 230 kB / 8 kB | payables (payments of the newest 200 vouchers only) |
| /supplier-returns?limit=200 | 0.03-0.5 s | 185 kB / 4 kB | payables credit-note cards / settle dialog (newest 200 notes only) |
| /payables/bills (raw POs, not used by the page) | 0.49-0.50 s | 207 kB | - |
| /customers (ClientDbSync, every 15 s on every screen) | 0.10-0.19 s | 1.2 MB / 23 kB | |
| /debts?limit=100 x 34 pages (POS debt modal, orders credit history) | 0.02-0.03 s each | 1.5 MB total | |
| /claims?limit=500 (orders page) | 0.006-0.19 s | (no claims in perf_load) | |

### Plan
1. [x] perf_load (kept), payables seed, measure before.
2. [~] Payables (backend done): page uses /payables/bills (paging, search, supplier filter, summary totals); e2e parity vs the browser logic.
3. [ ] Supplier returns: PO list searchable/paged from the server.
4. [ ] POS debt picker + orders credit history: filtered server query.
5. [ ] Customer list refresh every 15 s -> delta / on demand (check consumers).
6. [ ] Cheap follow-ups (claims on orders page).
7. [ ] Tests, after-measurements, full verification, PROJECT_STATUS.

### Done
- Step 2 backend: GET /payables/bills now returns the page's bill rows computed on the server (payable-bills.ts =
  port of the browser mapPosToPayableBills over EVERY payable PO and EVERY active voucher): page/limit (<=500),
  supplierId, paymentStatus (computed), search (PO no / supplier name / + supplier invoice no), open=1, slim=1;
  summary over all bills (billCount, unpaidCount, totalOutstanding, totalPaid, availableCredit(+Count), per supplier
  openCount/debt/creditCount/creditTotal). One intended change: received value = gross per unit (VAT/discounts) like
  payableNow / settlement (browser used qty x unitCost: a 107 VAT bill showed 100 payable). Old raw-PO response had no
  consumer (only the e2e test). e2e "payables" parity (frozen legacy copy test/legacy/payables-client-legacy.ts):
  every bill + payments + order, cards, per-supplier, 8 filter combos, paging, slim, open: 53/53 e2e.
  perf_load: page 1 0.20-0.24 s / 227 kB, filtered 0.13-0.2 s, open+slim all.

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

## Task 2: POS catalogue, delta sync, images by URL, lighter stock list, scanner lookup, gzip — DONE (summary in PROJECT_STATUS.md 2026-11-14)

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

### After (same perf_load, same bench requests; old = f9078b0 build run on the same DB)
| request | before time / size | after time / size (gzip) |
|---|---|---|
| GET /products | 2.0-2.2 s / 13.5 MB | 0.34-0.49 s / 6.8 MB (72 kB gzip) |
| GET /products/sync (full, first load) | - | 0.34 s / 6.8 MB (72 kB gzip) |
| GET /products/sync?since= (nothing changed / 5 stock changes) | (was a full GET /products every 15 s, twice on POS screens) | 0.015 s / 100 B; 0.015-0.02 s / 4.4 kB |
| GET /inventory/stock | 1.1-1.3 s / 10.7 MB | 0.34 s / 4.7 MB (54 kB gzip) |
| GET /inventory/low-stock | 0.9-1.0 s / 106 kB | 0.27 s / 47 kB |
| GET /products/lookup empty / barcode / sku / "รุ่น 500" | 0.29 / 0.07 / 0.07 / 0.35 s | 0.11 / 0.06 / 0.06 / 0.15 s (byte-identical responses) |
| GET /products/barcode/:code (scanner) | 0.013-0.015 s | 0.012-0.014 s (unique indexes already; POS scans the in-memory catalogue) |
| peak RSS of the run above | 0.94 GB | 0.37 GB |
| perf_img (1,000 photos of 30 kB, packs, suppliers, bundles): GET /products | 3.6-3.7 s / 60.5 MB, peak RSS 1.58 GB after 2 calls | 0.60-0.75 s / 11.6 MB (330 kB gzip), peak RSS 0.52 GB |

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
4. [x] Catalogue rows built by one SQL statement (Prisma objects took 0.95 s of the 1 s); measurements after, full verification, PROJECT_STATUS entry.

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
- Step 4: catalogRows = one SQL statement (CTEs json_agg per relation, trim_scale(decimal)::text = Prisma's Decimal
  JSON, to_char ISO timestamps, ORDER BY ctid = the old unordered findMany order); parity vs the old build on perf_img:
  all 10,012 rows equal (minus intended removals) and same order. New e2e: catalogue row == GET /products/:id for a
  product with every relation (46/46). Playwright 07-product-photos (photo thumb on POS card + products table, form
  shows URL, upload adds a photo with browser thumbnail, saved photo kept by id, later syncs use since=, response
  compressed through the Next rewrite: brotli for browsers, gzip for curl). Verification: backend tsc + jest 119 +
  e2e 46/46, frontend tsc + eslint 0 errors + vitest 165 + next build + Playwright 14/14.
- Not done / follow-ups: orders page still downloads GET /products once to map names (now light, 0.4 s); the mobile
  lookup still substring-scans every product (needs pg_trgm for an index; 0.06-0.15 s now); server-side paging of
  the products / inventory pages is task 3.

## Task 3: server-side paging / search / sort for the management lists — DONE (summary in PROJECT_STATUS.md 2026-11-14)

Branch ccr-8f8b0741-si1a0o (base 762e54d). Load DB perf_load. Endpoint list: scratchpad/perf/t3-endpoints.txt
(`ENDPOINTS="$(cat .../t3-endpoints.txt)" bash .../bench2.sh perf_load`), raw output t3-before.txt / t3-after.txt.

### Before (762e54d, perf_load: 10k products, 5k customers, 100k orders, 3.3k debts, 5k POs, 300k audit rows)
| page | requests on open | time / size | problem |
|---|---|---|---|
| /products | catalogue (GET /products/sync full) + /suppliers | 0.46 s / 6.8 MB | whole catalogue for a 50-row table (cheap later via delta, but every first open) |
| /inventory | catalogue + /inventory/movements (100 newest) | 0.46 s / 6.8 MB | same; adjust dialog = <select> of 10k options |
| /customers | GET /customers | 0.24 s / 2.1 MB | every customer + every debt row; ?search= also returns everything |
| /debts | /debts?limit=100&page=1..34 (sequential) | 34 x 0.02-0.03 s / 1.5 MB | grows with debts |
| /orders | /orders?startDate&endDate (default limit 50!) + GET /products + /claims?limit=500 | 0.04 s / 89 kB + 0.46 s / 6.8 MB | BUG: only the newest 50 bills of the range are shown, stats over those 50 |
| /purchase-orders | /purchase-orders?limit=1000 (server caps at 500) | 0.25 s / 2.1 MB | BUG: only the newest 500 POs |
| /payables | /purchase-orders?limit=1000 + /suppliers + /payables/vouchers?limit=200 | 0.25 s / 2.1 MB | BUG: bills from the newest 500 POs only (server /payables/bills exists: 0.64 s) |
| /products/lookup (mobile) "รุ่น 500" / empty | | 0.21 / 0.09 s | substring scan |
| audit log | no page in the frontend | - | /inventory/movements is limit 100 |

Search: pg_trgm tested on a copy of perf_load (C.UTF-8): Thai words produce trigrams, `ILIKE '%…%'` with GIN
gin_trgm_ops: products name/sku/barcode 31 -> 1-14 ms, orders.order_number 75 -> 1 ms. postgres:16-alpine (the
docker-compose image the Windows installer runs) and EDB Windows installers ship contrib; pg_trgm is a trusted
extension (PG13+). Migration creates it inside a DO block that only RAISEs a NOTICE if it is missing, so an install
without contrib still migrates (plain ILIKE, same results, just a scan).

### Plan
1. [x] Measure, notes.
2. [x] Migration pg_trgm (guarded) + GIN trigram indexes (products name/sku, barcodes, pack barcodes, customers name/phone, orders order_number).
3. [x] Orders page: server paging/search/status tab/stats; no GET /products download.
4. [x] Debts page: server paging + summary.
5. [x] Customers: GET /customers?page= (paged mode; no page param = old full list for POS/other consumers).
6. [x] Products page: GET /products/page (q, category, supplier, stock filter, sort, paging, counts); export/import/bundle picker load the catalogue on demand.
7. [x] Inventory page: paged stock list + server stats.
8. [x] Purchase orders: server paging + status counts. Payables NOT changed (see follow-ups).
9. [x] Tests, after-measurements, full verification, PROJECT_STATUS.

### Decisions
- pg_trgm migration 20261125000000_trigram_search (guarded DO block; schema declares the GIN indexes, fresh-DB diff empty).
- Search everywhere = case-insensitive substring (ILIKE with % _ \ escaped), same fields the pages searched before.
- Orders: GET /orders gains statusGroup (completed = not VOIDED, voided), search also in note + item product name/sku,
  counts=1 -> meta.counts {all, completed, voided, revenue} over the date range only (old cards ignored search/tab);
  order createdAt desc, id desc. Page no longer downloads GET /products (item names come with the order).
  Search on 100k orders: 0.25-0.3 s (OR over joins); page 1: 0.03-0.09 s.
- Debts: GET /debts gains statusGroup (unpaid / overdue / paid as the page defined them), customerId, customerType
  (profile type, missing = INDIVIDUAL), search also customer code / company / tax id, stats=1 (cards over every debt).
  The list now includes customer.profile (before: type filter / code search never matched anything).
  Other consumers of the full list (POS debt modal, orders page credit history via getDebtRecordByOrderId) still
  use fetchDebtRecords (all pages) — not changed.
- Customers: GET /customers?page= paged mode (stats + nextCode over every customer, listIndex for the legacy
  fallback code); no page = full list as before minus the `debts` arrays (nobody read them), currentDebt summed
  in SQL, rows in creation order. ClientDbSync still refreshes the full list every 15 s (now 0.11 s / 1.2 MB).

- Products: GET /products/page?page&limit&q&categoryId&supplierId&stock(all|low|out|normal|negative|reorder)&sort&dir&stats=1.
  Rows = catalogue rows (catalogRows({ids}), same JSON as GET /products, cost stripped without VIEW_COST); stock as
  catalogStock (batch sum / complete bundle sets) computed in SQL; sort keys = the old table's (basePrice = price
  level 1 else base price, levels 2-5 missing = 0), ties and "no sort" = table order (ctid, as the catalogue);
  name sort uses an ICU collation (th-TH-x-icu / th-x-icu / und-x-icu, looked up once; database default if none).
  Low-stock threshold = store settings (the page used the local mirror of the same setting).
  Export / import diff / bundle picker load the catalogue (product store) on demand. Size / colour filters removed
  (no such columns; never shown). ClientDbSync still loads the catalogue in the background on every back-office
  screen (task 2 design, delta after the first load) — the table no longer waits for it.
- Inventory: same endpoint, stats=1 (totalItems, totalBaseUnits, totalValuation = stock>=0 x selling price, cost
  if the price is 0 and the user may see cost — as the page summed it, low/out/negative counts); reorder tab =
  first 500 rows of stock=reorder with a "first N of M" note; adjust dialog loads the catalogue when opened.
- Purchase orders: page of 50, status tab on the server, ?counts=1 -> meta.counts per status (+ALL).
- /products/lookup unchanged: on perf_load "รุ่น 500" matches every product (all barcodes contain "500"), time is the
  ranking of 10k candidates in Node, an index cannot help that query (ILIKE form: 74 -> 40 ms of SQL only).

### After (same perf_load; t3-after.txt; sizes uncompressed / gzip)
| page | before (requests on open) | after |
|---|---|---|
| /products | catalogue 0.46 s / 6.8 MB (+ /suppliers) | /products/page 0.05-0.06 s / 36 kB (2.5 kB gzip); search 0.05 s; sort by name p.100 0.06 s |
| /inventory | catalogue 0.46 s / 6.8 MB + movements | page+stats 0.05 s / 9 kB (1.6 kB gzip); reorder tab 0.05 s / 68 kB |
| /customers | GET /customers 0.24 s / 2.1 MB, 5k rows in the DOM | page 0.02-0.03 s / 14 kB (1 kB gzip), 50 rows per page |
| ClientDbSync every 15 s | GET /customers 0.24 s / 2.1 MB | 0.11 s / 1.2 MB (23 kB gzip) |
| /debts | 34 sequential requests, ~1 s / 1.5 MB | 1 request 0.02 s / 5 kB; search 0.15 s |
| /orders | 0.04 s / 89 kB but only 50 newest bills + GET /products 0.46 s / 6.8 MB | page+counts 0.02-0.08 s / 27 kB (1.7 kB gzip), all bills reachable; search 0.22-0.3 s |
| /purchase-orders | 0.25 s / 2.1 MB, newest 500 only | 0.04 s / 213 kB per 50 POs (4.5 kB gzip), all reachable |
| peak RSS (bench run) | 0.40 GB | 0.18 GB |

### Verification
backend tsc + jest 119 + e2e 51/51 (fresh perf_t3_test; 5 new list tests), fresh migrate deploy + empty diff (7 trgm
indexes present); frontend tsc, eslint 0 errors, vitest 169 (4 new), next build, Playwright 15/15 (new 08-paged-lists).

### Follow-ups (not done)
- Payables page still builds bills in the browser from /purchase-orders?limit=1000 (server cap 500) +
  /payables/vouchers?limit=200: with > 500 POs or > 200 vouchers the bills / paid amounts are incomplete. Needs the
  page moved to the server's /payables/bills (0.64 s on perf_load) after checking it computes the same figures.
- supplier-return-service fetchPurchaseOrders (supplier returns page, payables) has the same 500 cap.
- POS debt modal and the orders page credit history still use fetchDebtRecords (every debt, 100 per request).
- ClientDbSync downloads the full customer list every 15 s on every screen (now 1.2 MB / 23 kB gzip) and the
  catalogue delta; a per-customer refresh would remove the first.
- /claims?limit=500 on the orders page (claims by bill number) is still a bounded download.
