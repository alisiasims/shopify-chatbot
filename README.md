# DEESSE AI Chat — Deesy

A responsive AI chatbot UI for **deesse.ee**, featuring **Deesy**, the DEESSE AI sales agent.
It runs on Railway with a Railway PostgreSQL database. AI replies are mocked for now.

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS 4 · shadcn/ui · Lucide-React · Prisma 6 · PostgreSQL

## Features

- Chat history sidebar (collapsible on mobile): open, delete, start new chats
- LLM model selector (GPT-4, Claude, Local Llama) and system prompt selector
- Manage Prompts modal: add, edit and delete system prompts
- Advanced settings: Temperature and Top-P (0.0–1.0), saved per chat
- Auto-expanding input, file attachment name, Clear Chat, typing indicator
- Everything is stored in PostgreSQL; a friendly banner appears when the database is unreachable
- Mock AI (`src/lib/mock-ai.ts`) with a 1.5s delay; Deesy replies in English, Estonian or Russian and always ends with the DEESSE signature

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET, POST | `/api/chats` | List / create chat sessions |
| GET, PATCH, DELETE | `/api/chats/[id]` | Load, update settings, delete a chat |
| POST, DELETE | `/api/chats/[id]/messages` | Send a message (returns the mock reply) / clear messages |
| GET, POST, PUT, DELETE | `/api/prompts` | List, create, update (`{ id, name, content }`), delete (`?id=`) |

## Deployment (Railway)

1. Create a Railway project with a **PostgreSQL** service and a service connected to this GitHub repo (`main` branch).
2. In the app service, set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`.
3. Railway runs `npm run build` (`prisma generate && next build`) and `npm start` (`prisma migrate deploy && next start`), listening on `PORT`.

Default system prompts are created automatically when the prompts table is empty. To re-seed or update them explicitly:

```bash
railway run npm run db:seed
```

See `.env.example` for the required environment variable.
