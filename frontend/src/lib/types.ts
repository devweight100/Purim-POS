// =============================================
// Shared Types for POS System
// =============================================

// --- Product & Inventory ---

export interface ProductUnit {
  id: string;
  unitName: string;
  factor: number; // conversion to base unit: 1 of this = factor × base
  price: number;
  barcode?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  category?: string;
  stock: number; // always in base units
  minStockAlert?: number; // จำนวนสต๊อกเตือนใกล้หมด
  hasVat: boolean;
  image: string | null;
  imageUrl?: string | null;
  units: ProductUnit[];
  defaultSellingUnitId?: string | null;
  unit?: string;
  basePrice?: number | null;
  costPrice?: number | null;
  priceLevel1?: number | null;
  priceLevel2?: number | null;
  priceLevel3?: number | null;
  priceLevel4?: number | null;
  priceLevel5?: number | null;
  supplierId?: string | null;
  barcodes?: Array<{ barcode?: string; supplierId?: string; label?: string }>;
  supplierEntries?: Array<{ supplierId?: string; lastCost?: number | string; notes?: string }>;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

// --- Cart ---

export interface CartItem {
  productId: string;
  name: string;
  sku: string;
  originalPrice: number;
  customPrice: number | null; // null = ใช้ originalPrice
  quantity: number;
  unitId: string;
  unitName: string;
  conversionFactor: number;
  discountType: 'none' | 'baht' | 'percent';
  discountValue: number;
  hasVat: boolean;
  isWholesaleApplied?: boolean;
  pricingNote?: string;
  itemNote?: string;
}

export interface HeldBill {
  id: string;
  label: string;
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  billDiscountType: 'none' | 'baht' | 'percent';
  billDiscountValue: number;
  pointsDiscountValue?: number;
  pointsUsed?: number;
  note?: string;
  heldAt: string;
}

// --- Customer / Member ---

export interface Customer {
  id: string;
  name: string;
  phone: string;
  type?: 'INDIVIDUAL' | 'COMPANY';
  code?: string;
  lineId?: string;
  email?: string;
  address?: string;
  taxId?: string;
  memberTier?: 'normal' | 'silver' | 'gold' | 'vip';
  priceLevel?: 1 | 2 | 3 | 4 | 5;
  creditLimit?: number;
  creditTerms?: number;
  currentDebt?: number;
  isCreditBlocked?: boolean;
  creditNote?: string;
  points: number;
  totalPointsEarned?: number;
  totalPointsRedeemed?: number;
  pointEarnRateBaht?: number;
  pointEarnUnits?: number;
  pointRedeemRatePoints?: number;
  pointRedeemDiscountBaht?: number;
  companyName?: string;
  branchType?: 'HEAD_OFFICE' | 'BRANCH';
  branchNumber?: string;
  taxAddress?: string;
  contactPerson?: string;
  contactPhone?: string;
  birthday?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

// --- Shift ---

export interface Shift {
  id: string;
  userId: string;
  userName: string;
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  cashSales: number;
  qrSales: number;
  cardSales: number;
  transferSales: number;
  creditSales?: number;
  cashIn: number;
  cashOut: number;
  orderCount: number;
  voidCount: number;
  isOpen: boolean;
}

export interface CashTransaction {
  id: string;
  shiftId: string;
  type: 'in' | 'out';
  amount: number;
  reason: string;
  createdAt: string;
}

// --- Orders ---

export interface OrderItem {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitName: string;
  unitId?: string;
  conversionFactor?: number;
  unitPrice: number;
  originalPrice: number;
  discountType: 'none' | 'baht' | 'percent';
  discountValue: number;
  discountAmount: number;
  lineTotal: number;
  hasVat: boolean;
}

export interface OrderPayment {
  method: PaymentMethodType;
  amount: number;
  referenceNo?: string;
  cashReceived?: number;
  changeAmount?: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string | null;
  items: OrderItem[];
  subtotal: number;
  billDiscountType: 'none' | 'baht' | 'percent';
  billDiscountValue: number;
  billDiscountAmount: number;
  pointsDiscountAmount?: number;
  pointsUsed?: number;
  claimDiscountAmount?: number;
  claimInfo?: any;
  vatAmount: number;
  totalAmount: number;
  payments: OrderPayment[];
  cashReceived: number;
  changeAmount: number;
  status: 'COMPLETED' | 'VOIDED' | 'REFUNDED' | 'CANCELLED';
  voidReason?: string;
  note?: string;
  userId: string;
  userName: string;
  shiftId: string;
  createdAt: string;
  isSynced?: boolean;
}

export type PaymentMethodType = 'CASH' | 'QR_PROMPTPAY' | 'CREDIT_CARD' | 'TRANSFER' | 'CREDIT_NOTE';

// --- Store Settings ---

export interface StoreSettings {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeEmail?: string;
  logoUrl: string | null;
  qrImageUrl: string | null;
  qrLabel: string;
  taxId?: string;
  receiptFooter?: string;
  vatRate: number; // 7
}

// --- Dashboard ---

export interface DashboardData {
  todaySales: number;
  monthSales: number;
  todayOrders: number;
  totalProducts: number;
  totalCustomers: number;
  recentOrders: Order[];
  salesChart: { date: string; sales: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
}

// --- Customer Debt & Credit Management ---

export type DebtStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface DebtPaymentInstallment {
  id: string;
  installmentNo: number;
  paymentDate: string;
  amountPaid: number;
  paymentMethod: PaymentMethodType;
  accountLabel?: string;
  referenceNo?: string;
  note?: string;
  cashierName: string;
  previousPaid: number;
  remainingAfter: number;
}

export interface DebtRecord {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  dueDate?: string;
  customerId: string;
  customerCode?: string;
  customerName: string;
  customerPhone?: string;
  customerType?: 'INDIVIDUAL' | 'COMPANY';
  companyName?: string;
  taxId?: string;
  taxAddress?: string;
  totalAmount: number;
  paidAmount: number;
  remainingDebt: number;
  progressPercent: number; // 0 - 100
  status: DebtStatus;
  installments: DebtPaymentInstallment[];
  lastPaymentDate?: string;
}

// --- Warranty & Product Claims Management ---

export type ClaimResolutionType =
  | 'REPLACE_ITEM'      // เปลี่ยนสินค้าชิ้นใหม่ทันที
  | 'REFUND_CASH'       // คืนเป็นเงินสด
  | 'REFUND_TRANSFER'   // คืนเป็นเงินโอน
  | 'STORE_DISCOUNT'    // เปลี่ยนเป็นส่วนลดบิลซื้อปัจจุบัน
  | 'SUPPLIER_RMA';     // รับเข้าส่งเคลมโรงงาน/ซัพพลายเออร์

export type ClaimStatus =
  | 'COMPLETED'          // เคลมสำเร็จ (เปลี่ยนของหรือคืนเงินแล้ว)
  | 'PENDING_CHECKOUT'   // รอชำระเงินบิลหน้าร้าน (ใช้เป็นส่วนลดบิลนี้)
  | 'PENDING_SUPPLIER'   // รอส่งเคลมซัพพลายเออร์
  | 'SENT_TO_SUPPLIER'   // ส่งเคลมซัพพลายเออร์แล้ว
  | 'SUPPLIER_REPLACED'  // ได้รับของเปลี่ยนจากซัพพลายเออร์แล้ว
  | 'SCRAPPED';          // ตัดจำหน่าย / ทิ้ง

export interface ClaimRecord {
  id: string; // CLM-YYYYMMDD-XXXX
  claimDate: string; // ISO date string
  orderId: string;
  orderNumber: string;
  orderDate: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  productId: string;
  productName: string;
  sku: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  totalClaimValue: number;
  conversionFactor?: number;
  baseQuantity?: number;
  defectReason: string;
  resolutionType: ClaimResolutionType;
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
  status: ClaimStatus;
  cashierName: string;
  note?: string;
  isReplacementItem?: boolean;
  parentClaimId?: string; // If this item was a replacement from a previous claim
  claimedInOrderNumber?: string; // If used as discount in a POS checkout order
  supplierId?: string;
  supplierName?: string;
  supplierTrackingNo?: string;
  costPrice?: number;
  totalCostValue?: number;
  returnDocId?: string;
  settledInBillNumber?: string;
  completedDate?: string;
}

export interface SupplierReturnItem {
  claimId: string;             // รหัสใบเคลมเดิม CLM-xxx
  productId: string;
  productName: string;
  sku: string;
  unitName: string;
  quantity: number;
  unitCost: number;            // ราคาทุนต่อหน่วย
  totalCost: number;           // มูลค่ารวม = quantity * unitCost
  defectReason: string;        // อาการเสียที่ส่งคืน
  originalOrderNumber: string; // บิลขายเดิมที่ลูกค้าซื้อไป
}

export interface SupplierReturnDeduction {
  billNumber: string;
  deductedAmount: number;
  deductedAt: string;
  netPaid: number;
  note?: string;
}

export interface SupplierReturnNote {
  id: string;                  // RTN-YYYYMMDD-XXXX
  returnDate: string;          // ISO date string
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  items: SupplierReturnItem[];
  totalQuantity: number;
  totalCreditAmount: number;   // ยอดเงินที่ต้องหักลดหนี้ตามราคาทุนรวม (เช่น 50 บาท)
  remainingCreditAmount: number; // ยอดคงเหลือที่ยังไม่ได้หัก (รองรับหักหลายรอบ)
  status: 'PENDING_DEDUCTION' | 'PARTIALLY_DEDUCTED' | 'DEDUCTED' | 'CANCELLED';
  deductions?: SupplierReturnDeduction[];
  notes?: string;
  createdBy: string;
}

export interface ClaimEligibleItem {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  productId: string;
  productName: string;
  sku: string;
  unitName: string;
  conversionFactor?: number;
  boughtQuantity: number;
  alreadyClaimedQuantity: number;
  availableClaimQuantity: number;
  baseBoughtQuantity?: number;
  alreadyClaimedBaseQuantity?: number;
  availableBaseClaimQuantity?: number;
  baseUnitPrice?: number;
  availableUnits?: Array<{ id: string; unitName: string; factor: number; price: number; barcode?: string }>;
  unitPrice: number;
  isReplacementWarranty?: boolean;
  originalClaimId?: string;
}
