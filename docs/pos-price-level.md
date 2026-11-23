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
