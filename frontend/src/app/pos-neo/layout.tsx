import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Purim POS (Neo-Brutalist Edition)',
  description: 'จุดขายหน้าร้านสไตล์ Neo-brutalism & Retro OS - คลีน อ่านง่าย คอนทราสต์ชัดเจน',
};

export default function POSNeoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F5EFEB] text-black antialiased selection:bg-[#FEF08A] selection:text-black">
      {children}
    </div>
  );
}
