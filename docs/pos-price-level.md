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

## Plan / done
- [ ] shared `levelPrice` resolver (+ packs) used by POS cart, checkout validation, online shop
- [ ] cart: bill level (persisted, held bills), re-price on customer / level change, per-line applied level
- [ ] 0-price popup, manual price path for override users
- [ ] server: expected price per bill level, 0-price rejected, orders.price_level, walk-in level setting
- [ ] start-of-bill dialog + walk-in level choice in the customer area, settings
- [ ] receipts / orders show the level
- [ ] tests (shared, backend e2e, vitest, Playwright before/after), screenshots, PROJECT_STATUS

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
