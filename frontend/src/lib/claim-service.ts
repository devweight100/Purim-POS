import {
  ClaimRecord, ClaimEligibleItem, ClaimStatus, ClaimResolutionType, Product, ApiClaim, ApiListResponse, ApiOrderItem,
  ApiOrderLike, apiListRows,
} from './types';
import { useShiftStore } from './store/shift-store';
import { useProductStore } from './store/product-store';
import { newOperationId } from './order-sync-service';
import { isRetryableError, errorText } from './api-error';
import { toast } from 'sonner';
import { getProductPackagingUnits } from './cart-pricing';
import { apiFetch } from './api';

/**
 * Claims and replacement warranties live on the server only. The last server response is kept
 * in memory (never in localStorage) for synchronous lookups; fetch* refresh it and throw when
 * the server cannot be reached.
 */
let claimsMem: ClaimRecord[] = [];
let warrantiesMem: ReplacementWarrantyRecord[] = [];

const CLAIM_STATUSES: readonly string[] = ['COMPLETED', 'PENDING_CHECKOUT', 'PENDING_SUPPLIER', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'SCRAPPED'];

/** An order as the claim checks read it (server order with names filled in). */
type ClaimOrderRow = ApiOrderLike & { orderNumber: string };
/** A sold line; bundle children carry where they came from. */
type ClaimOrderLine = ApiOrderItem & { isFromBundle?: boolean; parentBundleName?: string };
/** One child of a bundle line (OrderItem.bundleData entry, or built from the product's bundleItems). */
interface BundleComponent {
  productId?: string;
  childProductId?: string;
  productName?: string;
  sku?: string;
  quantityPerBundle?: number;
  totalQuantity?: number;
  unitPrice?: number;
}

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

// ─── Server reads ───

/** All claims from the server. Throws when the server cannot be reached. */
/** Server claim -> the claim record the pages and the printed claim document use. */
export function mapServerClaim(c: ApiClaim, storeProducts: Product[] = useProductStore.getState().products || []): ClaimRecord {
  const claimId = c.claimNumber || c.id;
  const ordNum = c.order?.orderNumber || c.orderNumber || '-';
  const pId = (c.productId || c.product?.id) ?? '';

  const matchedProd = storeProducts.find((p) => p.id === pId || p.sku === c.product?.sku || p.sku === c.sku);
  const resolvedUnitPrice = Number(c.unitPrice ?? matchedProd?.priceLevel1 ?? matchedProd?.basePrice ?? 0);
  const resolvedQty = Number(c.quantity ?? 1);
  const resolvedClaimValue = Number(c.totalClaimValue ?? c.refundAmount ?? (resolvedUnitPrice * resolvedQty));

  const resolvedResType = (c.resolutionType ||
    (c.claimType === 'REFUND'
      ? 'REFUND_CASH'
      : c.claimType === 'EXCHANGE'
        ? 'REPLACE_ITEM'
        : 'REPLACE_ITEM')) as ClaimResolutionType;

  let resolvedStatus: ClaimStatus = 'COMPLETED';
  const rawStatus = c.frontendStatus || c.claimStatus || c.status;
  if (rawStatus !== undefined && CLAIM_STATUSES.includes(rawStatus)) {
    resolvedStatus = rawStatus as ClaimStatus;
  } else if (rawStatus === 'IN_PROGRESS') {
    resolvedStatus = c.returnDocId ? 'SENT_TO_SUPPLIER' : 'PENDING_SUPPLIER';
  } else if (rawStatus === 'PENDING') {
    resolvedStatus = resolvedResType === 'STORE_DISCOUNT' ? 'PENDING_CHECKOUT' : 'PENDING_SUPPLIER';
  } else if (rawStatus === 'REJECTED') {
    resolvedStatus = 'SCRAPPED';
  }

  return {
    id: claimId,
    orderId: c.orderId || c.order?.id || '',
    orderNumber: ordNum !== '-' ? ordNum : '-',
    orderDate: c.orderDate || c.order?.createdAt || c.createdAt || new Date().toISOString(),
    claimDate: c.claimDate || c.receivedDate || c.createdAt || new Date().toISOString(),
    customerId: c.customerId ?? c.customer?.id ?? null,
    customerName: c.customer?.name || c.customerName || 'ลูกค้าทั่วไป',
    customerPhone: c.customer?.phone || c.customerPhone || '-',
    productId: pId,
    productName: c.product?.name || c.productName || matchedProd?.name || 'สินค้า',
    sku: c.product?.sku || c.sku || matchedProd?.sku || '-',
    unitName: c.unitName || matchedProd?.unit || 'ชิ้น',
    quantity: resolvedQty,
    conversionFactor: Number(c.conversionFactor ?? 1),
    baseQuantity: Number(c.baseQuantity ?? resolvedQty),
    replacementProductId: c.replacementProductId,
    replacementProductName: c.replacementProductName,
    replacementSku: c.replacementSku,
    replacementUnitName: c.replacementUnitName,
    replacementConversionFactor: c.replacementConversionFactor,
    unitPrice: resolvedUnitPrice,
    totalClaimValue: resolvedClaimValue,
    refundAmount: c.refundAmount,
    refundAccountId: c.refundAccountId,
    refundAccountLabel: c.refundAccountLabel,
    refundAccountNumber: c.refundAccountNumber,
    discountAmount: c.discountAmount,
    defectReason: c.defectReason || c.problemDescription || '-',
    resolutionType: resolvedResType,
    status: resolvedStatus,
    cashierName: c.cashierName || 'พนักงาน POS',
    note: c.note ?? c.resolutionNote,
    isReplacementItem: c.isReplacementItem,
    parentClaimId: c.parentClaimId,
    claimedInOrderNumber: c.claimedInOrderNumber,
    supplierId: c.supplierId,
    supplierName: c.supplierName,
    supplierTrackingNo: c.supplierTrackingNo,
    costPrice: c.costPrice !== undefined ? Number(c.costPrice) : undefined,
    totalCostValue: c.totalCostValue !== undefined ? Number(c.totalCostValue) : undefined,
    returnDocId: c.returnDocId,
    settledInBillNumber: c.settledInBillNumber,
    completedDate: c.completedDate,
  };
}

export async function fetchAllClaimRecords(): Promise<ClaimRecord[]> {
  // Hydrate replacement warranties in background
  void fetchReplacementWarranties().catch(() => {});

  const res = await apiFetch<ApiListResponse<ApiClaim> | null>('/claims?limit=500');
  const list = apiListRows(res);
  if (!Array.isArray(list)) throw new Error('ข้อมูลเคลมจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  {
    {
      const storeProducts: Product[] = useProductStore.getState().products || [];

      const mapped: ClaimRecord[] = list.map((c) => mapServerClaim(c, storeProducts));

      claimsMem = mapped;
      return mapped;
    }
  }
}

/**
 * Ids of these bills that have a claim, by order id or by bill number, over every claim on the server
 * (GET /claims/claimed-orders, 500 ids per request). Throws when the server cannot be reached.
 */
export async function fetchClaimedOrderIds(orderIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const res = await apiFetch<string[] | null>(`/claims/claimed-orders?orderIds=${chunk.map(encodeURIComponent).join(',')}`);
    if (!Array.isArray(res)) throw new Error('ข้อมูลเคลมจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    res.forEach((id) => out.add(id));
  }
  return out;
}

/**
 * Every claim that can still be sent back to a supplier (not on a return note, not scrapped), from
 * GET /claims/returnable. Does not touch the claims kept by fetchAllClaimRecords. Throws when the server cannot be reached.
 */
export async function fetchReturnableClaimRecords(): Promise<ClaimRecord[]> {
  const res = await apiFetch<ApiListResponse<ApiClaim> | null>('/claims/returnable');
  const list = apiListRows(res);
  if (!Array.isArray(list)) throw new Error('ข้อมูลเคลมจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  const storeProducts: Product[] = useProductStore.getState().products || [];
  return list.map((c) => mapServerClaim(c, storeProducts));
}

/** Replacement warranties from the server. Throws when the server cannot be reached. */
export async function fetchReplacementWarranties(): Promise<ReplacementWarrantyRecord[]> {
  const res = await apiFetch<ApiListResponse<ReplacementWarrantyRecord> | null>('/claims/warranties/list');
  const list = apiListRows(res);
  if (!Array.isArray(list)) throw new Error('ข้อมูลการรับประกันจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  warrantiesMem = list;
  return list;
}

/** Last claims the server returned in this session (empty until the first fetch). */
export function loadAllClaimRecords(): ClaimRecord[] {
  return claimsMem;
}

/** Last replacement warranties the server returned in this session. */
export function loadReplacementWarranties(): ReplacementWarrantyRecord[] {
  return warrantiesMem;
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

/**
 * Bills that can still be claimed, from the server's orders, claims and warranties.
 * Throws when the server cannot be reached (claim quotas must never come from stale data).
 */
export async function fetchClaimEligibleItems(query: ClaimVerificationQuery): Promise<ClaimEligibleItem[]> {
  const [res, claims] = await Promise.all([
    apiFetch<ApiListResponse<ApiOrderLike> | null>('/orders?limit=500'),
    fetchAllClaimRecords(),
    fetchReplacementWarranties(),
  ]);
  const backendOrders: ApiOrderLike[] = (res && !Array.isArray(res) ? res.data : undefined) || (Array.isArray(res) ? res : []);
  const allClaims: ClaimRecord[] = claims || [];

  const orderMap = new Map<string, ClaimOrderRow>();

  // Orders from the server
  backendOrders.forEach((b) => {
    const key = (b.orderNumber || b.id) ?? '';
    const customer = typeof b.customer === 'object' ? b.customer : undefined;
    const existing = orderMap.get(key);
    const bItems = Array.isArray(b.items)
      ? b.items.map((it): ApiOrderItem => ({
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
      customerName: customer?.name || b.customerName || existing?.customerName || 'ลูกค้าทั่วไป',
      customerPhone: customer?.phone || b.customerPhone || existing?.customerPhone || '',
      orderNumber: b.orderNumber || key,
      status: b.status,
      createdAt: b.createdAt,
    });
  });

  return verifyClaimEligibility(query, Array.from(orderMap.values()), allClaims);
}

export function verifyClaimEligibility(
  query: ClaimVerificationQuery,
  customOrders?: ClaimOrderRow[],
  customClaims?: ClaimRecord[]
): ClaimEligibleItem[] {
  const keyword = (query.searchKeyword || '').trim().toLowerCase();
  const targetOrderNum = (query.orderNumber || '').trim().toLowerCase();
  const targetPhone = (query.customerPhone || '').trim().toLowerCase();
  const targetName = (query.customerName || '').trim().toLowerCase();
  const targetSku = (query.sku || '').trim().toLowerCase();
  const targetProductId = query.productId;

  // 1. The server's orders (see fetchClaimEligibleItems); no local bill history exists
  const allOrders: ClaimOrderRow[] = Array.isArray(customOrders) ? customOrders : [];
  const allExistingClaims = customClaims || loadAllClaimRecords();
  const replacementWarranties = loadReplacementWarranties();

  const results: ClaimEligibleItem[] = [];

  // 2. Iterate through all orders and match items
  allOrders.forEach((order) => {
    // Skip voided or cancelled orders
    if (order.status === 'VOIDED' || order.status === 'CANCELLED') return;

    const ordNum = (order.orderNumber || order.id || '').toLowerCase();
    const custName = (order.customerName || (typeof order.customer === 'string' ? order.customer : '') || 'ลูกค้าทั่วไป').toLowerCase();
    const custPhone = (order.customerPhone || '').toLowerCase();

    // Check header level filters
    if (targetOrderNum && !ordNum.includes(targetOrderNum)) return;
    if (targetPhone && !custPhone.includes(targetPhone)) return;
    if (targetName && !custName.includes(targetName)) return;

    // Master products (from the server) to resolve units and conversion factors
    const allCatalogProducts: Product[] = useProductStore.getState().products || [];

    // 2. Unpack bundle items if any, so that child components can be claimed individually
    const flattenedOrderItems: ClaimOrderLine[] = [];
    (order.items || []).forEach((item) => {
      const pId = item.productId || item.id;
      const prodSku = (item.sku || item.code || '').toLowerCase();
      const matchedProd = allCatalogProducts.find(
        (p) => p.id === pId || p.sku === prodSku || p.sku === pId || p.id === prodSku
      );

      const hasBundleData = Array.isArray(item.bundleData) && item.bundleData.length > 0;
      const isBundleProd = Boolean(matchedProd && matchedProd.isBundle && Array.isArray(matchedProd.bundleItems) && matchedProd.bundleItems.length > 0);

      if (hasBundleData || isBundleProd) {
        const bundleComponents: BundleComponent[] = hasBundleData
          ? (item.bundleData as BundleComponent[])
          : (matchedProd?.bundleItems || []).map((bi) => ({
              productId: bi.childProductId,
              productName: bi.childProduct?.name,
              sku: bi.childProduct?.sku,
              quantityPerBundle: bi.quantity,
              totalQuantity: bi.quantity * (Number(item.quantity) || 1),
              unitPrice: Number(bi.childProduct?.basePrice || bi.childProduct?.priceLevel1 || 0),
            }));

        bundleComponents.forEach((child) => {
          const childId = child.productId || child.childProductId;
          const childProd = allCatalogProducts.find((p) => p.id === childId || p.sku === child.sku);
          const childBoughtQty = Number(child.totalQuantity || (Number(child.quantityPerBundle) * Number(item.quantity || 1)) || 1);
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

    flattenedOrderItems.forEach((item) => {
      const prodName = (item.name || item.productName || 'สินค้า').toLowerCase();
      const prodSku = (item.sku || item.code || '').toLowerCase();
      const pId = (item.productId || item.id) ?? '';

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
        (p) => p.id === pId || p.sku === prodSku || p.sku === pId || p.id === prodSku
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
            (u) => (u.unitName || '').trim().toLowerCase() === itemUName.toLowerCase()
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
          .filter((u) => Number(u.factor || 1) <= purchasedFactor)
          .map((u) => {
            const uFactor = Number(u.factor || 1);
            let uPrice = Number(u.price || 0);
            if (!uPrice || uPrice <= 0) {
              uPrice = (Number(item.unitPrice || 0) / purchasedFactor) * uFactor;
            }
            return {
              id: u.id || `u-${u.unitName}`,
              unitName: u.unitName || 'ชิ้น',
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
        orderNumber: (order.orderNumber || order.id) ?? '',
        orderDate: order.createdAt || new Date().toISOString(),
        customerId: order.customerId,
        customerName: order.customerName || (typeof order.customer === 'string' ? order.customer : '') || 'ลูกค้าทั่วไป',
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
    // Dynamic lookup of supplier and cost price (imported lazily: supplier-return-service imports this module)
    const { resolveProductSupplierAndCost } = await import('./supplier-return-service');
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
  let requestBody: typeof richPayload & { clientClaimId?: string } = richPayload;
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
  let confirmed: ApiClaim | null;
  try {
    confirmed = await apiFetch<ApiClaim | null>('/claims', { method: 'POST', body: JSON.stringify(requestBody) });
  } catch (error) {
    if (attemptKey && !isRetryableError(error)) localStorage.removeItem(attemptKey);
    throw error;
  }
  if (!confirmed?.id || !confirmed?.claimNumber) throw new Error('ยังไม่ได้รับการยืนยันเคลมจากฐานข้อมูล กรุณาตรวจสอบหรือส่งข้อมูลเดิมซ้ำ');
  claimId = confirmed.claimNumber;
  claimRecord.id = claimId;
  if (confirmed.refundAmount !== undefined && confirmed.refundAmount !== null) claimRecord.refundAmount = Number(confirmed.refundAmount);
  if (confirmed.cashierName) claimRecord.cashierName = confirmed.cashierName;
  // From here on, the DB transaction has committed. The server also marks a claimed replacement
  // warranty and creates the new one for an exchange (same transaction), so nothing is
  // bookkept locally; refresh the in-memory lists from the server instead.
  claimsMem = [claimRecord, ...claimsMem.filter((row) => row.id !== claimId)];
  void fetchAllClaimRecords().catch(() => undefined);

  // REFUND_CASH: the server already took the cash out of this user's shift drawer (cash
  // movement + ledger, same transaction as the claim). Only refresh the shift view here;
  // posting another cash movement would count the refund twice.
  if (params.resolutionType === 'REFUND_CASH') {
    void useShiftStore.getState().fetchCurrentShift().catch(() => undefined);
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
  // Only the server changes a claim; compute the request from the last server copy.
  const current = claimsMem.find((c) => c.id === claimId);
  const target: ClaimRecord | undefined = current ? { ...current } : undefined;
  if (target) {
    if (options?.note) target.note = `${target.note ? target.note + '\n' : ''}${options.note}`;
    if (newStatus === 'COMPLETED' || newStatus === 'SUPPLIER_REPLACED') {
      target.completedDate = new Date().toISOString();
    }
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
  }).then(() => fetchAllClaimRecords()).catch((err) => {
    // The server enforces permissions and the claim workflow; tell the user instead of silently
    // keeping a status the database refused.
    console.warn('[ClaimService] Failed to sync claim status update to backend:', err);
    toast.error(`อัปเดตสถานะเคลม #${claimId} ในฐานข้อมูลไม่สำเร็จ: ${errorText(err) || 'เกิดข้อผิดพลาด'}`);
    window.dispatchEvent(new Event('pos-data-synced'));
  });

  return target || null;
}


// ─── Get Summary KPI for Claims & Defective Stock ───

export function getClaimStockSummary(customClaims?: ClaimRecord[]) {
  const claims = customClaims !== undefined ? customClaims : loadAllClaimRecords();

  const totalClaims = claims.length;
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
