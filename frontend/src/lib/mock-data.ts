import { Product, Category, Customer, StoreSettings, Order, DashboardData } from './types';

export const categories: Category[] = [];

export const products: Product[] = [];

export const customers: Customer[] = [];

export const orders: Order[] = [];

export const storeSettings: StoreSettings = {
  storeName: 'ร้านปุริม POS',
  storePhone: '02-123-4567',
  storeAddress: '123/45 ถนนสุขุมวิท กรุงเทพมหานคร',
  receiptFooter: 'ขอบคุณที่ใช้บริการร้านปุริม โอกาสหน้าเชิญใหม่นะคะ',
  logoUrl: '',
  qrImageUrl: '',
  qrLabel: 'พร้อมเพย์ร้านปุริม',
  taxId: '',
  vatRate: 7,
};

export const dashboardData: DashboardData = {
  todaySales: 0,
  monthSales: 0,
  todayOrders: 0,
  totalProducts: 0,
  totalCustomers: 0,
  recentOrders: [],
  salesChart: [],
  topProducts: [],
};
