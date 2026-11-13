/** API helpers + realistic shop data for the print audit. */
export const BACKEND = process.env.PA_BACKEND || 'http://127.0.0.1:4331';

export async function api<T = unknown>(method: string, p: string, token?: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BACKEND}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export const ADMIN = { username: 'admin', defaultPassword: 'admin123', password: 'Admin#Print2026', pin: '7391' };

export async function adminToken(): Promise<string> {
  const login = (pw: string) => api<{ access_token: string }>('POST', '/auth/login', undefined, { username: ADMIN.username, password: pw });
  try {
    return (await login(ADMIN.password)).access_token;
  } catch {
    const t = (await login(ADMIN.defaultPassword)).access_token;
    await api('POST', '/auth/change-password', t, { currentPassword: ADMIN.defaultPassword, newPassword: ADMIN.password, newPin: ADMIN.pin });
    return (await login(ADMIN.password)).access_token;
  }
}

export const STORE = {
  storeName: 'ร้านปุริมวัสดุก่อสร้างและฮาร์ดแวร์',
  branchName: 'สำนักงานใหญ่',
  storeAddress: '99/9 หมู่ 4 ถนนพหลโยธิน ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120',
  storePhone: '02-123-4567, 081-234-5678',
  storeEmail: 'purim.shop@example.com',
  taxId: '0135561234567',
  receiptFooter: 'สินค้าซื้อแล้วเปลี่ยนได้ภายใน 7 วัน พร้อมใบเสร็จ',
};

export interface SeedProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  basePrice: number;
}

export const PRODUCTS = [
  { sku: 'PA-PIPE-PVC-12', name: 'ท่อพีวีซี ตราช้าง ขนาด 1/2 นิ้ว ชั้น 13.5 ยาว 4 เมตร สีฟ้า (มอก.)', unit: 'เส้น', basePrice: 89.5, pack: { name: 'มัด', qtyPerPrev: 10, priceLevel1: 850 } },
  { sku: 'PA-CEMENT-TPI', name: 'ปูนซีเมนต์ผสม ทีพีไอ เขียว M197 50 กก.', unit: 'ถุง', basePrice: 145, pack: undefined },
  { sku: 'PA-SCREW-6', name: 'สกรูเกลียวปล่อย หัวนูน #6x1" ชุบซิงค์ (แพ็ค 100 ตัว) สำหรับงานไม้และงานยิปซัมบอร์ดทั่วไป', unit: 'แพ็ค', basePrice: 35, pack: undefined },
  { sku: 'PA-GLOVE', name: 'ถุงมือผ้า', unit: 'คู่', basePrice: 12, pack: { name: 'โหล', qtyPerPrev: 12, priceLevel1: 130 } },
] as const;
