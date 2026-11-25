# Numpads by keyboard, product form stock + layout, bank logos (owner round 2026-11-25)

Progress / decisions file (read this first when continuing).

## Owner requests
1. Every numpad (POS + back office) takes keyboard digits at once, without a click first.
2. Product form: stock quantity field (create = opening stock, edit = adjustment movement through the inventory
   adjustment service; concurrency check against the stock the user saw).
3. Product form layout by priority: name, cost, prices 1-5, barcode, SKU, stock on top (and in Tab order); the rest
   below in "ข้อมูลเพิ่มเติม"; Enter = save; first field autofocused.
4. Bank logos for receiving accounts (built-in badges + optional uploaded logo), cashier selects the receiving
   account at transfer payment (keyboard), recorded on the payment.

## Status
- [ ] 1 numpads: reproduce, root cause, fix, Playwright
- [ ] 2 product stock field: backend + e2e, frontend
- [ ] 3 product form layout
- [ ] 4 bank logos + account selection
- [ ] full verification + screenshots

## Decisions
(filled in as the work goes)
