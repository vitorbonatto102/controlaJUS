import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ControlaJUS",
  description: "Plataforma interna de gestão do escritório",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
