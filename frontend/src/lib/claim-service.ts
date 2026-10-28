import { ClaimRecord, ClaimEligibleItem, ClaimStatus, ClaimResolutionType } from './types';
import { useShiftStore } from './store/shift-store';
import { useProductStore } from './store/product-store';
import { newOperationId } from './order-sync-service';
import { isRetryableError } from './api-error';
import { toast } from 'sonner';
import { getProductPackagingUnits } from './cart-pricing';
import { apiFetch } from './api';

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

export async function fetchAllClaimRecords(): Promise<ClaimRecord[]> {
  const localClaims = loadAllClaimRecords();
  const localMap = new Map<string, ClaimRecord>();
  localClaims.forEach((c) => {
    if (c.id) localMap.set(c.id, c);
    if (c.orderNumber && c.productId) localMap.set(`${c.orderNumber}_${c.productId}`, c);
  });

  // Hydrate replacement warranties in background
  void fetchReplacementWarranties().catch(() => {});

  try {
    const res = await apiFetch('/claims?limit=500');
    const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : null);
    if (Array.isArray(list)) {
      let storeProducts: any[] = useProductStore.getState().products || [];
      if (!storeProducts.length && typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('custom_products');
          if (raw) storeProducts = JSON.parse(raw);
        } catch {}
      }

      const mapped: ClaimRecord[] = list.map((c: any) => {
        const claimId = c.claimNumber || c.id;
        const ordNum = c.order?.orderNumber || c.orderNumber || '-';
        const pId = c.productId || c.product?.id;
        const local = localMap.get(claimId) || localMap.get(`${ordNum}_${pId}`);

        const matchedProd = storeProducts.find((p: any) => p.id === pId || p.sku === c.product?.sku || p.sku === c.sku);
        const resolvedUnitPrice = Number(c.unitPrice ?? local?.unitPrice ?? matchedProd?.priceLevel1 ?? matchedProd?.basePrice ?? 0);
        const resolvedQty = Number(c.quantity ?? local?.quantity ?? 1);
        const resolvedClaimValue = Number(c.totalClaimValue ?? c.refundAmount ?? local?.totalClaimValue ?? (resolvedUnitPrice * resolvedQty));

        const resolvedResType = (c.resolutionType ||
          (c.claimType === 'REFUND'
            ? 'REFUND_CASH'
            : c.claimType === 'EXCHANGE'
              ? 'REPLACE_ITEM'
              : local?.resolutionType || 'REPLACE_ITEM')) as ClaimResolutionType;

        let resolvedStatus: ClaimStatus = 'COMPLETED';
        const rawStatus = c.frontendStatus || c.claimStatus || c.status;
        if (
          ['COMPLETED', 'PENDING_CHECKOUT', 'PENDING_SUPPLIER', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'SCRAPPED'].includes(
            rawStatus
          )
        ) {
          resolvedStatus = rawStatus as ClaimStatus;
        } else if (rawStatus === 'IN_PROGRESS') {
          resolvedStatus = c.returnDocId || local?.returnDocId ? 'SENT_TO_SUPPLIER' : 'PENDING_SUPPLIER';
        } else if (rawStatus === 'PENDING') {
          resolvedStatus = resolvedResType === 'STORE_DISCOUNT' ? 'PENDING_CHECKOUT' : 'PENDING_SUPPLIER';
        } else if (rawStatus === 'REJECTED') {
          resolvedStatus = 'SCRAPPED';
        } else if (local?.status) {
          resolvedStatus = local.status;
        }

        return {
          id: claimId,
          orderId: c.orderId || c.order?.id || local?.orderId || '',
          orderNumber: ordNum !== '-' ? ordNum : (local?.orderNumber || '-'),
          orderDate: c.orderDate || c.order?.createdAt || c.createdAt || local?.orderDate || new Date().toISOString(),
          claimDate: c.claimDate || c.receivedDate || c.createdAt || local?.claimDate || new Date().toISOString(),
          customerId: c.customerId ?? c.customer?.id ?? local?.customerId ?? null,
          customerName: c.customer?.name || c.customerName || local?.customerName || 'ลูกค้าทั่วไป',
          customerPhone: c.customer?.phone || c.customerPhone || local?.customerPhone || '-',
          productId: pId,
          productName: c.product?.name || c.productName || matchedProd?.name || local?.productName || 'สินค้า',
          sku: c.product?.sku || c.sku || matchedProd?.sku || local?.sku || '-',
          unitName: c.unitName || local?.unitName || matchedProd?.unit || 'ชิ้น',
          quantity: resolvedQty,
          conversionFactor: Number(c.conversionFactor ?? local?.conversionFactor ?? 1),
          baseQuantity: Number(c.baseQuantity ?? local?.baseQuantity ?? resolvedQty),
          replacementProductId: c.replacementProductId ?? local?.replacementProductId,
          replacementProductName: c.replacementProductName ?? local?.replacementProductName,
          replacementSku: c.replacementSku ?? local?.replacementSku,
          replacementUnitName: c.replacementUnitName ?? local?.replacementUnitName,
          replacementConversionFactor: c.replacementConversionFactor ?? local?.replacementConversionFactor,
          unitPrice: resolvedUnitPrice,
          totalClaimValue: resolvedClaimValue,
          refundAmount: c.refundAmount ?? local?.refundAmount,
          refundAccountId: c.refundAccountId ?? local?.refundAccountId,
          refundAccountLabel: c.refundAccountLabel ?? local?.refundAccountLabel,
          refundAccountNumber: c.refundAccountNumber ?? local?.refundAccountNumber,
          discountAmount: c.discountAmount ?? local?.discountAmount,
          defectReason: c.defectReason || c.problemDescription || local?.defectReason || '-',
          resolutionType: resolvedResType,
          status: resolvedStatus,
          cashierName: c.cashierName || local?.cashierName || 'พนักงาน POS',
          note: c.note ?? c.resolutionNote ?? local?.note,
          isReplacementItem: c.isReplacementItem ?? local?.isReplacementItem,
          parentClaimId: c.parentClaimId ?? local?.parentClaimId,
          claimedInOrderNumber: c.claimedInOrderNumber ?? local?.claimedInOrderNumber,
          supplierId: c.supplierId ?? local?.supplierId,
          supplierName: c.supplierName ?? local?.supplierName,
          supplierTrackingNo: c.supplierTrackingNo ?? local?.supplierTrackingNo,
          costPrice: c.costPrice !== undefined ? Number(c.costPrice) : local?.costPrice,
          totalCostValue: c.totalCostValue !== undefined ? Number(c.totalCostValue) : local?.totalCostValue,
          returnDocId: c.returnDocId ?? local?.returnDocId,
          settledInBillNumber: c.settledInBillNumber ?? local?.settledInBillNumber,
          completedDate: c.completedDate ?? local?.completedDate,
        };
      });

      saveClaimRecords(mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[ClaimService] Failed to fetch claims from backend:', err);
  }
  return loadAllClaimRecords();
}

export async function fetchReplacementWarranties(): Promise<ReplacementWarrantyRecord[]> {
  try {
    const res = await apiFetch('/claims/warranties/list');
    const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : null);
    if (Array.isArray(list)) {
      saveReplacementWarranties(list);
      return list;
    }
  } catch (err) {
    console.warn('[ClaimService] Failed to fetch replacement warranties from backend:', err);
  }
  return loadReplacementWarranties();
}

export async function createReplacementWarranty(record: ReplacementWarrantyRecord): Promise<ReplacementWarrantyRecord> {
  const list = loadReplacementWarranties().filter((r) => r.id !== record.id && r.originalClaimId !== record.originalClaimId);
  list.unshift(record);
  saveReplacementWarranties(list);
  try {
    const saved = await apiFetch('/claims/warranties', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    if (saved && saved.id) {
      return saved;
    }
  } catch (err) {
    console.warn('[ClaimService] Failed to sync replacement warranty to backend:', err);
  }
  return record;
}

export async function markReplacementWarrantyClaimed(idOrOriginalClaimId: string, claimId: string): Promise<void> {
  const rwList = loadReplacementWarranties();
  const targetRw = rwList.find((r) => r.id === idOrOriginalClaimId || r.originalClaimId === idOrOriginalClaimId);
  if (targetRw) {
    targetRw.isClaimed = true;
    targetRw.claimId = claimId;
    saveReplacementWarranties(rwList);
  }
  try {
    await apiFetch(`/claims/warranties/${encodeURIComponent(targetRw?.id || idOrOriginalClaimId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isClaimed: true, claimId }),
    });
  } catch (err) {
    console.warn('[ClaimService] Failed to update replacement warranty on backend:', err);
  }
}

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

// ─── Generate Unique Claim Number (CLM-YYMMxxxxx) ───

export function generateClaimNumber(): string {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `CLM-${yy}${mm}`;
  const existing = loadAllClaimRecords();
  const monthClaims = existing.filter((c) => (c.id || '').startsWith(prefix));
  const seq = (monthClaims.length + 1).toString().padStart(5, '0');
  return `${prefix}${seq}`;
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

export async function fetchClaimEligibleItems(query: ClaimVerificationQuery): Promise<ClaimEligibleItem[]> {
  let backendOrders: any[] = [];
  let allClaims: ClaimRecord[] = [];
  try {
    const [res, claims] = await Promise.all([
      apiFetch('/orders?limit=500'),
      fetchAllClaimRecords().catch(() => []),
      fetchReplacementWarranties().catch(() => []),
    ]);
    backendOrders = res?.data || (Array.isArray(res) ? res : []);
    allClaims = claims || [];
  } catch (err) {
    console.warn('[ClaimService] Failed to fetch orders from backend:', err);
  }

  const localOrders = useShiftStore.getState().completedOrders || [];
  const orderMap = new Map<string, any>();

  // Overlay local orders
  localOrders.forEach((o) => {
    const key = o.orderNumber || o.id;
    if (key) orderMap.set(key, o);
  });

  // Merge backend orders
  backendOrders.forEach((b) => {
    const key = b.orderNumber || b.id;
    const existing = orderMap.get(key);
    const bItems = Array.isArray(b.items)
      ? b.items.map((it: any) => ({
          ...it,
          productId: it.productId || it.product?.id,
          name: it.product?.name || it.name || 'สินค้า',
          productName: it.product?.name || it.name || 'สินค้า',
          sku: it.product?.sku || it.sku || '',
          unitName: it.product?.unit || it.unitName || 'ชิ้น',
          unitPrice: Number(it.unitPrice || 0),
          quantity: Number(it.quantity || 1),
          bundleData: it.bundleData,
        }))
      : [];

    orderMap.set(key, {
      ...b,
      ...(existing || {}),
      items: existing?.items && existing.items.length > 0 ? existing.items : bItems,
      customerName: b.customer?.name || b.customerName || existing?.customerName || 'ลูกค้าทั่วไป',
      customerPhone: b.customer?.phone || b.customerPhone || existing?.customerPhone || '',
      orderNumber: b.orderNumber || key,
      status: b.status,
      createdAt: b.createdAt,
    });
  });

  return verifyClaimEligibility(query, Array.from(orderMap.values()), allClaims);
}

export function verifyClaimEligibility(
  query: ClaimVerificationQuery,
  customOrders?: any[],
  customClaims?: ClaimRecord[]
): ClaimEligibleItem[] {
  const keyword = (query.searchKeyword || '').trim().toLowerCase();
  const targetOrderNum = (query.orderNumber || '').trim().toLowerCase();
  const targetPhone = (query.customerPhone || '').trim().toLowerCase();
  const targetName = (query.customerName || '').trim().toLowerCase();
  const targetSku = (query.sku || '').trim().toLowerCase();
  const targetProductId = query.productId;

  // 1. Collect all completed orders from customOrders or Shift Store
  let allOrders: any[] = [];
  if (customOrders && Array.isArray(customOrders)) {
    allOrders = customOrders;
  } else {
    const localOrders = useShiftStore.getState().completedOrders || [];
    const orderMap = new Map<string, any>();

    localOrders.forEach((o) => {
      const key = o.orderNumber || o.id;
      if (key) orderMap.set(key, o);
    });

    allOrders = Array.from(orderMap.values());
  }
  const allExistingClaims = customClaims || loadAllClaimRecords();
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

    // 2. Unpack bundle items if any, so that child components can be claimed individually
    const flattenedOrderItems: any[] = [];
    (order.items || []).forEach((item: any) => {
      const pId = item.productId || item.id;
      const prodSku = (item.sku || item.code || '').toLowerCase();
      const matchedProd = allCatalogProducts.find(
        (p: any) => p.id === pId || p.sku === prodSku || p.sku === pId || p.id === prodSku
      );

      const hasBundleData = Array.isArray(item.bundleData) && item.bundleData.length > 0;
      const isBundleProd = Boolean(matchedProd && matchedProd.isBundle && Array.isArray(matchedProd.bundleItems) && matchedProd.bundleItems.length > 0);

      if (hasBundleData || isBundleProd) {
        const bundleComponents = hasBundleData
          ? item.bundleData
          : (matchedProd?.bundleItems || []).map((bi: any) => ({
              productId: bi.childProductId,
              productName: bi.childProduct?.name,
              sku: bi.childProduct?.sku,
              quantityPerBundle: bi.quantity,
              totalQuantity: bi.quantity * (Number(item.quantity) || 1),
              unitPrice: Number(bi.childProduct?.basePrice || bi.childProduct?.priceLevel1 || 0),
            }));

        bundleComponents.forEach((child: any) => {
          const childId = child.productId || child.childProductId;
          const childProd = allCatalogProducts.find((p: any) => p.id === childId || p.sku === child.sku);
          const childBoughtQty = Number(child.totalQuantity || (child.quantityPerBundle * Number(item.quantity || 1)) || 1);
          const childUnitPrice = Number(child.unitPrice || childProd?.priceLevel1 || childProd?.basePrice || 0);

          flattenedOrderItems.push({
            productId: childId,
            name: `${child.productName || childProd?.name || 'สินค้า'} (จากชุด: ${item.name || item.productName || 'สินค้าชุด'})`,
            sku: child.sku || childProd?.sku || '',
            quantity: childBoughtQty,
            unitPrice: childUnitPrice,
            unitName: childProd?.unit || 'ชิ้น',
            conversionFactor: 1,
            isFromBundle: true,
            parentBundleName: item.name || item.productName,
          });
        });
      } else {
        flattenedOrderItems.push(item);
      }
    });

    flattenedOrderItems.forEach((item: any) => {
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
  skipStockDeduction?: boolean;
  fulfilledInOrderNumber?: string;
  fulfilledInOrderId?: string;
}

export async function processClaim(params: ProcessClaimParams): Promise<ClaimRecord> {
  let claimId = generateClaimNumber();
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

  const body = {
    orderId: params.item.orderId,
    customerId: params.item.customerId,
    productId: params.item.productId,
    quantity: params.quantity,
    conversionFactor: claimFactor,
    replacementProductId: claimRecord.replacementProductId,
    replacementConversionFactor: claimRecord.replacementConversionFactor,
    claimType: params.resolutionType === 'REPLACE_ITEM' ? 'EXCHANGE' : params.resolutionType.startsWith('REFUND') ? 'REFUND' : 'WARRANTY',
    problemDescription: params.defectReason || 'เคลมสินค้าหน้าร้าน POS',
    note: params.note,
    status: initialStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
    skipStockDeduction: Boolean(params.skipStockDeduction),
    fulfilledInOrderNumber: params.fulfilledInOrderNumber,
    fulfilledInOrderId: params.fulfilledInOrderId,
  };
  const richPayload = {
    ...body,
    orderNumber: params.item.orderNumber,
    orderDate: params.item.orderDate,
    customerName: params.item.customerName,
    customerPhone: params.item.customerPhone,
    productName: params.item.productName,
    sku: params.item.sku,
    unitName: claimUnitName,
    baseQuantity: baseQty,
    unitPrice: claimUnitPrice,
    totalClaimValue: totalClaimVal,
    defectReason: params.defectReason,
    resolutionType: params.resolutionType,
    frontendStatus: initialStatus,
    refundAmount: claimRecord.refundAmount,
    refundAccountId: claimRecord.refundAccountId,
    refundAccountLabel: claimRecord.refundAccountLabel,
    refundAccountNumber: claimRecord.refundAccountNumber,
    discountAmount: claimRecord.discountAmount,
    replacementProductName: claimRecord.replacementProductName,
    replacementSku: claimRecord.replacementSku,
    replacementUnitName: claimRecord.replacementUnitName,
    cashierName: claimRecord.cashierName,
    isReplacementItem: params.item.isReplacementWarranty,
    originalClaimId: params.item.originalClaimId,
    supplierId: claimRecord.supplierId,
    supplierName: claimRecord.supplierName,
    costPrice: claimRecord.costPrice,
    totalCostValue: claimRecord.totalCostValue,
    skipStockDeduction: Boolean(params.skipStockDeduction),
    fulfilledInOrderNumber: params.fulfilledInOrderNumber,
    fulfilledInOrderId: params.fulfilledInOrderId,
  };
  let attemptKey: string | undefined;
  let requestBody: any = richPayload;
  if (params.resolutionType === 'REPLACE_ITEM') {
    const owner = JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.user?.id;
    if (!owner) throw new Error('กรุณาเข้าสู่ระบบก่อนเปลี่ยนสินค้า');
    const orderKey = params.item.orderId || params.fulfilledInOrderNumber || params.fulfilledInOrderId || 'direct';
    attemptKey = 'purim-exchange-attempt:' + owner + ':' + orderKey + ':' + params.item.productId;
    const fingerprint = JSON.stringify(body);
    const previous = localStorage.getItem(attemptKey);
    const attempt = previous ? JSON.parse(previous) : { fingerprint, clientClaimId: newOperationId() };
    if (attempt.fingerprint !== fingerprint) throw new Error('มีรายการเปลี่ยนสินค้าที่ไม่ทราบผล กรุณาส่งข้อมูลเดิมซ้ำก่อนแก้รายการ');
    localStorage.setItem(attemptKey, JSON.stringify(attempt));
    requestBody = { ...richPayload, clientClaimId: attempt.clientClaimId };
  }
  let confirmed: any;
  try {
    confirmed = await apiFetch('/claims', { method: 'POST', body: JSON.stringify(requestBody) });
  } catch (error) {
    if (attemptKey && !isRetryableError(error)) localStorage.removeItem(attemptKey);
    throw error;
  }
  if (!confirmed?.id || !confirmed?.claimNumber) throw new Error('ยังไม่ได้รับการยืนยันเคลมจากฐานข้อมูล กรุณาตรวจสอบหรือส่งข้อมูลเดิมซ้ำ');
  claimId = confirmed.claimNumber;
  claimRecord.id = claimId;
  // From here on, the DB transaction has committed; cache failures cannot undo it.
  try {
  const existingClaims = loadAllClaimRecords().filter(row => row.id !== claimId);
  existingClaims.unshift(claimRecord);
  saveClaimRecords(existingClaims);

  // 2. If this claim was for an existing replacement warranty, mark it as claimed
  if (params.item.isReplacementWarranty && params.item.originalClaimId) {
    void markReplacementWarrantyClaimed(params.item.originalClaimId, claimId);
  }

  // 3. If resolution is 'REPLACE_ITEM', establish a NEW Replacement Warranty for the new unit!
  if (params.resolutionType === 'REPLACE_ITEM') {
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
    void createReplacementWarranty(newRw);
  }

  // 4. If resolution is 'REFUND_CASH', deduct cash from active POS shift drawer!
  if (params.resolutionType === 'REFUND_CASH') {
    try {
      const { useShiftStore } = require('./store/shift-store');
      const shiftStore = useShiftStore.getState();
      if (shiftStore && shiftStore.isShiftOpen()) {
        const cashRefundAmt = params.refundAmount ?? totalClaimVal;
        shiftStore.recordClaimRefund(cashRefundAmt, claimId, params.defectReason);
      }
    } catch (e) {
      console.warn('Could not deduct cash from shift for claim refund:', e);
    }
  }

  } catch {
    toast.warning('ฐานข้อมูลบันทึกเคลมแล้ว แต่ปรับข้อมูลสำรองในเครื่องไม่สำเร็จ กรุณาโหลดข้อมูลใหม่');
  }
  if (attemptKey) { try { localStorage.removeItem(attemptKey); } catch {} }
  void useProductStore.getState().fetchProducts();
  window.dispatchEvent(new Event('pos-data-synced'));
  return claimRecord;
}

// ─── Update Claim Status (e.g. Sent to Supplier, Replaced by Supplier, Scrapped) ───

export function updateClaimStatus(
  claimId: string,
  newStatus: ClaimStatus,
  options?: {
    supplierId?: string;
    supplierName?: string;
    supplierTrackingNo?: string;
    note?: string;
    claimedInOrderNumber?: string;
    returnDocId?: string | null;
    settledInBillNumber?: string;
  }
): ClaimRecord | null {
  const claims = loadAllClaimRecords();
  const target = claims.find((c) => c.id === claimId);

  if (target) {
    target.status = newStatus;
    if (options?.supplierId !== undefined) target.supplierId = options.supplierId;
    if (options?.supplierName !== undefined) target.supplierName = options.supplierName;
    if (options?.supplierTrackingNo !== undefined) target.supplierTrackingNo = options.supplierTrackingNo;
    if (options?.claimedInOrderNumber !== undefined) target.claimedInOrderNumber = options.claimedInOrderNumber;
    if (options?.returnDocId !== undefined) {
      target.returnDocId = options.returnDocId || undefined;
    }
    if (options?.settledInBillNumber !== undefined) {
      target.settledInBillNumber = options.settledInBillNumber;
    }
    if (options?.note) target.note = `${target.note ? target.note + '\n' : ''}${options.note}`;

    if (newStatus === 'COMPLETED' || newStatus === 'SUPPLIER_REPLACED') {
      target.completedDate = new Date().toISOString();
    }

    saveClaimRecords(claims);
  }

  void apiFetch(`/claims/${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: newStatus,
      frontendStatus: newStatus,
      supplierId: options?.supplierId,
      supplierName: options?.supplierName,
      supplierTrackingNo: options?.supplierTrackingNo,
      claimedInOrderNumber: options?.claimedInOrderNumber,
      returnDocId: options?.returnDocId,
      settledInBillNumber: options?.settledInBillNumber,
      note: target?.note ?? options?.note,
      resolutionNote: target?.note ?? options?.note,
      completedDate: target?.completedDate,
    }),
  }).catch((err) => console.warn('[ClaimService] Failed to sync claim status update to backend:', err));

  return target || null;
}

export async function markClaimsAsReturnedToSupplier(
  claimIds: string[],
  returnDocId: string,
  supplierId?: string,
  supplierName?: string
): Promise<void> {
  const uniqueIds = Array.from(new Set(claimIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const claims = loadAllClaimRecords();
  claims.forEach((c) => {
    if (uniqueIds.includes(c.id)) {
      c.returnDocId = returnDocId;
      c.status = 'SENT_TO_SUPPLIER';
      if (supplierId) c.supplierId = supplierId;
      if (supplierName) c.supplierName = supplierName;
    }
  });
  saveClaimRecords(claims);

  await Promise.allSettled(
    uniqueIds.map((cid) =>
      apiFetch(`/claims/${encodeURIComponent(cid)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'SENT_TO_SUPPLIER',
          frontendStatus: 'SENT_TO_SUPPLIER',
          returnDocId,
          supplierId,
          supplierName,
        }),
      })
    )
  );
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
