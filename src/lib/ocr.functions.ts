import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const IMAGE_MAX = 5 * 1024 * 1024; // 5MB
const PDF_MAX = 10 * 1024 * 1024; // 10MB

function estimateBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

function contentBlockFor(dataUrl: string, mime: string, filename?: string) {
  if (mime.startsWith("image/")) {
    return { type: "image_url", image_url: { url: dataUrl } };
  }
  return {
    type: "file",
    file: { filename: filename ?? "document.pdf", file_data: dataUrl },
  };
}

async function callGateway(prompt: string, block: unknown) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, block],
        },
      ],
    }),
  });
  if (!res.ok) {
    const status = res.status;
    const body = await res.text().catch(() => "");
    if (status === 429) throw new Error("Rate limit reached. Try again in a moment.");
    if (status === 402)
      throw new Error("AI credits exhausted. Add credits in workspace billing settings.");
    throw new Error(`AI extraction failed (${status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(text);
  } catch {
    // Try to salvage a JSON block
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Model did not return valid JSON.");
  }
}

const InputSchema = z.object({
  dataUrl: z
    .string()
    .refine((s) => s.startsWith("data:"), "Expected a data URL"),
  mime: z.string().min(1),
  filename: z.string().optional(),
});

function guardSize(dataUrl: string, mime: string) {
  const bytes = estimateBytes(dataUrl);
  const limit = mime === "application/pdf" ? PDF_MAX : IMAGE_MAX;
  if (bytes > limit) {
    const mb = Math.round((limit / (1024 * 1024)) * 10) / 10;
    throw new Error(`File too large. Max ${mb} MB for this type.`);
  }
}

// ---------- Receipt ----------

const ReceiptResult = z.object({
  merchant: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  occurred_on: z.string().nullable().optional(),
  category_guess: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  confidence: z
    .object({
      amount: z.enum(["high", "medium", "low"]).optional(),
      date: z.enum(["high", "medium", "low"]).optional(),
      merchant: z.enum(["high", "medium", "low"]).optional(),
    })
    .optional(),
});

export const extractReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dataUrl: string; mime: string; filename?: string }) =>
    InputSchema.parse(d),
  )
  .handler(async ({ data }) => {
    guardSize(data.dataUrl, data.mime);
    const prompt = `You are an OCR assistant extracting a SINGLE purchase receipt.

Return ONLY a JSON object with these keys:
  "merchant": string | null,        // store/vendor name
  "amount": number | null,          // total paid, positive number, no currency symbol
  "currency": string | null,        // ISO code detected on receipt (e.g. "EGP","USD"). Null if unclear.
  "occurred_on": string | null,     // YYYY-MM-DD. If year missing, assume current year.
  "category_guess": string | null,  // one of: Food, Transport, Groceries, Utilities, Health, Shopping, Entertainment, Other
  "note": string | null,            // short summary (<=80 chars). Include item count if visible.
  "confidence": { "amount": "high|medium|low", "date": "high|medium|low", "merchant": "high|medium|low" }

Rules:
- Amount is the final total paid, not subtotal or tax line.
- Do not invent values. Use null when not confidently present.
- No prose. JSON only.`;
    const raw = await callGateway(prompt, contentBlockFor(data.dataUrl, data.mime, data.filename));
    return ReceiptResult.parse(raw);
  });

// ---------- SMS / screenshot ----------

const SmsResult = z.object({
  direction: z.enum(["expense", "income"]).nullable().optional(),
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  occurred_on: z.string().nullable().optional(),
  counterparty: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  confidence: z
    .object({
      amount: z.enum(["high", "medium", "low"]).optional(),
      direction: z.enum(["high", "medium", "low"]).optional(),
      date: z.enum(["high", "medium", "low"]).optional(),
    })
    .optional(),
});

export const extractSmsScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dataUrl: string; mime: string; filename?: string }) =>
    InputSchema.parse(d),
  )
  .handler(async ({ data }) => {
    guardSize(data.dataUrl, data.mime);
    if (!data.mime.startsWith("image/"))
      throw new Error("SMS mode expects an image screenshot.");
    const prompt = `You are extracting ONE bank/wallet transaction from an SMS or notification screenshot (e.g. Instapay, CIB, NBE, Vodafone Cash).

Return ONLY a JSON object:
  "direction": "expense" | "income" | null,
  "amount": number | null,           // positive, no currency symbol
  "currency": string | null,         // ISO code if visible ("EGP" typical)
  "occurred_on": string | null,      // YYYY-MM-DD; use today's year if missing
  "counterparty": string | null,     // merchant, sender or recipient name
  "note": string | null,             // short (<=80 chars)
  "confidence": { "amount": "high|medium|low", "direction": "high|medium|low", "date": "high|medium|low" }

Rules:
- "credited"/"received"/"deposit" => income. "debited"/"paid"/"purchase"/"withdrawn" => expense.
- Ignore available-balance lines when picking the amount.
- Do not invent. Use null when uncertain. JSON only.`;
    const raw = await callGateway(prompt, contentBlockFor(data.dataUrl, data.mime, data.filename));
    return SmsResult.parse(raw);
  });

// ---------- Bank statement ----------

const StatementRow = z.object({
  date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  direction: z.enum(["expense", "income"]).nullable().optional(),
  category_guess: z.string().nullable().optional(),
});

const StatementResult = z.object({
  currency: z.string().nullable().optional(),
  rows: z.array(StatementRow).default([]),
});

export const extractStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dataUrl: string; mime: string; filename?: string }) =>
    InputSchema.parse(d),
  )
  .handler(async ({ data }) => {
    guardSize(data.dataUrl, data.mime);
    const prompt = `You are extracting transaction rows from a bank/wallet statement (PDF or image).

Return ONLY a JSON object:
  "currency": string | null,   // ISO code inferred for the statement
  "rows": [
    {
      "date": "YYYY-MM-DD" | null,
      "description": string | null,       // merchant / narration
      "amount": number | null,            // positive number
      "direction": "expense" | "income" | null,
      "category_guess": string | null     // Food, Transport, Groceries, Utilities, Health, Shopping, Entertainment, Other
    }, ...
  ]

Rules:
- Include every posted transaction line. Skip: header/footer, page numbers, opening/closing balances, running-balance columns, subtotals.
- Debits/withdrawals/purchases => "expense". Credits/deposits/transfers-in => "income".
- Amount is positive; sign goes into "direction".
- If a date has no year, use the statement period's year (or current year if unknown).
- If more than 200 rows are visible, return the first 200 and stop.
- JSON only. No prose.`;
    const raw = await callGateway(prompt, contentBlockFor(data.dataUrl, data.mime, data.filename));
    return StatementResult.parse(raw);
  });
