import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

import { PRODUCT_NAME, TENANT } from "@/lib/brand";
import { DEFAULT_THEME, THEME_BOOT_SCRIPT } from "@/lib/themes";

import { Providers } from "./providers";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} · ${TENANT.name}`,
  description: "Ladda upp, rita om och hantera planritningar.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/redraw-mark.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", type: "image/x-icon" },
    ],
    apple: [{ url: "/favicon.ico" }],
    shortcut: ["/favicon.ico"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="sv"
      data-theme={DEFAULT_THEME}
      className={`${geist.variable} h-full antialiased`}
      style={{ "--tenant-accent": TENANT.accent } as React.CSSProperties}
      // The boot script may switch the theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-stone-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
