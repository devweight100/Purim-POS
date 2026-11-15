# Bug fixes for v1.5.3 (tester report)

Branch `ccr-8f8b0741-si1a0o`. Order: 01, 02, 03, 04, 05, 06, 12, 10. (07/08/09/11 = another agent.)
Status per bug: reproduced? / real cause / fix / files / test.

## Progress
- [ ] BUG-01 ... [ ] BUG-02 ... [ ] BUG-03 ... [ ] BUG-04 ... [ ] BUG-05 ... [ ] BUG-06 ... [ ] BUG-12 ... [ ] BUG-10
- Final verification: not run yet.

## Test setup
Fresh DB `bug_test_*` on localhost:5433 seeded by `backend/scripts/prepare-database.js`, then via the UI/API:
supplier "บริษัททดสอบ จำกัด", bank account 000-0-00000-0, product "น้ำดื่มทดสอบ 600 มล." price 20 cost 12,
stock 0 -> 24 via inventory "ปรับยอด" with reason "ปรับยอดเริ่มต้น".

## Notes for BUG-07/08/09/11 (other agent)
