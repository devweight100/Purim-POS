const fs = require('fs');
const path = require('path');

const files = {
  'src/lib/utils.ts': `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
  }).format(amount)
}

export function formatDate(dateStr: string | Date) {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function generateOrderNumber() {
  const date = new Date()
  const d = date.toISOString().slice(0,10).replace(/-/g, '')
  const r = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return \`ORD-\${d}-\${r}\`
}`,

  'src/lib/mock-data.ts': `// Categories
export const categories = [
  { id: '1', name: 'อาหารสด', color: '#22c55e', icon: '🥬', productCount: 3 },
  { id: '2', name: 'เครื่องดื่ม', color: '#3b82f6', icon: '🥤', productCount: 3 },
  { id: '3', name: 'ขนมขบเคี้ยว', color: '#f59e0b', icon: '🍿', productCount: 1 },
  { id: '4', name: 'ของใช้ในบ้าน', color: '#8b5cf6', icon: '🏠', productCount: 3 },
  { id: '5', name: 'เครื่องเขียน', color: '#ec4899', icon: '✏️', productCount: 2 },
  { id: '6', name: 'อื่นๆ', color: '#6b7280', icon: '📦', productCount: 0 },
];

// Products
export const products = [
  { id: '1', name: 'ข้าวหอมมะลิ 5 กก.', sku: 'RICE-JAS-5KG', price: 189.00, categoryId: '1', stock: 45, barcodes: ['8850000000001'], image: null },
  { id: '2', name: 'น้ำดื่มสิงห์ 600ml', sku: 'DRK-SINGHA-600', price: 12.00, categoryId: '2', stock: 200, barcodes: ['8850000000002'], image: null },
  { id: '3', name: 'มาม่าต้มยำกุ้ง', sku: 'SNK-MAMA-TYK', price: 7.00, categoryId: '3', stock: 150, barcodes: ['8850000000003', '8850000000013'], image: null },
  { id: '4', name: 'น้ำยาล้างจาน ซันไลต์ 450ml', sku: 'HH-SUNLIGHT-450', price: 35.00, categoryId: '4', stock: 30, barcodes: ['8850000000004'], image: null },
  { id: '5', name: 'ปากกาลูกลื่น Pilot', sku: 'ST-PILOT-BP', price: 15.00, categoryId: '5', stock: 8, barcodes: ['8850000000005'], image: null },
  { id: '6', name: 'นมจืดหนองโพ 200ml', sku: 'DRK-NP-MILK-200', price: 14.00, categoryId: '2', stock: 100, barcodes: ['8850000000006'], image: null },
  { id: '7', name: 'ไข่ไก่ แพค 10 ฟอง', sku: 'FOOD-EGG-10', price: 55.00, categoryId: '1', stock: 25, barcodes: ['8850000000007'], image: null },
  { id: '8', name: 'แชมพู เฮดแอนด์โชว์เดอร์ 330ml', sku: 'HH-HNS-330', price: 119.00, categoryId: '4', stock: 18, barcodes: ['8850000000008'], image: null },
  { id: '9', name: 'ขนมปังฟาร์มเฮ้าส์', sku: 'FOOD-FH-BREAD', price: 38.00, categoryId: '1', stock: 12, barcodes: ['8850000000009'], image: null },
  { id: '10', name: 'โค้ก 325ml', sku: 'DRK-COKE-325', price: 15.00, categoryId: '2', stock: 180, barcodes: ['8850000000010'], image: null },
  { id: '11', name: 'สมุดบันทึก A5', sku: 'ST-NOTEBOOK-A5', price: 25.00, categoryId: '5', stock: 50, barcodes: ['8850000000011'], image: null },
  { id: '12', name: 'ถุงขยะดำ 30x40', sku: 'HH-TRASH-3040', price: 20.00, categoryId: '4', stock: 60, barcodes: ['8850000000012'], image: null },
];

export const customers = [
  { id: '1', name: 'สมชาย มั่งมี', phone: '081-234-5678', points: 150 },
  { id: '2', name: 'สมหญิง ใจดี', phone: '089-876-5432', points: 85 },
  { id: '3', name: 'ประหยัด อดออม', phone: '086-111-2222', points: 320 },
];

export const orders = [
  { id: '1', orderNumber: 'ORD-20260804-0001', customer: 'สมชาย มั่งมี', items: 3, total: 223.00, status: 'COMPLETED', payments: [{method: 'CASH', amount: 223.00}], createdAt: '2026-08-04T09:15:00' },
  { id: '2', orderNumber: 'ORD-20260804-0002', customer: null, items: 2, total: 54.00, status: 'COMPLETED', payments: [{method: 'QR_PROMPTPAY', amount: 54.00}], createdAt: '2026-08-04T10:30:00' },
  { id: '3', orderNumber: 'ORD-20260804-0003', customer: 'สมหญิง ใจดี', items: 5, total: 456.00, status: 'COMPLETED', payments: [{method: 'CASH', amount: 200.00}, {method: 'QR_PROMPTPAY', amount: 256.00}], createdAt: '2026-08-04T11:45:00' },
];

export const storeSettings = {
  storeName: 'ร้านปุริม',
  storePhone: '02-123-4567',
  storeAddress: '123 ถ.สุขุมวิท กรุงเทพฯ 10110',
  logoUrl: null,
  qrImageUrl: null,
  qrLabel: 'PromptPay: 081-234-5678',
};

export const dashboardData = {
  todaySales: 12450.00,
  monthSales: 385600.00,
  todayOrders: 28,
  totalProducts: 12,
  totalCustomers: 3,
  recentOrders: orders,
  salesChart: [
    { date: '28 ก.ค.', sales: 8500 },
    { date: '29 ก.ค.', sales: 12300 },
    { date: '30 ก.ค.', sales: 9800 },
    { date: '31 ก.ค.', sales: 15200 },
    { date: '1 ส.ค.', sales: 11000 },
    { date: '2 ส.ค.', sales: 13700 },
    { date: '3 ส.ค.', sales: 10500 },
    { date: '4 ส.ค.', sales: 12450 },
  ],
  topProducts: [
    { name: 'น้ำดื่มสิงห์ 600ml', quantity: 45, revenue: 540 },
    { name: 'มาม่าต้มยำกุ้ง', quantity: 38, revenue: 266 },
    { name: 'โค้ก 325ml', quantity: 32, revenue: 480 },
    { name: 'ข้าวหอมมะลิ 5 กก.', quantity: 12, revenue: 2268 },
    { name: 'ไข่ไก่ แพค 10 ฟอง', quantity: 10, revenue: 550 },
  ],
};
`,

  'src/lib/api.ts': `import { categories, products, customers, orders, storeSettings, dashboardData } from "./mock-data";

const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

export const api = {
  getCategories: async () => {
    await delay();
    return categories;
  },
  getProducts: async () => {
    await delay();
    return products;
  },
  getCustomers: async () => {
    await delay();
    return customers;
  },
  getOrders: async () => {
    await delay();
    return orders;
  },
  getStoreSettings: async () => {
    await delay();
    return storeSettings;
  },
  getDashboardData: async () => {
    await delay();
    return dashboardData;
  },
  createOrder: async (orderData: any) => {
    await delay(500);
    return { success: true, orderId: \`ORD-\${Date.now()}\` };
  }
};
`,

  'src/lib/store/cart-store.ts': `import { create } from 'zustand';

export interface CartItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  discountAmount: number;
  addItem: (product: any) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setCustomer: (id: string, name: string) => void;
  clearCustomer: () => void;
  setDiscount: (amount: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  discountAmount: 0,
  
  addItem: (product) => {
    set((state) => {
      const existing = state.items.find((i) => i.productId === product.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return {
        items: [...state.items, {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          quantity: 1,
        }],
      };
    });
  },
  
  removeItem: (productId) => {
    set((state) => ({
      items: state.items.filter((i) => i.productId !== productId),
    }));
  },
  
  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    set((state) => ({
      items: state.items.map((i) =>
        i.productId === productId ? { ...i, quantity } : i
      ),
    }));
  },
  
  setCustomer: (id, name) => set({ customerId: id, customerName: name }),
  clearCustomer: () => set({ customerId: null, customerName: null }),
  setDiscount: (amount) => set({ discountAmount: amount }),
  
  clearCart: () => set({ items: [], customerId: null, customerName: null, discountAmount: 0 }),
  
  getSubtotal: () => {
    return get().items.reduce((total, item) => total + (item.price * item.quantity), 0);
  },
  
  getTotal: () => {
    const subtotal = get().getSubtotal();
    return Math.max(0, subtotal - get().discountAmount);
  },
  
  getItemCount: () => {
    return get().items.reduce((count, item) => count + item.quantity, 0);
  },
}));
`,

  'src/lib/store/auth-store.ts': `import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  role: string;
}

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  login: async (username, password) => {
    // Mock login
    return new Promise((resolve) => {
      setTimeout(() => {
        if (username === 'admin' && password === 'admin123') {
          set({
            user: { id: '1', name: 'Admin User', role: 'ADMIN' },
            isAuthenticated: true,
          });
          resolve(true);
        } else {
          resolve(false);
        }
      }, 500);
    });
  },
  logout: () => set({ user: null, isAuthenticated: false }),
}));
`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(__dirname, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(\`Generated \${filePath}\`);
}
