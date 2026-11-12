import { useProductStore } from './store/product-store';
import { apiFetch } from './api';
import { ApiError } from './api-error';

export type StockMovementType = 
  | 'IN_PO'       // รับเข้าจากใบสั่งซื้อ PO
  | 'OUT_POS'     // ขายออกหน้าร้าน POS
  | 'OUT_CLAIM'   // ตัดสต็อกจ่ายเปลี่ยนสินค้าเคลม (Claim Replacement)
  | 'IN_VOID'     // คืนสต็อกจากการยกเลิกบิล Void
  | 'ADJUST_ADD'  // ปรับเพิ่มสต็อก
  | 'ADJUST_SUB'  // ปรับลดสต็อก (ชำรุด/หมดอายุ/สูญหาย)
  | 'ADJUST_SET'; // ปรับยอดคงเหลือตามตรวจนับจริง

export interface StockMovement {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unitName: string;
  type: StockMovementType;
  quantityChange: number; // e.g. +10, -2
  previousStock: number;
  currentStock: number;
  referenceType?: 'PO' | 'POS' | 'ADJUST' | 'VOID' | 'CLAIM';
  referenceNo?: string; // e.g. "PO-202608-0001", "ORD-12345"
  reason?: string; // e.g. "ตรวจนับประจำเดือน", "สินค้าหมดอายุ", "ขายหน้าร้าน"
  userName?: string;
  createdAt: string; // ISO date string
}

/**
 * Stock and stock movements live on the server only: sales, voids, claims and purchase orders
 * move stock inside their own server transactions, and nothing is bookkept on this device.
 */

/** Stock movements from the server. Throws when the server cannot be reached. */
export async function fetchStockMovements(productId?: string): Promise<StockMovement[]> {
  const url = productId ? `/inventory/movements?productId=${productId}` : '/inventory/movements';
  const data = await apiFetch(url);
  if (!Array.isArray(data)) throw new Error('ข้อมูลความเคลื่อนไหวสต็อกจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  return data;
}

/**
 * Manual stock adjustment (Add, Subtract, Set). Server only: any failure (including no
 * connection) is thrown to the caller, which must show it; nothing is changed locally.
 */
export async function adjustSingleProductStock(params: {
  productId: string;
  type: 'ADD' | 'SUB' | 'SET';
  amount: number;
  reason: string;
  userName?: string;
}): Promise<{ success: boolean; newStock: number; previousStock: number; delta: number; offline?: boolean; error?: string }> {
  const res = await apiFetch('/inventory/adjust', {
    method: 'POST',
    body: JSON.stringify({
      productId: params.productId,
      type: params.type,
      adjustmentType: params.type === 'SUB' ? 'SUBTRACT' : params.type,
      amount: params.amount,
      reason: params.reason,
      ...(params.userName ? { userName: params.userName } : {}),
    }),
  });

  if (!res || !res.success) throw new ApiError('เซิร์ฟเวอร์ไม่ยืนยันการปรับสต็อก', 502, res);
  // Refresh real product catalog from DB
  await useProductStore.getState().fetchProducts();
  return {
    success: true,
    newStock: Number(res.newStock),
    previousStock: Number(res.previousStock),
    delta: Number(res.delta),
    offline: false,
  };
}
