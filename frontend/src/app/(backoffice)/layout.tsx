import type { Metadata } from "next";
import Providers from "@/components/providers";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ClientDbSync } from "@/components/common/ClientDbSync";
import { GlobalDocumentSearch } from "@/components/common/GlobalDocumentSearch";

export const metadata: Metadata = {
  title: "ระบบขายหน้าร้าน ร้านปุริม (Purim POS)",
  description: "ระบบบริหารจัดการจุดขายหน้าร้านและคลังสินค้า ร้านปุริม",
};

/** Back office + POS: login guard, background sync, document search. The online shop (/shop) has none of these. */
export default function BackOfficeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <ClientDbSync />
      <GlobalDocumentSearch />
      <AuthGuard>{children}</AuthGuard>
    </Providers>
  );
}
