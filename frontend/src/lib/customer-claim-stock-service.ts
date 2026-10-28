import { fetchClaimEligibleItems } from './claim-service';
import { ClaimEligibleItem } from './types';
import { apiFetch } from './api';

const STORAGE_KEY_CLAIM_INVENTORY = 'pos_claim_inventory_cache';

export interface CustomerClaimStockItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unitName: string;
  quantity: number;
  unitCost: number;
  condition?: string;
  location?: string;
  note?: string;
  claimId?: string;
  customerId?: string | null;
  customerName?: string;
  customerPhone?: string | null;
  supplierId?: string;
  supplierName?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function loadCustomerClaimStockItems(): CustomerClaimStockItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CLAIM_INVENTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load claim inventory:', err);
    return [];
  }
}

export function saveCustomerClaimStockItems(items: CustomerClaimStockItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CLAIM_INVENTORY, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to save claim inventory:', err);
  }
}

export async function fetchCustomerClaimStockItems(): Promise<CustomerClaimStockItem[]> {
  try {
    const res = await apiFetch('/claims/inventory/list');
    const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : null);
    if (Array.isArray(list)) {
      const mapped: CustomerClaimStockItem[] = list.map((item: any) => ({
        id: item.id,
        productId: item.productId || item.product?.id || '',
        productName: item.product?.name || item.productName || 'สินค้า',
        sku: item.product?.sku || item.sku || '-',
        unitName: item.product?.unit || item.unitName || 'ชิ้น',
        quantity: Number(item.quantity ?? 0),
        unitCost: Number(item.unitCost ?? item.product?.costPrice ?? 0),
        condition: item.condition || 'รอตรวจสอบ / ส่งเคลม',
        location: item.location || 'คลังสินค้าเคลม',
        note: item.note || undefined,
        claimId: item.claimId,
        customerId: item.customerId,
        customerName: item.customerName,
        customerPhone: item.customerPhone,
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
      saveCustomerClaimStockItems(mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[CustomerClaimStockService] Failed to fetch claim inventory from backend:', err);
  }
  return loadCustomerClaimStockItems();
}

export async function createCustomerClaimStockItem(
  data: Partial<CustomerClaimStockItem> & { productId: string }
): Promise<CustomerClaimStockItem> {
  const res = await apiFetch('/claims/inventory', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  void fetchCustomerClaimStockItems().catch(() => {});
  return res;
}

export async function updateCustomerClaimStockItem(
  id: string,
  data: Partial<CustomerClaimStockItem>
): Promise<CustomerClaimStockItem> {
  const res = await apiFetch(`/claims/inventory/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  void fetchCustomerClaimStockItems().catch(() => {});
  return res;
}

export const loadClaimInventory = loadCustomerClaimStockItems;
export const saveClaimInventory = saveCustomerClaimStockItems;
export const fetchClaimInventory = fetchCustomerClaimStockItems;

export interface CustomerProductStock {
  productId: string;
  productName: string;
  sku: string;
  unitName: string;
  baseUnitPrice: number;
  totalBoughtQuantity: number;
  totalClaimedQuantity: number;
  availableClaimQuantity: number;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    orderDate: string;
    boughtQuantity: number;
    alreadyClaimedQuantity: number;
    availableClaimQuantity: number;
    unitPrice: number;
    unitName: string;
    conversionFactor: number;
  }>;
}

export interface CustomerStockSummary {
  customerName: string;
  customerPhone?: string;
  customerId?: string;
  items: CustomerProductStock[];
  totalAvailableItems: number;
}

/**
 * Fetch and aggregate purchase history into a customer-specific product stock inventory
 */
export async function getCustomerProductStock(params: {
  customerId?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
}): Promise<CustomerStockSummary> {
  const { customerId, customerPhone, customerName } = params;

  if (!customerId && !customerPhone && !customerName) {
    return {
      customerName: 'ลูกค้าทั่วไป',
      items: [],
      totalAvailableItems: 0,
    };
  }

  // Hydrate claim inventory in background
  void fetchCustomerClaimStockItems().catch(() => {});

  // Use fetchClaimEligibleItems to get all verified eligible purchases
  const eligibleItems = await fetchClaimEligibleItems({
    customerPhone: customerPhone || undefined,
    customerName: customerName || undefined,
  });

  // Filter strictly by customer if id, phone, or name provided
  const filtered = eligibleItems.filter((it) => {
    if (customerId && it.customerId && it.customerId === customerId) return true;
    if (customerPhone && it.customerPhone && it.customerPhone.includes(customerPhone.trim())) return true;
    if (customerName && it.customerName && it.customerName.toLowerCase().includes(customerName.trim().toLowerCase())) return true;
    return false;
  });

  // Group by productId
  const productMap = new Map<string, CustomerProductStock>();

  for (const item of filtered) {
    const key = item.productId;
    let existing = productMap.get(key);

    if (!existing) {
      existing = {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        unitName: item.unitName,
        baseUnitPrice: item.baseUnitPrice || item.unitPrice,
        totalBoughtQuantity: 0,
        totalClaimedQuantity: 0,
        availableClaimQuantity: 0,
        orders: [],
      };
      productMap.set(key, existing);
    }

    existing.totalBoughtQuantity += item.boughtQuantity;
    existing.totalClaimedQuantity += item.alreadyClaimedQuantity;
    existing.availableClaimQuantity += item.availableClaimQuantity;

    existing.orders.push({
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      orderDate: item.orderDate,
      boughtQuantity: item.boughtQuantity,
      alreadyClaimedQuantity: item.alreadyClaimedQuantity,
      availableClaimQuantity: item.availableClaimQuantity,
      unitPrice: item.unitPrice,
      unitName: item.unitName,
      conversionFactor: item.conversionFactor || 1,
    });
  }

  const items = Array.from(productMap.values()).sort(
    (a, b) => b.availableClaimQuantity - a.availableClaimQuantity
  );

  const totalAvailableItems = items.reduce((sum, i) => sum + i.availableClaimQuantity, 0);

  return {
    customerName: customerName || filtered[0]?.customerName || 'ลูกค้าทั่วไป',
    customerPhone: customerPhone || filtered[0]?.customerPhone || undefined,
    customerId: customerId || filtered[0]?.customerId || undefined,
    items,
    totalAvailableItems,
  };
}

/**
 * Quick lookup of remaining claim quota for a specific product for the customer
 */
export async function getCustomerQuotaForProduct(
  productId: string,
  params: { customerId?: string | null; customerPhone?: string | null; customerName?: string | null }
): Promise<{ availableQuota: number; latestOrder?: any; unitName: string; unitPrice: number }> {
  const stock = await getCustomerProductStock(params);
  const found = stock.items.find((i) => i.productId === productId);
  if (!found) {
    return { availableQuota: 0, unitName: 'ชิ้น', unitPrice: 0 };
  }
  const latestOrderWithQuota = found.orders.find((o) => o.availableClaimQuantity > 0) || found.orders[0];
  return {
    availableQuota: found.availableClaimQuantity,
    latestOrder: latestOrderWithQuota,
    unitName: found.unitName,
    unitPrice: found.baseUnitPrice,
  };
}
