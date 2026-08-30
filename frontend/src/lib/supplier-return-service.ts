import { ClaimRecord, SupplierReturnNote, SupplierReturnItem, SupplierReturnItemType } from './types';
import { loadAllClaimRecords, saveClaimRecords } from './claim-service';
import { useProductStore } from './store/product-store';

const STORAGE_KEY_RETURNS = 'pos_supplier_returns';
const STORAGE_KEY_SUPPLIERS = 'custom_suppliers';
const STORAGE_KEY_POS = 'custom_purchase_orders';
const STORAGE_KEY_PRODUCTS = 'custom_products';

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

// ─── Purchase Orders Storage Helpers ───
export function loadPurchaseOrders(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const supps = loadSuppliers();
        return parsed.map((po: any) => {
          if (!po.supplier || !po.supplier.name) {
            const supp = supps.find((s: any) => s.id === (po.supplierId || po.supplier?.id));
            if (supp) {
              return { ...po, supplier: supp, supplierName: supp.name };
            }
          }
          return po;
        });
      }
    }
  } catch {}
  return [];
}

export function savePurchaseOrders(pos: any[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(pos));
  } catch (err) {
    console.error('Failed to save POs to storage:', err);
  }
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
      const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
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
        (po.items || []).some((i: any) => i.productId === productId || i.sku === sku || (prod?.name && i.productName === prod.name))
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

  // If no supplier matched, assign default supplier #1
  if (!supplier) {
    supplier = suppliers[0] || DEFAULT_SUPPLIERS[0];
    supplierId = supplier.id;
  } else {
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

// ─── Query Products that Belong to a Specific Supplier ───
export function getProductsBySupplier(supplierId: string): any[] {
  let storeProducts: any[] = useProductStore.getState().products || [];
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        storeProducts = parsed;
      }
    } catch {}
  }

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
      return isMatchSupp && isNotCancelled;
    })
    .map((po) => {
      const totalAmount = Number(po.totalAmount || 0);
      const alreadyDeducted = (po.deductedReturns || []).reduce(
        (sum: number, r: any) => sum + Number(r.amount || 0),
        0
      );
      const remainingPayable = Math.max(0, totalAmount - alreadyDeducted);

      return {
        id: po.id,
        poNumber: po.poNumber,
        poDate: po.createdAt || po.issueDate || po.issuedAt || new Date().toISOString(),
        status: po.status,
        totalAmount,
        alreadyDeducted,
        remainingPayable,
        items: (po.items || []).map((i: any) => ({
          id: i.id,
          productId: i.productId,
          productName: i.productName,
          sku: i.sku,
          quantity: Number(i.quantity || 0),
          receivedQuantity: Number(i.receivedQuantity || i.quantity || 0),
          unitPrice: Number(i.unitPrice || i.costPrice || 0),
          unitName: i.unitName || 'ชิ้น',
        })),
      };
    })
    .filter((po) => po.remainingPayable > 0);
}

// ─── Get Claims Eligible to be Returned to Supplier ───
export function getEligibleClaimsForReturn(supplierId?: string): ClaimRecord[] {
  const allClaims = loadAllClaimRecords();
  const suppliers = loadSuppliers();
  const pos = loadPurchaseOrders();

  let storeProducts: any[] = useProductStore.getState().products || [];
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        storeProducts = parsed;
      }
    } catch {}
  }

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
        (i: any) => i.productId === claim.productId || i.sku === claim.sku || (claim.productName && i.productName === claim.productName)
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

      const totalCost = Math.round(cost * (c.quantity || 1) * 100) / 100;

      return {
        ...c,
        supplierId: suppId,
        supplierName: suppName,
        costPrice: cost,
        totalCostValue: c.totalCostValue || totalCost,
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

export function createSupplierReturnNote(params: CreateReturnNoteParams): SupplierReturnNote {
  const returnId = generateReturnDocNumber();
  const nowIso = new Date().toISOString();
  const allClaims = loadAllClaimRecords();

  const returnItems: SupplierReturnItem[] = [];
  let totalQty = 0;
  let defectiveTotalCost = 0;
  let overstockTotalCost = 0;

  // Case 1: Advanced items array provided (combines Defective and Overstock)
  if (Array.isArray(params.items) && params.items.length > 0) {
    const claimIdsToUpdate = new Set<string>();

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

      if (rItem.itemType === 'DEFECTIVE') {
        defectiveTotalCost += itemTotalCost;
        if (item.claimId) claimIdsToUpdate.add(item.claimId);
      } else {
        overstockTotalCost += itemTotalCost;
        // Deduct active store stock for unsold/overstock return
        if (typeof window !== 'undefined') {
          try {
            const rawProds = localStorage.getItem(STORAGE_KEY_PRODUCTS);
            if (rawProds) {
              const prods: any[] = JSON.parse(rawProds);
              const target = prods.find((p) => p.id === item.productId || p.sku === item.sku);
              if (target) {
                target.stock = Math.max(0, Number(target.stock || 0) - Number(item.quantity));
                localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(prods));
                useProductStore.getState().fetchProducts();
              }
            }
          } catch (e) {
            console.error('Failed to deduct inventory for overstock return:', e);
          }
        }
      }
    });

    // Update claim records if any
    if (claimIdsToUpdate.size > 0) {
      allClaims.forEach((c) => {
        if (claimIdsToUpdate.has(c.id)) {
          c.returnDocId = returnId;
          c.status = 'SENT_TO_SUPPLIER';
          c.supplierId = params.supplierId;
          c.supplierName = params.supplierName;
        }
      });
      saveClaimRecords(allClaims);
    }
  } else if (Array.isArray(params.claimItems) && params.claimItems.length > 0) {
    // Case 2: Legacy claimItems fallback
    const claimIdsToUpdate = new Set(params.claimItems.map((i) => i.claimId));

    allClaims.forEach((c) => {
      if (claimIdsToUpdate.has(c.id)) {
        const matchParam = params.claimItems!.find((p) => p.claimId === c.id);
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
          itemType: 'DEFECTIVE',
          defectReason: c.defectReason,
          originalOrderNumber: c.orderNumber,
        });

        totalQty += c.quantity;
        defectiveTotalCost += itemTotalCost;

        c.returnDocId = returnId;
        c.status = 'SENT_TO_SUPPLIER';
        c.supplierId = params.supplierId;
        c.supplierName = params.supplierName;
        c.costPrice = unitCost;
        c.totalCostValue = itemTotalCost;
      }
    });

    saveClaimRecords(allClaims);
  }

  const itemsTotalCost = Math.round((defectiveTotalCost + overstockTotalCost) * 100) / 100;
  const totalCredit = params.customCreditAmount !== undefined && params.customCreditAmount >= 0
    ? Math.round(params.customCreditAmount * 100) / 100
    : itemsTotalCost;

  const newReturnNote: SupplierReturnNote = {
    id: returnId,
    returnDate: nowIso,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    supplierContact: params.supplierContact,
    supplierPhone: params.supplierPhone,
    supplierAddress: params.supplierAddress,
    linkedPoId: params.linkedPoId,
    linkedPoNumber: params.linkedPoNumber,
    items: returnItems,
    totalQuantity: totalQty,
    defectiveTotalCost: Math.round(defectiveTotalCost * 100) / 100,
    overstockTotalCost: Math.round(overstockTotalCost * 100) / 100,
    totalCreditAmount: totalCredit,
    remainingCreditAmount: totalCredit,
    status: 'PENDING_DEDUCTION',
    notes: params.notes,
    createdBy: params.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม',
  };

  // If auto-deduct is requested against linked PO
  if (params.autoDeductFromPo && params.linkedPoId && totalCredit > 0) {
    try {
      const allPos = loadPurchaseOrders();
      const targetPo = allPos.find(
        (p) => p.id === params.linkedPoId || p.poNumber === params.linkedPoNumber
      );
      if (targetPo) {
        const poTotal = Number(targetPo.totalAmount || 0);
        const alreadyDeducted = (targetPo.deductedReturns || []).reduce(
          (sum: number, r: any) => sum + Number(r.amount || 0),
          0
        );
        const curPayable = Math.max(0, poTotal - alreadyDeducted);
        const actualDeduct = Math.min(totalCredit, curPayable);

        if (actualDeduct > 0) {
          const deductionEntry = {
            returnNoteId: returnId,
            returnNumber: returnId,
            amount: actualDeduct,
            deductedAt: nowIso,
            note: `หักลดยอดอัตโนมัติจากใบส่งคืน ${returnId}`,
          };

          targetPo.deductedReturns = [...(targetPo.deductedReturns || []), deductionEntry];
          targetPo.netAmountPayable = Math.max(0, curPayable - actualDeduct);
          savePurchaseOrders(allPos);

          newReturnNote.remainingCreditAmount = Math.max(0, Math.round((totalCredit - actualDeduct) * 100) / 100);
          newReturnNote.status = newReturnNote.remainingCreditAmount <= 0 ? 'DEDUCTED' : 'PARTIALLY_DEDUCTED';
          newReturnNote.deductions = [
            {
              billNumber: targetPo.poNumber || params.linkedPoNumber || 'PO',
              deductedAmount: actualDeduct,
              deductedAt: nowIso,
              netPaid: targetPo.netAmountPayable,
              note: `หักลดยอดในใบสั่งซื้อ ${targetPo.poNumber}`,
            },
          ];
        }
      }
    } catch (e) {
      console.error('Failed to auto-deduct PO balance:', e);
    }
  }

  const existingNotes = loadSupplierReturnNotes();
  existingNotes.unshift(newReturnNote);
  saveSupplierReturnNotes(existingNotes);

  return newReturnNote;
}

// ─── Cancel Supplier Return Note & Rollback ───
export function cancelSupplierReturnNote(noteId: string): { success: boolean; message: string } {
  const notes = loadSupplierReturnNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note) {
    return { success: false, message: 'ไม่พบเอกสารส่งคืนที่ต้องการยกเลิก' };
  }

  if (note.status === 'CANCELLED') {
    return { success: false, message: 'เอกสารนี้ถูกยกเลิกไปแล้ว' };
  }

  // 1. Rollback customer claims back to PENDING_SUPPLIER
  const allClaims = loadAllClaimRecords();
  allClaims.forEach((c) => {
    if (c.returnDocId === noteId) {
      c.returnDocId = undefined;
      c.status = 'PENDING_SUPPLIER';
    }
  });
  saveClaimRecords(allClaims);

  // 2. Rollback inventory stock for overstock items
  const overstockItems = note.items.filter((i) => i.itemType === 'OVERSTOCK');
  if (overstockItems.length > 0 && typeof window !== 'undefined') {
    try {
      const rawProds = localStorage.getItem(STORAGE_KEY_PRODUCTS);
      if (rawProds) {
        const prods: any[] = JSON.parse(rawProds);
        overstockItems.forEach((item) => {
          const p = prods.find((prod) => prod.id === item.productId || prod.sku === item.sku);
          if (p) {
            p.stock = Number(p.stock || 0) + Number(item.quantity);
          }
        });
        localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(prods));
        useProductStore.getState().fetchProducts();
      }
    } catch (e) {
      console.error('Failed to rollback overstock products:', e);
    }
  }

  // 3. Rollback PO deductions if applied
  if (note.deductions && note.deductions.length > 0) {
    try {
      const allPos = loadPurchaseOrders();
      note.deductions.forEach((d) => {
        const po = allPos.find((p) => p.poNumber === d.billNumber);
        if (po && Array.isArray(po.deductedReturns)) {
          po.deductedReturns = po.deductedReturns.filter((r: any) => r.returnNoteId !== noteId);
          const totalAmount = Number(po.totalAmount || 0);
          const totalDeducted = po.deductedReturns.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
          po.netAmountPayable = Math.max(0, totalAmount - totalDeducted);
        }
      });
      savePurchaseOrders(allPos);
    } catch (e) {
      console.error('Failed to rollback PO deductions:', e);
    }
  }

  note.status = 'CANCELLED';
  saveSupplierReturnNotes(notes);

  return { success: true, message: `ยกเลิกเอกสารส่งคืน ${noteId} และคืนยอดสต็อก/สถานะเรียบร้อยแล้ว` };
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

// ─── Update Supplier Return Note (When not yet fully deducted) ───
export function updateSupplierReturnNote(
  noteId: string,
  params: CreateReturnNoteParams
): SupplierReturnNote {
  const notes = loadSupplierReturnNotes();
  const existingIndex = notes.findIndex((n) => n.id === noteId);
  if (existingIndex < 0) {
    throw new Error('ไม่พบเอกสารส่งคืนที่ต้องการแก้ไข');
  }

  const existingNote = notes[existingIndex];
  if (existingNote.status === 'DEDUCTED') {
    throw new Error('เอกสารนี้ถูกหักลดหนี้ในบิลแล้ว ไม่สามารถแก้ไขได้โดยตรง (กรุณาย้อนสถานะก่อน)');
  }

  // 1. Rollback old overstock items from current store stock first
  const oldOverstockItems = existingNote.items.filter((i) => i.itemType === 'OVERSTOCK');
  if (oldOverstockItems.length > 0 && typeof window !== 'undefined') {
    try {
      const rawProds = localStorage.getItem(STORAGE_KEY_PRODUCTS);
      if (rawProds) {
        const prods: any[] = JSON.parse(rawProds);
        oldOverstockItems.forEach((item) => {
          const p = prods.find((prod) => prod.id === item.productId || prod.sku === item.sku);
          if (p) {
            p.stock = Number(p.stock || 0) + Number(item.quantity);
          }
        });
        localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(prods));
      }
    } catch (e) {}
  }

  // 2. Rollback old claims
  const allClaims = loadAllClaimRecords();
  allClaims.forEach((c) => {
    if (c.returnDocId === noteId) {
      c.returnDocId = undefined;
      c.status = 'PENDING_SUPPLIER';
    }
  });

  // 3. Process new items
  const newReturnItems: SupplierReturnItem[] = [];
  let totalQty = 0;
  let defectiveTotalCost = 0;
  let overstockTotalCost = 0;
  const claimIdsToUpdate = new Set<string>();

  (params.items || []).forEach((item) => {
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

    newReturnItems.push(rItem);
    totalQty += Number(item.quantity);

    if (rItem.itemType === 'DEFECTIVE') {
      defectiveTotalCost += itemTotalCost;
      if (item.claimId) claimIdsToUpdate.add(item.claimId);
    } else {
      overstockTotalCost += itemTotalCost;
      // Deduct new overstock quantity from store
      if (typeof window !== 'undefined') {
        try {
          const rawProds = localStorage.getItem(STORAGE_KEY_PRODUCTS);
          if (rawProds) {
            const prods: any[] = JSON.parse(rawProds);
            const target = prods.find((p) => p.id === item.productId || p.sku === item.sku);
            if (target) {
              target.stock = Math.max(0, Number(target.stock || 0) - Number(item.quantity));
              localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(prods));
            }
          }
        } catch (e) {}
      }
    }
  });

  if (typeof window !== 'undefined') {
    useProductStore.getState().fetchProducts();
  }

  // Update claim records
  allClaims.forEach((c) => {
    if (claimIdsToUpdate.has(c.id)) {
      c.returnDocId = noteId;
      c.status = 'SENT_TO_SUPPLIER';
      c.supplierId = params.supplierId;
      c.supplierName = params.supplierName;
    }
  });
  saveClaimRecords(allClaims);

  const itemsTotalCost = Math.round((defectiveTotalCost + overstockTotalCost) * 100) / 100;
  const totalCredit = params.customCreditAmount !== undefined && params.customCreditAmount >= 0
    ? Math.round(params.customCreditAmount * 100) / 100
    : itemsTotalCost;

  const updatedNote: SupplierReturnNote = {
    ...existingNote,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    supplierContact: params.supplierContact,
    supplierPhone: params.supplierPhone,
    supplierAddress: params.supplierAddress,
    linkedPoId: params.linkedPoId,
    linkedPoNumber: params.linkedPoNumber,
    items: newReturnItems,
    totalQuantity: totalQty,
    defectiveTotalCost: Math.round(defectiveTotalCost * 100) / 100,
    overstockTotalCost: Math.round(overstockTotalCost * 100) / 100,
    totalCreditAmount: totalCredit,
    remainingCreditAmount: totalCredit,
    notes: params.notes,
  };

  notes[existingIndex] = updatedNote;
  saveSupplierReturnNotes(notes);

  return updatedNote;
}

// ─── Change / Revert Supplier Return Note Status ───
export function changeSupplierReturnStatus(
  noteId: string,
  newStatus: SupplierReturnNote['status'],
  options?: { rollbackPo?: boolean }
): { success: boolean; message: string; updatedNote?: SupplierReturnNote } {
  const notes = loadSupplierReturnNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note) {
    return { success: false, message: 'ไม่พบเอกสารส่งคืนที่ต้องการเปลี่ยนสถานะ' };
  }

  const oldStatus = note.status;
  if (oldStatus === newStatus) {
    return { success: true, message: 'สถานะเป็นสถานะเดิมอยู่แล้ว', updatedNote: note };
  }

  // 1. If reverting from DEDUCTED / PARTIALLY_DEDUCTED back to PENDING_DEDUCTION
  if ((oldStatus === 'DEDUCTED' || oldStatus === 'PARTIALLY_DEDUCTED') && newStatus === 'PENDING_DEDUCTION') {
    // Rollback deductions in PO
    try {
      const allPos = loadPurchaseOrders();
      if (note.deductions && note.deductions.length > 0) {
        note.deductions.forEach((d) => {
          const po = allPos.find((p) => p.poNumber === d.billNumber);
          if (po && Array.isArray(po.deductedReturns)) {
            po.deductedReturns = po.deductedReturns.filter((r: any) => r.returnNoteId !== noteId);
            const totalAmount = Number(po.totalAmount || 0);
            const totalDeducted = po.deductedReturns.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
            po.netAmountPayable = Math.max(0, totalAmount - totalDeducted);
          }
        });
        savePurchaseOrders(allPos);
      }
    } catch (e) {
      console.error('Failed to rollback PO deduction on status change:', e);
    }

    note.remainingCreditAmount = note.totalCreditAmount;
    note.deductions = [];
    note.status = 'PENDING_DEDUCTION';
  } else if (newStatus === 'CANCELLED') {
    // 2. If cancelling
    return cancelSupplierReturnNote(noteId);
  } else if (oldStatus === 'CANCELLED' && newStatus === 'PENDING_DEDUCTION') {
    // 3. If reviving from CANCELLED
    // Re-deduct overstock items from store stock
    const overstockItems = note.items.filter((i) => i.itemType === 'OVERSTOCK');
    if (overstockItems.length > 0 && typeof window !== 'undefined') {
      try {
        const rawProds = localStorage.getItem(STORAGE_KEY_PRODUCTS);
        if (rawProds) {
          const prods: any[] = JSON.parse(rawProds);
          overstockItems.forEach((item) => {
            const p = prods.find((prod) => prod.id === item.productId || prod.sku === item.sku);
            if (p) {
              p.stock = Math.max(0, Number(p.stock || 0) - Number(item.quantity));
            }
          });
          localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(prods));
          useProductStore.getState().fetchProducts();
        }
      } catch (e) {}
    }

    // Re-link defective claims
    const claimIds = new Set(note.items.filter((i) => i.itemType === 'DEFECTIVE' && i.claimId).map((i) => i.claimId));
    if (claimIds.size > 0) {
      const allClaims = loadAllClaimRecords();
      allClaims.forEach((c) => {
        if (claimIds.has(c.id)) {
          c.returnDocId = noteId;
          c.status = 'SENT_TO_SUPPLIER';
        }
      });
      saveClaimRecords(allClaims);
    }

    note.remainingCreditAmount = note.totalCreditAmount;
    note.status = 'PENDING_DEDUCTION';
  } else if (newStatus === 'DEDUCTED' && oldStatus === 'PENDING_DEDUCTION') {
    // 4. Manually mark as deducted
    note.remainingCreditAmount = 0;
    note.status = 'DEDUCTED';
  } else {
    note.status = newStatus;
  }

  saveSupplierReturnNotes(notes);
  return { success: true, message: `เปลี่ยนสถานะเอกสาร ${noteId} เป็น "${newStatus}" เรียบร้อยแล้ว`, updatedNote: note };
}

