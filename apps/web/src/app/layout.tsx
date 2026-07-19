import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/i18n/server-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "GateLM Web Console",
  description: "GateLM Web Console"
};

const preferenceInitScript = `
try {
  var theme = window.localStorage.getItem("gatelm_console_theme");
  var displayMode = window.localStorage.getItem("gatelm_console_display_mode");
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.presentationMode = displayMode === "expanded" ? "true" : "false";
} catch (error) {
  document.documentElement.dataset.theme = "light";
  document.documentElement.dataset.presentationMode = "false";
}
`;

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} className="font-sans" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: preferenceInitScript }} />
        {children}
      </body>
    </html>
  );
}
