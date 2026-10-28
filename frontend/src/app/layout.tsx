import type { Metadata } from "next";
import { Inter, Sarabun } from "next/font/google";
import "./globals.css";
import Providers from "@/components/providers";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ClientDbSync } from "@/components/common/ClientDbSync";
import { GlobalDocumentSearch } from "@/components/common/GlobalDocumentSearch";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const sarabun = Sarabun({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-sarabun",
});

export const metadata: Metadata = {
  title: "ระบบขายหน้าร้าน ร้านปุริม (Purim POS)",
  description: "ระบบบริหารจัดการจุดขายหน้าร้านและคลังสินค้า ร้านปุริม",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body
        className={`${inter.variable} ${sarabun.variable} font-sans antialiased min-h-dvh bg-background text-foreground flex flex-col`}
      >
        <Providers>
          <ClientDbSync />
          <GlobalDocumentSearch />
          <AuthGuard>{children}</AuthGuard>
        </Providers>
      </body>
    </html>
  );
}
