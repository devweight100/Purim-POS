/**
 * FROZEN COPY of what the browser computed from the claims lists (frontend as of commit 5b3dd01):
 * claim-service mapServerClaim / getClaimStockSummary, the claims page filters, the dashboard claim refunds,
 * product-store toStoreProduct (the fields these read), supplier-return-service resolveProductSupplierAndCost /
 * getEligibleClaimsForReturn, the supplier returns page cards, CreateSupplierReturnModal groupClaimsByProduct and
 * the claim-inventory page (enrichment, filters, product / supplier summaries, stats, categories).
 * Test oracle only: the e2e tests feed it GET /claims rows, GET /products/sync rows, GET /suppliers and the
 * product-suppliers / supplier POs answers, and compare with the server endpoints. Types loosened to `any`;
 * do not "fix" it.
 */
/* eslint-disable */

// ─── product-store toStoreProduct (fields read by the claims code) ───
export function toStoreProduct(p: any): any {
  const pId = p.id || p.sku;
  const basePrice = Number(p.price || p.priceLevel1 || p.basePrice || 0);
  const rawCost = p.costPrice ?? p.cost;
  const baseCost: number | undefined = rawCost !== undefined && rawCost !== null ? Number(rawCost) || 0 : undefined;
  const baseUnitName = p.unit ?? '';
  const supplierEntries = Array.isArray(p.supplierEntries) ? p.supplierEntries : [];
  const preferredSupplier = supplierEntries.find((s: any) => s.isPreferred) || supplierEntries[0] || null;
  return {
    id: pId,
    name: p.name || 'สินค้า',
    sku: p.sku || 'SKU',
    category: p.category,
    unit: baseUnitName,
    cost: baseCost,
    costPrice: baseCost,
    basePrice,
    price: basePrice,
    priceLevel1: p.priceLevel1 != null ? Number(p.priceLevel1) : basePrice,
    barcodes: Array.isArray(p.barcodes) ? p.barcodes : [],
    units: [{ unitName: baseUnitName, factor: 1, price: basePrice }],
    supplierEntries,
    supplierId: p.supplierId || preferredSupplier?.supplierId || null,
  };
}

// ─── claim-service ───
const CLAIM_STATUSES: readonly string[] = ['COMPLETED', 'PENDING_CHECKOUT', 'PENDING_SUPPLIER', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'SCRAPPED'];

export function mapServerClaim(c: any, storeProducts: any[]): any {
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
        : 'REPLACE_ITEM'));

  let resolvedStatus = 'COMPLETED';
  const rawStatus = c.frontendStatus || c.claimStatus || c.status;
  if (rawStatus !== undefined && CLAIM_STATUSES.includes(rawStatus)) {
    resolvedStatus = rawStatus;
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
    replacementUnitName: c.replacementUnitName,
    unitPrice: resolvedUnitPrice,
    totalClaimValue: resolvedClaimValue,
    refundAmount: c.refundAmount,
    defectReason: c.defectReason || c.problemDescription || '-',
    resolutionType: resolvedResType,
    status: resolvedStatus,
    supplierId: c.supplierId,
    supplierName: c.supplierName,
    costPrice: c.costPrice !== undefined ? Number(c.costPrice) : undefined,
    totalCostValue: c.totalCostValue !== undefined ? Number(c.totalCostValue) : undefined,
    returnDocId: c.returnDocId,
  };
}

export function getClaimStockSummary(claims: any[]) {
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
  return { totalClaims, totalClaimValue, pendingSupplierCount, completedCount, scrappedCount, replacedItemCount, refundedCount, discountedCount };
}

// ─── claims/page.tsx filteredClaims ───
export function claimsPageFilter(claims: any[], f: { resolutionFilter: string; startDate: string; endDate: string; search: string }) {
  const { resolutionFilter, startDate, endDate, search } = f;
  return claims.filter((claim) => {
    if (resolutionFilter !== 'ALL' && claim.resolutionType !== resolutionFilter) {
      return false;
    }
    if (startDate) {
      const dStart = new Date(startDate).getTime();
      const cTime = new Date(claim.claimDate).getTime();
      if (cTime < dStart) return false;
    }
    if (endDate) {
      const dEnd = new Date(endDate).getTime() + 24 * 60 * 60 * 1000;
      const cTime = new Date(claim.claimDate).getTime();
      if (cTime > dEnd) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const idMatch = claim.id.toLowerCase().includes(q);
      const orderMatch = (claim.orderNumber || '').toLowerCase().includes(q);
      const custMatch = (claim.customerName || '').toLowerCase().includes(q);
      const prodMatch = (claim.productName || '').toLowerCase().includes(q);
      const skuMatch = (claim.sku || '').toLowerCase().includes(q);
      const reasonMatch = (claim.defectReason || '').toLowerCase().includes(q);
      if (!idMatch && !orderMatch && !custMatch && !prodMatch && !skuMatch && !reasonMatch) {
        return false;
      }
    }
    return true;
  });
}

// ─── dashboard/page.tsx claim refunds (from = start of the period in ms, -Infinity for "all") ───
export function dashboardClaimRefunds(claims: any[], from: number) {
  const filteredClaims = claims.filter((claim) => {
    const claimTime = new Date(claim.claimDate || claim.orderDate || '').getTime();
    if (!claimTime) return true;
    return claimTime >= from;
  });
  let claimRefundAmount = 0;
  let claimRefundCount = 0;
  filteredClaims.forEach((c) => {
    const isRefund = c.resolutionType === 'REFUND_CASH' || c.resolutionType === 'REFUND_TRANSFER' || c.claimType === 'REFUND';
    if (isRefund) {
      claimRefundCount++;
      claimRefundAmount += Number(c.totalClaimValue || c.refundAmount || 0);
    }
  });
  return { count: claimRefundCount, amount: claimRefundAmount };
}

// ─── supplier-return-service ───
export interface SupplierState {
  storeProducts: any[];
  suppliers: any[];
  /** productPoSupplierMem: GET /purchase-orders/product-suppliers answers */
  productPoSupplier: Map<string, { supplierId: string; supplierName: string | null }>;
  /** loadPurchaseOrders(): POs loaded in the session (with supplier names filled in) */
  purchaseOrders: any[];
}

export function resolveProductSupplierAndCost(st: SupplierState, productId: string, sku?: string) {
  const storeProducts = st.storeProducts;
  const suppliers = st.suppliers;
  const prod = storeProducts.find((p) => p.id === productId || p.sku === sku || p.sku === productId);
  const supplierEntry = Array.isArray(prod?.supplierEntries) ? prod.supplierEntries.find((entry: any) => entry?.supplierId) : undefined;
  const barcodeSupplier = Array.isArray(prod?.barcodes) ? prod.barcodes.find((entry: any) => entry?.supplierId) : undefined;
  const supplierId = prod?.supplierId || barcodeSupplier?.supplierId || supplierEntry?.supplierId;
  let supplier: any = suppliers.find((s) => s.id === supplierId);
  const productSupplier = prod?.supplier;
  if (!supplier && productSupplier) {
    if (typeof productSupplier === 'object' && productSupplier?.id) {
      const refId = productSupplier.id;
      supplier = suppliers.find((s) => s.id === refId);
    } else if (typeof productSupplier === 'string') {
      const refName = productSupplier.trim().toLowerCase();
      supplier = suppliers.find((s) => s.name.trim().toLowerCase() === refName);
    }
  }
  const productSupplierName = prod?.supplierName;
  if (!supplier && productSupplierName) {
    const refName = productSupplierName.trim().toLowerCase();
    supplier = suppliers.find((s) => s.name.trim().toLowerCase() === refName);
  }
  if (!supplier) {
    const fromPo = st.productPoSupplier.get(prod?.id || productId);
    if (fromPo) {
      supplier = suppliers.find((s) => s.id === fromPo.supplierId);
      if (!supplier && fromPo.supplierName) {
        const refName = fromPo.supplierName.trim().toLowerCase();
        supplier = suppliers.find((s) => s.name.trim().toLowerCase() === refName);
      }
    }
  }
  if (!supplier) {
    try {
      const pos = st.purchaseOrders;
      const poWithItem = pos.find((po) =>
        (po.items || []).some((i: any) => i.productId === productId || (i.sku || i.product?.sku) === sku || (prod?.name && (i.productName || i.product?.name) === prod.name))
      );
      if (poWithItem) {
        const poSuppId = poWithItem.supplierId || poWithItem.supplier?.id;
        supplier = suppliers.find((s) => s.id === poSuppId);
        const poSupplierName = poWithItem.supplierName;
        if (!supplier && poSupplierName) {
          const refName = poSupplierName.trim().toLowerCase();
          supplier = suppliers.find((s) => s.name.trim().toLowerCase() === refName);
        }
      }
    } catch {}
  }
  if (!supplier) {
    supplier = (suppliers && suppliers.length > 0) ? suppliers[0] : null;
  }
  const resolvedSupplierId = supplier?.id || 'UNKNOWN';
  const resolvedSupplierName = supplier?.name || 'ไม่ระบุผู้จำหน่าย';
  const supplierEntryCost = supplierEntry?.lastCost !== undefined ? Number(supplierEntry.lastCost) : 0;
  let costPrice = Number(prod?.costPrice || prod?.basePrice || supplierEntryCost || 0);
  if (costPrice <= 0) {
    const firstUnitPrice = Number(prod?.units?.[0]?.price || 0);
    costPrice = firstUnitPrice > 0 ? firstUnitPrice : 0;
  }
  return { supplierId: resolvedSupplierId, supplierName: resolvedSupplierName, costPrice: Math.round(costPrice * 100) / 100 };
}

/** getEligibleClaimsForReturn over the returnable claims (mapped) */
export function getEligibleClaimsForReturn(st: SupplierState, allClaims: any[], supplierId?: string): any[] {
  const suppliers = st.suppliers;
  const pos = st.purchaseOrders;
  const storeProducts = st.storeProducts;
  const targetSupplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
  const isClaimBelongingToSupplier = (claim: any, targetId: string): boolean => {
    if (claim.supplierId && claim.supplierId === targetId) return true;
    if (targetSupplier && claim.supplierName) {
      if (claim.supplierName.trim().toLowerCase() === targetSupplier.name.trim().toLowerCase()) {
        return true;
      }
    }
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

  const eligibleClaims = allClaims
    .filter((c) => !c.returnDocId && c.status !== 'SCRAPPED')
    .map((c) => {
      let suppId = c.supplierId;
      let suppName = c.supplierName;
      let cost = Number(c.costPrice || 0);
      if (!suppId || cost <= 0) {
        const resolved = resolveProductSupplierAndCost(st, c.productId, c.sku);
        if (!suppId) {
          suppId = resolved.supplierId;
          suppName = resolved.supplierName;
        }
        if (cost <= 0) {
          cost = resolved.costPrice > 0 ? resolved.costPrice : Number(c.unitPrice || 50);
        }
      }
      const factor = Number(c.conversionFactor || 1);
      const baseQty = Number(c.baseQuantity !== undefined ? c.baseQuantity : (Number(c.quantity || 1) * factor));
      const baseUnit = factor > 1 ? (c.replacementUnitName || 'ชิ้น') : (c.unitName || 'ชิ้น');
      const baseCost = factor > 1 && cost > 0 ? (cost / factor) : cost;
      const totalCost = Math.round(baseCost * baseQty * 100) / 100;
      return { ...c, quantity: baseQty, unitName: baseUnit, baseQuantity: baseQty, supplierId: suppId, supplierName: suppName, costPrice: baseCost, totalCostValue: totalCost };
    });
  if (!supplierId) {
    return eligibleClaims;
  }
  return eligibleClaims.filter((c) => isClaimBelongingToSupplier(c, supplierId));
}

/** supplier-returns/page.tsx: pending claims card values and the cards per supplier (in the supplier list order) */
export function supplierReturnsCards(pendingClaims: any[], suppliers: any[]) {
  const totalPendingClaimsCost = pendingClaims.reduce(
    (sum, c) => sum + Number(c.totalCostValue || (c.costPrice || 50) * (c.quantity || 1)),
    0
  );
  const cards = suppliers.flatMap((supp) => {
    const suppClaims = pendingClaims.filter((c) => c.supplierId === supp.id);
    if (suppClaims.length === 0) return [];
    const totalVal = suppClaims.reduce(
      (sum, c) => sum + Number(c.totalCostValue || (c.costPrice || 50) * (c.quantity || 1)),
      0
    );
    return [{ supplierId: supp.id, count: suppClaims.length, totalVal, top: suppClaims.slice(0, 3).map((c) => ({ id: c.id, productName: c.productName, quantity: c.quantity })) }];
  });
  return { count: pendingClaims.length, totalPendingClaimsCost, cards };
}

/** CreateSupplierReturnModal groupClaimsByProduct (claims: kept as a count) */
export function groupClaimsByProduct(claims: any[]): any[] {
  const map = new Map<string, any>();
  claims.forEach((c) => {
    const key = c.productId ? `PID_${c.productId}` : (c.sku ? `SKU_${c.sku}` : `NAME_${c.productName}`);
    const factor = Number(c.conversionFactor || 1);
    const baseQty = Number(c.baseQuantity !== undefined ? c.baseQuantity : (Number(c.quantity || 1) * factor));
    const baseUnit = factor > 1 ? (c.replacementUnitName || 'ชิ้น') : (c.unitName || 'ชิ้น');
    const baseCostPrice = factor > 1 && Number(c.costPrice || 0) > 0 ? Number(c.costPrice) / factor : Number(c.costPrice || 0);
    if (!map.has(key)) {
      map.set(key, {
        groupKey: key, productId: c.productId, productName: c.productName, sku: c.sku, unitName: baseUnit,
        totalQuantity: 0, costPrice: baseCostPrice, claims: [], claimIds: [], defectReasons: [], orderNumbers: [],
        supplierId: c.supplierId, supplierName: c.supplierName,
      });
    }
    const group = map.get(key)!;
    group.totalQuantity += baseQty;
    group.claims.push(c);
    if (c.id && !group.claimIds.includes(c.id)) group.claimIds.push(c.id);
    if (c.defectReason && !group.defectReasons.includes(c.defectReason)) group.defectReasons.push(c.defectReason);
    if (c.orderNumber && !group.orderNumbers.includes(c.orderNumber)) group.orderNumbers.push(c.orderNumber);
    if (group.costPrice <= 0 && baseCostPrice > 0) group.costPrice = baseCostPrice;
  });
  return Array.from(map.values()).map(({ claims, ...g }) => ({ ...g, claimCount: claims.length }));
}

// ─── claim-inventory/page.tsx ───
export function claimInventoryItems(st: SupplierState, rawClaims: any[]) {
  const storeProducts = st.storeProducts;
  return rawClaims.map((c) => {
    let suppId = c.supplierId;
    let suppName = c.supplierName;
    let cost = Number(c.costPrice || 0);
    if (!suppId || cost <= 0) {
      const resolved = resolveProductSupplierAndCost(st, c.productId, c.sku);
      if (!suppId) {
        suppId = resolved.supplierId;
        suppName = resolved.supplierName;
      }
      if (cost <= 0) {
        cost = resolved.costPrice > 0 ? resolved.costPrice : Number(c.unitPrice || 0);
      }
    }
    const matchedProduct = storeProducts.find((p) => p.id === c.productId || p.sku === c.sku);
    const rawCategory = matchedProduct?.category;
    const category = typeof rawCategory === 'object' && rawCategory !== null ? (rawCategory.name || 'ทั่วไป') : (rawCategory || 'ทั่วไป');
    const factor = Number(c.conversionFactor || 1);
    const baseQty = Number(c.baseQuantity !== undefined ? c.baseQuantity : Number(c.quantity || 1) * factor);
    const baseUnit = factor > 1 ? (c.replacementUnitName || 'ชิ้น') : (c.unitName || 'ชิ้น');
    const baseCost = factor > 1 && cost > 0 ? cost / factor : cost;
    const totalCost = Math.round(baseCost * baseQty * 100) / 100;
    return {
      id: c.id, claimId: c.id, claimDate: c.claimDate || c.orderDate || new Date().toISOString(), orderNumber: c.orderNumber,
      customerName: c.customerName || 'ลูกค้าทั่วไป', customerPhone: c.customerPhone, productId: c.productId, productName: c.productName,
      sku: c.sku, category, supplierId: suppId || 'UNKNOWN', supplierName: suppName || 'ไม่ระบุผู้จำหน่าย',
      defectReason: c.defectReason || 'สินค้าชำรุด', quantity: baseQty, unitName: baseUnit, costPrice: baseCost,
      unitPrice: Number(c.unitPrice || 0), totalCostValue: totalCost, totalClaimValue: Number(c.totalClaimValue || 0),
      status: c.status, returnDocId: c.returnDocId,
    };
  });
}

export function claimInventoryView(claimItems: any[], suppliersList: any[], f: { statusFilter: string; selectedSupplierId: string; categoryFilter: string; search: string }) {
  const { statusFilter, selectedSupplierId, categoryFilter, search } = f;
  const filteredClaims = claimItems.filter((item) => {
    if (statusFilter === 'IN_STOCK') {
      if (item.returnDocId || item.status === 'SCRAPPED' || item.status === 'SENT_TO_SUPPLIER' || item.status === 'SUPPLIER_REPLACED') return false;
    } else if (statusFilter === 'RETURNED') {
      if (!item.returnDocId && item.status !== 'SENT_TO_SUPPLIER' && item.status !== 'SUPPLIER_REPLACED') return false;
    }
    if (selectedSupplierId !== 'ALL' && item.supplierId !== selectedSupplierId) return false;
    if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchName = item.productName.toLowerCase().includes(q);
      const matchSku = item.sku.toLowerCase().includes(q);
      const matchSupp = item.supplierName.toLowerCase().includes(q);
      const matchClaim = item.claimId.toLowerCase().includes(q);
      const matchOrder = item.orderNumber ? item.orderNumber.toLowerCase().includes(q) : false;
      return matchName || matchSku || matchSupp || matchClaim || matchOrder;
    }
    return true;
  });

  const map = new Map<string, any>();
  filteredClaims.forEach((item) => {
    const key = `${item.productId}_${item.sku}_${item.supplierId}`;
    const existing = map.get(key);
    const isInStock = !item.returnDocId && item.status !== 'SCRAPPED' && item.status !== 'SENT_TO_SUPPLIER' && item.status !== 'SUPPLIER_REPLACED';
    if (!existing) {
      map.set(key, {
        productId: item.productId, productName: item.productName, sku: item.sku, category: item.category,
        supplierId: item.supplierId, supplierName: item.supplierName, unitName: item.unitName, costPrice: item.costPrice,
        unitPrice: item.unitPrice, totalPieces: item.quantity, inStockPieces: isInStock ? item.quantity : 0,
        totalCostValue: item.totalCostValue, inStockCostValue: isInStock ? item.totalCostValue : 0,
        totalClaimValue: item.totalClaimValue, latestClaimDate: item.claimDate, claims: [item],
      });
    } else {
      existing.totalPieces += item.quantity;
      if (isInStock) {
        existing.inStockPieces += item.quantity;
        existing.inStockCostValue += item.totalCostValue;
      }
      existing.totalCostValue += item.totalCostValue;
      existing.totalClaimValue += item.totalClaimValue;
      if (new Date(item.claimDate) > new Date(existing.latestClaimDate)) existing.latestClaimDate = item.claimDate;
      existing.claims.push(item);
    }
  });
  const productSummaries = Array.from(map.values()).sort((a, b) => b.inStockCostValue - a.inStockCostValue);

  const smap = new Map<string, any>();
  productSummaries.forEach((p) => {
    const suppId = p.supplierId || 'UNKNOWN';
    const existing = smap.get(suppId);
    const suppInfo = suppliersList.find((s) => s.id === suppId);
    if (!existing) {
      smap.set(suppId, {
        supplierId: suppId, supplierName: p.supplierName, supplierPhone: suppInfo?.phone, productCount: 1,
        totalPieces: p.totalPieces, inStockPieces: p.inStockPieces, totalCostValue: p.totalCostValue,
        inStockCostValue: p.inStockCostValue, totalClaimValue: p.totalClaimValue, latestClaimDate: p.latestClaimDate, products: [p],
      });
    } else {
      existing.productCount += 1;
      existing.totalPieces += p.totalPieces;
      existing.inStockPieces += p.inStockPieces;
      existing.totalCostValue += p.totalCostValue;
      existing.inStockCostValue += p.inStockCostValue;
      existing.totalClaimValue += p.totalClaimValue;
      if (new Date(p.latestClaimDate) > new Date(existing.latestClaimDate)) existing.latestClaimDate = p.latestClaimDate;
      existing.products.push(p);
    }
  });
  const supplierSummaries = Array.from(smap.values()).sort((a, b) => b.inStockCostValue - a.inStockCostValue);

  const inStockClaims = claimItems.filter(
    (c) => !c.returnDocId && c.status !== 'SCRAPPED' && c.status !== 'SENT_TO_SUPPLIER' && c.status !== 'COMPLETED' && c.status !== 'SUPPLIER_REPLACED'
  );
  const hund = (v: any) => { const n = Number(v); const q = Number.isFinite(n) ? n : 0; return Math.round(q * 100 + (q >= 0 ? 1e-7 : -1e-7)); };
  const stats = {
    uniqueProducts: new Set(inStockClaims.map((c) => `${c.productId}_${c.sku}`)).size,
    pieces: inStockClaims.reduce((s, c) => s + hund(c.quantity), 0) / 100,
    costValue: inStockClaims.reduce((s, c) => s + c.totalCostValue, 0),
    suppliersCount: new Set(inStockClaims.map((c) => c.supplierId)).size,
  };
  const set = new Set<string>();
  claimItems.forEach((c) => { if (c.category) set.add(c.category); });
  return { filteredClaims, productSummaries, supplierSummaries, stats, categoryOptions: Array.from(set) };
}
