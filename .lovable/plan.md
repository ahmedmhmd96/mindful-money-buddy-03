## Goal

Close the gaps surfaced by the test-it review on `/simulate` without changing the feature's shape. Ephemeral behavior, 12-month horizon, and AI explanation stay as-is.

## Scope

UI + a small server-fn hardening pass. No schema changes, no persistence.

## Changes

### 1. Server function hardening (`src/lib/simulate.functions.ts`)
- Add a Zod schema for `ExplainInput` and validate inside `inputValidator` (replace the `as` cast). Reject malformed payloads with a clear error.
- Cap payload size: max 24 one-offs, 24 overrides, 12 new-recurring, 12 disabled. Trim names to 60 chars before building the prompt.
- Keep the existing 429 / 402 / generic error mapping.

### 2. Numeric input UX (all scenario fields)
- Extract a small `NumberField` wrapper (or shared `onChange` helper) so every amount/multiplier/addend/override field allows:
  - clearing to empty without snapping to 0 mid-type,
  - typing a leading `-` or `.`,
  - recomputing forecast only on valid parse (empty = treated as 0 for math, but display stays empty).
- Apply to: starting balance, income multiplier, income addend, one-off amounts, recurring override amounts, new-recurring monthly amount.

### 3. Semantic clarifications
- **Override = 0 vs disable**: if override equals 0, auto-mark as disabled (single code path); don't double-count.
- **Override equal to original**: do NOT set `hasScenario` on affected months.
- **New recurring with end < start**: block save with inline validation message; contribute 0 months if somehow present.
- **New recurring start in the past**: clamp start to the first forecast month.

### 4. Explain button state
- Disable the button while the mutation is pending; show a spinner.
- On error, keep the previous explanation visible and surface the error via toast (already wired) instead of clearing the card.
- Debounce is unnecessary since the button disables during pending.

### 5. Empty-state + legend copy
- Before first click, the AI card shows a one-line hint: "Click to get a plain-language walk-through of the months above."
- Legend: add a short line clarifying that "Cumulative = starting balance + running sum of net" and that scenario-affected months carry the badge.

## Out of scope

- Locale switching (en-EG stays).
- Forwarding `X-Lovable-AIG-Run-ID` to the browser (internal debugging only; revisit if support needs it).
- Persistence, sharing, or saving scenarios.
- Retry/backoff on AI errors (terminal errors stay terminal; user can click again).

## Technical notes

- `NumberField` is a controlled input holding a string; parent gets `number | null` via `onChange`. Forecast `useMemo` treats `null` as 0.
- Zod schema mirrors the existing `ExplainInput` type; use `.max()` on arrays and `.trim().max(60)` on names.
- Override-equals-original check: compare against the source recurring item's amount before setting `hasScenario`.
- No new dependencies.

## Files touched

- `src/routes/simulate.tsx` — NumberField, semantic fixes, button state, copy.
- `src/lib/simulate.functions.ts` — Zod validation, payload caps, name trimming.

## Acceptance criteria

- Every numeric field can be cleared to empty and retyped without flicker or 0-snap.
- Malformed `explainForecast` payloads are rejected server-side with a readable error.
- Override to 0 behaves identically to disable in the forecast.
- New recurring with end < start cannot be saved.
- Explain button disables during request; previous explanation preserved on error.
- No regressions to the 12-row forecast, partial badge, or cumulative anchor.
