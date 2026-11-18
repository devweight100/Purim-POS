# Bug: LINE customer linked to a level-2 member still sees ราคา 1 (owner 2026-11-18, v1.5.7)

Owner: "I linked a LINE customer to a member and set the member's price to ราคา 2, but the shop still shows the
customer ราคา 1." The link was approved while the shop page was open on the phone; the level was set on the
customers page or chosen while approving.

## What was checked (fresh DB, v1.5.7 = ffb0eee)
- Server (curl): after approving with an existing level-2 member, `GET /api/public/shop/products` and `/me` answer
  level 2 at once with the SAME session token; customers page PATCH `priceLevel` 1 / 3 / "2" is read back on the next
  request (`customers.profile.priceLevel`, the key `levelOf()` reads). The session token holds only the LINE user id /
  name / picture, no level. Approval with "สร้างสมาชิกใหม่" writes `profile.priceLevel` the same way. No server cache
  keyed without the level (categoryCache holds categories only). Answers had no Cache-Control at all.
- Browser (Playwright probe on the v1.5.7 build, phone 390x844, one page kept open while staff approve):
  - link page after 25 s: still the request form, never "บัญชีนี้เป็นสมาชิกแล้ว";
  - home after client navigation: "เป็นลูกค้าประจำ? กดผูกบัญชีเพื่อดูราคาของคุณ" (the shop says: not a member);
  - cart bar: ฿200 (retail) — also AFTER A FULL RELOAD (cart prices are kept in localStorage and only the cart page
    re-quoted them);
  - product list after navigation: ฿180 (the list itself was fetched fresh).
- Products without ราคา 2: retail by design (shared `shopUnits`), but nothing told the customer or staff.

## Root causes
1. The shop page loaded the visitor (`me`: member, level) once per page load (`init` guarded by `started`);
   `refreshMe` existed but was only called after placing an order. Approval / level changes were invisible until
   LINE reloaded the page, so the page kept saying "not linked / ราคาปลีก".
2. The cart on the phone (localStorage) kept the retail prices it was filled with; the cart bar total showed them
   even after a reload, until the customer opened the cart page.
3. (Data) A product without ราคา 2 is sold to a level-2 member at ราคาปลีก, silently.
4. (Hardening) shop API answers carried no Cache-Control; a proxy / Cloudflare rule / LINE webview cache could serve a
   retail answer to a member.

## Fix
- Shop (`lib/shop/shop-store.ts`, `components/shop/ShopShell.tsx`): `refreshMe` on every page change, when the page
  comes back to the front (visibilitychange / focus / pageshow — LINE reopened), every 10 s while a link request is
  pending, and whenever the catalogue or a quote was priced at another level than the page shows (`level` in both
  answers). Shared in-flight request. A level change re-prices the cart (`repriceCart`, POST /quote); the cart is also
  re-priced when the shop opens; `useQuote` re-runs on a level change. Products page reloads on a level change.
- Shop shows the level: strip under the header "ราคาสำหรับสมาชิก: <ชื่อราคา>" (18 px, every page) and, on a product
  whose selected unit has no price at the member's level, "ราคาปลีก · สินค้านี้ยังไม่มี<ชื่อราคา>". New unit field
  `levelPrice` (members only) from `shopUnits().atLevel`. Pricing rules (fallback to retail, cap at retail) unchanged.
- Server: shop JSON answers `Cache-Control: private, no-store, max-age=0` + `Vary: Authorization` (photos stay
  `public, max-age=86400`); LINE push on approval (when a Messaging token is set): "ผูกบัญชี LINE ของคุณกับสมาชิก X
  แล้ว ราคาที่เห็นในร้านออนไลน์ตอนนี้เป็น <ชื่อราคา>" + shop link; link requests return the member's level and its shop
  name; `GET /api/online-shop/level-coverage` (any staff, counts only): products without a price at each level.
- Back office: link request buttons "ผูกกับ X (เบอร์) · ระดับราคา 2 (ราคาส่ง)" + a note; customers page (credit tab)
  note under the level tiles: what a linked LINE customer sees, that products without a price at this level use
  ราคาปลีก, and how many products have no price at this level yet. Guide updated.

## Tests
- Playwright `e2e/19-member-price.spec.ts`: (1) guest prices + cart, link request, staff approve in the back office by
  keyboard choosing the level-2 member (level shown, layout at 3 sizes), the open phone page switches to member by
  itself, strip + cart bar ฿180 without a reload, next navigation ฿180 / pack ฿1,700, retail note on a product without
  ราคา 2, cart ฿180, order placed at 180, reload; (2) linked at ราคาปลีก, level changed on the customers page (note with
  the count, 3 sizes), phone follows on the next navigation (strip, prices, cart bar), and on visibilitychange.
- Backend e2e: same-session level change (PATCH 2 / "2" / 3) -> products / me / quote at once, no-store + Vary
  headers, photos still public, `levelPrice`, level coverage counts, link request match level, LINE push on approval.
- vitest `shop-member-level.test.ts` (refreshMe + cart re-price), shared `shopUnits` atLevel cases.

## Owner: check your data
- Products used by members need ราคาระดับ 2 (หน้าสินค้า ช่องราคาระดับ 2); empty / 0 = ราคาปลีก. The customer edit
  screen shows how many products have no price at that level.
- A pack / case without its own level-2 price uses base level-2 price x pack size (never above the pack's retail).
- The level is on the member (ลูกค้าสมาชิก > แก้ไข > เครดิต & ระดับราคา); the approval buttons show it.
