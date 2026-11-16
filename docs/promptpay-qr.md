# PromptPay QR with the amount locked (owner request, 2026-11-16)

Branch `ccr-8f8b0741-si1a0o`. Offline generator, no bank API. Payment is still confirmed by the cashier.

## Plan
1. [x] `shared/src/promptpay.ts`: payload (EMVCo / Thai QR: 000201, 010212|11, 29 AID A000000677010111 + 01/02/03, 5303764, 54 amount, 5802TH, 6304 CRC16-CCITT-FALSE), ID validation (mobile, 13-digit ID checksum, 15-digit e-wallet), mask. Tests `shared/test/promptpay.spec.ts`.
2. [ ] Prisma: `bank_accounts.promptpay_type` (enum) + `promptpay_id`, migration, service validation, e2e.
3. [ ] Frontend QR renderer (`qrcode-generator`, pinned) + accounts form (type, ID, live ฿1.00 preview).
4. [ ] POS QR payment, split payment, debt payment (PayDebtModal) use the generated QR when the account has a PromptPay ID, else the uploaded image.
5. [ ] Playwright: set PromptPay ID, sell with QR, decode QR, amount in payload. Layout at 1366x768 / 1920x1080 / 1093x614.
6. [ ] Full verification, PROJECT_STATUS, screenshot.

## Test vectors
- crc16("123456789") = 0x29B1.
- `promptpay-qr` 0.5.0 output (tag 58 before 53 there): CRC + tag 29 compared.
- Our payloads, CRC checked with Python `binascii.crc_hqx(..., 0xFFFF)`: e.g. 0812345678 / 4.22 -> `...54044.225802TH63042352`.

## Notes
- Not on printed documents (owner has not decided).
