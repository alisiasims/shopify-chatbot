# DEESSE AI Chat — Deisi for the deesse.ee shop

One Next.js app on Railway with a Railway PostgreSQL database:

1. **Admin / homework chat** (`/`) — chat history, model and system-prompt selectors, Manage Prompts, Temperature / Top-P per chat, attachments, Clear Chat, typing indicator. Everything is stored in PostgreSQL.
2. **Deisi, the shop assistant** — the same agent that works at DEESSE Studio, adapted to the shop: live catalog of deesse.ee, sizes and stock, checkout links, delivery and return rules, handoff to a colleague.
3. **Site chat window** (`/deesy.js`, try it on `/demo`) — the DEESSE Studio chat design with shop texts, chips, product cards and a checkout button.
4. **Inbox** (`/inbox`, password) — all customer conversations from the site, e-mail, Instagram and Messenger; colleagues can answer site chats there.
5. **Gmail bridge** (`integrations/gmail-bridge.gs`) — new e-mails to info@deesse.ee get a Deisi draft reply in Gmail (a person sends it).
6. **Instagram / Messenger webhook** (`/api/meta`) — answers or Telegram drafts.

## Models

| Chosen model | What answers |
| --- | --- |
| Claude | Real Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-5-5`) when `ANTHROPIC_API_KEY` is set; otherwise the demo answer |
| GPT-4, Local Llama | Simulated answers (`src/lib/mock-ai.ts`, 1.5 s delay) as in the homework spec |

With the prompt **"Deesy – DEESSE Sales Agent"** or **"Deisi – shop assistant…"** the chat uses the shop tools; with Coder / Writer / Math it is a plain chat with that system prompt.

## How Deisi works (`src/lib/shop`)

- `knowledge.ts` — shop facts (shipping and refund policy, pickup, stock tags) and the rules learned at the studio: facts only from tools, only links from tools, never claim an action that did not happen, client's language with formal "Вы / Teie", greet once, short answers, one main product + 1–2 add-ons, discount only on hesitation and only a real code, handoff with name + e-mail, GDPR, prompt-injection safety.
- `catalog.ts` — reads `deesse.ee/products.json` (≈1,400 products) into the `Product` table every 6 h; search with synonyms, size and price filters.
- `tools.ts` — `search_products`, `get_product`, `make_cart_link` (Shopify cart permalink), `handoff_to_human` (Handoff row + Telegram), `offer_discount` (only with `DISCOUNT_CODE`), `order_status` (only with a Shopify Admin token; order number **and** e-mail must match), `skip_email`.
- `agent.ts` — Claude tool-use loop, link guard (made-up links are replaced), product cards for the chat window.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET, POST | `/api/chats` | List / create admin chats |
| GET, PATCH, DELETE | `/api/chats/[id]` | Load, update settings, delete a chat |
| POST, DELETE | `/api/chats/[id]/messages` | Send a message `{content, files?}` / clear messages |
| GET, POST, PUT, DELETE | `/api/prompts` | Manage system prompts |
| GET, POST | `/api/widget/chat` | Site chat window (CORS for deesse.ee) |
| POST | `/api/email` | Gmail bridge (Bearer `EMAIL_BRIDGE_TOKEN`) |
| GET, POST | `/api/meta` | Instagram / Messenger webhook |
| GET, POST | `/api/catalog` | Catalog status / sync now |
| GET, POST | `/api/inbox`, `/api/inbox/[id]` | Inbox (Basic auth, `ADMIN_PASSWORD`) |
| GET | `/api/health` | Which integrations are on (yes / no only) |

## Deployment (Railway)

Railway builds from `main`: `npm run build` (`prisma generate && next build`), start `npm start` (`prisma migrate deploy && next start`) on `PORT`.
Variables are listed in `.env.example`. Secrets live only in Railway Variables.

## Put Deisi on deesse.ee

Paste the line from `integrations/shopify-theme.liquid` before `</body>` in `layout/theme.liquid` (Online Store → Themes → Edit code). Remove the line to take her off.
