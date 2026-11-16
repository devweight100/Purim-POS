# Online shop from LINE (LIFF) — plan, decisions, progress

Branch `ccr-8f8b0741-si1a0o`. Owner request 2026-11-16. A later agent: read this file first, continue from "Next".

## Decisions (owner + implementation)
- Customers open "🛒 สั่งของ" in the LINE OA rich menu -> LIFF page `https://<shop domain>/shop`. No signup / password.
- Exposure: Cloudflare Tunnel on the server PC. ONLY `/shop/*`, `/api/public/shop/*` and the static files they need are reachable through it. Enforced in 3 layers (see "Tunnel isolation").
- Pickup (fee 0) or delivery. Delivery fee per customer: `customers.profile.deliveryFee` ("ค่าส่ง", edited on the customer page). Linked member without a fee / guest: "ร้านจะแจ้งค่าส่ง" (null) — staff sets it when accepting. Staff may change the fee when accepting.
- Fee on the bill: a system service product "ค่าส่ง" (SKU `SYS-DELIVERY-FEE`, `products.is_service = true`): a normal bill line, never touches stock (checkout / void / returns skip FIFO + stock logs), left out of stock filters / counts and of the shop catalogue. The cashier can also add it to any POS sale. Receipts / reports show it as a line "ค่าส่ง" (revenue, cost 0).
- Prices: guests see price level 1 (ราคาปลีก). A LINE account linked to a member sees the member's price level (customers.profile.priceLevel). Level names configurable (default 1 ปลีก, 2 ส่ง, 3 ส่งพิเศษ). Pack / case price for level N = the pack's level-N price, else base level-N x factor, never above the level-1 price of that unit (shared `shared/src/online-shop.ts`).
- Linking: customer types a phone number -> link request -> staff approves (choosing / creating the member) -> linked. Never automatic.
- Catalogue: every active non-service product. "มีของ" / "หมด" only (no numbers); out of stock cannot be added. Units: base + packaging units (ชิ้น / แพค / ลัง) with their price.
- Prices are always computed on the server when the order is placed; client prices ignored.
- Accepting an order makes it payable in the POS: the POS "บิลพัก" sheet lists accepted online orders (server-side, every terminal), "เปิดบิล" loads the items (agreed prices) + ค่าส่ง line + customer into the cart with `onlineOrderId`; checkout links the POS bill (`online_orders.pos_order_id`). Pickup orders become เสร็จ when paid; delivery orders stay until staff marks กำลังส่ง / เสร็จ. Voiding that POS bill unlinks it.
- Status: NEW (ใหม่) -> ACCEPTED (รับแล้ว) -> PREPARING (เตรียมของ, optional) -> DELIVERING (กำลังส่ง, optional) -> DONE (เสร็จ) / CANCELLED (ยกเลิก, with reason).
- Permissions: online orders page + accept / edit / reject = `POS_SELL` (cashiers do this); price below the computed price needs the usual checkout approval at payment time; approving LINE links = ADMIN / MANAGER or `POS_DISCOUNT` (it grants prices). LINE settings = ADMIN only.
- LINE config in a new table `online_shop_config` (single row): enabled, LIFF ID, LINE Login channel ID (ID-token verification), Messaging API channel access token (write-only, never returned), public base URL, pickup / delivery switches, notice, level names. Not configured -> on LAN / localhost the page offers a test profile ("โหมดทดสอบ"); through the tunnel the page says the shop is not open.
- Session: `POST /api/public/shop/session` with the LIFF ID token -> verified by LINE's verify endpoint -> our own HMAC session token (7 days). Dev profile only when LIFF is not configured AND the request is not public.
- LINE push (if a token is configured): order received, accepted (total + PromptPay QR PNG with amount locked when the default bank account has a PromptPay ID, served at `/api/public/shop/qr/...png` signed link, + link to the order page), rejected (reason), delivering, done. Not configured -> skipped; the order shows "ไม่ได้ส่ง LINE (ยังไม่ตั้งค่า)".

## Tunnel isolation (3 layers)
1. Gateway port: backend starts a second HTTP listener on `127.0.0.1:${SHOP_GATEWAY_PORT:-3080}` that forwards only allow-listed paths (`/shop`, `/shop/*`, `/api/public/shop/*`, `/_next/static/*`, `/favicon.ico`, `/icon.svg`) to the Next server (`FRONTEND_INTERNAL_URL`, default http://127.0.0.1:3000) and marks them `x-purim-public: 1` (client copies stripped). cloudflared points at this port. Everything else 404.
2. Next `proxy.ts`: a request is public when it carries `x-purim-public`, any Cloudflare header (`cf-ray`, `cf-connecting-ip`, `cf-visitor`, `cdn-loop: cloudflare`) or its Host is the configured `SHOP_PUBLIC_HOST`; public requests may only reach the allow list, else 404.
3. Backend middleware (AppModule + first `app.use` in main.ts): public requests may only reach `/api/public/shop/*`; CORS is off for public routes.
Detection is fail-closed: anything that looks like it came through Cloudflare is public. A LAN request that spoofs those headers only restricts itself.

## Plan / done
1. [x] Schema + migration (`online_orders`, `online_order_items`, `line_link_requests`, `shop_visitors`, `online_shop_config`, `products.is_service` + seeded ค่าส่ง product), shared calculations + tests.
2. [x] Backend: exposure middleware + gateway, online-shop module (public + admin), LINE service (verify, push, PNG QR), checkout link, service product handling, customer deliveryFee validation, realtime entities. e2e.
3. [x] Frontend: root layout split (back office chrome in `(backoffice)` group), shop pages (mobile, big UI).
4. [ ] Back office: /online-orders page (badge, sound, toast), link requests, POS held-bills section, settings section (LINE), customer field ค่าส่ง.
5. [ ] Installer: Thai guide (LINE OA, LINE Developers, LIFF, domain on Cloudflare, cloudflared service) + config/script.
6. [ ] Playwright (shop mobile 390x844, back office 3 sizes), screenshots, full verification, PROJECT_STATUS.

## Next
- Step 4 (back office page, POS held-bills section, settings section, customer field). Dev servers: scratchpad/shop/seed-demo.mjs fills a demo DB.
- Backend e2e: online shop block in `backend/test/store-flow.e2e-spec.ts` (79/79 at step 2); exposure unit tests `backend/src/online-shop/public-exposure.spec.ts`.

## Setup guide
See `Installer/Server/คู่มือร้านออนไลน์ LINE (Cloudflare Tunnel).txt` (written in step 5).
