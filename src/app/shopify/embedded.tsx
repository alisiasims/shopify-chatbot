"use client";

import { useEffect, useState } from "react";
import { Inbox } from "../inbox/inbox";

type ShopifyGlobal = { idToken: () => Promise<string> };

/**
 * Waits for Shopify App Bridge (loaded in <head> by the root layout), then adds the Shopify session token
 * to every request of this page to our own /api (the server checks it in middleware).
 */
export function Embedded() {
  const [state, setState] = useState<"wait" | "ok" | "outside">("wait");
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      const shopify = (window as unknown as { shopify?: ShopifyGlobal }).shopify;
      if (shopify?.idToken) {
        clearInterval(timer);
        const original = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const own = url.startsWith("/") || url.startsWith(window.location.origin);
          if (!own) return original(input, init);
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          headers.set("Authorization", `Bearer ${await shopify.idToken()}`);
          return original(input, { ...init, headers });
        };
        setState("ok");
      } else if (++tries > 100 || window.top === window.self) {
        clearInterval(timer);
        setState("outside");
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);
  if (state === "ok") return <Inbox />;
  if (state === "outside")
    return <p className="p-8 text-center text-sm text-zinc-500">Откройте Дейси в админке Shopify: Приложения → Deesy AI Agent.</p>;
  return <p className="p-8 text-center text-sm text-zinc-400">Загрузка…</p>;
}
