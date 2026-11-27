# PO grid entry (owner round, 2026-11-27)

Owner (translated): enter purchase-order lines like typing into a spreadsheet; give the grid more room and make the
bill summary small; Enter moves between cells; the product form's category picker becomes a searchable dropdown.

## Plan / progress

- [ ] before screenshots (HEAD c60c929 + e0f9c59)
- [ ] shared `po-calc`: pack units (factor), per-unit discount (`unit` type), default unit price rule, tests
- [ ] migration: `purchase_order_items.unit_id / unit_name / unit_factor` (nullable / default 1)
- [ ] backend: create / update store the unit (resolved from the product's packaging units), receive in pack units
      -> base stock + FIFO cost per base unit, last-price endpoint, exact code lookup, consumers (reports, ...)
- [ ] frontend grid (PoCreateView / PoItemsTable), search popup, compact header / footer, VAT toggle
- [ ] receive dialog / detail / PDF show the pack unit
- [ ] ProductForm category combobox
- [ ] tests (vitest, jest, backend e2e, Playwright) + after screenshots

## Decisions

(filled in as the work goes)
