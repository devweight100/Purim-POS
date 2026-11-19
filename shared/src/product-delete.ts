/**
 * Texts of deleting / disabling a product (docs/product-delete.md), shared by the backend (409 answers, audit) and
 * the products page (confirmations), so both say the same thing.
 */

/** Stock on hand that a delete removes, e.g. "ยังมีสต็อก 24 ชิ้น มูลค่าทุน ฿288 จะถูกลบออกจากคลัง" (value only when known). */
export function stockWarning(qty: number, unit: string, value?: number | null): string {
  const q = qty.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const v = value !== undefined && value !== null
    ? ` มูลค่าทุน ฿${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    : '';
  return `ยังมีสต็อก ${q} ${unit || 'ชิ้น'}${v} จะถูกลบออกจากคลัง`;
}

/** What "ปิดการใช้งาน" does, for dialogs. */
export const DISABLE_EXPLAINED =
  'ปิดการใช้งาน: สินค้าจะหายจากหน้าขาย (POS) ร้านออนไลน์ และการค้นหาเลือกสินค้า แต่ยังอยู่ในบิล เอกสาร ประวัติ และรายงานทั้งหมด เปิดใช้งานกลับได้ทุกเมื่อ';
