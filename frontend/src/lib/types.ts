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
  stock: number; // always in base units
  hasVat: boolean;
  image: string | null;
  units: ProductUnit[];
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
}

export interface HeldBill {
  id: string;
  label: string;
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  billDiscountType: 'none' | 'baht' | 'percent';
  billDiscountValue: number;
  heldAt: string;
}

// --- Customer / Member ---

export interface Customer {
  id: string;
  name: string;
  phone: string;
  lineId?: string;
  email?: string;
  address?: string;
  taxId?: string;
  memberTier: 'normal' | 'silver' | 'gold' | 'vip';
  points: number;
  birthday?: string;
  note?: string;
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
  vatAmount: number;
  totalAmount: number;
  payments: OrderPayment[];
  cashReceived: number;
  changeAmount: number;
  status: 'COMPLETED' | 'VOIDED' | 'REFUNDED';
  voidReason?: string;
  userId: string;
  userName: string;
  shiftId: string;
  createdAt: string;
}

export type PaymentMethodType = 'CASH' | 'QR_PROMPTPAY' | 'CREDIT_CARD' | 'TRANSFER';

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
