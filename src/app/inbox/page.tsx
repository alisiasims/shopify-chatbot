import type { Metadata } from "next";
import { Inbox } from "./inbox";

export const metadata: Metadata = { title: "DEESSE · Inbox", robots: { index: false } };
export const dynamic = "force-dynamic";

export default function InboxPage() {
  return <Inbox />;
}
