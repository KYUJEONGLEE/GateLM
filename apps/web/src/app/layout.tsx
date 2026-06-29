import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/i18n/server-locale";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "GateLM Web Console",
  description: "GateLM Web Console"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
