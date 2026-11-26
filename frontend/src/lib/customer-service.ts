'use client';
import { discountForPoints, pointsForSale, rateValue } from '@shared/loyalty';
import { memberRates, setShopLoyaltyConfig } from './loyalty-rates';
import { useSyncExternalStore } from 'react';
import { api, apiFetch, getAuthToken } from './api';
import type { ApiCustomer } from './types';

export type CustomerType = 'INDIVIDUAL' | 'COMPANY';

export interface Customer {
  id: string;
  type: CustomerType; // 'INDIVIDUAL' (บุคคลธรรมดา) | 'COMPANY' (นิติบุคคล/บริษัท)
  code: string; // เช่น CUST-0001
  name: string; // ชื่อลูกค้า หรือ ชื่อบริษัท
  phone: string; // เบอร์โทรศัพท์หลัก
  email?: string;
  address?: string;

  // 1. เครดิตและยอดหนี้
  creditLimit: number; // วงเงินเครดิต (0 = ไม่เปิดเครดิต)
  creditTerms: number; // จำนวนวันให้เครดิต เช่น 15, 30, 45, 60 วัน
  currentDebt: number; // ยอดค้างชำระปัจจุบัน
  isCreditBlocked?: boolean; // ระงับเครดิตชั่วคราว
  creditNote?: string;

  // 2. ระดับราคา
  priceLevel: 1 | 2 | 3 | 4 | 5; // ระดับราคา 1 ถึง 5 (1=ทั่วไป, 2=สมาชิก, 3=ช่าง/ขายส่ง, 4=VIP, 5=ตัวแทน)
  /** online shop delivery fee (ค่าส่ง); null = the shop tells each time */
  deliveryFee?: number | null;

  // 3. & 4. การให้และใช้คะแนนสะสม (Loyalty Program)
  points: number; // แต้มสะสมคงเหลือปัจจุบัน
  totalPointsEarned: number; // แต้มที่เคยได้รับทั้งหมด
  totalPointsRedeemed: number; // แต้มที่เคยแลกไปแล้ว
  /** member's own rate; undefined / 0 = the shop's rate (shared/src/loyalty.ts) */
  pointEarnRateBaht?: number; // ยอดซื้อทุกๆ กี่บาท (เช่น 500 บาท)
  /** member's own rate; undefined / 0 = the shop's rate (shared/src/loyalty.ts) */
  pointEarnUnits?: number; // ได้รับกี่คะแนน (เช่น 10 คะแนน)
  /** member's own rate; undefined / 0 = the shop's rate (shared/src/loyalty.ts) */
  pointRedeemRatePoints?: number; // ใช้กี่คะแนน (เช่น 100 คะแนน)
  /** member's own rate; undefined / 0 = the shop's rate (shared/src/loyalty.ts) */
  pointRedeemDiscountBaht?: number; // ได้ส่วนลดกี่บาท (เช่น 1 บาท)

  // 5. ข้อมูลสำหรับออกใบกำกับภาษี / ข้อมูลบริษัท
  companyName?: string; // ชื่อจดทะเบียนนิติบุคคล
  taxId?: string; // เลขประจำตัวผู้เสียภาษี 13 หลัก
  branchType?: 'HEAD_OFFICE' | 'BRANCH'; // สำนักงานใหญ่ หรือ สาขา
  branchNumber?: string; // เลขที่สาขา เช่น 00001
  taxAddress?: string; // ที่อยู่ออกใบกำกับภาษี
  contactPerson?: string; // ผู้ประสานงาน / ฝ่ายจัดซื้อ
  contactPhone?: string; // เบอร์ผู้ประสานงาน

  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltySystemConfig {
  /** ใช้แต้มขั้นต่ำต่อครั้ง (0 = ไม่มีขั้นต่ำ) */
  minRedeemPoints?: number;
  defaultPointEarnRateBaht: number; // เช่น 500 บาท
  defaultPointEarnUnits: number; // ได้ 10 คะแนน
  defaultPointRedeemRatePoints: number; // ใช้ 100 คะแนน
  defaultPointRedeemDiscountBaht: number; // เท่ากับ 1 บาท
  isLoyaltyEnabled: boolean;
}

/**
 * Customers live on the server only. The last server response is kept in memory (never in
 * localStorage) so the POS can look a customer up synchronously; fetchCustomers() refreshes it
 * and throws when the server cannot be reached.
 */
let lastServerCustomers: Customer[] = [];
let lastServerLoyaltyConfig: LoyaltySystemConfig | null = null;
let customersVersion = 0;
const customerListeners = new Set<() => void>();

function publishCustomers(list: Customer[]) {
  lastServerCustomers = list;
  customersVersion++;
  customerListeners.forEach((l) => l());
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltySystemConfig = {
  defaultPointEarnRateBaht: 500,
  defaultPointEarnUnits: 10,
  defaultPointRedeemRatePoints: 100,
  defaultPointRedeemDiscountBaht: 1,
  isLoyaltyEnabled: true,
};

export function normalizeCustomerRow(c: ApiCustomer | null | undefined, idx = 0): Customer {
  const profile = typeof c?.profile === 'object' && c?.profile !== null ? c.profile : {};
  const merged = { ...profile, ...c };
  return {
    ...merged,
    id: String(merged.id || `cust_${idx}`),
    type: merged.type === 'COMPANY' ? 'COMPANY' : 'INDIVIDUAL',
    code: merged.code || `CUST-${String(idx + 1).padStart(4, '0')}`,
    name: String(merged.name || 'ลูกค้า'),
    phone: String(merged.phone || ''),
    creditLimit: Number(merged.creditLimit ?? 0),
    creditTerms: Number(merged.creditTerms ?? 30),
    currentDebt: Number(merged.currentDebt ?? 0),
    priceLevel: ([1, 2, 3, 4, 5].includes(Number(merged.priceLevel))
      ? Number(merged.priceLevel)
      : 1) as 1 | 2 | 3 | 4 | 5,
    points: Number(merged.points ?? 0),
    totalPointsEarned: Number(merged.totalPointsEarned ?? merged.points ?? 0),
    totalPointsRedeemed: Number(merged.totalPointsRedeemed ?? 0),
    // the member's own rates only when set (> 0); empty = the shop's rate (memberRates() in lib/loyalty-rates.ts).
    // They used to be filled with 500 / 10 / 100 / 1 here, so the POS never followed the shop's setting.
    pointEarnRateBaht: rateValue(merged.pointEarnRateBaht) ?? undefined,
    pointEarnUnits: rateValue(merged.pointEarnUnits) ?? undefined,
    pointRedeemRatePoints: rateValue(merged.pointRedeemRatePoints) ?? undefined,
    pointRedeemDiscountBaht: rateValue(merged.pointRedeemDiscountBaht) ?? undefined,
    createdAt: merged.createdAt || new Date().toISOString(),
    updatedAt: merged.updatedAt || new Date().toISOString(),
  };
}

/** Last loyalty config the server returned in this session (defaults until then). */
export function loadLoyaltyConfig(): LoyaltySystemConfig {
  return lastServerLoyaltyConfig || DEFAULT_LOYALTY_CONFIG;
}

export async function saveLoyaltyConfig(config: LoyaltySystemConfig): Promise<void> {
  await api.settings.update({ loyaltyConfig: config });
  lastServerLoyaltyConfig = config;
  setShopLoyaltyConfig(config);
}

/** Last customer list the server returned in this session (empty until the first fetch). */
export function loadCustomers(): Customer[] {
  return lastServerCustomers;
}

/** A customer of the list and its position in the server's full list (creation order; fallback CUST code). */
export interface IndexedCustomer {
  customer: Customer;
  listIndex: number;
}

export interface CustomerSyncResponse {
  cursor: string;
  full: boolean;
  customers: (ApiCustomer & { listIndex?: number })[];
  deleted: string[];
}

/**
 * Applies GET /customers/sync to the list: full = the new list; otherwise the changed customers replace / join it
 * (kept in list order). Returns null when nothing changed (no re-render).
 */
export function applyCustomerSync(current: IndexedCustomer[], res: CustomerSyncResponse): IndexedCustomer[] | null {
  if (res.full) return res.customers.map((c, i) => ({ customer: normalizeCustomerRow(c, i), listIndex: i }));
  if (!res.customers.length && !res.deleted?.length) return null;
  const byId = new Map(current.map((x) => [x.customer.id, x]));
  let next = current.length ? Math.max(...current.map((x) => x.listIndex)) + 1 : 0;
  for (const c of res.customers) {
    const { listIndex, ...row } = c;
    const li = typeof listIndex === 'number' ? listIndex : next++;
    byId.set(String(row.id), { customer: normalizeCustomerRow(row, li), listIndex: li });
  }
  for (const id of res.deleted || []) byId.delete(id);
  return [...byId.values()].sort((a, b) => a.listIndex - b.listIndex);
}

let indexedCustomers: IndexedCustomer[] = [];
let customersCursor: { token: string | null; cursor: string } | null = null;
let customersInflight: Promise<Customer[]> | null = null;

function setIndexed(list: IndexedCustomer[]) {
  indexedCustomers = list;
  publishCustomers(list.map((x) => x.customer));
}

/**
 * Customers from the server: the whole list on the first call of a login, then only the customers changed since
 * (GET /customers/sync; the screens used to download the whole list every 15 s). Throws when the server cannot be
 * reached. Concurrent calls share one request.
 */
export function fetchCustomers(opts?: { full?: boolean }): Promise<Customer[]> {
  // F5 รีเฟรชข้อมูล: the whole list again, after a delta that may be running
  if (opts?.full) {
    const after = customersInflight ? customersInflight.catch(() => undefined) : Promise.resolve();
    return after.then(() => {
      customersCursor = null;
      return fetchCustomers();
    });
  }
  if (customersInflight) return customersInflight;
  const started = customersEpoch;
  customersInflight = (async () => {
    const token = getAuthToken();
    const since = customersCursor && customersCursor.token === token ? customersCursor.cursor : '';
    const res = await apiFetch<CustomerSyncResponse | null>(`/customers/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`);
    if (!res || !Array.isArray(res.customers) || typeof res.cursor !== 'string') throw new Error('ข้อมูลลูกค้าจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    // released while the request ran (back-office screen of a device that does not sell): keep nothing
    if (started !== customersEpoch) return lastServerCustomers;
    const next = applyCustomerSync(since ? indexedCustomers : [], since ? res : { ...res, full: true });
    if (next) setIndexed(next);
    customersCursor = { token, cursor: res.cursor };
    return lastServerCustomers;
  })().finally(() => {
    customersInflight = null;
  });
  return customersInflight;
}

let customersEpoch = 0;

/** Refresh the list only when it is in memory (POS / selling device / a screen that needs it). */
export function refreshCustomersIfLoaded(): Promise<unknown> {
  return indexedCustomers.length || customersInflight ? fetchCustomers() : Promise.resolve();
}

/** Forget the customer list (frees the memory; the next fetchCustomers() downloads it in full again). */
export function releaseCustomers() {
  customersEpoch++;
  customersInflight = null;
  customersCursor = null;
  if (!indexedCustomers.length) return;
  setIndexed([]);
}

const looked = new Map<string, Customer>();
/**
 * One customer with every field (A4 reprint: address / tax id): from the list when it is in memory, else
 * GET /customers/:id (the last 50 looked up are kept). null when unknown / unreachable.
 */
export async function ensureCustomer(id: string | null | undefined): Promise<Customer | null> {
  if (!id) return null;
  const inList = getCustomerById(id);
  if (inList) return inList;
  try {
    const row = await api.customers.getOne(id);
    if (!row) return null;
    const c = normalizeCustomerRow(row);
    looked.delete(id);
    looked.set(id, c);
    if (looked.size > 50) looked.delete(looked.keys().next().value as string);
    return c;
  } catch {
    return looked.get(id) || null;
  }
}

export interface CustomerPageStats {
  total: number;
  individualCount: number;
  companyCount: number;
  totalCreditCustomers: number;
  totalDebt: number;
  totalPoints: number;
  /** next free CUST-#### code (over every customer) */
  nextCode: string;
}

/** One page of the customers screen (GET /customers?page=…), filtered and searched by the server. */
export async function fetchCustomerPage(q: {
  page: number;
  limit: number;
  search?: string;
  type?: 'all' | 'INDIVIDUAL' | 'COMPANY' | 'credit' | 'hasDebt';
  priceLevel?: string;
}): Promise<{ rows: Customer[]; total: number; stats: CustomerPageStats }> {
  const params = new URLSearchParams({ page: String(q.page), limit: String(q.limit) });
  if (q.search?.trim()) params.set('search', q.search.trim());
  if (q.type && q.type !== 'all') params.set('type', q.type);
  if (q.priceLevel && q.priceLevel !== 'all') params.set('priceLevel', q.priceLevel);
  const res = await apiFetch<{ data: (ApiCustomer & { listIndex?: number })[]; meta: { total: number }; stats: CustomerPageStats } | null>(
    `/customers?${params.toString()}`,
  );
  if (!Array.isArray(res?.data) || !res?.stats) throw new Error('ข้อมูลลูกค้าจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  // listIndex = position in the whole list: the same fallback code as the full list gives a row without one
  const rows = res.data.map((c, i) => {
    const { listIndex, ...row } = c;
    return normalizeCustomerRow(row, listIndex ?? i);
  });
  return { rows, total: Number(res.meta?.total) || 0, stats: res.stats };
}

/** Loyalty config from the server. Throws when the server cannot be reached. */
export async function fetchLoyaltyConfig(): Promise<LoyaltySystemConfig> {
  const settings = await api.settings.get();
  const config: LoyaltySystemConfig = { ...DEFAULT_LOYALTY_CONFIG, ...(settings?.loyaltyConfig || {}) };
  lastServerLoyaltyConfig = config;
  setShopLoyaltyConfig(settings?.loyaltyConfig);
  return config;
}

export function getCustomerById(id: string): Customer | null {
  return lastServerCustomers.find((c) => c.id === id || c.code === id) || null;
}

/** React hook: the customer with this id from the latest server list (re-renders on refresh). */
export function useCustomerById(id: string | null | undefined): Customer | null {
  useSyncExternalStore(
    (cb) => {
      customerListeners.add(cb);
      return () => customerListeners.delete(cb);
    },
    () => customersVersion,
    () => 0,
  );
  return id ? getCustomerById(id) : null;
}

// Suggest the next sequential customer code CUST-0001, CUST-0002... from the server's list
export function generateNextCustomerCode(): string {
  let maxNum = 0;
  lastServerCustomers.forEach((c) => {
    if (c.code) {
      const match = c.code.match(/CUST-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  });
  return `CUST-${String(maxNum + 1).padStart(4, '0')}`;
}

export async function upsertCustomer(
  customerData: Partial<Customer> & { name: string; phone: string },
): Promise<{ success: boolean; customer: Customer }> {
  const saved = customerData.id
    ? await api.customers.update(customerData.id, customerData)
    : await api.customers.create(customerData);
  const existing = indexedCustomers.find((x) => x.customer.id === String(saved?.id ?? customerData.id));
  const listIndex = existing ? existing.listIndex : indexedCustomers.length ? Math.max(...indexedCustomers.map((x) => x.listIndex)) + 1 : 0;
  const customer = normalizeCustomerRow({ ...customerData, ...saved }, listIndex);
  setIndexed([...indexedCustomers.filter((x) => x.customer.id !== customer.id), { customer, listIndex }].sort((a, b) => a.listIndex - b.listIndex));
  return { success: true, customer };
}

export async function deleteCustomer(id: string): Promise<boolean> {
  await api.customers.delete(id);
  setIndexed(indexedCustomers.filter((x) => x.customer.id !== id));
  return true;
}

// Calculate points earned from a sale amount
export function calculateEarnedPoints(customer: Customer, saleTotalBaht: number): number {
  // the same rule as the server checkout (shared/src/loyalty.ts)
  return pointsForSale(saleTotalBaht, memberRates(customer));
}

// Calculate discount amount from redeemed points
export function calculateRedemptionDiscount(customer: Customer, pointsToRedeem: number): number {
  return discountForPoints(pointsToRedeem, memberRates(customer));
}

