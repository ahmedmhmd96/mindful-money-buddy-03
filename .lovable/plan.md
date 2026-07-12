# Product Document (PRD) — PDF Export

Generate a stakeholder-facing PRD as a polished PDF saved to `/mnt/documents/` and delivered via a presentation-artifact tag. No app code changes.

## Source of truth

Feature summary derived from existing app routes and server functions:

- **Dashboard** (`/`) — monthly income/spend/net, projected totals, daily spending limit until cycle end, category budgets, recurring commitments, income by source, goals progress, recent transactions.
- **Transactions** (`/transactions`) — add/edit income & expense entries in EGP with category, source, note, date.
- **Budget** (`/budget`) — manage categories (name, color, monthly limit), recurring items (monthly/weekly, day-of-month/week, expense/income), cycle end day.
- **Goals** (`/goals`) — savings targets and per-category caps with on-track/over-cap indicators.
- **Simulate** (`/simulate`) — 12-month cash-flow forecast with what-if scenarios (starting balance, income multiplier/addend, one-offs, recurring overrides, new hypothetical recurring, disabled items) plus AI-written natural-language explanation of the forecast.
- **Advice** (`/advice`) — on-demand AI budgeting tips based on the current month.
- **Settings** (`/settings`) — account & cycle configuration.
- **Auth & security** — email/Google sign-in, per-user data isolation via row-level security.
- **AI** — powered by Lovable AI Gateway (advice + forecast explanation).

## Document structure (3–6 pages)

1. **Cover** — product name, one-line value prop, date, audience note.
2. **Overview** — what the product is, who it's for (EGP-based personal budgeters), core value.
3. **Key features** — grouped sections with short descriptions:
   - Dashboard & projections
   - Transactions
   - Categories & budgets
   - Recurring commitments
   - Goals (savings + category caps)
   - 12-month simulator with AI explanation
   - AI budgeting advice
   - Accounts, cycle & settings
4. **User journeys** — 2–3 short narratives (new user onboarding, monthly check-in, planning a big expense via simulator).
5. **Differentiators** — cycle-aware daily limit, projection blending posted + expected recurring, natural-language AI forecast explanation, EGP-first.
6. **Roadmap / not in scope** — brief note on future opportunities (multi-currency, exports, shared budgets) — kept short since audience is external.

## Design

- Format: US Letter PDF, 1" margins.
- Typography: DejaVu Sans (Unicode-safe), 11pt body, 22pt title, 14pt section headers.
- Accent color: emerald green (matches app's positive/net tone).
- Section header underline bar; simple, clean, no clip-art.

## Technical implementation

- Python + ReportLab Platypus (`SimpleDocTemplate`, `Paragraph`, `Spacer`, `PageBreak`).
- Register DejaVu Sans via fontconfig for correct glyph rendering.
- Write to `/mnt/documents/product-overview.pdf`.
- Mandatory QA: render pages to JPG with `pdftoppm -r 150`, view every page, fix overflow/overlap/contrast issues, re-render until clean.
- Deliver with `<presentation-artifact path="product-overview.pdf" mime_type="application/pdf">`.

## Out of scope

- No changes to app code, routes, or database.
- No diagrams/screenshots embedded (text-only PRD unless you request visuals).
- No marketing copywriting beyond straightforward feature descriptions.
