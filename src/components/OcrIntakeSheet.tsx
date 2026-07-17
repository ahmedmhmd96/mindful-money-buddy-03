import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Upload, AlertTriangle } from "lucide-react";
import {
  extractReceipt,
  extractSmsScreenshot,
  extractStatement,
} from "@/lib/ocr.functions";
import { listCategories } from "@/lib/budget.functions";
import { logQuickTransaction } from "@/lib/snapshot.functions";
import { formatEGP } from "@/lib/format";

type Mode = "receipt" | "sms" | "statement";

type Confidence = "high" | "medium" | "low" | undefined;

function ConfBadge({ level }: { level: Confidence }) {
  if (!level || level === "high") return null;
  const cls =
    level === "low"
      ? "bg-rose-100 text-rose-700"
      : "bg-amber-100 text-amber-800";
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase ${cls}`}>
      {level}
    </span>
  );
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("Read failed"));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function OcrIntakeSheet({
  open,
  onOpenChange,
  defaultMode = "receipt",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultMode?: Mode;
}) {
  const qc = useQueryClient();
  const listCatsFn = useServerFn(listCategories);

  const [mode, setMode] = useState<Mode>(defaultMode);
  const catsQ = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCatsFn({ data: undefined }),
    enabled: open,
  });
  const cats = catsQ.data ?? [];

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["snapshot"] });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Scan & import</SheetTitle>
          <SheetDescription>
            Photograph a receipt, an SMS/wallet screenshot, or upload a bank statement.
            Everything is reviewed before it saves.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="receipt">Receipt</TabsTrigger>
            <TabsTrigger value="sms">SMS / screenshot</TabsTrigger>
            <TabsTrigger value="statement">Bank statement</TabsTrigger>
          </TabsList>

          <TabsContent value="receipt" className="mt-4">
            <ReceiptFlow
              cats={cats}
              onSaved={invalidateAll}
              onDone={() => onOpenChange(false)}
              acceptPdf
            />
          </TabsContent>

          <TabsContent value="sms" className="mt-4">
            <SmsFlow
              cats={cats}
              onSaved={invalidateAll}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="statement" className="mt-4">
            <StatementFlow
              cats={cats}
              onSaved={invalidateAll}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ---------- Shared file picker ----------

function FilePicker({
  file,
  setFile,
  onExtract,
  isPending,
  accept,
  hint,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  onExtract: () => void;
  isPending: boolean;
  accept: string;
  hint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={accept.includes("image") ? "environment" : undefined}
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <div className="text-sm">
          {file ? (
            <span className="font-medium">{file.name}</span>
          ) : (
            <>Drop file here or click below</>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{hint}</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </Button>
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={!file || isPending}
        onClick={onExtract}
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading…
          </>
        ) : (
          "Extract"
        )}
      </Button>
    </div>
  );
}

// ---------- Receipt ----------

type Cat = { id: string; name: string };

function guessCategoryId(guess: string | null | undefined, cats: Cat[]): string {
  if (!guess) return "";
  const g = guess.trim().toLowerCase();
  return cats.find((c) => c.name.toLowerCase() === g)?.id ?? "";
}

function ReceiptFlow({
  cats,
  onSaved,
  onDone,
  acceptPdf,
}: {
  cats: Cat[];
  onSaved: () => void;
  onDone: () => void;
  acceptPdf?: boolean;
}) {
  const extractFn = useServerFn(extractReceipt);
  const logFn = useServerFn(logQuickTransaction);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof extractReceipt>> | null>(null);

  const extractM = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      const dataUrl = await fileToDataUrl(file);
      return extractFn({ data: { dataUrl, mime: file.type, filename: file.name } });
    },
    onSuccess: (r) => setResult(r),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveM = useMutation({
    mutationFn: (d: Parameters<typeof logFn>[0]["data"]) => logFn({ data: d }),
    onSuccess: () => {
      onSaved();
      toast.success("Transaction saved.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState<string>("");

  // hydrate form when result arrives
  useEffect(() => {
    if (!result) return;
    setAmount(result.amount != null ? String(result.amount) : "");
    setDate(result.occurred_on ?? today());
    setMerchant(result.merchant ?? "");
    setCategoryId(guessCategoryId(result.category_guess, cats));
    setNote(result.note ?? "");
    setCurrency(result.currency ?? "");
  }, [result, cats]);

  const nonEgp = currency && currency.toUpperCase() !== "EGP";

  return (
    <div className="space-y-4">
      {!result && (
        <FilePicker
          file={file}
          setFile={setFile}
          onExtract={() => extractM.mutate()}
          isPending={extractM.isPending}
          accept={acceptPdf ? "image/*,application/pdf" : "image/*"}
          hint={`Photo of a receipt${acceptPdf ? " or PDF" : ""}. Max 5 MB image / 10 MB PDF.`}
        />
      )}

      {result && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const amt = Number(amount);
            if (!Number.isFinite(amt) || amt <= 0) {
              toast.error("Enter a valid amount");
              return;
            }
            saveM.mutate({
              kind: "expense",
              amount: amt,
              category_id: categoryId || null,
              note: [merchant, note].filter(Boolean).join(" · ") || undefined,
              occurred_on: date,
              accuracy_type: "exact",
            });
          }}
        >
          {nonEgp && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
              <span>
                Detected {currency.toUpperCase()} {amount || "?"}. Convert to EGP before saving —
                the app is EGP-only.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              Amount (EGP) <ConfBadge level={result.confidence?.amount as Confidence} />
            </Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Date <ConfBadge level={result.confidence?.date as Confidence} />
            </Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>
              Merchant <ConfBadge level={result.confidence?.merchant as Confidence} />
            </Label>
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {cats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
            >
              Rescan
            </Button>
            <Button type="submit" className="flex-1" disabled={saveM.isPending}>
              {saveM.isPending ? "Saving…" : "Save transaction"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------- SMS ----------

function SmsFlow({
  cats,
  onSaved,
  onDone,
}: {
  cats: Cat[];
  onSaved: () => void;
  onDone: () => void;
}) {
  const extractFn = useServerFn(extractSmsScreenshot);
  const logFn = useServerFn(logQuickTransaction);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof extractSmsScreenshot>> | null>(
    null,
  );

  const extractM = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a screenshot first.");
      const dataUrl = await fileToDataUrl(file);
      return extractFn({ data: { dataUrl, mime: file.type, filename: file.name } });
    },
    onSuccess: (r) => setResult(r),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveM = useMutation({
    mutationFn: (d: Parameters<typeof logFn>[0]["data"]) => logFn({ data: d }),
    onSuccess: () => {
      onSaved();
      toast.success("Transaction saved.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [counterparty, setCounterparty] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState("");

  useMemo(() => {
    if (!result) return;
    setKind(result.direction ?? "expense");
    setAmount(result.amount != null ? String(result.amount) : "");
    setDate(result.occurred_on ?? today());
    setCounterparty(result.counterparty ?? "");
    setNote(result.note ?? "");
    setCurrency(result.currency ?? "");
  }, [result]);

  const nonEgp = currency && currency.toUpperCase() !== "EGP";

  return (
    <div className="space-y-4">
      {!result && (
        <FilePicker
          file={file}
          setFile={setFile}
          onExtract={() => extractM.mutate()}
          isPending={extractM.isPending}
          accept="image/*"
          hint="Screenshot of an SMS or wallet notification. Max 5 MB."
        />
      )}

      {result && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const amt = Number(amount);
            if (!Number.isFinite(amt) || amt <= 0) {
              toast.error("Enter a valid amount");
              return;
            }
            saveM.mutate({
              kind,
              amount: amt,
              category_id: kind === "expense" ? categoryId || null : null,
              note: [counterparty, note].filter(Boolean).join(" · ") || undefined,
              source: kind === "income" ? counterparty || undefined : undefined,
              occurred_on: date,
              accuracy_type: "exact",
            });
          }}
        >
          {nonEgp && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
              <span>
                Detected {currency.toUpperCase()} {amount || "?"}. Convert to EGP before saving.
              </span>
            </div>
          )}

          <Tabs value={kind} onValueChange={(v) => setKind(v as "expense" | "income")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="expense">
                Expense <ConfBadge level={result.confidence?.direction as Confidence} />
              </TabsTrigger>
              <TabsTrigger value="income">Income</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-1.5">
            <Label>
              Amount (EGP) <ConfBadge level={result.confidence?.amount as Confidence} />
            </Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Date <ConfBadge level={result.confidence?.date as Confidence} />
            </Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{kind === "income" ? "Source" : "Counterparty"}</Label>
            <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </div>
          {kind === "expense" && (
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {cats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
            >
              Rescan
            </Button>
            <Button type="submit" className="flex-1" disabled={saveM.isPending}>
              {saveM.isPending ? "Saving…" : "Save transaction"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------- Statement (bulk) ----------

type Row = {
  include: boolean;
  date: string;
  description: string;
  amount: string;
  direction: "expense" | "income";
  category_id: string;
};

function StatementFlow({
  cats,
  onSaved,
  onDone,
}: {
  cats: Cat[];
  onSaved: () => void;
  onDone: () => void;
}) {
  const extractFn = useServerFn(extractStatement);
  const logFn = useServerFn(logQuickTransaction);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [currency, setCurrency] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");

  const extractM = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      const dataUrl = await fileToDataUrl(file);
      return extractFn({ data: { dataUrl, mime: file.type, filename: file.name } });
    },
    onSuccess: (r) => {
      setCurrency(r.currency ?? "");
      setRows(
        (r.rows ?? []).map((row) => ({
          include: true,
          date: row.date ?? today(),
          description: row.description ?? "",
          amount: row.amount != null ? String(row.amount) : "",
          direction: (row.direction ?? "expense") as "expense" | "income",
          category_id: guessCategoryId(row.category_guess, cats),
        })),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveM = useMutation({
    mutationFn: async () => {
      if (!rows) return { saved: 0, failed: 0 };
      const chosen = rows.filter((r) => r.include);
      let saved = 0;
      let failed = 0;
      for (const r of chosen) {
        const amt = Number(r.amount);
        if (!Number.isFinite(amt) || amt <= 0 || !r.date) {
          failed++;
          continue;
        }
        try {
          await logFn({
            data: {
              kind: r.direction,
              amount: amt,
              category_id:
                r.direction === "expense" ? r.category_id || null : null,
              note: r.description || undefined,
              source: r.direction === "income" ? r.description || undefined : undefined,
              occurred_on: r.date,
              accuracy_type: "exact",
            },
          });
          saved++;
        } catch {
          failed++;
        }
      }
      return { saved, failed };
    },
    onSuccess: ({ saved, failed }) => {
      onSaved();
      if (saved > 0) toast.success(`Imported ${saved} transaction${saved === 1 ? "" : "s"}.`);
      if (failed > 0) toast.error(`${failed} row${failed === 1 ? "" : "s"} skipped.`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev));
  }

  const nonEgp = currency && currency.toUpperCase() !== "EGP";
  const includedCount = rows?.filter((r) => r.include).length ?? 0;
  const totalIn = useMemo(
    () =>
      rows
        ?.filter((r) => r.include && r.direction === "income")
        .reduce((s, r) => s + (Number(r.amount) || 0), 0) ?? 0,
    [rows],
  );
  const totalOut = useMemo(
    () =>
      rows
        ?.filter((r) => r.include && r.direction === "expense")
        .reduce((s, r) => s + (Number(r.amount) || 0), 0) ?? 0,
    [rows],
  );

  return (
    <div className="space-y-4">
      {!rows && (
        <FilePicker
          file={file}
          setFile={setFile}
          onExtract={() => extractM.mutate()}
          isPending={extractM.isPending}
          accept="image/*,application/pdf"
          hint="Bank/wallet statement PDF or image. Max 10 MB. Large statements are capped at 200 rows."
        />
      )}

      {rows && (
        <div className="space-y-3">
          {nonEgp && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
              <span>
                Statement currency detected as {currency.toUpperCase()}. Amounts are inserted as
                EGP. Convert first if that's wrong.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {includedCount} / {rows.length} selected
            </span>
            <span>·</span>
            <span>+{formatEGP(totalIn)}</span>
            <span>−{formatEGP(totalOut)}</span>
            <div className="ml-auto flex items-center gap-2">
              <Label className="text-xs">Bulk category</Label>
              <Select
                value={bulkCategoryId}
                onValueChange={(v) => {
                  setBulkCategoryId(v);
                  setRows((prev) =>
                    prev
                      ? prev.map((r) =>
                          r.include && r.direction === "expense" ? { ...r, category_id: v } : r,
                        )
                      : prev,
                  );
                }}
              >
                <SelectTrigger className="h-8 w-40">
                  <SelectValue placeholder="Apply to expenses" />
                </SelectTrigger>
                <SelectContent>
                  {cats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-left">
                  <th className="px-2 py-1.5"></th>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5">Dir</th>
                  <th className="px-2 py-1.5 text-right">Amount</th>
                  <th className="px-2 py-1.5">Category</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">
                      <Checkbox
                        checked={r.include}
                        onCheckedChange={(v) => updateRow(i, { include: Boolean(v) })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        value={r.date}
                        onChange={(e) => updateRow(i, { date: e.target.value })}
                        className="h-7 w-32 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={r.description}
                        onChange={(e) => updateRow(i, { description: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Select
                        value={r.direction}
                        onValueChange={(v) =>
                          updateRow(i, { direction: v as "expense" | "income" })
                        }
                      >
                        <SelectTrigger className="h-7 w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="expense">Expense</SelectItem>
                          <SelectItem value="income">Income</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={r.amount}
                        onChange={(e) => updateRow(i, { amount: e.target.value })}
                        className="h-7 w-24 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      {r.direction === "expense" ? (
                        <Select
                          value={r.category_id}
                          onValueChange={(v) => updateRow(i, { category_id: v })}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {cats.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setRows(null);
                setFile(null);
              }}
            >
              Rescan
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={saveM.isPending || includedCount === 0}
              onClick={() => saveM.mutate()}
            >
              {saveM.isPending
                ? "Importing…"
                : `Import ${includedCount} transaction${includedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
