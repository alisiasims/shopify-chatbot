import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEESSE AI Chat",
  description: "Deesy — the DEESSE AI sales agent for luxury dancewear.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // the page inside the Shopify admin (/shopify, marked by middleware) needs App Bridge as the first script in <head>
  const embedded = (await headers()).get("x-deesse-embedded") === "1" && Boolean(process.env.SHOPIFY_CLIENT_ID);
  return (
    <html lang={embedded ? "ru" : "en"}>
      {embedded && (
        <head>
          <meta name="shopify-api-key" content={process.env.SHOPIFY_CLIENT_ID} />
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        </head>
      )}
      <body className="antialiased">{children}</body>
    </html>
  );
}
