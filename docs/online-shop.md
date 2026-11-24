# Online shop from LINE (LIFF) — plan, decisions, progress

Branch `ccr-8f8b0741-si1a0o`. Owner request 2026-11-16. A later agent: read this file first, continue from "Next".

## Decisions (owner + implementation)
- Customers open "🛒 สั่งของ" in the LINE OA rich menu -> LIFF page `https://<shop domain>/shop`. No signup / password.
- Exposure: Cloudflare Tunnel on the server PC. ONLY `/shop/*`, `/api/public/shop/*` and the static files they need are reachable through it. Enforced in 3 layers (see "Tunnel isolation").
- Pickup (fee 0) or delivery. Delivery fee per customer: `customers.profile.deliveryFee` ("ค่าส่ง", edited on the customer page). Linked member without a fee / guest: "ร้านจะแจ้งค่าส่ง" (null) — staff sets it when accepting. Staff may change the fee when accepting.
- Fee on the bill: a system service product "ค่าส่ง" (SKU `SYS-DELIVERY-FEE`, `products.is_service = true`): a normal bill line, never touches stock (checkout / void / returns skip FIFO + stock logs), left out of stock filters / counts and of the shop catalogue. The cashier can also add it to any POS sale. Receipts / reports show it as a line "ค่าส่ง" (revenue, cost 0).
- Prices: guests see price level 1 (ราคาปลีก). A LINE account linked to a member sees the member's price level (customers.profile.priceLevel). Level names configurable (default 1 ปลีก, 2 ส่ง, 3 ส่งพิเศษ). Prices follow the one shared rule of the POS and the checkout (`shared/src/price-level.ts`, docs/pos-price-level.md): level N price, else ราคา 1, else the first of ราคา 2-5; a pack's own level price, else base level x factor (a derived pack price never above the pack's own ราคา 1).
- Linking: customer types a phone number -> link request -> staff approves (choosing / creating the member) -> linked. Never automatic.
- Member level on the open page (owner bug 2026-11-18, `docs/bugfix-member-price.md`): the page re-reads who the visitor is on every page change, when LINE brings it back, every 10 s while a link request waits, and when the server priced at another level; a level change re-prices the cart. Strip "ราคาสำหรับสมาชิก: <ชื่อ>"; a unit without a price at the member's level shows "ราคาปลีก · สินค้านี้ยังไม่มี<ชื่อ>" (`levelPrice`). Shop answers are `no-store`. LINE push when a link is approved.
- Catalogue: every active non-service product. "มีของ" / "หมด" only (no numbers); out of stock cannot be added. Units: base + packaging units (ชิ้น / แพค / ลัง) with their price.
- Prices are always computed on the server when the order is placed; client prices ignored.
- Accepting an order makes it payable in the POS: the POS "บิลพัก" sheet lists accepted online orders (server-side, every terminal), "เปิดบิล" loads the items (agreed prices) + ค่าส่ง line + customer into the cart with `onlineOrderId`; checkout links the POS bill (`online_orders.pos_order_id`). Pickup orders become เสร็จ when paid; delivery orders stay until staff marks กำลังส่ง / เสร็จ. Voiding that POS bill unlinks it.
- Status: NEW (ใหม่) -> ACCEPTED (รับแล้ว) -> PREPARING (เตรียมของ, optional) -> READY (จัดเสร็จ รอรับเงิน/รอส่ง, set by "จัดของเสร็จ", 2026-11-17) -> DELIVERING (กำลังส่ง, optional) -> DONE (เสร็จ) / CANCELLED (ยกเลิก, with reason). Payable (open as a POS bill): ACCEPTED / PREPARING / READY / DELIVERING.
- Permissions: online orders page + accept / edit / reject = `POS_SELL` (cashiers do this); price below the computed price needs the usual checkout approval at payment time; approving LINE links = ADMIN / MANAGER or `POS_DISCOUNT` (it grants prices). LINE settings = ADMIN only.
- LINE config in a new table `online_shop_config` (single row): enabled, LIFF ID, LINE Login channel ID (ID-token verification), Messaging API channel access token (write-only, never returned), public base URL, pickup / delivery switches, notice, level names. Not configured -> on LAN / localhost the page offers a test profile ("โหมดทดสอบ"); through the tunnel the page says the shop is not open.
- Session: `POST /api/public/shop/session` with the LIFF ID token -> verified by LINE's verify endpoint -> our own HMAC session token (7 days). Dev profile only when LIFF is not configured AND the request is not public.
- LINE push (if a token is configured): order received, accepted (total + PromptPay QR PNG with amount locked when the default bank account has a PromptPay ID, served at `/api/public/shop/qr/...png` signed link, + link to the order page), rejected (reason), delivering, done. Not configured -> skipped; the order shows "ไม่ได้ส่ง LINE (ยังไม่ตั้งค่า)".

## Tunnel isolation (3 layers)
1. Gateway port: backend starts a second HTTP listener on `127.0.0.1:${SHOP_GATEWAY_PORT:-3080}` that forwards only allow-listed paths (`/shop`, `/shop/*`, `/api/public/shop/*`, the exact LINE webhook `/api/public/line/webhook` (Round B), `/_next/static/*`, `/favicon.ico`, `/icon.svg`) to the Next server (`FRONTEND_INTERNAL_URL`, default http://127.0.0.1:3000) and marks them `x-purim-public: 1` (client copies stripped). cloudflared points at this port. Everything else 404.
2. Next `proxy.ts`: a request is public when it carries `x-purim-public`, any Cloudflare header (`cf-ray`, `cf-connecting-ip`, `cf-visitor`, `cdn-loop: cloudflare`) or its Host is the configured `SHOP_PUBLIC_HOST`; public requests may only reach the allow list, else 404.
3. Backend middleware (AppModule + first `app.use` in main.ts): public requests may only reach `/api/public/shop/*` and `/api/public/line/webhook` (X-Line-Signature checked with the channel secret, else 401); CORS is off for public routes.
Detection is fail-closed: anything that looks like it came through Cloudflare is public. A LAN request that spoofs those headers only restricts itself.

## Plan / done
1. [x] Schema + migration `20261201000000_online_shop` (`online_orders`, `online_order_items`, `line_link_requests`, `shop_visitors`, `online_shop_config`, `products.is_service`), shared rules `shared/src/online-shop.ts` + `shared/src/public-exposure.ts` with tests (`shared/test/online-shop.spec.ts`, `public-exposure.spec.ts`). The ค่าส่ง product is created on first use (`OnlineShopService.ensureDeliveryProduct`), not by the migration.
2. [x] Backend `backend/src/online-shop/`: `public-exposure.ts` (middleware in AppModule + first `app.use` in main.ts, gateway port), `online-shop.controller.ts` (public `/api/public/shop/*`: config, session, me, categories, products, images, quote, orders, orders/:id, cancel, link, qr png; staff `/api/online-shop/*`: counts, orders list/detail/edit/accept/reject/status/pos, link-requests + decide, customers/:id/line, unlink, config GET/PUT + test-line), `line.service.ts` (verify / push / bot info; `LINE_API_BASE` env for tests), `shop-session.ts` (HMAC session + rate limiter), `qr-png.ts` (PNG encoder), `online-order-payment.ts` (checkout link / void unlink). Checkout: `onlineOrderId`; service products skip FIFO / stock logs (checkout, void, returns) and stock filters / counts / valuation. Customer `deliveryFee` validated in the customers controller (profile JSON). Realtime entity `onlineOrder`.
3. [x] Frontend: root layout is now minimal; back office chrome (Providers, ClientDbSync, document search, AuthGuard) moved to `app/(backoffice)/layout.tsx` (all old routes moved into that group, URLs unchanged). Shop: `app/shop/*` (+ `components/shop/*`, `lib/shop/*`). `proxy.ts` runs on every request and 404s public requests outside the allow list.
4. [x] Back office: `/online-orders` (+ `components/online-orders/*`), sidebar item + badge, `OnlineOrderWatcher` (toast + chime, in back office layout and POS), POS held-bills sheet section + "บิลพัก (n)" button on the classic POS when the cart is empty, cart `onlineOrderId` (persisted, held bills keep it), settings tab `online` (ADMIN), customer form `CustomerOnlineFields`.
5. [x] Installer: `Installer/Server/คู่มือร้านออนไลน์ LINE (Cloudflare Tunnel).txt`, `Installer/Server/setup/setup-cloudflare-tunnel.ps1` (remotely-managed tunnel token -> Windows service, SHOP_PUBLIC_HOST in backend/.env, gateway self-check), `purim-server.js` passes SHOP_PUBLIC_HOST to Next. Not added to the server control app (ServerControl.cs) — the script + guide are enough for a one-time setup.
6. [x] Tests: backend e2e block "online shop (LINE LIFF)" in `backend/test/store-flow.e2e-spec.ts` (9 tests), jest `public-exposure.spec.ts`, vitest `online-order-cart.test.ts`, Playwright `frontend/e2e/15-online-shop.spec.ts` (4 tests). Verification (2026-11-16): backend jest 159, e2e 79/79, frontend vitest 213, eslint 0 errors, next build, Playwright 45/45, empty migration diff.

## Claim lock + picking slip (owner request 2026-11-16, round 2)
Owner: "cashier 1 and cashier 2 both see it, both go pick the goods" -> one staff member prepares an order; and a
picking slip "ใบจัดของ" (names, units, quantities, customer; NO prices).

### Claim lock (backend `online-order-claim.ts`)
- Columns (migration `20261202000000_online_order_claim`): `claimed_by_id` (FK users, SET NULL), `claimed_at`,
  `pos_terminal_id`, `pos_opened_at`, `picking_print_count`, `picking_printed_at`.
- Claim = ONE conditional `UPDATE online_orders ... WHERE status open AND (claimed_by_id IS NULL OR = me)`; PostgreSQL
  re-checks the WHERE after a concurrent commit, so of two cashiers pressing at once exactly one wins; the other gets
  409 `ONLINE_ORDER_CLAIMED` with `claimedBy {id, name}`, `claimedAt`, `canTakeOver`.
- `POST /online-shop/orders/:id/claim` ("รับจัดออเดอร์นี้"; `{takeover:true}` = ADMIN / MANAGER take it over, audit log
  `ONLINE_ORDER_TAKEOVER` with from / to), `POST .../release` ("ปล่อยงาน": holder; managers may release anyone's, audit
  `ONLINE_ORDER_RELEASE`), `POST .../picking-slip` (claims, counts prints, returns the slip data without prices).
- Since 2026-11-17 (round 3 below) the claim covers the PICKING phase only. Picking actions claim automatically when
  nobody holds the order and are refused (409) while someone else does: edit (items / qty / price / fee / member),
  accept, reject, picking slip, status "เตรียมของ", "จัดของเสร็จ". Reject / cancel / done (also a pickup order finished
  by its payment), "จัดของเสร็จ" and กำลังส่ง release it. The customer cannot cancel from LINE once a staff member
  holds the order.
- One POS bill per online order: `POST .../pos` (was GET) records the terminal (no claim: any cashier); another
  terminal gets 409 `ONLINE_ORDER_OPEN_ELSEWHERE` unless it confirms (`force`), which moves the bill there. Checkout
  (`linkOnlineOrder`) refuses an order moved to another terminal and links with ONE conditional
  `UPDATE ... WHERE pos_order_id IS NULL`: of two simultaneous checkouts the second changes no row and is rolled back
  (409). A retry of the same bill (same clientOrderId) returns the bill. The payment never claims the order.

### Progress
1. [x] Backend claim lock + one-bill link + picking slip data; e2e block "claim lock + one POS bill per online order"
   (concurrent claim, refusals, manager takeover audit, reprint count, other-terminal refusal, concurrent checkout).
2. [x] Frontend: online orders page claim bar ("รับจัดออเดอร์นี้" / "ปล่อยงาน" / managers "ปลดล็อก/โอนมาที่ฉัน" with a
   confirmation), colored badge "กำลังจัดโดย <ชื่อ> · เวลา" on rows and detail (live via the realtime `onlineOrder`
   event), new unclaimed orders highlighted (amber, thick left edge, "ยังไม่มีคนจัด"); every action button stays
   visible but disabled for others, the reason is shown. POS held-bills sheet: holder shown, "เปิดบิล" disabled for
   others; opening on a second terminal asks before moving the bill.
3. [x] Tests + verification (see PROJECT_STATUS 2026-11-16 "Claim lock + picking slip").

### Round 3 (owner 2026-11-17): picking is for the picker, payment for every cashier
Owner: "Picking is for the picker. Once picking is done, every cashier can take payment and hand the goods to the
customer." Before, whoever claimed / accepted held the order until done and even the cashier taking the payment got
409 (`15-online-shop` had to press ปล่อยงาน first).
- Picking actions (claim lock, see above): claim, edit, accept, reject, picking slip, เตรียมของ, and the new
  "จัดของเสร็จ" (`POST /online-shop/orders/:id/picked`, ACCEPTED / PREPARING only, paid or not).
- "จัดของเสร็จ": status READY ("จัดเสร็จ รอรับเงิน/รอส่ง"), `picked_by_id` / `picked_at` (migration
  `20261203000000_online_order_picked`; kept for audit and shown "จัดโดย X · เวลา" on rows, detail, POS, also after
  done), ends the claim (the POS bill terminal stays). Why a status and not only the two fields: the list filter
  "จัดเสร็จ", the customer page and LINE need a state; READY sits between เตรียมของ and กำลังส่ง so the old flow is
  unchanged. LINE push when configured: pickup "ของพร้อมแล้ว มารับที่ร้านได้เลย" (+ amount when unpaid), delivery
  "จัดของเสร็จแล้ว รอนำไปส่ง". Editing the ITEMS of a READY order sends it back to รับแล้ว (picker cleared, the
  editor holds it: pick again); fee / member / note edits keep READY.
- Not claimed: open as a POS bill and checkout (any POS_SELL cashier, picked or not: customers may transfer by QR
  right after acceptance), กำลังส่ง / เสร็จ. Payment never claims. Edits after payment stay impossible.
- POS warns, never blocks: held-bills sheet row note "✓ จัดโดย X · เวลา" (green) or "ยังไม่ได้จัดของ · กำลังจัดโดย X"
  (yellow), "เปิดบิล" enabled for everyone; the cart banner shows the same note live (realtime `onlineOrder`).
  Online orders page: claim bar button "จัดของเสร็จ" (holder, or anyone when unclaimed: auto-claims; disabled with the
  reason for others), "รับเงินที่หน้าขาย" and กำลังไปส่ง / เสร็จแล้ว enabled for everyone, filter "จัดเสร็จ".
- Tests: e2e block "picking is for the picker, payment for every cashier" (B refused edit / print / picked / reject,
  B opens + pays (concurrent checkouts -> one bill, idempotent retry), READY + picker recorded, delivery steps by B,
  pay before picking, READY item edit -> re-pick); Playwright `16-claim-picking` two-cashier flow (A picks with the
  keyboard, B pays cash and hands over), `15-online-shop` without the ปล่อยงาน workaround.

### Picking slip "ใบจัดของ"
- Nothing like it existed. One layout: `components/pos/PickingSlipView.tsx` (built from `slip-parts.tsx`, 288 CSS px
  = the receipt slip width; the desktop app prints it as an ESC/POS raster picture, 576 dots for 80 mm, the same
  layout scaled to 384 dots for 58 mm; a plain browser prints it as a picture through the print preview, like the
  receipts). Data mappers `lib/picking-slip.ts` (cart / held bill / completed bill / online order), entry points
  `lib/pos/picking.ts` and `lib/online-order-actions.ts`.
- Content: shop name (small), "ใบจัดของ", reprint marker, document no. (บิลขาย / บิลพัก / ออเดอร์ออนไลน์), date-time
  (Buddhist year), customer, online orders: "ส่ง (ร้านไปส่ง)" / "รับเองที่ร้าน" + phone + address (delivery), note;
  per line a drawn tick box, name (wraps), quantity + unit (large), line note; bundles list their parts (each with a
  tick box, quantity = per bundle x bundles x unit factor; parts from the bill snapshot, else the POS catalogue);
  "รวม N รายการ"; "ผู้จัด ____ ผู้ตรวจ ____". No prices, money totals or VAT. Service lines (ค่าส่ง: SKU
  SYS-DELIVERY-FEE or `products.is_service`) are left out.
- Where: POS cart "ใบจัดของ" button (touch: cart header; list view: bottom bar) and F8 on both screens; held-bills
  sheet per bill; POS sales history ⋯ "พิมพ์ใบจัดของ"; orders page bill detail "พิมพ์ใบจัดของ"; online order detail
  "พิมพ์ใบจัดของ" (claims the order; server counts prints, 2nd+ marked "พิมพ์ซ้ำ"). A cart / held bill that pays an
  online order prints that order's slip through the server. Reprints from history / orders page are marked "พิมพ์ซ้ำ".
- Setting: ตั้งค่า > รูปแบบใบเสร็จ (สลิป) "พิมพ์ใบจัดของอัตโนมัติหลังขาย" (`receiptOptions.slip.autoPickingSlip`,
  default off): prints the sale's slip 1.5 s after the receipt.
- Limit: the desktop raster renderer caps one picture at 30,000 dots (~2.5 m of paper at 80 mm, about 500 short
  lines); same limit as the receipts.

## Next / open
- Owner: register LINE OA + LINE Developers + domain + tunnel (guide), set PromptPay ID on the default bank, set ค่าส่ง on members, choose level names.
- Not done: customer cannot edit an order after placing it (cancel while ใหม่ and re-order); no stock reservation for online orders (stock is taken when the POS bill is paid); PromptPay QR not on printed documents; ServerControl.cs has no tunnel button.
- Rate limits are in memory (one backend process): 240 public requests / min / IP, 30 sessions / min / IP, 6 orders / 10 min / LINE user and 30 / IP, 5 link requests / hour.

## Setup guide
See `Installer/Server/คู่มือร้านออนไลน์ LINE (Cloudflare Tunnel).txt`.
