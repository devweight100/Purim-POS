'use client';

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

export const DEFAULT_LOYALTY_CONFIG: LoyaltySystemConfig = {
  defaultPointEarnRateBaht: 500,
  defaultPointEarnUnits: 10,
  defaultPointRedeemRatePoints: 100,
  defaultPointRedeemDiscountBaht: 1,
  isLoyaltyEnabled: true,
};

const INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'cust_1',
    type: 'INDIVIDUAL',
    code: 'CUST-0001',
    name: 'คุณสมชาย ใจดี',
    phone: '081-234-5678',
    email: 'somchai@gmail.com',
    address: '123/45 ถ.สุขุมวิท ต.ในเมือง อ.เมือง จ.เชียงใหม่ 50000',
    creditLimit: 20000,
    creditTerms: 30,
    currentDebt: 4500,
    isCreditBlocked: false,
    priceLevel: 2, // สมาชิกระดับ 2
    points: 350,
    totalPointsEarned: 500,
    totalPointsRedeemed: 150,
    pointEarnRateBaht: 500,
    pointEarnUnits: 10,
    pointRedeemRatePoints: 100,
    pointRedeemDiscountBaht: 1,
    createdAt: '2026-01-15T09:00:00.000Z',
    updatedAt: '2026-08-20T14:30:00.000Z',
  },
  {
    id: 'cust_2',
    type: 'COMPANY',
    code: 'CUST-0002',
    name: 'บริษัท ปุริมพัฒนา คอนสตรัคชั่น จำกัด',
    phone: '02-789-4561',
    email: 'finance@purimcon.co.th',
    address: '99/1 อาคารปุริมทาวเวอร์ ชั้น 12 ถ.รัชดาภิเษก แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310',
    creditLimit: 100000,
    creditTerms: 45,
    currentDebt: 32800,
    isCreditBlocked: false,
    priceLevel: 3, // ระดับราคาส่ง/ช่าง
    points: 1240,
    totalPointsEarned: 2000,
    totalPointsRedeemed: 760,
    pointEarnRateBaht: 500,
    pointEarnUnits: 10,
    pointRedeemRatePoints: 100,
    pointRedeemDiscountBaht: 1,
    companyName: 'บริษัท ปุริมพัฒนา คอนสตรัคชั่น จำกัด',
    taxId: '0105560123456',
    branchType: 'HEAD_OFFICE',
    branchNumber: '00000',
    taxAddress: '99/1 อาคารปุริมทาวเวอร์ ชั้น 12 ถ.รัชดาภิเษก แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310',
    contactPerson: 'คุณกิตติศักดิ์ (ฝ่ายจัดซื้อ)',
    contactPhone: '089-111-2233',
    createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-08-25T11:00:00.000Z',
  },
  {
    id: 'cust_3',
    type: 'INDIVIDUAL',
    code: 'CUST-0003',
    name: 'คุณสมหญิง รักสวย',
    phone: '089-876-5432',
    email: 'somying.beauty@yahoo.com',
    address: '88 หมู่ 2 ต.ช้างเผือก อ.เมือง จ.เชียงใหม่ 50300',
    creditLimit: 0, // ไม่มีเครดิต
    creditTerms: 0,
    currentDebt: 0,
    isCreditBlocked: false,
    priceLevel: 1, // ราคาปกติทั่วไป
    points: 120,
    totalPointsEarned: 120,
    totalPointsRedeemed: 0,
    pointEarnRateBaht: 500,
    pointEarnUnits: 10,
    pointRedeemRatePoints: 100,
    pointRedeemDiscountBaht: 1,
    createdAt: '2026-03-01T15:00:00.000Z',
    updatedAt: '2026-08-22T08:20:00.000Z',
  },
  {
    id: 'cust_4',
    type: 'COMPANY',
    code: 'CUST-0004',
    name: 'ห้างหุ้นส่วนจำกัด สยามการช่าง เอ็นจิเนียริ่ง',
    phone: '053-123-456',
    email: 'siam.engineer@gmail.com',
    address: '45/8 ถ.เชียงใหม่-ลำปาง ต.หนองป่าครั่ง อ.เมือง จ.เชียงใหม่ 50000',
    creditLimit: 50000,
    creditTerms: 30,
    currentDebt: 0,
    isCreditBlocked: false,
    priceLevel: 4, // ระดับ VIP
    points: 890,
    totalPointsEarned: 1500,
    totalPointsRedeemed: 610,
    pointEarnRateBaht: 500,
    pointEarnUnits: 10,
    pointRedeemRatePoints: 100,
    pointRedeemDiscountBaht: 1,
    companyName: 'ห้างหุ้นส่วนจำกัด สยามการช่าง เอ็นจิเนียริ่ง',
    taxId: '0503554001234',
    branchType: 'BRANCH',
    branchNumber: '00001',
    taxAddress: '45/8 ถ.เชียงใหม่-ลำปาง ต.หนองป่าครั่ง อ.เมือง จ.เชียงใหม่ 50000',
    contactPerson: 'ช่างวิรัช',
    contactPhone: '081-998-8776',
    createdAt: '2026-03-12T11:20:00.000Z',
    updatedAt: '2026-08-24T16:00:00.000Z',
  },
];

export function loadLoyaltyConfig(): LoyaltySystemConfig {
  if (typeof window === 'undefined') return DEFAULT_LOYALTY_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOYALTY_CONFIG);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_LOYALTY_CONFIG;
}

export function saveLoyaltyConfig(config: LoyaltySystemConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_LOYALTY_CONFIG, JSON.stringify(config));
  } catch {}
}

export function loadCustomers(): Customer[] {
  return [];
}

export function saveCustomers(customers: Customer[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(customers));
  } catch {}
}

export function getCustomerById(id: string): Customer | null {
  const list = loadCustomers();
  return list.find((c) => c.id === id || c.code === id) || null;
}

// Automatically generate sequential customer code CUST-0001, CUST-0002...
export function generateNextCustomerCode(): string {
  const list = loadCustomers();
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

export function upsertCustomer(customerData: Partial<Customer> & { name: string; phone: string }): { success: boolean; customer: Customer } {
  const list = loadCustomers();
  const now = new Date().toISOString();
  const config = loadLoyaltyConfig();

  let target: Customer;

  if (customerData.id) {
    // Edit existing (keep existing code)
    const idx = list.findIndex((c) => c.id === customerData.id);
    if (idx >= 0) {
      target = {
        ...list[idx],
        ...customerData,
        code: list[idx].code || generateNextCustomerCode(),
        updatedAt: now,
      };
      list[idx] = target;
    } else {
      target = {
        id: customerData.id,
        type: customerData.type || 'INDIVIDUAL',
        code: generateNextCustomerCode(),
        name: customerData.name.trim(),
        phone: customerData.phone.trim(),
        email: customerData.email?.trim() || '',
        address: customerData.address?.trim() || '',
        creditLimit: Number(customerData.creditLimit || 0),
        creditTerms: Number(customerData.creditTerms || 0),
        currentDebt: Number(customerData.currentDebt || 0),
        isCreditBlocked: Boolean(customerData.isCreditBlocked),
        creditNote: customerData.creditNote || '',
        priceLevel: (customerData.priceLevel || 1) as any,
        points: Number(customerData.points || 0),
        totalPointsEarned: Number(customerData.totalPointsEarned || customerData.points || 0),
        totalPointsRedeemed: Number(customerData.totalPointsRedeemed || 0),
        pointEarnRateBaht: customerData.pointEarnRateBaht || config.defaultPointEarnRateBaht,
        pointEarnUnits: customerData.pointEarnUnits || config.defaultPointEarnUnits,
        pointRedeemRatePoints: customerData.pointRedeemRatePoints || config.defaultPointRedeemRatePoints,
        pointRedeemDiscountBaht: customerData.pointRedeemDiscountBaht || config.defaultPointRedeemDiscountBaht,
        companyName: customerData.companyName?.trim() || '',
        taxId: customerData.taxId?.trim() || '',
        branchType: customerData.branchType || 'HEAD_OFFICE',
        branchNumber: customerData.branchNumber?.trim() || '00000',
        taxAddress: customerData.taxAddress?.trim() || '',
        contactPerson: customerData.contactPerson?.trim() || '',
        contactPhone: customerData.contactPhone?.trim() || '',
        note: customerData.note || '',
        createdAt: now,
        updatedAt: now,
      };
      list.unshift(target);
    }
  } else {
    // Create new (auto assign sequential code)
    target = {
      id: `cust_${Date.now()}`,
      type: customerData.type || 'INDIVIDUAL',
      code: generateNextCustomerCode(),
      name: customerData.name.trim(),
      phone: customerData.phone.trim(),
      email: customerData.email?.trim() || '',
      address: customerData.address?.trim() || '',
      creditLimit: Number(customerData.creditLimit || 0),
      creditTerms: Number(customerData.creditTerms || 0),
      currentDebt: Number(customerData.currentDebt || 0),
      isCreditBlocked: Boolean(customerData.isCreditBlocked),
      creditNote: customerData.creditNote || '',
      priceLevel: (customerData.priceLevel || 1) as any,
      points: Number(customerData.points || 0),
      totalPointsEarned: Number(customerData.totalPointsEarned || customerData.points || 0),
      totalPointsRedeemed: Number(customerData.totalPointsRedeemed || 0),
      pointEarnRateBaht: customerData.pointEarnRateBaht || config.defaultPointEarnRateBaht,
      pointEarnUnits: customerData.pointEarnUnits || config.defaultPointEarnUnits,
      pointRedeemRatePoints: customerData.pointRedeemRatePoints || config.defaultPointRedeemRatePoints,
      pointRedeemDiscountBaht: customerData.pointRedeemDiscountBaht || config.defaultPointRedeemDiscountBaht,
      companyName: customerData.companyName?.trim() || '',
      taxId: customerData.taxId?.trim() || '',
      branchType: customerData.branchType || 'HEAD_OFFICE',
      branchNumber: customerData.branchNumber?.trim() || '00000',
      taxAddress: customerData.taxAddress?.trim() || '',
      contactPerson: customerData.contactPerson?.trim() || '',
      contactPhone: customerData.contactPhone?.trim() || '',
      note: customerData.note || '',
      createdAt: now,
      updatedAt: now,
    };
    list.unshift(target);
  }

  saveCustomers(list);
  return { success: true, customer: target };
}

export function deleteCustomer(id: string): boolean {
  const list = loadCustomers();
  const next = list.filter((c) => c.id !== id);
  saveCustomers(next);
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
  pointsUsed: number = 0
): {
  earnedPoints: number;
  pointsUsed: number;
  newTotalPoints: number;
  previousPoints: number;
  debtAdded: number;
  customerName: string;
} {
  if (!customerId) {
    return { earnedPoints: 0, pointsUsed: 0, newTotalPoints: 0, previousPoints: 0, debtAdded: 0, customerName: 'ลูกค้าทั่วไป' };
  }

  const list = loadCustomers();
  const target = list.find((c) => c.id === customerId || c.code === customerId);
  if (!target) {
    return { earnedPoints: 0, pointsUsed: 0, newTotalPoints: 0, previousPoints: 0, debtAdded: 0, customerName: 'ลูกค้าทั่วไป' };
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
  pointsUsed: number = 0
): boolean {
  if (!customerId) return false;
  const list = loadCustomers();
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
