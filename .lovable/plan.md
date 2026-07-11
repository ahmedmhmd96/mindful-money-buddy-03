## Overview

Personal budgeting app in EGP with cloud sync via Lovable Cloud. Email + password login so your data follows you across devices. Lovable AI generates budgeting advice.

## Auth

- Enable Lovable Cloud (Supabase-backed).
- Email + password sign-in on `/auth` (sign up / sign in tabs).
- All app routes live under the managed `_authenticated/` layout.
- No profile fields needed (single user, just email).

## Data model (all with RLS scoped to `auth.uid()`)

- `categories` — id, user_id, name, monthly_limit (EGP), color, created_at.
- `transactions` — id, user_id, kind ('expense'|'income'), amount, category_id (nullable for income), note, occurred_on (date), created_at.
- `recurring_items` — id, user_id, kind, amount, category_id, name, frequency ('monthly'|'weekly'), day_of_month (1–31) or day_of_week (0–6), last_generated_on, active.

Each table: GRANTs for `authenticated` + `service_role`; RLS policies for select/insert/update/delete where `auth.uid() = user_id`. On first login, a server function seeds default categories (Food, Transport, Groceries, Bills, Entertainment, Health, Shopping, Other) for the user if none exist.

## Recurring generator

Server function `runRecurring` runs on app load (from dashboard loader). For each active recurring item, inserts missing transactions from `last_generated_on` up to today (idempotent via `last_generated_on` update).

## Routes (all under `_authenticated/`)

- `/` — Dashboard: month totals (income, spending, net), per-category progress vs. limit, top categories, recent transactions, "Get AI advice" button.
- `/transactions` — Add expense/income form + filterable list (this week / month / all), delete.
- `/budget` — Manage categories (name, monthly limit) and recurring items (CRUD).
- `/advice` — AI recommendations page (also embeddable card on dashboard).

Public `/auth` route for login.

## AI recommendations

- `src/lib/ai-gateway.server.ts` — Lovable AI Gateway provider helper.
- `src/lib/advice.functions.ts` — `getBudgetAdvice` server fn (auth-protected):
  - Loads current-month transactions, categories with limits, active recurring items.
  - Sends compact summary (per-category spend vs. limit, days left, recurring load, net) to `google/gemini-3-flash-preview` via `generateText`.
  - Returns 3–5 concrete, EGP-context tips as markdown.
- Client calls with `useServerFn` + `useMutation`; renders with `react-markdown`.
- Handles 429 (rate limit) and 402 (credits) with clear messages.
- Ensures `LOVABLE_API_KEY` via `ai_gateway--create`.

## UI

- Shared header with nav (Dashboard, Transactions, Budget, Advice, Sign out).
- shadcn components: Card, Button, Input, Select, Progress, Tabs, Table, Dialog, Toast.
- `formatEGP()` helper using `Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' })`.
- Real head metadata per route; replace placeholder homepage.
- Sign-out follows hygiene pattern (cancelQueries → clear → signOut → navigate to /auth).

## Out of scope (v1)

- Multi-currency, savings goals, daily limits, bank imports, receipts, sharing.
