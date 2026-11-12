import { ClaimRecord, SupplierReturnNote, SupplierReturnItem, SupplierReturnItemType } from './types';
import { loadAllClaimRecords, fetchAllClaimRecords } from './claim-service';
import { useProductStore } from './store/product-store';
import { apiFetch, api } from './api';
import { grossPerUnit } from './po-calc';

/**
 * Suppliers, purchase orders and supplier return notes live on the server only. The last server
 * response of each is kept in memory (never in localStorage) so helpers can read them
 * synchronously; fetch* refresh them and throw when the server cannot be reached.
 */
let suppliersMem: any[] = [];
let purchaseOrdersMem: any[] = [];
let returnNotesMem: SupplierReturnNote[] = [];

// ─── Suppliers ───
export const DEFAULT_SUPPLIERS: any[] = [];

/** Suppliers from the server. Throws when the server cannot be reached. */
export async function fetchSuppliers(): Promise<any[]> {
  const data = await apiFetch('/suppliers');
  if (!Array.isArray(data)) throw new Error('ข้อมูลผู้จำหน่ายจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  suppliersMem = data;
  return data;
}

/** Last suppliers the server returned in this session. */
export function loadSuppliers(): any[] {
  return suppliersMem;
}

// ─── Purchase Orders ───
/** Purchase orders from the server. Throws when the server cannot be reached. */
export async function fetchPurchaseOrders(): Promise<any[]> {
  const data = await apiFetch('/purchase-orders?limit=1000');
  const list = Array.isArray(data) ? data : data?.data;
  if (!Array.isArray(list)) throw new Error('ข้อมูลใบสั่งซื้อจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  purchaseOrdersMem = list;
  return list;
}

/** Last purchase orders the server returned in this session (with supplier names filled in). */
export function loadPurchaseOrders(): any[] {
  const supps = suppliersMem;
  return purchaseOrdersMem.map((po: any) => {
    if (!po.supplier || !po.supplier.name) {
      const supp = supps.find((s: any) => s.id === (po.supplierId || po.supplier?.id));
      if (supp) {
        return { ...po, supplier: supp, supplierName: supp.name };
      }
    }
    return po;
  });
}

// ─── Supplier Return Notes ───
function mapReturnNote(item: any): SupplierReturnNote {
  const docNum = item.returnNumber || item.noteNumber || item.id;
  const rawStatus = item.frontendStatus || item.status;
  const resolvedStatus =
    rawStatus === 'PENDING'
      ? 'PENDING_DEDUCTION'
      : rawStatus === 'PARTIALLY_USED'
        ? 'PARTIALLY_DEDUCTED'
        : rawStatus === 'USED'
          ? 'DEDUCTED'
          : rawStatus || 'PENDING_DEDUCTION';

  return {
    id: docNum,
    noteNumber: docNum,
    returnDate: item.returnDate || item.createdAt || new Date().toISOString(),
    supplierId: item.supplierId || item.supplier?.id || '',
    supplierName: item.supplierName || item.supplier?.name || 'ไม่ระบุผู้จำหน่าย',
    supplierPhone: item.supplierPhone || item.supplier?.phone || '',
    supplierContact: item.supplierContact || item.supplier?.contactName || '',
    supplierAddress: item.supplierAddress || item.supplier?.address || '',
    linkedPoId: item.linkedPoId,
    linkedPoNumber: item.linkedPoNumber,
    items: Array.isArray(item.items) ? item.items : [],
    totalQuantity: Number(item.totalQuantity ?? 0),
    defectiveTotalCost: Number(item.defectiveTotalCost ?? 0),
    overstockTotalCost: Number(item.overstockTotalCost ?? 0),
    totalCreditAmount: Number(item.totalCreditAmount ?? item.totalAmount ?? 0),
    remainingCreditAmount: Number(item.remainingCreditAmount ?? item.totalAmount ?? 0),
    status: resolvedStatus as any,
    notes: item.notes ?? item.note ?? item.reason ?? '',
    deductions: Array.isArray(item.deductions) ? item.deductions : [],
    createdBy: item.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม',
  } as SupplierReturnNote;
}

/** Supplier return notes from the server. Throws when the server cannot be reached. */
export async function fetchSupplierReturnNotes(): Promise<SupplierReturnNote[]> {
  const res = await apiFetch('/supplier-returns?limit=200');
  const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : null);
  if (!Array.isArray(list)) throw new Error('ข้อมูลใบส่งคืนจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  returnNotesMem = list.map(mapReturnNote);
  return returnNotesMem;
}

/** Last supplier return notes the server returned in this session. */
export function loadSupplierReturnNotes(): SupplierReturnNote[] {
  return returnNotesMem;
}

export function generateReturnDocNumber(): string {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `SRN-${yy}${mm}`;
  const existing = loadSupplierReturnNotes();
  const monthNotes = existing.filter((n) => (n.id || (n as any).returnNumber || '').startsWith(prefix));
  const seq = (monthNotes.length + 1).toString().padStart(5, '0');
  return `${prefix}${seq}`;
}

// ─── Helper to resolve Product's Supplier & Cost ───
export function resolveProductSupplierAndCost(productId: string, sku?: string): {
  supplierId: string;
  supplierName: string;
  costPrice: number;
} {
  const storeProducts: any[] = useProductStore.getState().products || [];
  const suppliers = loadSuppliers();

  const prod = storeProducts.find((p) => p.id === productId || p.sku === sku || p.sku === productId);

  const supplierEntry = Array.isArray(prod?.supplierEntries)
    ? prod.supplierEntries.find((entry: any) => entry?.supplierId)
    : undefined;
  const barcodeSupplier = Array.isArray(prod?.barcodes)
    ? prod.barcodes.find((entry: any) => entry?.supplierId)
    : undefined;

  let supplierId = prod?.supplierId || barcodeSupplier?.supplierId || supplierEntry?.supplierId;
  let supplier = suppliers.find((s) => s.id === supplierId);

  // Check product.supplier if object or string
  if (!supplier && prod?.supplier) {
    if (typeof prod.supplier === 'object' && prod.supplier?.id) {
      supplier = suppliers.find((s) => s.id === prod.supplier.id);
    } else if (typeof prod.supplier === 'string') {
      supplier = suppliers.find((s) => s.name.trim().toLowerCase() === prod.supplier.trim().toLowerCase());
    }
  }

  // Check product.supplierName
  if (!supplier && prod?.supplierName) {
    supplier = suppliers.find((s) => s.name.trim().toLowerCase() === prod.supplierName.trim().toLowerCase());
  }

  // Check purchase orders
  if (!supplier) {
    try {
      const pos = loadPurchaseOrders();
      const poWithItem = pos.find((po) =>
        (po.items || []).some((i: any) => i.productId === productId || (i.sku || i.product?.sku) === sku || (prod?.name && (i.productName || i.product?.name) === prod.name))
      );
      if (poWithItem) {
        const poSuppId = poWithItem.supplierId || poWithItem.supplier?.id;
        supplier = suppliers.find((s) => s.id === poSuppId);
        if (!supplier && poWithItem.supplierName) {
          supplier = suppliers.find((s) => s.name.trim().toLowerCase() === poWithItem.supplierName.trim().toLowerCase());
        }
      }
    } catch {}
  }

  // If no supplier matched, assign fallback safely
  if (!supplier) {
    supplier = (suppliers && suppliers.length > 0) ? suppliers[0] : (DEFAULT_SUPPLIERS && DEFAULT_SUPPLIERS.length > 0 ? DEFAULT_SUPPLIERS[0] : null);
  }

  const resolvedSupplierId = supplier?.id || 'UNKNOWN';
  const resolvedSupplierName = supplier?.name || 'ไม่ระบุผู้จำหน่าย';

  const supplierEntryCost = supplierEntry?.lastCost !== undefined ? Number(supplierEntry.lastCost) : 0;
  let costPrice = Number(prod?.costPrice || prod?.basePrice || supplierEntryCost || 0);
  if (costPrice <= 0) {
    const firstUnitPrice = Number(prod?.units?.[0]?.price || 0);
    costPrice = firstUnitPrice > 0 ? firstUnitPrice : 0;
  }

  return {
    supplierId: resolvedSupplierId,
    supplierName: resolvedSupplierName,
    costPrice: Math.round(costPrice * 100) / 100,
  };
}

// ─── Query Products that Belong to a Specific Supplier ───
export function getProductsBySupplier(supplierId: string): any[] {
  const storeProducts: any[] = useProductStore.getState().products || [];

  const pos = loadPurchaseOrders();
  const supplierPos = pos.filter(
    (p) => p.supplierId === supplierId || p.supplier?.id === supplierId
  );
  const orderedProductIds = new Set<string>();
  supplierPos.forEach((po) => {
    (po.items || []).forEach((item: any) => {
      if (item.productId) orderedProductIds.add(item.productId);
    });
  });

  return storeProducts.filter((p) => {
    const directSupplier = p.supplierId === supplierId;
    const inSupplierEntries = Array.isArray(p.supplierEntries) && p.supplierEntries.some((e: any) => e.supplierId === supplierId);
    const inBarcodes = Array.isArray(p.barcodes) && p.barcodes.some((b: any) => b.supplierId === supplierId);
    const inOrderedPos = orderedProductIds.has(p.id) || orderedProductIds.has(p.sku);
    return directSupplier || inSupplierEntries || inBarcodes || inOrderedPos;
  });
}

// ─── Query Payable POs for a Supplier (Debt Reduction Candidates) ───
export interface PayablePO {
  id: string;
  poNumber: string;
  poDate: string;
  status: string;
  totalAmount: number;
  alreadyDeducted: number;
  remainingPayable: number;
  items: Array<{
    id?: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    receivedQuantity?: number;
    unitPrice: number;
    unitName?: string;
  }>;
}

export function getPayablePOsBySupplier(supplierId: string): PayablePO[] {
  const allPos = loadPurchaseOrders();

  return allPos
    .filter((po) => {
      const isMatchSupp = po.supplierId === supplierId || po.supplier?.id === supplierId;
      const isNotCancelled = po.status !== 'CANCELLED' && po.status !== 'DRAFT';
      const isNotPaid = po.paymentStatus !== 'PAID';
      return isMatchSupp && isNotCancelled && isNotPaid;
    })
    .map((po) => {
      const totalAmount = Number(po.totalAmount || 0);
      const alreadyDeducted = (po.deductedReturns || []).reduce(
        (sum: number, r: any) => sum + Number(r.amount || 0),
        0
      );
      const payments = Array.isArray(po.payments) ? po.payments : [];
      const alreadyPaid = payments.reduce(
        (sum: number, p: any) => sum + Number(p.netCashOrTransferPaid || 0),
        0
      );
      const alreadyDiscount = payments.reduce(
        (sum: number, p: any) => sum + Number(p.discountAmount || 0),
        0
      );
      const remainingPayable = Math.max(
        0,
        Math.round((totalAmount - alreadyDeducted - alreadyPaid - alreadyDiscount) * 100) / 100
      );

      return {
        id: po.id,
        poNumber: po.poNumber,
        poDate: po.createdAt || po.issueDate || po.issuedAt || new Date().toISOString(),
        status: po.status,
        totalAmount,
        alreadyDeducted,
        remainingPayable,
        // backend PO items carry product.{name,sku}, unitCost and total (not productName/unitPrice)
        items: (po.items || []).map((i: any) => {
          const quantity = Number(i.quantity || 0);
          const explicit = Number(i.unitPrice ?? i.costPrice);
          const unitPrice = Number.isFinite(explicit) && explicit > 0
            ? explicit
            : Math.round(grossPerUnit({ quantity, total: i.total ?? undefined, unitCost: i.unitCost }) * 100) / 100;
          return {
            id: i.id,
            productId: i.productId || i.product?.id,
            productName: i.productName || i.product?.name || i.name || 'สินค้า',
            sku: i.sku || i.product?.sku || '',
            quantity,
            receivedQuantity: Number(i.receivedQuantity ?? i.quantity ?? 0),
            unitPrice,
            unitName: i.unitName || i.product?.unit || 'ชิ้น',
          };
        }),
      };
    })
    .filter((po) => po.remainingPayable > 0);
}

// ─── Get Claims Eligible to be Returned to Supplier ───
export function getEligibleClaimsForReturn(supplierId?: string): ClaimRecord[] {
  const allClaims = loadAllClaimRecords();
  const suppliers = loadSuppliers();
  const pos = loadPurchaseOrders();

  const storeProducts: any[] = useProductStore.getState().products || [];

  const targetSupplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;

  // Helper to check if a claim belongs to targetSupplierId
  const isClaimBelongingToSupplier = (claim: ClaimRecord, targetId: string): boolean => {
    // 1. Direct ID match
    if (claim.supplierId && claim.supplierId === targetId) return true;

    // 2. Direct supplierName match
    if (targetSupplier && claim.supplierName) {
      if (claim.supplierName.trim().toLowerCase() === targetSupplier.name.trim().toLowerCase()) {
        return true;
      }
    }

    // 3. Product catalog matching
    const prod = storeProducts.find(
      (p) => p.id === claim.productId || p.sku === claim.sku || p.sku === claim.productId || p.id === claim.sku
    );

    if (prod) {
      if (prod.supplierId === targetId) return true;
      if (typeof prod.supplier === 'string' && targetSupplier && prod.supplier.trim().toLowerCase() === targetSupplier.name.trim().toLowerCase()) {
        return true;
      }
      if (typeof prod.supplier === 'object' && prod.supplier) {
        if (prod.supplier.id === targetId || (targetSupplier && prod.supplier.name === targetSupplier.name)) {
          return true;
        }
      }
      if (targetSupplier && prod.supplierName && prod.supplierName.trim().toLowerCase() === targetSupplier.name.trim().toLowerCase()) {
        return true;
      }
      if (Array.isArray(prod.barcodes) && prod.barcodes.some((b: any) => b.supplierId === targetId)) {
        return true;
      }
      if (Array.isArray(prod.supplierEntries) && prod.supplierEntries.some((s: any) => s.supplierId === targetId)) {
        return true;
      }
    }

    // 4. Purchase orders from this supplier containing this product
    const supplierPos = pos.filter(
      (p) => p.supplierId === targetId || p.supplier?.id === targetId || (targetSupplier && p.supplierName === targetSupplier.name)
    );
    const inPo = supplierPos.some((po) =>
      (po.items || []).some(
        (i: any) => i.productId === claim.productId || (i.sku || i.product?.sku) === claim.sku || (claim.productName && (i.productName || i.product?.name) === claim.productName)
      )
    );
    if (inPo) return true;

    return false;
  };

  // Step 1: Enrich all unreturned, unscrapped claims with resolved supplier & cost
  const eligibleClaims = allClaims
    .filter((c) => !c.returnDocId && c.status !== 'SCRAPPED')
    .map((c) => {
      let suppId = c.supplierId;
      let suppName = c.supplierName;
      let cost = Number(c.costPrice || 0);

      // If supplier info or cost is missing, dynamically resolve from catalog/POs
      if (!suppId || cost <= 0) {
        const resolved = resolveProductSupplierAndCost(c.productId, c.sku);
        if (!suppId) {
          suppId = resolved.supplierId;
          suppName = resolved.supplierName;
        }
        if (cost <= 0) {
          cost = resolved.costPrice > 0 ? resolved.costPrice : Number(c.unitPrice || 50);
        }
      }

      // Normalize to smallest base unit
      const factor = Number(c.conversionFactor || 1);
      const baseQty = Number(c.baseQuantity !== undefined ? c.baseQuantity : (Number(c.quantity || 1) * factor));
      const baseUnit = factor > 1 ? (c.replacementUnitName || 'ชิ้น') : (c.unitName || 'ชิ้น');
      const baseCost = factor > 1 && cost > 0 ? (cost / factor) : cost;
      const totalCost = Math.round(baseCost * baseQty * 100) / 100;

      return {
        ...c,
        quantity: baseQty,
        unitName: baseUnit,
        baseQuantity: baseQty,
        supplierId: suppId,
        supplierName: suppName,
        costPrice: baseCost,
        totalCostValue: totalCost,
      };
    });

  // Step 2: Filter by supplierId if provided
  if (!supplierId) {
    return eligibleClaims;
  }

  return eligibleClaims.filter((c) => isClaimBelongingToSupplier(c, supplierId));
}

// ─── Group Pending Claims by Supplier ───
export interface PendingSupplierGroup {
  supplierId: string;
  supplierName: string;
  supplierPhone?: string;
  supplierContact?: string;
  pendingCount: number;
  totalItemsQuantity: number;
  totalCostValue: number;
  claims: ClaimRecord[];
}

export function getPendingReturnsGroupedBySupplier(): PendingSupplierGroup[] {
  const eligible = getEligibleClaimsForReturn();
  const suppliers = loadSuppliers();

  const groupsMap = new Map<string, PendingSupplierGroup>();

  eligible.forEach((claim) => {
    const suppId = claim.supplierId || 'unassigned';
    const supp = suppliers.find((s) => s.id === suppId);

    if (!groupsMap.has(suppId)) {
      groupsMap.set(suppId, {
        supplierId: suppId,
        supplierName: claim.supplierName || supp?.name || 'ไม่ระบุผู้จำหน่าย',
        supplierPhone: supp?.phone,
        supplierContact: supp?.contactName,
        pendingCount: 0,
        totalItemsQuantity: 0,
        totalCostValue: 0,
        claims: [],
      });
    }

    const group = groupsMap.get(suppId)!;
    group.pendingCount += 1;
    group.totalItemsQuantity += Number(claim.quantity || 1);
    group.totalCostValue += Number(claim.totalCostValue || (claim.costPrice || 50) * (claim.quantity || 1));
    group.claims.push(claim);
  });

  return Array.from(groupsMap.values());
}

// ─── Create Supplier Return Note (RTN) ───
export interface CreateSupplierReturnItemInput {
  productId: string;
  productName: string;
  sku: string;
  unitName?: string;
  quantity: number;
  unitCost: number;
  itemType: SupplierReturnItemType;
  defectReason?: string;
  returnReason?: string;
  claimId?: string;
  poId?: string;
  poNumber?: string;
  poItemId?: string;
  originalOrderNumber?: string;
}

export interface CreateSupplierReturnParams {
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  linkedPoId?: string;
  linkedPoNumber?: string;
  items: CreateSupplierReturnItemInput[];
  customCreditAmount?: number;
  notes?: string;
  createdBy?: string;
  autoDeductFromPo?: boolean;
}

export interface CreateReturnNoteParams {
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  claimItems?: Array<{
    claimId: string;
    unitCost?: number;
  }>;
  items?: CreateSupplierReturnItemInput[];
  linkedPoId?: string;
  linkedPoNumber?: string;
  customCreditAmount?: number;
  notes?: string;
  createdBy?: string;
  autoDeductFromPo?: boolean;
}

/** Items, totals and claim ids of a return note, computed from the form (and claims for legacy claimItems). */
function buildReturnContent(params: CreateReturnNoteParams) {
  const returnItems: SupplierReturnItem[] = [];
  let totalQty = 0;
  let defectiveTotalCost = 0;
  let overstockTotalCost = 0;

  if (Array.isArray(params.items) && params.items.length > 0) {
    params.items.forEach((item) => {
      const itemTotalCost = Math.round(Number(item.unitCost) * Number(item.quantity) * 100) / 100;
      const rItem: SupplierReturnItem = {
        claimId: item.claimId,
        poId: item.poId || params.linkedPoId,
        poNumber: item.poNumber || params.linkedPoNumber,
        poItemId: item.poItemId,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        unitName: item.unitName || 'ชิ้น',
        quantity: Number(item.quantity),
        unitCost: Number(item.unitCost),
        totalCost: itemTotalCost,
        itemType: item.itemType || 'DEFECTIVE',
        defectReason: item.defectReason,
        returnReason: item.returnReason,
        originalOrderNumber: item.originalOrderNumber,
      };
      returnItems.push(rItem);
      totalQty += Number(item.quantity);
      if (rItem.itemType === 'DEFECTIVE') defectiveTotalCost += itemTotalCost;
      else overstockTotalCost += itemTotalCost;
    });
  } else if (Array.isArray(params.claimItems) && params.claimItems.length > 0) {
    // Legacy claimItems: item details come from the server's claims
    const claims = loadAllClaimRecords();
    params.claimItems.forEach((ci) => {
      const c = claims.find((row) => row.id === ci.claimId);
      if (!c) return;
      const unitCost = ci.unitCost ?? (c.costPrice || 50);
      const itemTotalCost = Math.round(unitCost * c.quantity * 100) / 100;
      returnItems.push({
        claimId: c.id,
        productId: c.productId,
        productName: c.productName,
        sku: c.sku,
        unitName: c.unitName,
        quantity: c.quantity,
        unitCost,
        totalCost: itemTotalCost,
        itemType: 'DEFECTIVE',
        defectReason: c.defectReason,
        originalOrderNumber: c.orderNumber,
      });
      totalQty += c.quantity;
      defectiveTotalCost += itemTotalCost;
    });
  }

  const itemsTotalCost = Math.round((defectiveTotalCost + overstockTotalCost) * 100) / 100;
  const totalCredit = params.customCreditAmount !== undefined && params.customCreditAmount >= 0
    ? Math.round(params.customCreditAmount * 100) / 100
    : itemsTotalCost;

  return {
    items: returnItems,
    totalQuantity: totalQty,
    defectiveTotalCost: Math.round(defectiveTotalCost * 100) / 100,
    overstockTotalCost: Math.round(overstockTotalCost * 100) / 100,
    totalCreditAmount: totalCredit,
  };
}

/** After the server accepted a change: reload notes, claims (re-linked by the server) and stock. */
async function refreshAfterReturnWrite(): Promise<void> {
  await Promise.allSettled([fetchSupplierReturnNotes(), fetchAllClaimRecords()]);
  if (typeof window !== 'undefined') {
    void useProductStore.getState().fetchProducts();
    window.dispatchEvent(new Event('pos-data-synced'));
  }
}

const failMessage = (err: any, fallback: string) => (err && err.message) ? `${fallback}: ${err.message}` : fallback;

// ─── Create Supplier Return Note (RTN) ───
// The server links the claims, deducts overstock stock and stores the note in one transaction;
// nothing is recorded on this device.
export async function createSupplierReturnNote(params: CreateReturnNoteParams): Promise<SupplierReturnNote> {
  if (!params.supplierId) throw new Error('กรุณาเลือกผู้จำหน่าย');
  const returnId = generateReturnDocNumber();
  const nowIso = new Date().toISOString();
  const content = buildReturnContent(params);
  const createdBy = params.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม';
  let saved: any;
  try {
    saved = await api.supplierReturns.create({
      returnNumber: returnId,
      noteNumber: returnId,
      returnDate: nowIso,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      supplierContact: params.supplierContact,
      supplierPhone: params.supplierPhone,
      supplierAddress: params.supplierAddress,
      linkedPoId: params.linkedPoId,
      linkedPoNumber: params.linkedPoNumber,
      ...content,
      totalAmount: content.totalCreditAmount,
      remainingCreditAmount: content.totalCreditAmount,
      status: 'PENDING_DEDUCTION',
      deductions: [],
      notes: params.notes,
      reason: params.notes || 'ส่งเคลม/คืนสินค้าบริษัท',
      createdBy,
      deductStock: true,
    });
  } catch (err) {
    throw new Error(failMessage(err, 'บันทึกเอกสารส่งคืนลงฐานข้อมูลไม่สำเร็จ'));
  }
  await refreshAfterReturnWrite();
  const serverNum = saved?.returnNumber || saved?.id || returnId;
  return (
    returnNotesMem.find((n) => n.id === serverNum) ||
    mapReturnNote({
      ...saved,
      returnNumber: serverNum,
      supplierName: params.supplierName,
      supplierContact: params.supplierContact,
      supplierPhone: params.supplierPhone,
      supplierAddress: params.supplierAddress,
      ...content,
      remainingCreditAmount: content.totalCreditAmount,
      notes: params.notes,
      createdBy,
    })
  );
}

// ─── Update Supplier Return Note (When not yet fully deducted) ───
export async function updateSupplierReturnNote(noteId: string, params: CreateReturnNoteParams): Promise<SupplierReturnNote> {
  const existingNote = returnNotesMem.find((n) => n.id === noteId);
  if (!existingNote) throw new Error('ไม่พบเอกสารส่งคืนที่ต้องการแก้ไข');
  if (existingNote.status === 'DEDUCTED') {
    throw new Error('เอกสารนี้ถูกหักลดหนี้ในบิลแล้ว ไม่สามารถแก้ไขได้โดยตรง (กรุณาย้อนสถานะก่อน)');
  }
  const content = buildReturnContent(params);
  const updatedNote: SupplierReturnNote = {
    ...existingNote,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    supplierContact: params.supplierContact,
    supplierPhone: params.supplierPhone,
    supplierAddress: params.supplierAddress,
    linkedPoId: params.linkedPoId,
    linkedPoNumber: params.linkedPoNumber,
    ...content,
    remainingCreditAmount: content.totalCreditAmount,
    notes: params.notes,
  };
  try {
    await apiFetch(`/supplier-returns/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updatedNote),
    });
  } catch (err) {
    throw new Error(failMessage(err, 'บันทึกการแก้ไขเอกสารส่งคืนไม่สำเร็จ'));
  }
  await refreshAfterReturnWrite();
  return returnNotesMem.find((n) => n.id === noteId) || updatedNote;
}

// ─── Cancel Supplier Return Note (server restores stock & claim statuses) ───
export async function cancelSupplierReturnNote(noteId: string): Promise<{ success: boolean; message: string }> {
  const note = returnNotesMem.find((n) => n.id === noteId);
  if (note?.status === 'CANCELLED') return { success: false, message: 'เอกสารนี้ถูกยกเลิกไปแล้ว' };
  try {
    await apiFetch(`/supplier-returns/${encodeURIComponent(noteId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'ยกเลิกเอกสารส่งคืน' }),
    });
  } catch (err) {
    return { success: false, message: failMessage(err, 'ยกเลิกเอกสารในฐานข้อมูลไม่สำเร็จ') };
  }
  await refreshAfterReturnWrite();
  return { success: true, message: `ย้ายเอกสารส่งคืน ${noteId} ไปที่ถังขยะ และคืนยอดสต็อก/สถานะเรียบร้อยแล้ว` };
}

// ─── Restore Cancelled Return Note from Trash ───
export async function restoreSupplierReturnNote(noteId: string): Promise<{ success: boolean; message: string }> {
  const note = returnNotesMem.find((n) => n.id === noteId);
  if (!note) return { success: false, message: 'ไม่พบเอกสารส่งคืน' };
  if (note.status !== 'CANCELLED') return { success: false, message: 'เอกสารนี้ไม่ได้อยู่ในสถานะยกเลิก' };
  try {
    await apiFetch(`/supplier-returns/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PENDING_DEDUCTION', remainingCreditAmount: note.totalCreditAmount }),
    });
  } catch (err) {
    return { success: false, message: failMessage(err, 'กู้คืนเอกสารในฐานข้อมูลไม่สำเร็จ') };
  }
  await refreshAfterReturnWrite();
  return { success: true, message: `กู้คืนเอกสารส่งคืน ${noteId} กลับมาใช้งานเรียบร้อยแล้ว` };
}

// ─── Deduct Return Note from Supplier PO Bill ───
export function getAvailableReturnNotesForSupplier(supplierId: string): SupplierReturnNote[] {
  const notes = loadSupplierReturnNotes();
  return notes.filter(
    (n) =>
      n.supplierId === supplierId &&
      (n.status === 'PENDING_DEDUCTION' || n.status === 'PARTIALLY_DEDUCTED') &&
      n.remainingCreditAmount > 0
  );
}

// ─── Change / Revert Supplier Return Note Status ───
export async function changeSupplierReturnStatus(
  noteId: string,
  newStatus: SupplierReturnNote['status'],
  _options?: { rollbackPo?: boolean },
): Promise<{ success: boolean; message: string; updatedNote?: SupplierReturnNote }> {
  const note = returnNotesMem.find((n) => n.id === noteId);
  if (!note) return { success: false, message: 'ไม่พบเอกสารส่งคืนที่ต้องการเปลี่ยนสถานะ' };
  const oldStatus = note.status;
  if (oldStatus === newStatus) return { success: true, message: 'สถานะเป็นสถานะเดิมอยู่แล้ว', updatedNote: note };
  if (newStatus === 'CANCELLED') return cancelSupplierReturnNote(noteId);

  let body: Record<string, unknown>;
  if ((oldStatus === 'DEDUCTED' || oldStatus === 'PARTIALLY_DEDUCTED') && newStatus === 'PENDING_DEDUCTION') {
    body = { status: 'PENDING_DEDUCTION', remainingCreditAmount: note.totalCreditAmount, deductions: [] };
  } else if (oldStatus === 'CANCELLED' && newStatus === 'PENDING_DEDUCTION') {
    body = { status: 'PENDING_DEDUCTION', remainingCreditAmount: note.totalCreditAmount, deductions: note.deductions };
  } else if (newStatus === 'DEDUCTED' && oldStatus === 'PENDING_DEDUCTION') {
    body = { status: 'DEDUCTED', remainingCreditAmount: 0, deductions: note.deductions };
  } else {
    body = { status: newStatus, remainingCreditAmount: note.remainingCreditAmount, deductions: note.deductions };
  }
  try {
    await apiFetch(`/supplier-returns/${encodeURIComponent(noteId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (err) {
    return { success: false, message: failMessage(err, 'เปลี่ยนสถานะในฐานข้อมูลไม่สำเร็จ') };
  }
  await refreshAfterReturnWrite();
  return {
    success: true,
    message: `เปลี่ยนสถานะเอกสาร ${noteId} เป็น "${newStatus}" เรียบร้อยแล้ว`,
    updatedNote: returnNotesMem.find((n) => n.id === noteId),
  };
}

export const updateSupplierReturnStatus = changeSupplierReturnStatus;
