# Document numbers

Standard since 2026-11-18 (UI round 4, owner). Code: `shared/src/doc-number.ts` (format, prefixes),
`backend/src/common/doc-number.ts` (`nextDocNumber`), table `document_counters`
(migration `20261204000000_document_counters`).

## Format

`<PP><YYMM>-<NNNN>`, e.g. `IN2611-0001`

| Part | Meaning |
|------|---------|
| `PP` | 2-letter prefix of the document type (table below) |
| `YYMM` | Christian-era (ค.ศ.) 2-digit year + month, Bangkok calendar. November 2026 = `2611` |
| `NNNN` | running number of that type in that month, 4 digits, starts again at `0001` every month. A month with more than 9,999 documents of one type continues with 5 digits (`IN2611-10000`) |

Only document numbers use the Christian-era year. Dates shown on screens and printed documents stay in the Thai
Buddhist-era convention (`18 พ.ย. 69` in tables, `18/11/2569` on A4 documents).

## Prefix map

| Document | Prefix | Example | Table . column | Old format (kept on old documents) |
|----------|--------|---------|----------------|-------------------------------------|
| Sales bill / receipt / tax invoice (ใบเสร็จ / ใบกำกับภาษี; the same document, one number) | `IN` | `IN2611-0001` | `orders.order_number` | `ORD-261100001` (`ORD-YYMMnnnnn`) |
| Sales return / refund credit note (คืนสินค้า / ใบลดหนี้ลูกค้า) | `CN` | `CN2611-0001` | `order_returns.return_number` | `RET-261100001` |
| Customer debt payment receipt (ใบรับชำระหนี้) | `RC` | `RC2611-0001` | `debt_payments.receipt_no` | `REC-261100001` |
| Purchase order (ใบสั่งซื้อ) | `PO` | `PO2611-0001` | `purchase_orders.po_number` | `PO-261100001`; a number typed by hand on the PO form is kept as typed |
| Supplier payment voucher (ใบสำคัญจ่าย) | `PV` | `PV2611-0001` | `payment_vouchers.voucher_number` | `PV-261100001` |
| Supplier return / supplier credit note (ใบส่งคืน / ใบลดหนี้ผู้จำหน่าย; one document) | `SR` | `SR2611-0001` | `supplier_return_notes.return_number` | `SRN-261100001`; a typed number is kept unless already used |
| Customer claim (ใบรับเคลม) | `CL` | `CL2611-0001` | `customer_claims.claim_number` | `CLM-261100001` |
| Cashier shift (กะ) | `SH` | `SH2611-0001` | `shifts.shift_number` | `SHF-261100001` |
| Expense entry (ค่าใช้จ่าย) | `EX` | `EX2611-0001` | `expenses.expense_number` | `EXP-261100001` |
| Online shop order (ออเดอร์ออนไลน์ / LINE) | `WB` | `WB2611-0001` | `online_orders.order_no` | `WEB-261118-001` (was per day) |

Existing prefixes were 3-4 letters (`ORD`, `RET`, `REC`, `SRN`, `CLM`, `SHF`, `EXP`, `WEB`); the owner asked for 2 letters.
`PO` and `PV` were already 2 letters and are kept. `IN` = invoice (the sales bill is also the tax invoice).

### Documents without a number of their own (unchanged)

- Goods receipt (รับสินค้าเข้า): recorded on the purchase order (received quantities, supplier invoice number typed by
  the user); no separate document number.
- Cash in / out of a shift (`cash_movements`), money transfers, owner capital / draw, income lines of the ledger
  (`money_transactions`): referenced by their shift / account and time, no document number.
- Quotations: the system has none.
- Approval requests, recurring expenses, bank reconciliations: internal records, no printed number.
- Customer code `CUST-0001` and product codes (EAN-13 `200…`) are master-data codes, not documents.

## How a number is given (no duplicates)

`nextDocNumber(tx, type)` runs inside the database transaction that creates the document:

```sql
INSERT INTO document_counters (doc_type, period, last_value) VALUES ($type, $yymm, 1)
ON CONFLICT (doc_type, period) DO UPDATE SET last_value = document_counters.last_value + 1
RETURNING last_value
```

The upsert locks the `(type, month)` row until the transaction ends: a parallel create waits and then gets the next
value; a create that fails (rolled back) gives its number back, so numbers stay consecutive. The old code counted /
read the highest existing number and could hand the same number to two parallel creates. A number already used by
another row (e.g. typed by hand) is skipped. Backend e2e: parallel creates, monthly reset, rollback.

## Offline POS terminals

Before and after this change the terminal does **not** make bill numbers (decision: the simplest correct one):

- An offline sale is saved in the terminal's IndexedDB outbox with its `clientOrderId` (UUID). Its slip shows a
  provisional reference `OFFLINE-<first 8 characters of clientOrderId>` (was `ORD-OFFLINE-<uuid>`).
- On sync, `POST /orders/checkout` gives the bill the next `IN` number **of the month of the sale** (`createdAt` of the
  offline sale, so a sale made 30 Nov and sent 1 Dec is `IN2611-…`). A number sent by a terminal is ignored, so two
  terminals can never produce the same number. Re-sending the same `clientOrderId` returns the same bill and number.
- The POS history, reprints and every list read the bill from the server, so they show the final number. Searching
  the provisional reference in the document search (F3) finds the synced bill (search covers `clientOrderId`).

Per-terminal number ranges were not needed: a number is only ever made in one place (the server).

## Old and new numbers together

- Existing documents keep their old numbers; nothing is renumbered.
- Search (document search F3, orders, claims, payables, debts ...) is "contains" text search on the number, so old
  and new numbers are both found (also by part, e.g. `2611-0001`). Barcodes on printed documents (Code 128) encode
  the number as is.
- Lists sort by date; sorting by number text puts every old `ORD-` number before the new `IN` numbers.
- Nothing in the backend, frontend or desktop app parses the old formats (the only parser was the offline outbox
  check for `ORD-OFFLINE`, now replaced). `parseDocNumber` reads the new format only.
- Picking slips, receipts, A4 documents, LINE messages and links print / carry the number as stored.
