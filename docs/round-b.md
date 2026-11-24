# Round B (owner items 4, 6, 8, 9, 10 + style leftovers)

Branch `ccr-8f8b0741-si1a0o`. Spec: owner list "Round B". Item 9 (price fallback) was done before this round
(`shared/src/price-level.ts`, `docs/pos-price-level.md`); here it is only checked for quotes.

## Status

| Item | State |
|------|-------|
| 4 SKU editable (create + edit, blank = generated) | done (code + tests; full-suite run at the end) |
| 6 Export filter dialog + PIN on every export | done (code + tests) |
| 8 Dashboard debtors / creditors / upcoming expenses | done (code + tests) |
| 9 Quotes use the shared price rule (check only) | checked |
| 10 LINE staff group notification + reminders | done (code + tests) |
| Leftovers: PO status chips Thai, stock-card "-:", stat tiles | done |
| Release v1.5.11 notes (no tag) | prepared |

## Decisions (safest option, owner may change)

(filled in per item below)

## 4. Product code (SKU) typed by the user

Replaces the 2026-11-18 rule "SKU = permanent system ID".
- Form (`ProductDetailsSection`): field "รหัสสินค้า" (normal input, in the Tab order), placeholder / hint
  "เว้นว่างให้ระบบสร้าง" (edit: "เว้นว่าง = ใช้รหัสเดิม"), copy button kept in the edit form. Payload sends the trimmed code.
- Server (`products.service.ts`): create keeps a typed code (whitespace collapsed, max 64), blank / missing ->
  generated internal EAN-13 (`product-sku.ts`, same format). PATCH with a different code renames; blank = keep.
  Unique against every product SKU, product barcode **and pack-unit barcode** (409 naming the other product), and
  not equal to one of the product's own barcodes in the same request. Permission unchanged (MANAGE_INVENTORY).
- Import: match id -> SKU -> barcode (unchanged). A row matched by its **system id** with another SKU renames it
  (`skuRenamed`); a row matched by barcode keeps the stored code (`skuKept`, toast explains). Preview shows
  "รหัสสินค้า: old ➔ new" for a rename.
- Decision: renaming by an import row matched only by barcode is NOT done (a typo in the code column could silently
  rename a product); only the id column (exported files have it) renames.
- Tests: backend e2e block "product code (SKU): typed by the user ..."; vitest `product-sku.test.ts`; Playwright
  `20-product-sku`.

## Leftovers from the style pass

- PO status in Thai everywhere on the PO page: chips / tabs / status dialog / toasts ร่าง, ออกแล้ว, รับบางส่วน,
  รับครบ, ยกเลิก (`PoStatusBadge.tsx` `PO_STATUS_TH`).
- Stock card dialog: the server sends `referenceNo: "-"` for movements without a document; the dialog showed "-:"
  before the reason. Now the prefix is shown only for a real document number.
- Stat tiles: one style from tokens (`.stat-tile*` in `globals.css`, docs/ui-style.md "Stat tiles") on orders, debts,
  payables, claims, claim inventory, supplier returns, shifts and the 6 report tabs (46 tiles). Decision: values are
  primary text; red only for owed / overdue / voided / negative figures (colour = meaning rule). 4 tiles per row
  from a 1280 px window, 2 below (labels no longer wrap word by word at 1093x614).
- Shifts history (found by the screenshots at 1093x614, also before this round): long cashier names and the
  "สด | อื่นๆ" line pushed the table 38 px past the window; the name now wraps and the line is two lines.

## 6. Exports: filter dialog + manager PIN on every export

- Server (`backend/src/exports`): `POST /exports/approve { kind, filters, pin }` checks the PIN against active
  ADMIN / MANAGER users (bcrypt; throttled like the POS approval PIN, key `export-pin:<ip>`, 5 failures = 15 min),
  and that the requester may export that kind. It writes an `approval_requests` row (type `DATA_EXPORT`, APPROVED,
  channel PIN) bound to requester + kind + exact filters (sha256), valid **2 minutes**, single use.
  `POST /exports/products | report | profit-loss` need header `x-export-approval`; without a valid approval ->
  403 `EXPORT_APPROVAL_REQUIRED`. The approval becomes USED and `audit_logs` gets `DATA_EXPORT` (user, approver,
  kind, filters, row count). The approvals page lists these rows too ("ส่งออกข้อมูล: ...").
- Products: "ส่งออก Excel (.xlsx)" opens a filter dialog (categories multi-select incl. "ไม่มีหมวดหมู่" with search,
  stock ทั้งหมด / มีสต็อก / ใกล้หมด / หมด, status ทั้งหมด / ใช้งาน / ปิดใช้งาน, supplier). Filters are applied by the
  server (`products.service.ts page()` gained `categoryIds`, `stock=instock|nostock`). Same file format as before.
- Reports (6 tabs, Excel / CSV): the rows now come from `/exports/report` (every row of the tab in one answer).
- Finance P&L CSV: figures from `/exports/profit-loss`.
- PIN dialog (`components/common/ExportPinHost.tsx`, `lib/export-approval.ts`): keyboard-first (PIN field focused,
  Enter = approve, Esc = cancel), shows what is exported, error inline.
- Decisions: (a) "manager / admin PIN" = role ADMIN or MANAGER (not the APPROVE_OVERRIDES permission); a manager
  exporting types their own PIN (re-confirmation), a cashier needs a manager's. (b) The app has no other data
  exports today (customers / suppliers / orders / debts / payables / inventory lists have no export button; the
  inventory figures export through the report tab). A future export must use `approvedExport()` + an
  `/exports/<kind>` endpoint. (c) Printing / PDF is not an export (unchanged). (d) The import template download has
  no data, no PIN.

## 8. Dashboard: debtors, creditors, expenses due soon

- Server `GET /dashboard/obligations?days=` (VIEW_REPORTS, `backend/src/finance/obligations.service.ts`), one source:
  - creditors: supplier bills payable now = the payables page rule (received value - paid, capped by the PO's
    remaining; e2e checks the total equals `/payables/bills` summary.totalOutstanding). Due = PO due date, else bill
    date + supplier credit terms (30) - the cash forecast rule. Overdue = due day before today (Bangkok). Per
    supplier: bills, owed, overdue amount, oldest due.
  - upcoming: recurring expenses due up to today + N days (overdue ones included) and supplier bills due in that
    window or overdue; each item has a link (`/finance?view=recurring`, `/payables?search=<PO no.>`).
  - N = new setting `store_settings.dashboard_due_days` (default 7, 1-90; ตั้งค่า > การเงิน > "แดชบอร์ด:
    ค่าใช้จ่ายใกล้ถึงกำหนด").
- Dashboard: new row of 3 panels under the KPI cards ("ลูกหนี้เกินกำหนด" from `/debts/owing-customers?overdue=1`,
  "เจ้าหนี้ (ค้างจ่ายผู้จำหน่าย)", "ค่าใช้จ่ายใกล้ถึงกำหนด"); rows are links (Tab / Enter) to the customer's debts, the
  payables page filtered by supplier, the payables page searched by PO number, the finance recurring tab.
  "ดูทั้งหมด" of the debtors panel opens the existing credit-customers dialog with "เฉพาะที่เกินกำหนด" on.
- Payables page reads `?search=` / `?supplierId=`; finance page reads `?view=`.
- Decision: supplier bills appear in both the creditors panel (what is owed) and the upcoming panel (what falls due
  in N days / is overdue), because the owner asked for "unpaid bills due within N days" there.

## 10. LINE staff group: new online order alert + reminders

- Migration `20261208000000_round_b` (additive): `online_shop_config.channel_secret / staff_group_id /
  back_office_url`, table `line_groups`, `online_orders.staff_alert_next_at / staff_alert_count` (+ index), table
  `online_order_line_logs`.
- Webhook `POST /api/public/line/webhook` (`line-webhook.controller.ts`, `line-staff.service.ts`): the raw body is
  kept (`captureLineRawBody` in main.ts) and `X-Line-Signature` = base64 HMAC-SHA256(channel secret) is checked
  (timing-safe); no secret / bad signature -> 401. Group events (join, message, member joined ...) record the group
  (name from `GET /v2/bot/group/{id}/summary`); `leave` marks it left. LINE's "Verify" (empty events) -> 200.
- Exposure: `shared/src/public-exposure.ts` allows exactly `/api/public/line/webhook` besides the shop (gateway 3080,
  Next proxy, backend middleware all use it; unit test checks neighbours like `/api/public/line/other` stay 404).
- Settings (ADMIN): ตั้งค่า > ร้านออนไลน์ > card "แจ้งเตือนกลุ่มพนักงานใน LINE": channel secret (write-only),
  back-office address for the link (default: this server's LAN IP + port 3000), detected groups with a radio
  "ใช้แจ้งเตือน" and "ส่งข้อความทดสอบ", "ปิดการแจ้งเตือนกลุ่ม". APIs `GET /online-shop/line/groups`,
  `POST /online-shop/line/groups/:groupId/test`, `PUT /online-shop/config { channelSecret, staffGroupId, backOfficeUrl }`.
- Alerts: `placeOrder` sets `staff_alert_next_at = now`; `runDue()` (timer every 60 s + once 5 s after start, so a
  restart continues) sends the new-order message (order no., customer + phone, item count, total, pickup /
  delivery, back-office link `/online-orders?id=`), then while the order is still NEW and unclaimed a reminder every
  10 minutes, at most 6 ("เตือนครั้งที่ n/6 ... รอมา m นาที"). Claimed / accepted / cancelled -> the next run clears
  the schedule without sending. Each send is taken with a conditional update (never twice). Every result goes to
  `online_order_line_logs` and shows in the order detail ("แจ้งกลุ่มพนักงาน n ครั้ง").
- Quota: the month's quota (`/v2/bot/message/quota` + `/consumption`, cached 10 min) is checked before a send; when
  used up nothing is sent and the log says so. At most 7 pushes per order.
- Tests: e2e block "LINE staff group ..." with a local mock of api.line.me (never the real API): signature,
  tunnel path, group pick, test message, alert + 6 reminders with a fake clock and a fresh service instance
  (restart), stop on claim, quota full, no group chosen.
- Decisions: "accepted/claimed" = status no longer NEW or a staff member claimed it (claim lock). If no group / no
  token is set, the order logs "ไม่ได้แจ้งกลุ่มพนักงาน (...)" and no reminders are scheduled (choosing a group later
  does not alert old orders). The link points at the LAN back office (the back office is never exposed).

### Owner steps (LINE)
In `Installer/Server/คู่มือร้านออนไลน์ LINE (Cloudflare Tunnel).txt` "ขั้นที่ 7" (Thai): copy the Channel secret,
set Webhook URL `https://shop.purimtoy.com/api/public/line/webhook`, turn on "Use webhook", enable "Allow bot to join
group chats", paste the secret in settings, Verify, invite the bot to the staff group and type a message, pick the
group, "ส่งข้อความทดสอบ". The Cloudflare tunnel itself needs no change (same hostname -> localhost:3080); the server
must run v1.5.11 so the gateway lets the webhook path through.

## 9. Price fallback in quotes (check only)

The app has no separate quotation document; the "quote" is the online shop cart check `POST /api/public/shop/quote`.
It prices through `priceLines()` -> `shopUnits()` (`shared/src/online-shop.ts`) -> `pickLevelPrice` /
`productUnitPrices` of `shared/src/price-level.ts`, the same rule as the POS and checkout (shared tests
`shared/test/online-shop.spec.ts` "a level without prices = retail ... first non-zero of ราคา 2 -> 5"; backend e2e
"quote" calls). No change needed.

## Release v1.5.11 (prepared, not tagged)

- Versions: the release version comes from the git tag (`release.yml`: tag v1.5.11 -> app version 1.5.11); the
  only version kept in the repo is `desktop/package.json` (default of local `Installer/build-installers.*`), bumped
  1.4.2 -> 1.5.11. Backend / frontend package.json versions are not used for releases (unchanged).
- Thai release notes: `docs/release-notes/v1.5.11.md`; `release.yml` now publishes `docs/release-notes/<tag>.md`
  as the release text when it exists (else GitHub's generated notes as before).
- To ship: `git tag v1.5.11 && git push origin v1.5.11` from main after the merge (coordinator / owner).
