
## Goal

Refocus Mindful Money Buddy on one number — **safe to spend today** — and make every input feed it. Keep the current stack, visual system, and most existing screens; refactor where they conflict with the new intake model.

## Scope (what changes)

- **Onboarding** — new 5-step Financial Snapshot flow.
- **Dashboard** — replace top card with Safe-to-Spend + confidence + lightweight confirmations.
- **Transactions** — Quick Add + accuracy types (exact / daily total / category total / balance correction).
- **Recurring commitments** — expected → confirm / delay / change / skip lifecycle.
- **Simulator** — auto-inherit real baseline; scenarios stay isolated.
- Data model additions to support all of the above.

Out of scope: full visual redesign, advice screen rewrite, goals rework beyond what's needed to feed safe-to-spend.

## Data model changes (one migration)

New tables + columns; existing tables (`transactions`, `recurring_items`, `categories`, `user_settings`, `goals`) stay.

- `user_settings`: add `current_balance numeric`, `balance_updated_at timestamptz`, `next_income_amount numeric`, `next_income_date date`, `next_income_label text`, `flex_spend_amount numeric`, `flex_spend_frequency text` ('daily'|'weekly'|'monthly'), `onboarded_at timestamptz`.
- `transactions`: add `accuracy_type text` default `'exact'` ('exact'|'daily_total'|'category_total'|'balance_correction'), `period_start date`, `period_end date`.
- `recurring_items`: add `template text` (rent/installment/utilities/…), keep existing frequency fields.
- New `recurring_occurrences` (id, user_id, recurring_id, due_date, expected_amount, actual_amount, status text 'expected'|'confirmed'|'delayed'|'skipped', transaction_id, created_at). Generated forward for the current cycle instead of auto-posting transactions.
- New `scenarios` (id, user_id, name, created_at) + `scenario_items` (id, scenario_id, kind, amount, one_off boolean, start_date, duration_months, note). Never touched by real-data queries.

All new tables get GRANTs + RLS `auth.uid() = user_id` policies. Backward-compat: existing `runRecurring` behavior is replaced by occurrence generation; old auto-posted "Recurring: …" transactions remain valid.

## Core calc: `computeSafeToSpend`

New pure helper in `src/lib/safe-to-spend.ts`, used by dashboard, quick-add feedback toasts, and simulator baseline.

Inputs: current_balance, balance_updated_at, next_income (amount+date), open commitments (expected+unconfirmed), flex spend estimate, buffer.
Output: `{ dailyAmount, daysUntilIncome, projectedBuffer, confidence, confidenceReasons[], breakdown }`.

Formula:
```
horizonDays = max(1, daysUntil(next_income_date))
committed   = sum(open commitments due before next_income_date, using actual_amount ?? expected_amount)
flexTotal   = normalizedFlex * horizonDays
projected   = current_balance − committed − flexTotal
safeDaily   = max(0, (current_balance − committed − buffer) / horizonDays)
```
Confidence = high/medium/low from: balance freshness (<3d / <10d / older), unconfirmed past-due commitments, missing next_income, missing flex estimate.

## Server functions (new file `src/lib/snapshot.functions.ts`)

- `getSnapshot` — returns settings + open occurrences + safe-to-spend result.
- `updateSnapshot` — writes balance/income/flex fields; stamps `balance_updated_at`.
- `correctBalance` — writes new balance + inserts `accuracy_type='balance_correction'` transaction for audit.
- `logQuickTransaction` — thin wrapper over `addTransaction` with accuracy_type support; returns before/after safe-to-spend for the "your daily changed from X to Y" toast.
- `generateOccurrences` — replaces `runRecurring`; creates `recurring_occurrences` rows through end of current cycle instead of posting transactions.
- `confirmOccurrence({id, action: 'paid'|'delayed'|'skipped'|'changed', actual_amount?})` — updates status; on 'paid'/'changed' inserts the actual transaction and links it.
- Scenarios: `listScenarios`, `saveScenario`, `deleteScenario`, `applyScenario` (explicit merge into real data).

## UI changes

**Onboarding** — new `src/routes/onboarding.tsx` (5 steps: balance → next income → commitments (template chips) → flex estimate → results card). Redirect from `/` when `onboarded_at IS NULL`. Uses existing Card/Input/Button components.

**Dashboard (`src/routes/index.tsx`)** — new hero `SafeToSpendCard` (big EGP/day, days remaining, confidence badge, "why this number" collapsible). Below: current balance card with **Update balance** action, upcoming commitments list with per-row Confirm/Delay/Change/Skip buttons, expected income card with "Did it arrive?" prompt, projected cycle-end. Keep existing category budgets section lower on the page. Remove or demote the current "Daily limit" stat card since it's replaced.

**Transactions (`src/routes/transactions.tsx`)** — add "Quick Add" as the default compact form (kind/amount/category/date + Save). Move note/source/payment behind a `<Collapsible>` "More details". Add tabs above the form: **Exact / Daily total / Category total / Balance correction**. Show recent entries as tap-to-repeat chips. After save, toast shows safe-to-spend delta.

**Recurring / Commitments** — extend `src/routes/budget.tsx` (or add `src/routes/commitments.tsx`) to render upcoming occurrences with the 4 actions and status badges (Expected/Confirmed/Delayed/Skipped). Template chips on the create form.

**Simulator (`src/routes/simulate.tsx`)** — read baseline via `getSnapshot`, prefill read-only summary at the top ("Using your current balance, next income, commitments, flex spend"), keep scenario editing local. Add "Apply this scenario to my plan" button wired to `applyScenario`.

**Shared** — small `<AccuracyBadge kind="actual|expected|scenario">` component reused across lists.

## Acceptance mapping

Each acceptance-criteria item ↔ implementation:
- <2min to first safe-to-spend → onboarding step 5 shows the number.
- ≤3 inputs quick-add → Quick Add form.
- Balance correction without missing tx → `correctBalance`.
- Occurrence lifecycle → `confirmOccurrence` actions.
- Actual/Expected/Scenario distinction → `AccuracyBadge` + separate scenario tables.
- Safe-to-spend updates on every change → server fns return before/after; React Query invalidation on `["snapshot"]`.
- "Why it changed" → breakdown in SafeToSpendCard collapsible + delta toast.
- Confidence indicator → confidence in `computeSafeToSpend`.
- Simulator inherits baseline → prefilled from `getSnapshot`.
- Scenarios don't mutate real data → separate tables + explicit apply action.

## Implementation order

1. Migration (schema + GRANTs + RLS).
2. `safe-to-spend.ts` + `snapshot.functions.ts`.
3. Onboarding route + redirect gate.
4. Dashboard rewrite (SafeToSpend hero, balance/commitments/income cards).
5. Quick Add + accuracy types on transactions page.
6. Occurrence generation + confirm actions in commitments/budget page.
7. Simulator baseline + scenario tables.
8. Manual smoke via preview (add tx → confirm safe-to-spend delta; correct balance; confirm a rent occurrence).

## Notes / trade-offs

- Existing `runRecurring` that auto-posts transactions is replaced by occurrence generation. Historical auto-posted rows remain but new ones stop appearing automatically — matches spec ("do not auto-mix expected and actual").
- Goals-related "spend up to X/day to save Y" stays but moves into the SafeToSpend breakdown.
- All new EGP formatting reuses `formatEGP`.
