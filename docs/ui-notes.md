# UI tidy-up round (screens and button placement) — progress notes

Branch `ccr-8f8b0741-si1a0o`. Resume from "Next" below after a rate limit / restart.

## Part A — claim search over every bill (done in code, see commits)

- Before: the claim screens (claims page "รับเคลมสินค้าใหม่", POS "สิทธิ์เคลม" customer claim stock, cart-line claim quota)
  read `GET /orders?limit=500` = the newest 500 bills of the shop, then filtered in the browser; older bills could not be claimed.
- After: `fetchClaimSearchOrders` asks `GET /orders?scope=claim&statusGroup=completed&search=<text>[&customerId=]`
  (pages of 500, newest first, at most 1,000 matching bills). The server search is a superset of what the browser rule
  matches: bill number, customer name / phone, note, product name / SKU and, in `scope=claim` only, the bundle snapshot on the
  bill line (`bundle_data`), the bundle's current parts, the walk-in name "ลูกค้าทั่วไป" (bills without customer) and
  `customerId`. `verifyClaimEligibility` (the eligibility rules) is unchanged and filters those bills as before.
- The claims-page dialog searched on every keystroke (each loading 500 bills); now 300 ms after typing stops, stale answers ignored.
- Found: `ProductClaimModal` is mounted in the POS (`PosDialogs`) but nothing opens it there (`setShowClaimModal(true)` is never
  called); the POS uses "สิทธิ์เคลม" (CustomerClaimStockModal) instead. Left as is (see "asked the owner?").
- Tests: backend e2e "claim search over every bill" (bill older than 520 newer bills found by number / phone / name / product /
  bundle part / customer; voided excluded; cashier allowed); Playwright `10-claims.spec.ts` second test.

## Part B — screens and buttons

(plan follows after the audit)
