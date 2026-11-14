// ==============================================================================
// Purim POS - Offline Database & Resilient Sync Engine (IndexedDB)
// ==============================================================================
// ระบบแคชสินค้าและคิวบิลออฟไลน์:
// 1. แคชสินค้าและบาร์โค้ดลง IndexedDB เพื่อให้สแกนขายได้ทันทีแม้เน็ตหลุด (0ms)
// 2. เมื่อขายตอนออฟไลน์ จะบันทึกลงคิว offline_orders พร้อม clientOrderId (UUID)
// 3. เมื่อระบบตรวจจับว่าเชื่อมต่อเน็ตได้ จะส่ง POST /api/orders/sync-offline ทันที
//    โดยมี Idempotency Key ป้องกันข้อมูลซ้ำ ข้อมูลไม่มั่ว ไม่ซ้ำ และไม่ทับ
// ==============================================================================
import { addQty } from './qty';
import type { ApiProduct, CheckoutRequest, CheckoutResult } from './types';

const DB_NAME = 'purim_pos_offline_db';
const DB_VERSION = 1;

/** A server product as kept in IndexedDB: prices as numbers and a flat barcode index. */
export interface CachedProduct extends Omit<ApiProduct, 'barcodes' | 'basePrice' | 'costPrice'> {
  basePrice: number;
  costPrice: number;
  barcodes: string[];
  stockRemaining?: number;
}

/** A checkout request kept in the outbox until the server confirms it. */
export interface OfflineOrder extends CheckoutRequest {
  ownerId?: string;
  payloadVersion?: number;
  clientOrderId: string; // UUID Idempotency Key
  orderNumber: string;
  createdAt: string;
  syncStatus: 'pending' | 'syncing' | 'failed' | 'confirmed';
  serverOrder?: CheckoutResult;
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

    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error('กรุณาปิดแท็บ POS อื่นก่อนอัปเดตที่เก็บข้อมูล'));
    request.onerror = () => reject(request.error);
  });
}

// ──────────────────────────────────────────────
// PRODUCT CACHE METHODS
// ──────────────────────────────────────────────

/** A server product as stored in the offline cache (flat barcode list for the barcode index). */
export function toCachedProduct(p: ApiProduct): CachedProduct {
  const barcodes: string[] = [];
  if (Array.isArray(p.barcodes)) {
    for (const b of p.barcodes) {
      if (typeof b === 'string') barcodes.push(b);
      else if (b && b.barcode) barcodes.push(b.barcode);
    }
  }
  if (p.barcode && !barcodes.includes(p.barcode)) barcodes.push(p.barcode);
  return {
    ...p,
    id: p.id,
    name: p.name,
    sku: p.sku,
    basePrice: Number(p.basePrice) || Number(p.price) || 0,
    costPrice: Number(p.costPrice) || 0,
    categoryId: p.categoryId,
    barcodes,
    stockRemaining: p.stockBatches ? addQty(...p.stockBatches.map((b) => b.quantityRemaining || 0)) : p.stock,
  };
}

/** Replace the whole offline product cache (full catalogue load). */
export async function cacheProducts(products: ApiProduct[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    store.clear();

    for (const p of products) store.put(toCachedProduct(p));

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[OfflineDB] Failed to cache products:', err);
  }
}

/**
 * Apply a catalogue delta to the offline cache: changed products are re-written, deleted ones removed. Every
 * touched row is deleted first so a SKU moving from one product to another never trips the unique SKU index.
 * false = not written (the caller then reloads the whole catalogue next time).
 */
export async function applyCachedProductDelta(changed: ApiProduct[], deleted: string[]): Promise<boolean> {
  if (!changed.length && !deleted.length) return true;
  try {
    const db = await openDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    for (const id of [...deleted, ...changed.map((p) => p.id)]) store.delete(id);
    for (const p of changed) store.put(toCachedProduct(p));

    return await new Promise<boolean>((resolve) => {
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
    });
  } catch (err) {
    console.warn('[OfflineDB] Failed to update cached products:', err);
    return false;
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

export async function clearCachedProducts(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    store.clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[OfflineDB] Failed to clear cached products:', err);
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
  return saveOfflineOrder({ ...order, syncStatus: 'pending', retryCount: 0 });
}

export async function saveOfflineOrder(item: OfflineOrder): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('offline_orders', 'readwrite');
  const store = tx.objectStore('offline_orders');

  store.put(item);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('บันทึกข้อมูลสำรองไม่สำเร็จ')); };
  });
}

export async function getPendingOfflineOrders(): Promise<OfflineOrder[]> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_orders', 'readonly');
    const store = tx.objectStore('offline_orders');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => db.close();
      request.onsuccess = () => {
        const list = request.result || [];
        resolve(list);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    throw new Error('อ่านคิวบิลในเครื่องไม่ได้ กรุณาตรวจสอบพื้นที่จัดเก็บ: ' + String(error));
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

export async function syncOfflineOrdersNow(_apiUrl: string, _token: string | null): Promise<{ synced: number; failed: number }> {
  return (await import('./order-sync-service')).syncPendingOrders();
}
