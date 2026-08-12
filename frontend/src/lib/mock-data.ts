import { Category, Product, Customer, StoreSettings, DashboardData, Order } from './types';

export const categories: Category[] = [
  { id: 'c1', name: 'อาหารสด', color: '#f87171', icon: 'Beef' },
  { id: 'c2', name: 'เครื่องดื่ม', color: '#60a5fa', icon: 'CupSoda' },
  { id: 'c3', name: 'ขนมขบเคี้ยว', color: '#fbbf24', icon: 'Cookie' },
  { id: 'c4', name: 'ของใช้ส่วนตัว', color: '#34d399', icon: 'Bath' },
  { id: 'c5', name: 'เครื่องปรุง', color: '#a78bfa', icon: 'UtensilsCrossed' },
  { id: 'c6', name: 'อื่นๆ', color: '#94a3b8', icon: 'Package' },
];

export const products: Product[] = [
  {
    id: 'p1',
    name: 'น้ำแร่ธรรมชาติ 600ml',
    sku: 'BEV-001',
    categoryId: 'c2',
    stock: 240, // Base unit stock
    hasVat: true,
    image: null,
    units: [
      { id: 'u1-1', unitName: 'ขวด', factor: 1, price: 12, barcode: '885000000001' },
      { id: 'u1-2', unitName: 'แพ็ค (12 ขวด)', factor: 12, price: 135, barcode: '885000000002' }
    ]
  },
  {
    id: 'p2',
    name: 'โค้ก กระป๋อง 325ml',
    sku: 'BEV-002',
    categoryId: 'c2',
    stock: 48,
    hasVat: true,
    image: null,
    units: [
      { id: 'u2-1', unitName: 'กระป๋อง', factor: 1, price: 15, barcode: '885000000011' }
    ]
  },
  {
    id: 'p3',
    name: 'เลย์ มันฝรั่งทอด 50g',
    sku: 'SNK-001',
    categoryId: 'c3',
    stock: 50,
    hasVat: true,
    image: null,
    units: [
      { id: 'u3-1', unitName: 'ซอง', factor: 1, price: 20, barcode: '885000000021' }
    ]
  },
  {
    id: 'p4',
    name: 'ข้าวหอมมะลิ 5kg',
    sku: 'FOD-001',
    categoryId: 'c5',
    stock: 20,
    hasVat: false, // ข้าวสารยกเว้น VAT
    image: null,
    units: [
      { id: 'u4-1', unitName: 'ถุง', factor: 1, price: 189, barcode: '885000000031' }
    ]
  },
  {
    id: 'p5',
    name: 'สบู่ก้อน 100g',
    sku: 'PER-001',
    categoryId: 'c4',
    stock: 120,
    hasVat: true,
    image: null,
    units: [
      { id: 'u5-1', unitName: 'ก้อน', factor: 1, price: 15, barcode: '885000000041' },
      { id: 'u5-2', unitName: 'แพ็ค (4 ก้อน)', factor: 4, price: 55, barcode: '885000000042' }
    ]
  },
  {
    id: 'p6',
    name: 'น้ำปลาแท้ 700ml',
    sku: 'FOD-002',
    categoryId: 'c5',
    stock: 5,
    hasVat: true,
    image: null,
    units: [
      { id: 'u6-1', unitName: 'ขวด', factor: 1, price: 35, barcode: '885000000051' }
    ]
  },
];

export const customers: Customer[] = [
  {
    id: 'cust1',
    name: 'คุณสมชาย ใจดี',
    phone: '0812345678',
    memberTier: 'gold',
    points: 1250,
  },
  {
    id: 'cust2',
    name: 'คุณสมหญิง รักสวย',
    phone: '0898765432',
    memberTier: 'silver',
    points: 450,
  },
  {
    id: 'cust3',
    name: 'คุณมานะ อดทน',
    phone: '0855555555',
    memberTier: 'normal',
    points: 10,
  },
];

export const storeSettings: StoreSettings = {
  storeName: 'ร้านปุริม ซุปเปอร์มาร์เก็ต',
  storePhone: '02-123-4567',
  storeAddress: '123/45 ถ.สุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพฯ 10110',
  logoUrl: null,
  qrImageUrl: null,
  qrLabel: 'สแกนจ่ายผ่าน PromptPay',
  taxId: '0105555555555',
  receiptFooter: 'ขอบคุณที่ใช้บริการ\nสินค้าซื้อแล้วไม่รับเปลี่ยนคืน',
  vatRate: 7,
};

export const orders: Order[] = []; // Initial empty
export const dashboardData: DashboardData = {
  todaySales: 0,
  monthSales: 0,
  todayOrders: 0,
  totalProducts: products.length,
  totalCustomers: customers.length,
  recentOrders: [],
  salesChart: [],
  topProducts: []
};
