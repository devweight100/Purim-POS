// ==============================================================================
// Purim POS - Offline Database & Resilient Sync Engine (IndexedDB)
// ==============================================================================
// ระบบแคชสินค้าและคิวบิลออฟไลน์:
// 1. แคชสินค้าและบาร์โค้ดลง IndexedDB เพื่อให้สแกนขายได้ทันทีแม้เน็ตหลุด (0ms)
// 2. เมื่อขายตอนออฟไลน์ จะบันทึกลงคิว offline_orders พร้อม clientOrderId (UUID)
// 3. เมื่อระบบตรวจจับว่าเชื่อมต่อเน็ตได้ จะส่ง POST /api/orders/sync-offline ทันที
//    โดยมี Idempotency Key ป้องกันข้อมูลซ้ำ ข้อมูลไม่มั่ว ไม่ซ้ำ และไม่ทับ
// ==============================================================================

const DB_NAME = 'purim_pos_offline_db';
const DB_VERSION = 1;

export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  basePrice: number;
  costPrice?: number;
  categoryId?: string;
  barcodes: string[];
  stockRemaining?: number;
}

export interface OfflineOrder {
  clientOrderId: string; // UUID Idempotency Key
  orderNumber: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    productName?: string;
  }>;
  payments: Array<{
    method: string;
    amount: number;
    referenceNo?: string;
  }>;
  customerId?: string;
  shiftId?: string;
  discountAmount?: number;
  totalAmount: number;
  createdAt: string;
  syncStatus: 'pending' | 'syncing' | 'failed';
  retryCount: number;
  lastError?: string;
}

// Open or create IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('IndexedDB is only available in browser'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Cached Products Store
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'id' });
        productStore.createIndex('sku', 'sku', { unique: true });
        productStore.createIndex('barcodes', 'barcodes', { multiEntry: true });
      }

      // 2. Offline Orders Outbox Store
      if (!db.objectStoreNames.contains('offline_orders')) {
        const orderStore = db.createObjectStore('offline_orders', { keyPath: 'clientOrderId' });
        orderStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        orderStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ──────────────────────────────────────────────
// PRODUCT CACHE METHODS
// ──────────────────────────────────────────────

export async function cacheProducts(products: any[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');

    for (const p of products) {
      const barcodes: string[] = [];
      if (Array.isArray(p.barcodes)) {
        for (const b of p.barcodes) {
          if (typeof b === 'string') barcodes.push(b);
          else if (b && b.barcode) barcodes.push(b.barcode);
        }
      }
      if (p.barcode && !barcodes.includes(p.barcode)) barcodes.push(p.barcode);

      const cachedItem: CachedProduct = {
        id: p.id,
        name: p.name,
        sku: p.sku,
        basePrice: Number(p.basePrice) || Number(p.price) || 0,
        costPrice: Number(p.costPrice) || 0,
        categoryId: p.categoryId,
        barcodes,
        stockRemaining: p.stockBatches?.reduce((sum: number, b: any) => sum + (b.quantityRemaining || 0), 0) ?? p.stock,
      };

      store.put(cachedItem);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[OfflineDB] Failed to cache products:', err);
  }
}

export async function getCachedProducts(): Promise<CachedProduct[]> {
  try {
    const db = await openDB();
    const tx = db.transaction('products', 'readonly');
    const store = tx.objectStore('products');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function findCachedProductByBarcode(code: string): Promise<CachedProduct | null> {
  try {
    const db = await openDB();
    const tx = db.transaction('products', 'readonly');
    const store = tx.objectStore('products');
    const index = store.index('barcodes');
    const request = index.get(code);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// OFFLINE ORDER OUTBOX METHODS
// ──────────────────────────────────────────────

export async function enqueueOfflineOrder(order: Omit<OfflineOrder, 'syncStatus' | 'retryCount'>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('offline_orders', 'readwrite');
  const store = tx.objectStore('offline_orders');

  const item: OfflineOrder = {
    ...order,
    syncStatus: 'pending',
    retryCount: 0,
  };

  store.put(item);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingOfflineOrders(): Promise<OfflineOrder[]> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_orders', 'readonly');
    const store = tx.objectStore('offline_orders');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const list = request.result || [];
        resolve(list.filter((o: OfflineOrder) => o.syncStatus !== 'syncing'));
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function removeOfflineOrder(clientOrderId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_orders', 'readwrite');
    const store = tx.objectStore('offline_orders');
    store.delete(clientOrderId);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[OfflineDB] Failed to remove offline order:', err);
  }
}

// ──────────────────────────────────────────────
// SYNC ENGINE
// ──────────────────────────────────────────────

export async function syncOfflineOrdersNow(apiUrl: string, token: string | null): Promise<{ synced: number; failed: number }> {
  if (typeof window === 'undefined' || !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  const pending = await getPendingOfflineOrders();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  console.log(`[OfflineDB] Synchronizing ${pending.length} offline orders...`);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${apiUrl}/orders/sync-offline`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orders: pending }),
    });

    if (!res.ok) throw new Error(`Sync failed with HTTP ${res.status}`);

    const result = await res.json();
    let synced = 0;
    let failed = 0;

    if (result.results && Array.isArray(result.results)) {
      for (const item of result.results) {
        if (item.success) {
          await removeOfflineOrder(item.clientOrderId);
          synced++;
        } else {
          failed++;
        }
      }
    }

    console.log(`[OfflineDB] Sync complete: ${synced} synced, ${failed} failed.`);
    return { synced, failed };
  } catch (err) {
    console.error('[OfflineDB] Error syncing offline orders:', err);
    return { synced: 0, failed: pending.length };
  }
}
