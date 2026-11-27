-- POS: open the member picker after every completed sale (docs/pos-member-picker.md); off = unchanged behaviour
ALTER TABLE "store_settings" ADD COLUMN "pos_pick_member_after_sale" BOOLEAN NOT NULL DEFAULT false;
