import { useProductStore } from './store/product-store';

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

const STOCK_MOVEMENTS_KEY = 'custom_stock_movements';

export function loadStockMovements(): StockMovement[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STOCK_MOVEMENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Failed to load stock movements from storage:', err);
  }
  return [];
}

export function saveStockMovements(movements: StockMovement[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STOCK_MOVEMENTS_KEY, JSON.stringify(movements));
  } catch (err) {
    console.error('Failed to save stock movements to storage:', err);
  }
}

export function recordStockMovement(
  entry: Omit<StockMovement, 'id' | 'createdAt'>
): StockMovement {
  const newMovement: StockMovement = {
    ...entry,
    id: `sm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: new Date().toISOString(),
  };

  const existing = loadStockMovements();
  const updated = [newMovement, ...existing];
  // Keep latest 1,000 movements in storage for performance
  saveStockMovements(updated.slice(0, 1000));
  return newMovement;
}

/**
 * Load raw custom_products from localStorage or store
 */
function getLocalProducts(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('custom_products');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return useProductStore.getState().products || [];
}

function saveLocalProducts(products: any[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('custom_products', JSON.stringify(products));
    useProductStore.getState().fetchProducts();
  } catch (err) {
    console.error('Failed to persist products:', err);
  }
}

/**
 * Deduct inventory stock when POS checkout completes
 */
export function deductPosSaleStock(
  items: Array<{
    productId: string;
    quantity: number;
    conversionFactor?: number;
    name?: string;
    sku?: string;
    unitName?: string;
  }>,
  orderNumber: string,
  userName = 'พนักงาน POS'
): void {
  const products = getLocalProducts();
  if (products.length === 0) return;

  const updatedProducts = products.map((prod) => {
    const pId = prod.id || prod.sku;
    // Find all cart items matching this product
    const matchItems = items.filter(
      (item) => item.productId === pId || item.productId === prod.id || item.productId === prod.sku || item.sku === prod.sku
    );

    if (matchItems.length === 0) return prod;

    const previousStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
    const totalDeduct = matchItems.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.conversionFactor) || 1),
      0
    );
    const newStock = previousStock - totalDeduct;

    // Record stock movement log
    recordStockMovement({
      productId: prod.id || prod.sku,
      sku: prod.sku || '-',
      productName: prod.name || matchItems[0]?.name || 'สินค้า',
      unitName: prod.unit || matchItems[0]?.unitName || 'ชิ้น',
      type: 'OUT_POS',
      quantityChange: -totalDeduct,
      previousStock,
      currentStock: newStock,
      referenceType: 'POS',
      referenceNo: orderNumber,
      reason: `ขายหน้าร้าน (บิล #${orderNumber})`,
      userName,
    });

    return {
      ...prod,
      stock: newStock,
    };
  });

  saveLocalProducts(updatedProducts);
}

/**
 * Deduct inventory stock when customer is given a replacement product for a claim
 */
export function deductClaimReplacementStock(
  item: {
    productId: string;
    quantity: number;
    conversionFactor?: number;
    name?: string;
    sku?: string;
    unitName?: string;
  },
  claimId: string,
  userName = 'เจ้าหน้าที่รับเคลม'
): void {
  const products = getLocalProducts();
  if (products.length === 0) return;

  const targetPId = (item.productId || '').trim();
  const targetSku = (item.sku || '').trim().toLowerCase();

  let hasUpdated = false;

  const updatedProducts = products.map((prod) => {
    const pId = (prod.id || '').trim();
    const pSku = (prod.sku || '').trim().toLowerCase();

    // Check if this product matches by id, sku, or any unit barcode/id
    const isIdMatch = targetPId && (pId === targetPId || prod.id === targetPId || prod.sku === targetPId);
    const isSkuMatch = targetSku && (pSku === targetSku || (prod.sku || '').toLowerCase() === targetSku);
    const isUnitMatch = (prod.units || []).some(
      (u: any) =>
        (targetPId && (u.id === targetPId || u.barcode === targetPId)) ||
        (targetSku && (u.barcode || '').trim().toLowerCase() === targetSku)
    );

    if (!isIdMatch && !isSkuMatch && !isUnitMatch) return prod;

    // Find unit factor if unit matched
    const matchedUnit = (prod.units || []).find(
      (u: any) =>
        (targetPId && (u.id === targetPId || u.barcode === targetPId)) ||
        (targetSku && (u.barcode || '').trim().toLowerCase() === targetSku) ||
        (item.unitName && (u.unitName || '').trim() === (item.unitName || '').trim())
    );

    const factor = item.conversionFactor || matchedUnit?.factor || 1;
    const previousStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
    const totalDeduct = (Number(item.quantity) || 1) * factor;
    const newStock = Math.max(0, previousStock - totalDeduct);

    hasUpdated = true;

    // Record stock movement log
    recordStockMovement({
      productId: prod.id || prod.sku,
      sku: prod.sku || item.sku || '-',
      productName: prod.name || item.name || 'สินค้า',
      unitName: prod.unit || item.unitName || 'ชิ้น',
      type: 'OUT_CLAIM',
      quantityChange: -totalDeduct,
      previousStock,
      currentStock: newStock,
      referenceType: 'CLAIM',
      referenceNo: claimId,
      reason: `เปลี่ยนสินค้าตัวใหม่ให้ลูกค้า (ใบเคลม #${claimId})`,
      userName,
    });

    return {
      ...prod,
      stock: newStock,
    };
  });

  if (hasUpdated) {
    saveLocalProducts(updatedProducts);
  }
}

/**
 * Restore stock when a POS order is voided / cancelled
 */
export function restoreVoidOrderStock(
  items: Array<{
    productId: string;
    quantity: number;
    conversionFactor?: number;
    name?: string;
    sku?: string;
    unitName?: string;
  }>,
  orderNumber: string,
  reason = 'ยกเลิกบิลขาย (Void)',
  userName = 'พนักงาน POS'
): void {
  const products = getLocalProducts();
  if (products.length === 0) return;

  const updatedProducts = products.map((prod) => {
    const pId = prod.id || prod.sku;
    const matchItems = items.filter(
      (item) => item.productId === pId || item.productId === prod.id || item.productId === prod.sku || item.sku === prod.sku
    );

    if (matchItems.length === 0) return prod;

    const previousStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
    const totalRestore = matchItems.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.conversionFactor) || 1),
      0
    );
    const newStock = previousStock + totalRestore;

    recordStockMovement({
      productId: prod.id || prod.sku,
      sku: prod.sku || '-',
      productName: prod.name || matchItems[0]?.name || 'สินค้า',
      unitName: prod.unit || matchItems[0]?.unitName || 'ชิ้น',
      type: 'IN_VOID',
      quantityChange: totalRestore,
      previousStock,
      currentStock: newStock,
      referenceType: 'VOID',
      referenceNo: orderNumber,
      reason: `คืนสต็อกจากการยกเลิกบิล #${orderNumber} (${reason})`,
      userName,
    });

    return {
      ...prod,
      stock: newStock,
    };
  });

  saveLocalProducts(updatedProducts);
}

/**
 * Record stock addition when PO goods are received
 */
export function recordPoReceiveStock(
  items: Array<{
    productId: string;
    toReceive: number;
    multiplier?: number;
    name?: string;
    sku?: string;
    unitName?: string;
  }>,
  poNumber: string,
  userName = 'ผู้ดูแลระบบ'
): void {
  const products = getLocalProducts();
  if (products.length === 0) return;

  items.forEach((item) => {
    if (Number(item.toReceive) <= 0) return;
    const prod = products.find(
      (p) => p.id === item.productId || p.sku === item.productId || p.sku === item.sku
    );
    if (!prod) return;

    const previousStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
    const addQty = Number(item.toReceive) * (Number(item.multiplier) || 1);
    const newStock = previousStock + addQty;

    recordStockMovement({
      productId: prod.id || prod.sku,
      sku: prod.sku || '-',
      productName: prod.name || item.name || 'สินค้า',
      unitName: prod.unit || item.unitName || 'ชิ้น',
      type: 'IN_PO',
      quantityChange: addQty,
      previousStock,
      currentStock: newStock,
      referenceType: 'PO',
      referenceNo: poNumber,
      reason: `รับสินค้าเข้าคลังตามใบสั่งซื้อ PO #${poNumber}`,
      userName,
    });
  });
}

/**
 * Record stock deduction when PO status is rolled back
 */
export function recordPoRollbackStock(
  items: Array<{
    productId: string;
    receivedQuantity: number;
    multiplier?: number;
    name?: string;
    sku?: string;
    unitName?: string;
  }>,
  poNumber: string,
  userName = 'ผู้ดูแลระบบ'
): void {
  const products = getLocalProducts();
  if (products.length === 0) return;

  items.forEach((item) => {
    if (Number(item.receivedQuantity) <= 0) return;
    const prod = products.find(
      (p) => p.id === item.productId || p.sku === item.productId || p.sku === item.sku
    );
    if (!prod) return;

    const previousStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
    const deductQty = Number(item.receivedQuantity) * (Number(item.multiplier) || 1);
    const newStock = Math.max(0, previousStock - deductQty);

    recordStockMovement({
      productId: prod.id || prod.sku,
      sku: prod.sku || '-',
      productName: prod.name || item.name || 'สินค้า',
      unitName: prod.unit || item.unitName || 'ชิ้น',
      type: 'ADJUST_SUB',
      quantityChange: -deductQty,
      previousStock,
      currentStock: newStock,
      referenceType: 'PO',
      referenceNo: poNumber,
      reason: `หักคืนยอดสต็อกจากย้อนสถานะใบสั่งซื้อ PO #${poNumber}`,
      userName,
    });
  });
}

/**
 * Manual stock adjustment (Add, Subtract, Set)
 */
export function adjustSingleProductStock(params: {
  productId: string;
  type: 'ADD' | 'SUB' | 'SET';
  amount: number;
  reason: string;
  userName?: string;
}): { success: boolean; newStock: number; previousStock: number; delta: number } {
  const products = getLocalProducts();
  const prodIndex = products.findIndex(
    (p) => p.id === params.productId || p.sku === params.productId
  );

  if (prodIndex === -1) {
    return { success: false, newStock: 0, previousStock: 0, delta: 0 };
  }

  const prod = products[prodIndex];
  const previousStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
  let newStock = previousStock;
  let delta = 0;
  let movementType: StockMovementType = 'ADJUST_SET';

  if (params.type === 'ADD') {
    delta = Math.max(0, params.amount);
    newStock = previousStock + delta;
    movementType = 'ADJUST_ADD';
  } else if (params.type === 'SUB') {
    delta = -Math.max(0, params.amount);
    newStock = Math.max(0, previousStock + delta);
    movementType = 'ADJUST_SUB';
  } else if (params.type === 'SET') {
    newStock = Math.max(0, params.amount);
    delta = newStock - previousStock;
    movementType = delta >= 0 ? 'ADJUST_ADD' : 'ADJUST_SUB';
  }

  const updatedProducts = [...products];
  updatedProducts[prodIndex] = {
    ...prod,
    stock: newStock,
  };

  saveLocalProducts(updatedProducts);

  recordStockMovement({
    productId: prod.id || prod.sku,
    sku: prod.sku || '-',
    productName: prod.name || 'สินค้า',
    unitName: prod.unit || 'ชิ้น',
    type: movementType,
    quantityChange: delta,
    previousStock,
    currentStock: newStock,
    referenceType: 'ADJUST',
    referenceNo: `ADJ-${Date.now().toString().slice(-6)}`,
    reason: params.reason || 'ปรับยอดสต็อกสินค้า',
    userName: params.userName || 'ผู้ดูแลระบบ',
  });

  return { success: true, newStock, previousStock, delta };
}
