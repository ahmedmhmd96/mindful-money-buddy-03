# OCR Intake for Mindful Money Buddy

Add AI-powered financial-data intake using Lovable AI (Gemini vision). Users capture a receipt photo, an Instapay/bank SMS screenshot, or a bank statement PDF; the AI extracts structured fields; the user reviews a prefilled form before anything is saved.

Every OCR'd entry contributes to Safe-to-Spend through the existing `snapshot`/`financial-position` pipeline — we only add a new intake path, we do not touch the calculation engine.

## Entry points

- **Dashboard quick-add** — new "Scan" button next to the manual add-transaction control. Opens the OCR sheet in single-receipt mode.
- **Transactions page** — "Import from receipt / statement" action in the page header. Same sheet, with the statement tab enabled for bulk import.

## Three modes in one sheet

1. **Receipt** (image / PDF, single transaction)
   - Extracted: merchant, amount, currency, date, suggested category, note.
2. **SMS / screenshot** (image, single transaction)
   - Extracted: direction (income/expense), amount, currency, date, counterparty, note.
3. **Bank statement** (PDF, many transactions)
   - Extracted: list of `{date, description, amount, direction}` rows.
   - User reviews rows in a table, can uncheck/edit any row, pick category per row (or bulk-apply), then "Import N transactions".

Non-EGP amounts trigger a warning ("Detected USD 12.00 — enter EGP equivalent") since the app is EGP-only; we do not auto-convert.

## Review step (always)

Nothing writes to `transactions` until the user confirms. Extraction confidence per field is shown as a subtle badge; low-confidence fields are highlighted so the user checks them. On save, the transaction goes through the existing insert path so accuracy tagging, categories, and Safe-to-Spend recompute automatically.

## Technical section

**Backend (`src/lib/ocr.functions.ts`, new)**

- `extractReceipt(fileBase64, mime)` — `createServerFn` with `requireSupabaseAuth`.
- `extractSmsScreenshot(fileBase64, mime)` — same shape.
- `extractStatement(fileBase64, mime)` — same shape, returns `rows[]`.

All three:
- Call Lovable AI Gateway via existing `createLovableAiGatewayProvider` helper.
- Model: `google/gemini-3-flash-preview` (vision-capable, default).
- Use `generateText` with `Output.object({ schema })` for strict typed output; schema per mode.
- Pass the file as an `image_url` (image) or `file` (PDF) content block per `ai-multimodal-input`.
- Client sends base64 (files stay in memory, no storage bucket needed).
- Cap input size (5 MB image, 10 MB PDF) and return a friendly error above that.
- Handle 429 / 402 the same way `advice.functions.ts` does.
- Return `{ ok, data, confidence }` or `{ ok: false, error }`.

Prompt highlights (per mode):
- Force EGP-aware date parsing (`YYYY-MM-DD`, assume current year if missing).
- Return numeric amounts as positive; direction is a separate field.
- For statements: instruct to skip header/footer lines and running balances.

**Frontend**

- `src/components/OcrIntakeSheet.tsx` (new): Sheet/Dialog with tabs (Receipt / SMS / Statement), drop zone + camera capture (`<input type="file" accept="image/*,application/pdf" capture="environment">`), extraction spinner, review form, and (for statement) editable rows table.
- Uses `react-query` mutations wrapping the new server fns.
- On confirm: calls the existing transaction-insert path (already used by the manual quick-add) so accuracy tagging + snapshot invalidation stay identical.
- `src/routes/index.tsx`: add "Scan" button next to quick-add.
- `src/routes/transactions.tsx`: add "Import" button in header.

**No DB changes.** Reuses `transactions`, categories, and the existing snapshot invalidation.

## Out of scope (for this iteration)

- Auto-save without review.
- Non-EGP currency conversion.
- Recurring-bill scan (can follow later; would create a `recurring_items` row instead of a `transaction`).
- Persisting the original image alongside the transaction.

## Costs / limits to flag to the user

- Each scan uses Lovable AI credits (small for a receipt, larger for a multi-page statement).
- Statement PDFs are limited to what a single vision call can handle reliably — very large multi-month statements may need to be split.
