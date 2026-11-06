import type { Metadata } from "next";
import { Embedded } from "./embedded";

export const metadata: Metadata = { title: "Дейси · магазин DEESSE", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The inbox inside the Shopify admin (app "Deesy AI Agent", App URL = https://<railway>/shopify). */
export default function ShopifyAdminPage() {
  return <Embedded />;
}
