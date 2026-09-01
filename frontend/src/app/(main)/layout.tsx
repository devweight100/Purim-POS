import { Sidebar } from '@/components/layout/Sidebar';
import { ClientDbSync } from '@/components/common/ClientDbSync';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh max-w-full overflow-x-hidden bg-slate-50">
      <ClientDbSync />
      <Sidebar />
      <main className="min-h-dvh min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pt-14 lg:ml-[240px] lg:pt-0">
        {children}
      </main>
    </div>
  );
}
