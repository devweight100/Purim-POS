# PromptPay QR with the amount locked (owner request, 2026-11-16)

Branch `ccr-8f8b0741-si1a0o`. Offline generator, no bank API. Payment is still confirmed by the cashier.

## Plan
1. [x] `shared/src/promptpay.ts`: payload (EMVCo / Thai QR: 000201, 010212|11, 29 AID A000000677010111 + 01/02/03, 5303764, 54 amount, 5802TH, 6304 CRC16-CCITT-FALSE), ID validation (mobile, 13-digit ID checksum, 15-digit e-wallet), mask. Tests `shared/test/promptpay.spec.ts`.
2. [x] Prisma: `bank_accounts.promptpay_type` (enum) + `promptpay_id`, migration, service validation, e2e.
   - Migration `20261130000000_bank_promptpay` (enum `PromptPayIdType`, columns, CHECK pair). Validation in `cleanBankInput` via shared `normalizePromptPayId`. e2e 69/69.
3. [x] Frontend QR renderer (`qrcode-generator` 2.0.4 exact, MIT, no deps; `lib/promptpay-qr.ts`, `components/common/PromptPayQr.tsx` SVG with data-payload) + accounts form (type, ID, live ฿1.00 preview, upload area now a button). `jsqr` 1.4.0 (dev) decodes in tests.
4. [x] POS QR payment (amount = numpad amount or bill total), split (QR portion only; hint when 0), PayDebtModal (amount being paid; image fallback) use `PromptPayQr` when the account has a PromptPay ID. No other receive-payment dialog shows a bank QR (orders page "change payment method" has no QR). Money recorded unchanged.
5. [x] Playwright `e2e/14-promptpay.spec.ts` (4 tests): account form (checksum error, ฿1.00 preview decoded), QR sale (74.50, numpad -> 80.00, manual confirm, recorded QR 74.50), split (QR for transfer part), debt payment (111.75, partial 50). QR screenshots decoded with jsQR. Layout at 3 sizes; PayDebtModal method buttons 6 px -> 8 px apart.
6. [ ] Full verification, PROJECT_STATUS, screenshot.

## Test vectors
- crc16("123456789") = 0x29B1.
- `promptpay-qr` 0.5.0 output (tag 58 before 53 there): CRC + tag 29 compared.
- Our payloads, CRC checked with Python `binascii.crc_hqx(..., 0xFFFF)`: e.g. 0812345678 / 4.22 -> `...54044.225802TH63042352`.

## Notes
- Not on printed documents (owner has not decided).
