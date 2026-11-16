import type { Metadata, Viewport } from 'next';
import { ShopShell } from '@/components/shop/ShopShell';

export const metadata: Metadata = {
  title: 'สั่งของออนไลน์',
  description: 'สั่งสินค้าจากร้านผ่าน LINE รับเองที่ร้านหรือให้ร้านไปส่ง',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#065f46',
};

/** Online shop opened from LINE (LIFF). No back-office code, no staff login. docs/online-shop.md */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <ShopShell>{children}</ShopShell>;
}
