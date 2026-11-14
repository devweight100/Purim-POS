# Perf round — progress notes (delete a task's section when it is fully done)

## Task 1: reports computed in the database — IN PROGRESS

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

### Plan
1. [x] `backend/src/reports/report-sql.ts`: SQL equivalents of report-tabs.ts (sales by Bangkok day, VAT, best sellers,
       payments + shifts stats, customers, inventory, purchases, claim accounting), row guard (400 Thai message).
2. [x] `reports.service.ts` getReportTabs uses them; paging params (page, limit, q, sort, list); dashboard inventory snapshot in SQL;
       /reports/analytics guarded by the row limit.
3. [x] P&L (planning.service) claims / write-off / ledger sums in SQL.
4. [x] e2e parity test adapted to paging (fetch all pages) + new tricky-dataset test (old JS == new SQL).
5. [x] Frontend ReportsView: server paging/search for bestsellers, inventory, customers; export fetches all pages.
6. [ ] EXPLAIN ANALYZE -> indexes (migration 20261123000000_report_indexes + @@index).
7. [ ] After-measurements, full verification, PROJECT_STATUS entry.

### Decisions / findings
- Legacy quirks kept: PENDING orders count as sales in /reports/tabs (only VOIDED/REFUNDED excluded); orders without payments
  count as CASH; customers' averageTicket is unrounded for 1 bill and Math.round for more; debt-by-name fallback.
- Removed from the response (never read by the page, unbounded): `payments.shifts.list`, `customers.unpaidDebtsList`.
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
- Purchases tab stays in Node (PO rows bounded by the row guard; claims list = getAllClaims(1, 5000) as before).
