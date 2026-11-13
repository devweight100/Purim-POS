import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'สรุปร้าน (มือถือ) - ปุริม POS',
  description: 'ยอดขาย สต็อก ราคา และบิล สำหรับดูบนมือถือ',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

/** Mobile summary: no back-office sidebar, light theme, phone width first. */
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">{children}</div>;
}
