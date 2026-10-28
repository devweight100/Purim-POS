'use client';
import { api } from './api';

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

  // 3. & 4. การให้และใช้คะแนนสะสม (Loyalty Program)
  points: number; // แต้มสะสมคงเหลือปัจจุบัน
  totalPointsEarned: number; // แต้มที่เคยได้รับทั้งหมด
  totalPointsRedeemed: number; // แต้มที่เคยแลกไปแล้ว
  pointEarnRateBaht: number; // ยอดซื้อทุกๆ กี่บาท (เช่น 500 บาท)
  pointEarnUnits: number; // ได้รับกี่คะแนน (เช่น 10 คะแนน)
  pointRedeemRatePoints: number; // ใช้กี่คะแนน (เช่น 100 คะแนน)
  pointRedeemDiscountBaht: number; // ได้ส่วนลดกี่บาท (เช่น 1 บาท)

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
  defaultPointEarnRateBaht: number; // เช่น 500 บาท
  defaultPointEarnUnits: number; // ได้ 10 คะแนน
  defaultPointRedeemRatePoints: number; // ใช้ 100 คะแนน
  defaultPointRedeemDiscountBaht: number; // เท่ากับ 1 บาท
  isLoyaltyEnabled: boolean;
}

const STORAGE_KEY_CUSTOMERS = 'custom_customers';
const STORAGE_KEY_LOYALTY_CONFIG = 'custom_loyalty_config';

let lastCustomerSyncAt = 0;
let lastLoyaltySyncAt = 0;

export const DEFAULT_LOYALTY_CONFIG: LoyaltySystemConfig = {
  defaultPointEarnRateBaht: 500,
  defaultPointEarnUnits: 10,
  defaultPointRedeemRatePoints: 100,
  defaultPointRedeemDiscountBaht: 1,
  isLoyaltyEnabled: true,
};

function normalizeCustomerRow(c: any, idx = 0): Customer {
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
    pointEarnRateBaht: Number(merged.pointEarnRateBaht ?? DEFAULT_LOYALTY_CONFIG.defaultPointEarnRateBaht),
    pointEarnUnits: Number(merged.pointEarnUnits ?? DEFAULT_LOYALTY_CONFIG.defaultPointEarnUnits),
    pointRedeemRatePoints: Number(merged.pointRedeemRatePoints ?? DEFAULT_LOYALTY_CONFIG.defaultPointRedeemRatePoints),
    pointRedeemDiscountBaht: Number(merged.pointRedeemDiscountBaht ?? DEFAULT_LOYALTY_CONFIG.defaultPointRedeemDiscountBaht),
    createdAt: merged.createdAt || new Date().toISOString(),
    updatedAt: merged.updatedAt || new Date().toISOString(),
  };
}

function readLocalCustomers(): Customer[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOMERS) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadLoyaltyConfig(): LoyaltySystemConfig {
  if (typeof window === 'undefined') return DEFAULT_LOYALTY_CONFIG;
  if (Date.now() - lastLoyaltySyncAt > 15000) {
    lastLoyaltySyncAt = Date.now();
    void fetchLoyaltyConfig().catch(() => {});
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOYALTY_CONFIG);
    if (raw) return { ...DEFAULT_LOYALTY_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_LOYALTY_CONFIG;
}

export async function saveLoyaltyConfig(config: LoyaltySystemConfig): Promise<void> {
  await api.settings.update({ loyaltyConfig: config });
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_LOYALTY_CONFIG, JSON.stringify(config));
  } catch {}
}

export function loadCustomers(): Customer[] {
  const cached = readLocalCustomers();
  if (typeof window !== 'undefined' && Date.now() - lastCustomerSyncAt > 10000) {
    lastCustomerSyncAt = Date.now();
    void fetchCustomers().catch(() => {});
  }
  return cached;
}

export async function fetchCustomers(): Promise<Customer[]> {
  try {
    const rows = await api.customers.getAll();
    if (Array.isArray(rows)) {
      lastCustomerSyncAt = Date.now();
      const normalized = rows.map((c: any, idx: number) => normalizeCustomerRow(c, idx));
      saveCustomers(normalized);
      return normalized;
    }
  } catch (err) {
    console.warn('[CustomerService] Failed to fetch customers from backend, using offline cache:', err);
  }
  return readLocalCustomers();
}

export async function fetchLoyaltyConfig(): Promise<LoyaltySystemConfig> {
  try {
    const settings = await api.settings.get();
    lastLoyaltySyncAt = Date.now();
    const config = { ...DEFAULT_LOYALTY_CONFIG, ...(settings?.loyaltyConfig || {}) };
    try {
      localStorage.setItem(STORAGE_KEY_LOYALTY_CONFIG, JSON.stringify(config));
    } catch {}
    return config;
  } catch {
    return loadLoyaltyConfig();
  }
}

export function saveCustomers(customers: Customer[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(customers));
  } catch {}
}

export function getCustomerById(id: string): Customer | null {
  const list = readLocalCustomers();
  return list.find((c) => c.id === id || c.code === id) || null;
}

// Automatically generate sequential customer code CUST-0001, CUST-0002...
export function generateNextCustomerCode(): string {
  const list = readLocalCustomers();
  let maxNum = 0;
  list.forEach((c) => {
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
  const customer = normalizeCustomerRow({ ...customerData, ...saved });
  const rows = readLocalCustomers().filter((c) => c.id !== customer.id);
  saveCustomers([...rows, customer]);
  return { success: true, customer };
}

export async function deleteCustomer(id: string): Promise<boolean> {
  await api.customers.delete(id);
  saveCustomers(readLocalCustomers().filter((c) => c.id !== id));
  return true;
}

// Calculate points earned from a sale amount
export function calculateEarnedPoints(customer: Customer, saleTotalBaht: number): number {
  if (saleTotalBaht <= 0) return 0;
  const rateBaht = customer.pointEarnRateBaht || 500;
  const units = customer.pointEarnUnits || 10;
  const times = Math.floor(saleTotalBaht / rateBaht);
  return times * units;
}

// Calculate discount amount from redeemed points
export function calculateRedemptionDiscount(customer: Customer, pointsToRedeem: number): number {
  if (pointsToRedeem <= 0) return 0;
  const ratePoints = customer.pointRedeemRatePoints || 100;
  const discountBaht = customer.pointRedeemDiscountBaht || 1;
  const times = Math.floor(pointsToRedeem / ratePoints);
  return times * discountBaht;
}

// Record sale completion for a customer (Award points, deduct redeemed points & accumulate credit debt)
export function recordCustomerSale(
  customerId: string | null | undefined,
  saleTotalBaht: number,
  isCredit: boolean,
  orderNumber: string,
  pointsUsed: number = 0,
): {
  earnedPoints: number;
  pointsUsed: number;
  newTotalPoints: number;
  previousPoints: number;
  debtAdded: number;
  customerName: string;
} {
  if (!customerId) {
    return {
      earnedPoints: 0,
      pointsUsed: 0,
      newTotalPoints: 0,
      previousPoints: 0,
      debtAdded: 0,
      customerName: 'ลูกค้าทั่วไป',
    };
  }

  const list = readLocalCustomers();
  const target = list.find((c) => c.id === customerId || c.code === customerId);
  if (!target) {
    return {
      earnedPoints: 0,
      pointsUsed: 0,
      newTotalPoints: 0,
      previousPoints: 0,
      debtAdded: 0,
      customerName: 'ลูกค้าทั่วไป',
    };
  }

  const previousPoints = target.points || 0;

  // Deduct points used for discount
  if (pointsUsed > 0) {
    target.points = Math.max(0, (target.points || 0) - pointsUsed);
    target.totalPointsRedeemed = (target.totalPointsRedeemed || 0) + pointsUsed;
  }

  // Earn new points based on final payment
  const earned = calculateEarnedPoints(target, saleTotalBaht);
  target.points = (target.points || 0) + earned;
  target.totalPointsEarned = (target.totalPointsEarned || 0) + earned;

  let debtAdded = 0;
  if (isCredit) {
    debtAdded = saleTotalBaht;
    target.currentDebt = (target.currentDebt || 0) + saleTotalBaht;
  }

  target.updatedAt = new Date().toISOString();
  saveCustomers(list);

  return {
    earnedPoints: earned,
    pointsUsed,
    newTotalPoints: target.points,
    previousPoints,
    debtAdded,
    customerName: target.name,
  };
}

// Rollback sale for a customer (Voiding order reverses points & credit debt)
export function rollbackCustomerSale(
  customerId: string | null | undefined,
  saleTotalBaht: number,
  isCredit: boolean,
  pointsUsed: number = 0,
): boolean {
  if (!customerId) return false;
  const list = readLocalCustomers();
  const target = list.find((c) => c.id === customerId || c.code === customerId);
  if (!target) return false;

  const earned = calculateEarnedPoints(target, saleTotalBaht);
  target.points = Math.max(0, (target.points || 0) - earned + pointsUsed);
  target.totalPointsEarned = Math.max(0, (target.totalPointsEarned || 0) - earned);
  if (pointsUsed > 0) {
    target.totalPointsRedeemed = Math.max(0, (target.totalPointsRedeemed || 0) - pointsUsed);
  }

  if (isCredit) {
    target.currentDebt = Math.max(0, (target.currentDebt || 0) - saleTotalBaht);
  }

  target.updatedAt = new Date().toISOString();
  saveCustomers(list);
  return true;
}
