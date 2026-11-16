import type { Metadata } from "next";
import { Inter, Sarabun } from "next/font/google";
import "./globals.css";

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
        {/* back office chrome lives in (backoffice)/layout.tsx; the online shop has its own in shop/layout.tsx */}
        {children}
      </body>
    </html>
  );
}
