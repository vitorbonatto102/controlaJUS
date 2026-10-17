import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./branding.css";

const inter = localFont({ src: "./fonts/InterVariable.woff2", variable: "--font-inter", display: "swap", weight: "100 900" });

export const metadata: Metadata = {
  title: { default: "Repassum · Gestão financeira jurídica", template: "%s · Repassum" },
  applicationName: "Repassum",
  description: "Controle que acompanha cada valor. Contratos, recebimentos, comissões e repasses do seu escritório.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#123439" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" className={inter.variable}><body>{children}</body></html>;
}
