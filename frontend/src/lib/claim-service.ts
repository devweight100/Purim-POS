import { ClaimRecord, ClaimEligibleItem, ClaimStatus, ClaimResolutionType } from './types';
import { useShiftStore } from './store/shift-store';
import { useProductStore } from './store/product-store';
import { orders as mockOrders } from './mock-data';
import { deductClaimReplacementStock } from './stock-service';
import { getProductPackagingUnits } from './cart-pricing';

const STORAGE_KEY_CLAIMS = 'pos_product_claims';
const STORAGE_KEY_REPLACEMENTS = 'pos_replacement_warranties';

export interface ReplacementWarrantyRecord {
  id: string; // RWM-XXXX
  originalClaimId: string;
  originalOrderId: string;
  originalOrderNumber: string;
  replacementDate: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  productId: string;
  productName: string;
  sku: string;
  unitName: string;
  unitPrice: number;
  isClaimed: boolean;
  claimId?: string;
}

// ─── Local Storage Handlers ───

export function loadAllClaimRecords(): ClaimRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CLAIMS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load claims:', err);
    return [];
  }
}

export function saveClaimRecords(claims: ClaimRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CLAIMS, JSON.stringify(claims));
  } catch (err) {
    console.error('Failed to save claims:', err);
  }
}

export function loadReplacementWarranties(): ReplacementWarrantyRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REPLACEMENTS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load replacement warranties:', err);
    return [];
  }
}

export function saveReplacementWarranties(records: ReplacementWarrantyRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_REPLACEMENTS, JSON.stringify(records));
  } catch (err) {
    console.error('Failed to save replacement warranties:', err);
  }
}

// ─── Generate Unique Claim Number (CLM-YYYYMMDD-XXXX) ───

export function generateClaimNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const existing = loadAllClaimRecords();
  const todayClaims = existing.filter((c) => c.id.startsWith(`CLM-${dateStr}`));
  const seq = (todayClaims.length + 1).toString().padStart(4, '0');
  return `CLM-${dateStr}-${seq}`;
}

// ─── Search & Verify Purchase History & Calculate Remaining Claim Quotas ───

export interface ClaimVerificationQuery {
  orderNumber?: string;
  customerPhone?: string;
  customerName?: string;
  productId?: string;
  sku?: string;
  searchKeyword?: string;
}

export function verifyClaimEligibility(query: ClaimVerificationQuery): ClaimEligibleItem[] {
  const keyword = (query.searchKeyword || '').trim().toLowerCase();
  const targetOrderNum = (query.orderNumber || '').trim().toLowerCase();
  const targetPhone = (query.customerPhone || '').trim().toLowerCase();
  const targetName = (query.customerName || '').trim().toLowerCase();
  const targetSku = (query.sku || '').trim().toLowerCase();
  const targetProductId = query.productId;

  // 1. Collect all completed orders from Shift Store and Mock Data
  const localOrders = useShiftStore.getState().completedOrders || [];
  const orderMap = new Map<string, any>();

  localOrders
    .filter((o) => !o.orderNumber?.startsWith('ORD-2026') && !o.id?.startsWith('ORD-2026'))
    .forEach((o) => {
      const key = o.orderNumber || o.id;
      if (key) orderMap.set(key, o);
    });

  mockOrders
    .filter((o) => !o.orderNumber?.startsWith('ORD-2026') && !o.id?.startsWith('ORD-2026'))
    .forEach((o) => {
      const key = o.orderNumber || o.id;
      if (key && !orderMap.has(key)) orderMap.set(key, o);
    });

  const allOrders = Array.from(orderMap.values());
  const allExistingClaims = loadAllClaimRecords();
  const replacementWarranties = loadReplacementWarranties();

  const results: ClaimEligibleItem[] = [];

  // 2. Iterate through all orders and match items
  allOrders.forEach((order) => {
    // Skip voided or cancelled orders
    if (order.status === 'VOIDED' || order.status === 'CANCELLED') return;

    const ordNum = (order.orderNumber || order.id || '').toLowerCase();
    const custName = (order.customerName || order.customer || 'ลูกค้าทั่วไป').toLowerCase();
    const custPhone = (order.customerPhone || '').toLowerCase();

    // Check header level filters
    if (targetOrderNum && !ordNum.includes(targetOrderNum)) return;
    if (targetPhone && !custPhone.includes(targetPhone)) return;
    if (targetName && !custName.includes(targetName)) return;

    // Load master products to resolve units and conversion factors
    let allCatalogProducts: any[] = [];
    if (typeof window !== 'undefined') {
      try {
        const rawCustom = localStorage.getItem('custom_products');
        if (rawCustom) allCatalogProducts = JSON.parse(rawCustom);
      } catch {}
    }
    if (!allCatalogProducts || allCatalogProducts.length === 0) {
      allCatalogProducts = useProductStore.getState().products || [];
    }

    (order.items || []).forEach((item: any) => {
      const prodName = (item.name || item.productName || 'สินค้า').toLowerCase();
      const prodSku = (item.sku || item.code || '').toLowerCase();
      const pId = item.productId || item.id;

      if (targetSku && !prodSku.includes(targetSku)) return;
      if (targetProductId && pId !== targetProductId) return;

      // Keyword match (matches orderNumber, customer name, phone, product name, or SKU)
      if (keyword) {
        const matchesAny =
          ordNum.includes(keyword) ||
          custName.includes(keyword) ||
          custPhone.includes(keyword) ||
          prodName.includes(keyword) ||
          prodSku.includes(keyword);

        if (!matchesAny) return;
      }

      // Match with catalog product
      const matchedProd = allCatalogProducts.find(
        (p: any) => p.id === pId || p.sku === prodSku || p.sku === pId || p.id === prodSku
      );

      // 1. Get real packaging unit configurations for this product
      const pkgConfigs = getProductPackagingUnits(pId, matchedProd?.units);

      // 2. Determine conversion factor of the purchased unit
      let purchasedFactor = 1;
      const itemUName = (item.unitName || 'ชิ้น').trim();

      if (item.conversionFactor && Number(item.conversionFactor) > 0) {
        purchasedFactor = Number(item.conversionFactor);
      } else {
        // Find in packaging unit configs
        const matchedPkg = pkgConfigs.find(
          (u) => u.name.trim().toLowerCase() === itemUName.toLowerCase() ||
                 itemUName.toLowerCase().includes(u.name.trim().toLowerCase())
        );
        if (matchedPkg && Number(matchedPkg.multiplier) > 0) {
          purchasedFactor = Number(matchedPkg.multiplier);
        } else if (matchedProd && Array.isArray(matchedProd.units)) {
          const u = matchedProd.units.find(
            (u: any) => (u.unitName || u.name || '').trim().toLowerCase() === itemUName.toLowerCase()
          );
          if (u && Number(u.factor) > 0) {
            purchasedFactor = Number(u.factor);
          }
        }
      }

      const boughtQty = Number(item.quantity || 1);
      const baseBoughtQuantity = boughtQty * purchasedFactor;

      // Calculate total base quantity already claimed for this specific order + product line
      const matchingClaims = allExistingClaims.filter(
        (c) =>
          (c.orderId === order.id || c.orderNumber === order.orderNumber) &&
          (c.productId === pId || c.sku === item.sku)
      );

      const alreadyClaimedBase = matchingClaims.reduce((sum, c) => {
        const cFactor = Number(c.conversionFactor || 1);
        const cBase = Number(c.baseQuantity !== undefined ? c.baseQuantity : (Number(c.quantity || 1) * cFactor));
        return sum + cBase;
      }, 0);

      const availableBaseClaimQty = Math.max(0, baseBoughtQuantity - alreadyClaimedBase);
      const availableClaimQty = Math.floor(availableBaseClaimQty / purchasedFactor);

      // 3. Collect available units that can be selected for claim:
      // CRITICAL RULE: Available units MUST ONLY BE <= purchasedFactor!
      // (e.g. If customer bought "แพ็ค" (10), "ลัง" (120) MUST NEVER appear!)
      let availableUnits: Array<{ id: string; unitName: string; factor: number; price: number; barcode?: string }> = [];

      if (pkgConfigs && pkgConfigs.length > 0) {
        availableUnits = pkgConfigs
          .filter((u) => Number(u.multiplier || 1) <= purchasedFactor)
          .map((u) => {
            const uFactor = Number(u.multiplier || 1);
            let uPrice = Number(u.priceLevel1 || 0);
            if (!uPrice || uPrice <= 0) {
              uPrice = (Number(item.unitPrice || 0) / purchasedFactor) * uFactor;
            }
            return {
              id: `u-${pId}-${u.name}`,
              unitName: u.name,
              factor: uFactor,
              price: uPrice,
              barcode: u.barcode || '',
            };
          })
          .sort((a: { factor: number }, b: { factor: number }) => b.factor - a.factor);
      } else if (matchedProd && Array.isArray(matchedProd.units) && matchedProd.units.length > 0) {
        availableUnits = matchedProd.units
          .filter((u: any) => Number(u.factor || 1) <= purchasedFactor)
          .map((u: any) => {
            const uFactor = Number(u.factor || 1);
            let uPrice = Number(u.price || 0);
            if (!uPrice || uPrice <= 0) {
              uPrice = (Number(item.unitPrice || 0) / purchasedFactor) * uFactor;
            }
            return {
              id: u.id || `u-${u.unitName}`,
              unitName: u.unitName || u.name || 'ชิ้น',
              factor: uFactor,
              price: uPrice,
              barcode: u.barcode || '',
            };
          })
          .sort((a: { factor: number }, b: { factor: number }) => b.factor - a.factor);
      }

      if (availableUnits.length === 0) {
        if (purchasedFactor > 1) {
          availableUnits = [
            {
              id: `u-${itemUName}`,
              unitName: itemUName,
              factor: purchasedFactor,
              price: Number(item.unitPrice || 0),
            },
            {
              id: 'u-base',
              unitName: 'ชิ้น',
              factor: 1,
              price: Number(item.unitPrice || 0) / purchasedFactor,
            },
          ];
        } else {
          availableUnits = [
            {
              id: `u-${itemUName || 'ชิ้น'}`,
              unitName: itemUName || 'ชิ้น',
              factor: 1,
              price: Number(item.unitPrice || 0),
            },
          ];
        }
      } else {
        const hasPurchasedUnit = availableUnits.some(
          (u) => u.unitName.toLowerCase() === itemUName.toLowerCase()
        );
        if (!hasPurchasedUnit) {
          availableUnits.unshift({
            id: `u-${itemUName}`,
            unitName: itemUName,
            factor: purchasedFactor,
            price: Number(item.unitPrice || 0),
          });
        }
      }

      // STRICT FILTER: NEVER include any unit larger than what customer purchased!
      availableUnits = availableUnits
        .filter((u) => u.factor <= purchasedFactor)
        .sort((a, b) => b.factor - a.factor);

      const baseUnitPrice = Number(item.unitPrice || item.price || 0) / purchasedFactor;

      results.push({
        orderId: order.id || order.orderNumber,
        orderNumber: order.orderNumber || order.id,
        orderDate: order.createdAt || new Date().toISOString(),
        customerId: order.customerId,
        customerName: order.customerName || order.customer || 'ลูกค้าทั่วไป',
        customerPhone: order.customerPhone,
        productId: pId,
        productName: item.name || item.productName || 'สินค้า',
        sku: item.sku || item.code || '',
        unitName: item.unitName || 'ชิ้น',
        conversionFactor: purchasedFactor,
        boughtQuantity: boughtQty,
        alreadyClaimedQuantity: Math.round(alreadyClaimedBase / purchasedFactor * 100) / 100,
        availableClaimQuantity: availableClaimQty,
        baseBoughtQuantity,
        alreadyClaimedBaseQuantity: alreadyClaimedBase,
        availableBaseClaimQuantity: availableBaseClaimQty,
        baseUnitPrice,
        availableUnits,
        unitPrice: Number(item.unitPrice || item.price || 0),
        isReplacementWarranty: false,
      });
    });
  });

  // 3. Also check Replacement Warranties (สินค้าตัวใหม่ที่เคยเปลี่ยนให้ลูกค้าแล้วนำมาเคลมซ้ำ)
  replacementWarranties.forEach((rw) => {
    if (rw.isClaimed) return; // already claimed again

    const custName = (rw.customerName || '').toLowerCase();
    const custPhone = (rw.customerPhone || '').toLowerCase();
    const prodName = (rw.productName || '').toLowerCase();
    const prodSku = (rw.sku || '').toLowerCase();
    const ordNum = (rw.originalOrderNumber || '').toLowerCase();

    if (targetOrderNum && !ordNum.includes(targetOrderNum)) return;
    if (targetPhone && !custPhone.includes(targetPhone)) return;
    if (targetName && !custName.includes(targetName)) return;
    if (targetSku && !prodSku.includes(targetSku)) return;

    if (keyword) {
      const matchesAny =
        ordNum.includes(keyword) ||
        custName.includes(keyword) ||
        custPhone.includes(keyword) ||
        prodName.includes(keyword) ||
        prodSku.includes(keyword);

      if (!matchesAny) return;
    }

    results.push({
      orderId: rw.originalOrderId,
      orderNumber: rw.originalOrderNumber,
      orderDate: rw.replacementDate,
      customerId: rw.customerId,
      customerName: rw.customerName,
      customerPhone: rw.customerPhone,
      productId: rw.productId,
      productName: `${rw.productName} (ตัวเปลี่ยนประกันใหม่)`,
      sku: rw.sku,
      unitName: rw.unitName,
      boughtQuantity: 1,
      alreadyClaimedQuantity: 0,
      availableClaimQuantity: 1,
      unitPrice: rw.unitPrice,
      isReplacementWarranty: true,
      originalClaimId: rw.originalClaimId,
    });
  });

  // Sort: available items first, then by date descending
  return results.sort((a, b) => {
    if (a.availableClaimQuantity > 0 && b.availableClaimQuantity <= 0) return -1;
    if (b.availableClaimQuantity > 0 && a.availableClaimQuantity <= 0) return 1;
    return new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime();
  });
}

// ─── Process & Save New Claim ───

export interface ProcessClaimParams {
  item: ClaimEligibleItem;
  quantity: number;
  chosenUnitName?: string;
  chosenUnitFactor?: number;
  chosenUnitPrice?: number;
  defectReason: string;
  resolutionType: ClaimResolutionType;
  cashierName: string;
  note?: string;
  refundAmount?: number;
  refundAccountId?: string;
  refundAccountLabel?: string;
  refundAccountNumber?: string;
  discountAmount?: number;
  replacementProductId?: string;
  replacementProductName?: string;
  replacementSku?: string;
  replacementUnitName?: string;
  replacementConversionFactor?: number;
}

export function processClaim(params: ProcessClaimParams): ClaimRecord {
  const claimId = generateClaimNumber();
  const nowStr = new Date().toISOString();

  const claimUnitName = params.chosenUnitName || params.item.unitName;
  const claimFactor = Number(params.chosenUnitFactor || params.item.conversionFactor || 1);
  const claimUnitPrice = params.chosenUnitPrice !== undefined ? params.chosenUnitPrice : params.item.unitPrice;
  const totalClaimVal = params.quantity * claimUnitPrice;
  const baseQty = params.quantity * claimFactor;

  // Determine initial status based on resolution type
  let initialStatus: ClaimStatus = 'COMPLETED';
  if (params.resolutionType === 'SUPPLIER_RMA') {
    initialStatus = 'PENDING_SUPPLIER';
  } else if (params.resolutionType === 'STORE_DISCOUNT') {
    initialStatus = 'PENDING_CHECKOUT';
  }

  const claimRecord: ClaimRecord = {
    id: claimId,
    claimDate: nowStr,
    orderId: params.item.orderId,
    orderNumber: params.item.orderNumber,
    orderDate: params.item.orderDate,
    customerId: params.item.customerId,
    customerName: params.item.customerName,
    customerPhone: params.item.customerPhone,
    productId: params.item.productId,
    productName: params.item.productName,
    sku: params.item.sku,
    unitName: claimUnitName,
    conversionFactor: claimFactor,
    quantity: params.quantity,
    baseQuantity: baseQty,
    unitPrice: claimUnitPrice,
    totalClaimValue: totalClaimVal,
    defectReason: params.defectReason,
    resolutionType: params.resolutionType,
    refundAmount:
      params.resolutionType === 'REFUND_CASH' || params.resolutionType === 'REFUND_TRANSFER'
        ? params.refundAmount ?? totalClaimVal
        : undefined,
    refundAccountId: params.resolutionType === 'REFUND_TRANSFER' ? params.refundAccountId : undefined,
    refundAccountLabel: params.resolutionType === 'REFUND_TRANSFER' ? params.refundAccountLabel : undefined,
    refundAccountNumber: params.resolutionType === 'REFUND_TRANSFER' ? params.refundAccountNumber : undefined,
    discountAmount:
      params.resolutionType === 'STORE_DISCOUNT'
        ? params.discountAmount ?? totalClaimVal
        : undefined,
    replacementProductId: params.replacementProductId || params.item.productId,
    replacementProductName: params.replacementProductName || params.item.productName,
    replacementSku: params.replacementSku || params.item.sku,
    replacementUnitName: params.replacementUnitName || claimUnitName,
    replacementConversionFactor: params.replacementConversionFactor || claimFactor,
    status: initialStatus,
    cashierName: params.cashierName || 'พนักงาน POS',
    note: params.note,
    isReplacementItem: params.item.isReplacementWarranty,
    completedDate: initialStatus === 'COMPLETED' ? nowStr : undefined,
    supplierId: undefined, // will be resolved below
    supplierName: undefined,
    costPrice: 0,
    totalCostValue: 0,
  };

  try {
    // Dynamic lookup of supplier and cost price
    const { resolveProductSupplierAndCost } = require('./supplier-return-service');
    const suppCost = resolveProductSupplierAndCost(params.item.productId, params.item.sku);
    claimRecord.supplierId = suppCost.supplierId;
    claimRecord.supplierName = suppCost.supplierName;
    claimRecord.costPrice = suppCost.costPrice;
    claimRecord.totalCostValue = Math.round(suppCost.costPrice * params.quantity * 100) / 100;
  } catch {}

  // 1. Save Claim Record
  const existingClaims = loadAllClaimRecords();
  existingClaims.unshift(claimRecord);
  saveClaimRecords(existingClaims);

  // 2. If this claim was for an existing replacement warranty, mark it as claimed
  if (params.item.isReplacementWarranty && params.item.originalClaimId) {
    const rwList = loadReplacementWarranties();
    const targetRw = rwList.find((r) => r.originalClaimId === params.item.originalClaimId);
    if (targetRw) {
      targetRw.isClaimed = true;
      targetRw.claimId = claimId;
      saveReplacementWarranties(rwList);
    }
  }

  // 3. If resolution is 'REPLACE_ITEM', establish a NEW Replacement Warranty for the new unit!
  if (params.resolutionType === 'REPLACE_ITEM') {
    const rwList = loadReplacementWarranties();
    const replFactor = Number(params.replacementConversionFactor || claimFactor);
    const newRw: ReplacementWarrantyRecord = {
      id: `RWM-${Date.now()}`,
      originalClaimId: claimId,
      originalOrderId: params.item.orderId,
      originalOrderNumber: params.item.orderNumber,
      replacementDate: nowStr,
      customerId: params.item.customerId,
      customerName: params.item.customerName,
      customerPhone: params.item.customerPhone,
      productId: params.replacementProductId || params.item.productId,
      productName: params.replacementProductName || params.item.productName,
      sku: params.replacementSku || params.item.sku,
      unitName: params.replacementUnitName || claimUnitName,
      unitPrice: claimUnitPrice,
      isClaimed: false,
    };
    rwList.unshift(newRw);
    saveReplacementWarranties(rwList);

    // Deduct inventory stock of the replacement product and log stock movement
    deductClaimReplacementStock(
      {
        productId: params.replacementProductId || params.item.productId,
        sku: params.replacementSku || params.item.sku,
        name: params.replacementProductName || params.item.productName,
        unitName: params.replacementUnitName || claimUnitName,
        quantity: params.quantity,
        conversionFactor: replFactor,
      },
      claimId,
      params.cashierName || 'เจ้าหน้าที่รับเคลม'
    );
  }

  return claimRecord;
}

// ─── Update Claim Status (e.g. Sent to Supplier, Replaced by Supplier, Scrapped) ───

export function updateClaimStatus(
  claimId: string,
  newStatus: ClaimStatus,
  options?: {
    supplierName?: string;
    supplierTrackingNo?: string;
    note?: string;
    claimedInOrderNumber?: string;
  }
): ClaimRecord | null {
  const claims = loadAllClaimRecords();
  const target = claims.find((c) => c.id === claimId);
  if (!target) return null;

  target.status = newStatus;
  if (options?.supplierName) target.supplierName = options.supplierName;
  if (options?.supplierTrackingNo) target.supplierTrackingNo = options.supplierTrackingNo;
  if (options?.claimedInOrderNumber) target.claimedInOrderNumber = options.claimedInOrderNumber;
  if (options?.note) target.note = `${target.note ? target.note + '\n' : ''}${options.note}`;

  if (newStatus === 'COMPLETED' || newStatus === 'SUPPLIER_REPLACED') {
    target.completedDate = new Date().toISOString();
  }

  saveClaimRecords(claims);
  return target;
}

// ─── Get Summary KPI for Claims & Defective Stock ───

export function getClaimStockSummary(customClaims?: ClaimRecord[]) {
  const claims = customClaims !== undefined ? customClaims : loadAllClaimRecords();

  let totalClaims = claims.length;
  let totalClaimValue = 0;
  let pendingSupplierCount = 0;
  let completedCount = 0;
  let scrappedCount = 0;
  let replacedItemCount = 0;
  let refundedCount = 0;
  let discountedCount = 0;

  claims.forEach((c) => {
    totalClaimValue += Number(c.totalClaimValue || 0);

    if (c.status === 'PENDING_SUPPLIER' || c.status === 'SENT_TO_SUPPLIER') {
      pendingSupplierCount++;
    } else if (c.status === 'COMPLETED' || c.status === 'SUPPLIER_REPLACED') {
      completedCount++;
    } else if (c.status === 'SCRAPPED') {
      scrappedCount++;
    }

    if (c.resolutionType === 'REPLACE_ITEM') replacedItemCount += Number(c.quantity || 1);
    else if (c.resolutionType === 'REFUND_CASH' || c.resolutionType === 'REFUND_TRANSFER') refundedCount += Number(c.quantity || 1);
    else if (c.resolutionType === 'STORE_DISCOUNT') discountedCount += Number(c.quantity || 1);
  });

  return {
    totalClaims,
    totalClaimValue,
    pendingSupplierCount,
    completedCount,
    scrappedCount,
    replacedItemCount,
    refundedCount,
    discountedCount,
  };
}
