# POS price level bug + start-of-bill customer / price choice (owner, 2026-11-23)

Branch ccr-8f8b0741-si1a0o (base 421fea7 = origin/main).

## Findings (code read on 421fea7)
- **The POS never priced by level.** `cart-store.addItem` takes `unit.price`; `toStoreProduct` builds every unit
  price from ราคา 1 only (`priceLevel1 || price || basePrice`, a pack without its own ราคา 1 even fell back to the
  BASE price, not base x pack size); `calculateSmartRollupAndPricing` re-prices every line from those level-1 unit
  prices; `setCustomer(id, name)` stores no level and re-prices nothing. `git log -S priceLevel` on the POS files:
  the level was only ever displayed ("ระดับราคา N" next to the customer), never applied.
- Customer data is fine: `profile.priceLevel` reaches the screens (`normalizeCustomerRow` merges profile; paged list
  + delta sync both send it). Not a field-name mismatch. But the customer list lives in memory only, so after a
  reload offline the POS cannot even look the level up -> the level must be kept in the persisted cart.
- Catalogue is fine: `/products` + `/products/sync` + IndexedDB rows carry priceLevel1-5 and pack priceLevel1-5.
- Server checkout: the "price floor" is the LOWEST of all levels (+ packs, wholesale): a walk-in can be sold at ราคา 3
  by anyone, and a product with no price at all has no floor (0 accepted). No level stored on the order.
- Online shop: own rule (`shopUnits`: level -> retail, capped at retail) - not shared with the POS.
- Online-order lines loaded into the POS (agreed prices) are re-priced by the rollup to ราคา 1 when another item is
  added (customPrice null) - same root (the rollup owns every non-manual price).

## Reproduction on the old code (421fea7 built, fresh DB, `e2e/29-pos-price-level.spec.ts`, log scratchpad pos-level/before-run.txt)
10/10 paths fail, each on a price:
| path | expected | old POS |
|---|---|---|
| (a) level-2 member first, then scan | dish 18, tape (only ราคา 3) 30, total 98 | 20, **0.00**, total 70 |
| (b) items first, then member | 18 | 20 |
| (c) member 2 -> 3 -> clear | 18 / 16 / 20 | 20 |
| (d) pack barcode, level 2 / 3 | 100 / 96 (16 x 6) | 110 |
| (e) 7 scans -> pack + piece | 100 + 18 | 110 + 20 |
| (f) held bill recall | 18 | 20 |
| (g) reload, customer list unreachable | 18 | 20 |
| (h) quick-created level-3 member | 16 | 20 |
| (i) bundle at level 2 | 90 | 100 |
| (j) manual price + member change | manual 45 kept, dish 16 | (dish 20) |
Screenshot: scratchpad `pos-level/before/cart-level2-member.png` (level-2 member, ฿0.00 line, total ฿70.00).

## Root causes
1. **POS never applied the level** (the real bug): every cart price came from ราคา 1 (`addItem` -> `unit.price`; the
   roll-up re-priced every line from level-1 unit prices; `setCustomer` stored no level and re-priced nothing). The
   member's level was only shown as a label.
2. **Unit prices from the catalogue were wrong when ราคา 1 is empty**: base unit 0 (product with only ราคา 2/3), pack
   without its own ราคา 1 = the BASE price (not base x size).
3. **Server checkout did not know the bill's level**: it accepted any price >= the lowest of ALL levels (a walk-in
   could get ราคา 3 from anyone) and had no floor for a product without prices (0 accepted).
4. **Level lost offline / after reload**: the customer list is memory-only, so even a level-aware cart could not look
   the member up after a reload with the server unreachable -> the level has to live in the persisted cart.
5. (Found on the way) online-order lines (agreed prices) were re-priced to ราคา 1 by the roll-up when another item
   was added.
Not causes (checked): profile.priceLevel vs customer.priceLevel (both paths merge the profile), customer delta sync /
paged API (they send the profile), light catalogue / price columns (priceLevel1-5 + pack priceLevel1-5 are sent and
cached in IndexedDB), the start chooser (`/start` is the POS / back-office chooser, it has no customer).

## Fix
- `shared/src/price-level.ts` (one rule, used by the POS cart, the checkout validation and the online shop `shopUnits`):
  level L -> price L if > 0, else price 1, else first non-zero of 2 -> 3 -> 4 -> 5; never 0 (no price = `null`). Packs:
  own price per level, else base price of that level x size (capped at the pack's own ราคา 1, so a pack that is
  cheaper than its pieces stays cheapest); same rule over those candidates.
- Cart (`cart-store.ts`, `cart-pricing.ts`, `lib/pos/price-level.ts`): bill `priceLevel` + `levelChosen` (persisted,
  kept in held bills); each line keeps `levelPrices` (its 5 candidates) and the `priceLevel` it is charged at, so it
  re-prices even when the catalogue is not loaded. `setCustomer(id, name, level)` (level looked up in the customer
  list when not given), `setWalkInLevel`, `setMemberLevel` (POS follows a level change made on the customers page)
  re-price every line. Manual price (F4) and agreed online-order prices (`fixedPrice`) are never touched; a line with
  an item discount keeps its discount and follows the level.
- Catalogue unit prices (`toStoreProduct`): shared rule at level 1 (pack fallback base x size; ราคา 2/3-only products
  show their price). Product cards, the unit picker and the list search show the bill-level price.
- Server (`orders.service.ts`): expected price = shared rule at the bill level (member: the member's own level from
  the database, whatever the client says; walk-in: `priceLevel` of the payload), lowered by an applicable wholesale
  step or the agreed online-order price. Below it, or a product without any price: same path as the old price floor
  (POS_DISCOUNT / manager pass; others -> approval BELOW_PRICE_FLOOR, reject without rules); a 0 for an unpriced
  product is refused even when the approval rule is off. Service lines (ค่าส่ง) are not checked. A higher price is
  accepted (not a discount). `orders.price_level` stores the level (migration `20261207000000_pos_price_level`).
- Every POS add goes through `lib/pos/pos-add.ts addToCart`: no price at any level -> shared ask dialog
  "สินค้านี้ยังไม่ได้ตั้งราคา" (not added); users allowed to override get "ใส่ราคาเอง" (manual line, checkout rules).
- Indicator: "ราคา: ส่ง" next to the member (classic + list layout); a line charged at another level shows
  "ราคา: ปลีก" (amber); a manual line "ราคาที่แก้เอง". Receipts (slip + A4) and the orders detail show the level name
  when it is not ราคา 1.

## Feature: start-of-bill customer / price choice
- Setting ตั้งค่า > การขายและใบเสร็จ "เลือกลูกค้าก่อนเริ่มบิลทุกครั้ง" (`store_settings.pos_ask_customer_at_start`,
  default off; mirrored to the POS offline cache).
- On: the first item of a new bill (empty cart, nothing chosen yet; also after pay / clear / hold) opens the dialog;
  that item - and any item scanned while it is open - waits and goes in after the choice. Search box focused: type,
  ↑/↓, Enter picks a member; Enter on an empty search or Esc = ลูกค้าทั่วไป · ราคาปลีก; Alt+1..5 or Tab to the big
  buttons "ลูกค้าทั่วไป · <level name>" (shop's `levelNames`, the levels some product uses; 1-3 on a shop without
  any level prices yet).
- Off (and always): walk-in level select next to "ลูกค้าทั่วไป" on the cart, and walk-in level buttons in the member
  window (Ctrl+M), which also clear a member.
- Decision on permission: every cashier may choose a walk-in level by default (the owner's "price level without
  knowing the customer's name" is a daily cashier action); new setting "ขายราคาส่ง (ราคา 2-5) ให้ลูกค้าทั่วไป
  ต้องมีสิทธิ์ให้ส่วนลด" (`walk_in_level_needs_discount`, default off). On: the buttons are disabled for users without
  POS_DISCOUNT, the server checks such a bill at ราคา 1, and giving a member ราคา 2-5 (quick-create / edit) needs
  POS_DISCOUNT too (otherwise a new member would be the way around it).
- Level names / used levels come with GET /settings (public, cached offline), so the dialog works offline and in the
  desktop app (it loads the same web UI).

## Decisions
- A typed level price above retail is used as typed (owner rule "price L if > 0"); the old shop cap at retail is gone.
  Only a DERIVED pack price (base x size) is capped at the pack's own ราคา 1.
- A product with only ราคา 2/3 is now sold to retail customers too (first non-zero), in the POS and the LINE shop
  (before: POS sold it at 0, the shop hid it).
- Server trusts the member's level from the database, not the client; walk-in level from the client (validated 1-5).
- Prices above the expected level price are accepted.

## Done
- [x] shared rule + unit tests (`shared/test/price-level.spec.ts`, shop spec updated)
- [x] cart / catalogue / gate / indicator / walk-in level / start dialog / settings / receipts / orders detail
- [x] server validation + `orders.price_level` + settings columns + customer level permission
- [x] backend unit (`price-floor.spec.ts` -> expected price), checkout-guards, e2e (5 new cases)
- [x] vitest `cart-price-level.test.ts` (12)
- [x] Playwright `e2e/29-pos-price-level.spec.ts` (16): paths (a)-(j) (all fail on 421fea7, see above), indicator,
      walk-in level, 0-price popup (cashier / manager), start dialog on/off by keyboard, setting, list layout
- [x] screenshots: scratchpad `pos-level/before/*.png`, `pos-level/after/*.png`
- Fixed on the way: list layout member bar printed a stray "0" when the member had no debt.
