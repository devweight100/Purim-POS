import { ClaimRecord, SupplierReturnNote, SupplierReturnItem } from './types';
import { loadAllClaimRecords, saveClaimRecords } from './claim-service';
import { useProductStore } from './store/product-store';

const STORAGE_KEY_RETURNS = 'pos_supplier_returns';
const STORAGE_KEY_SUPPLIERS = 'custom_suppliers';

// ─── Default Suppliers Fallback ───
export const DEFAULT_SUPPLIERS = [
  { id: "supp_1", name: "บริษัท ปุริม ซัพพลาย จำกัด", contactName: "คุณสมชาย", phone: "081-234-5678", email: "contact@purimsupply.com", address: "123 ถ.สุขุมวิท กรุงเทพฯ", creditTerms: 30 },
  { id: "supp_2", name: "บจก. สยามเทรดดิ้ง แอนด์ ดีสทริบิวชั่น", contactName: "คุณวิภา", phone: "089-876-5432", email: "sales@siamtrading.co.th", address: "456 ถ.รัชดาภิเษก กรุงเทพฯ", creditTerms: 15 },
  { id: "supp_3", name: "หจก. รวมสินค้าค้าส่ง", contactName: "คุณกิตติ", phone: "02-999-8888", email: "wholesale@ruamkhong.com", address: "789 ถ.พหลโยธิน กรุงเทพฯ", creditTerms: 45 },
];

export function loadSuppliers(): any[] {
  if (typeof window === 'undefined') return DEFAULT_SUPPLIERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SUPPLIERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_SUPPLIERS;
}

// ─── Local Storage for Supplier Return Notes ───

export function loadSupplierReturnNotes(): SupplierReturnNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RETURNS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load supplier return notes:', err);
    return [];
  }
}

export function saveSupplierReturnNotes(notes: SupplierReturnNote[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_RETURNS, JSON.stringify(notes));
  } catch (err) {
    console.error('Failed to save supplier return notes:', err);
  }
}

export function generateReturnDocNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RTN-${y}${m}${d}-${rand}`;
}

// ─── Helper to resolve Product's Supplier & Cost ───

export function resolveProductSupplierAndCost(productId: string, sku?: string): {
  supplierId: string;
  supplierName: string;
  costPrice: number;
} {
  let storeProducts: any[] = useProductStore.getState().products || [];
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('custom_products');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        storeProducts = parsed;
      }
    } catch {}
  }
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

  // If no supplier matched, assign default supplier #1
  if (!supplier) {
    supplier = suppliers[0] || DEFAULT_SUPPLIERS[0];
    supplierId = supplier.id;
  }

  const supplierEntryCost = supplierEntry?.lastCost !== undefined ? Number(supplierEntry.lastCost) : 0;
  let costPrice = Number(prod?.costPrice || prod?.basePrice || supplierEntryCost || 0);
  if (costPrice <= 0) {
    const firstUnitPrice = Number(prod?.units?.[0]?.price || 0);
    costPrice = firstUnitPrice > 0 ? firstUnitPrice : 0;
  }

  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    costPrice: Math.round(costPrice * 100) / 100,
  };
}

// ─── Get Claims Eligible to be Returned to Supplier ───

export function getEligibleClaimsForReturn(): ClaimRecord[] {
  const allClaims = loadAllClaimRecords();

  return allClaims
    .filter((c) =>
      !c.returnDocId &&
      c.status !== 'SCRAPPED' &&
      c.resolutionType === 'SUPPLIER_RMA' &&
      c.status === 'PENDING_SUPPLIER'
    )
    .map((c) => {
      // Auto-populate supplier and cost if not present
      if (!c.supplierId || !c.costPrice) {
        const resolved = resolveProductSupplierAndCost(c.productId, c.sku);
        const unitCost = c.costPrice || resolved.costPrice;
        const totalCost = Math.round((unitCost * (c.quantity || 1)) * 100) / 100;

        return {
          ...c,
          supplierId: c.supplierId || resolved.supplierId,
          supplierName: c.supplierName || resolved.supplierName,
          costPrice: unitCost,
          totalCostValue: c.totalCostValue || totalCost,
        };
      }
      return c;
    });
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
    const suppId = claim.supplierId || 'supp_1';
    const supp = suppliers.find((s) => s.id === suppId) || DEFAULT_SUPPLIERS[0];

    if (!groupsMap.has(suppId)) {
      groupsMap.set(suppId, {
        supplierId: suppId,
        supplierName: claim.supplierName || supp.name,
        supplierPhone: supp.phone,
        supplierContact: supp.contactName,
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

export interface CreateReturnNoteParams {
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  claimItems: Array<{
    claimId: string;
    unitCost?: number;
  }>;
  notes?: string;
  createdBy?: string;
}

export function createSupplierReturnNote(params: CreateReturnNoteParams): SupplierReturnNote {
  const returnId = generateReturnDocNumber();
  const nowIso = new Date().toISOString();
  const allClaims = loadAllClaimRecords();

  const returnItems: SupplierReturnItem[] = [];
  let totalQty = 0;
  let totalCost = 0;

  const claimIdsToUpdate = new Set(params.claimItems.map((i) => i.claimId));

  allClaims.forEach((c) => {
    if (claimIdsToUpdate.has(c.id)) {
      const matchParam = params.claimItems.find((p) => p.claimId === c.id);
      const unitCost = matchParam?.unitCost ?? (c.costPrice || 50);
      const itemTotalCost = Math.round(unitCost * c.quantity * 100) / 100;

      returnItems.push({
        claimId: c.id,
        productId: c.productId,
        productName: c.productName,
        sku: c.sku,
        unitName: c.unitName,
        quantity: c.quantity,
        unitCost: unitCost,
        totalCost: itemTotalCost,
        defectReason: c.defectReason,
        originalOrderNumber: c.orderNumber,
      });

      totalQty += c.quantity;
      totalCost += itemTotalCost;

      // Update claim record status
      c.returnDocId = returnId;
      c.status = 'SENT_TO_SUPPLIER';
      c.supplierId = params.supplierId;
      c.supplierName = params.supplierName;
      c.costPrice = unitCost;
      c.totalCostValue = itemTotalCost;
    }
  });

  saveClaimRecords(allClaims);

  const newReturnNote: SupplierReturnNote = {
    id: returnId,
    returnDate: nowIso,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    supplierContact: params.supplierContact,
    supplierPhone: params.supplierPhone,
    supplierAddress: params.supplierAddress,
    items: returnItems,
    totalQuantity: totalQty,
    totalCreditAmount: Math.round(totalCost * 100) / 100,
    remainingCreditAmount: Math.round(totalCost * 100) / 100,
    status: 'PENDING_DEDUCTION',
    notes: params.notes,
    createdBy: params.createdBy || 'เจ้าหน้าที่ฝ่ายเคลม',
  };

  const existingNotes = loadSupplierReturnNotes();
  existingNotes.unshift(newReturnNote);
  saveSupplierReturnNotes(existingNotes);

  return newReturnNote;
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

export function deductReturnNoteFromBill(
  returnNoteId: string,
  billNumber: string,
  amountToDeduct: number,
  billTotal: number,
  note?: string
): { success: boolean; netPayable: number; actualDeducted: number; message: string } {
  const notes = loadSupplierReturnNotes();
  const target = notes.find((n) => n.id === returnNoteId);

  if (!target) {
    return { success: false, netPayable: billTotal, actualDeducted: 0, message: 'ไม่พบเอกสารส่งคืนสินค้านี้' };
  }

  const actualDeduct = Math.min(amountToDeduct, target.remainingCreditAmount, billTotal);
  target.remainingCreditAmount = Math.max(0, Math.round((target.remainingCreditAmount - actualDeduct) * 100) / 100);

  if (target.remainingCreditAmount <= 0) {
    target.status = 'DEDUCTED';
  } else {
    target.status = 'PARTIALLY_DEDUCTED';
  }

  const deductionEntry = {
    billNumber,
    deductedAmount: actualDeduct,
    deductedAt: new Date().toISOString(),
    netPaid: Math.max(0, billTotal - actualDeduct),
    note,
  };

  target.deductions = [...(target.deductions || []), deductionEntry];
  saveSupplierReturnNotes(notes);

  // Also update claims linked to this return note
  const allClaims = loadAllClaimRecords();
  allClaims.forEach((c) => {
    if (c.returnDocId === returnNoteId) {
      c.settledInBillNumber = billNumber;
      if (target.status === 'DEDUCTED') {
        c.status = 'COMPLETED';
        c.completedDate = new Date().toISOString();
      }
    }
  });
  saveClaimRecords(allClaims);

  const netPayable = Math.max(0, Math.round((billTotal - actualDeduct) * 100) / 100);
  return {
    success: true,
    netPayable,
    actualDeducted: actualDeduct,
    message: `หักลดยอดสินค้าเคลมคืนสำเร็จ ฿${actualDeduct.toLocaleString()} (ยอดชำระสุทธิคงเหลือ ฿${netPayable.toLocaleString()})`,
  };
}
