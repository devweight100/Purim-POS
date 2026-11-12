/**
 * The two sales screens (/pos "classic" and /pos-neo) share all of their logic (lib/pos/*) and differ
 * only in layout and in a few texts / settings, which live here.
 */
export type PosViewMode = 'touch_screen' | 'list_view';

export interface PosVariant {
  /** product cards rendered per "load more" page */
  pageSize: number;
  /** localStorage key that remembers touch / list mode on this device */
  viewModeStorageKey: string;
  /** toast text after switching the screen mode */
  viewModeToast: (mode: PosViewMode) => string;
  /** live-state description sent to the store monitor while the cart is empty */
  idleDescription: string;
  /** DOM id prefixes of cart rows (touch layout first, then list layout); the row index is appended */
  cartItemIdPrefixes: readonly string[];
  /** toast after a scan added a product (repeat = it was already in the cart) */
  scanRepeatToast: (name: string, newQty: number, unitName: string) => string;
  scanFirstToast: (name: string, unitName: string) => string;
  /** toast after a unit was chosen in the "select unit" dialog */
  unitAddedToast: (name: string, unitName: string) => string;
  /** toast after a product card was clicked */
  cardAddedToast: (name: string, unitName: string) => string;
}

export const CLASSIC_POS: PosVariant = {
  pageSize: 32,
  viewModeStorageKey: 'pos_screen_mode',
  viewModeToast: (mode) => `เปลี่ยนรูปแบบหน้าจอเป็น "${mode === 'touch_screen' ? 'หน้าจอแบบ touch screen' : 'หน้าจอแบบรายการ'}"`,
  idleDescription: 'จุดขายพร้อมให้บริการ (ว่าง)',
  cartItemIdPrefixes: ['classic-cart-item-', 'classic-list-cart-item-'],
  scanRepeatToast: (name, newQty, unitName) => `⚡ สแกนสินค้าเดิมซ้ำ: ${name} (+1 รวมเป็น ${newQty} ${unitName})`,
  scanFirstToast: (name, unitName) => `⚡ สแกนบาร์โค้ดสำเร็จ: ${name} (1 ${unitName})`,
  unitAddedToast: (name, unitName) => `เพิ่ม ${name} (${unitName}) ลงตะกร้าเรียบร้อยแล้ว`,
  cardAddedToast: (name, unitName) => `เพิ่ม ${name} (${unitName}) ลงตะกร้าแล้ว`,
};

export const NEO_POS: PosVariant = {
  pageSize: 36,
  viewModeStorageKey: 'pos_neo_screen_mode',
  viewModeToast: (mode) => `เปลี่ยนรูปแบบหน้าจอเป็น "${mode === 'touch_screen' ? 'Touch Screen' : 'แบบรายการ'}"`,
  idleDescription: 'จุดขายพร้อมให้บริการ (Neo UI)',
  cartItemIdPrefixes: ['cart-item-', 'list-cart-item-'],
  scanRepeatToast: (name, newQty, unitName) => `⚡ สแกนสินค้าซ้ำ: ${name} (+1 รวมเป็น ${newQty} ${unitName})`,
  scanFirstToast: (name, unitName) => `⚡ สแกนสำเร็จ: ${name} (1 ${unitName})`,
  unitAddedToast: (name, unitName) => `เพิ่ม ${name} (${unitName}) แล้ว`,
  cardAddedToast: (name, unitName) => `เพิ่ม ${name} (${unitName}) แล้ว`,
};

/** Scrolls the cart row with this index into view (whichever layout is on screen). */
export function scrollCartRowIntoView(variant: PosVariant, index: number, delayMs: number) {
  setTimeout(() => {
    for (const prefix of variant.cartItemIdPrefixes) {
      const elem = document.getElementById(`${prefix}${index}`);
      if (elem) {
        elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
    }
  }, delayMs);
}
