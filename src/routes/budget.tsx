import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteCategory,
  deleteRecurring,
  listCategories,
  listRecurring,
  upsertCategory,
  upsertRecurring,
} from "@/lib/budget.functions";
import { formatEGP } from "@/lib/format";

export const Route = createFileRoute("/budget")({
  head: () => ({ meta: [{ title: "Budget — My Budget" }] }),
  component: BudgetPage,
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type RecurringValues = {
  kind: "expense" | "income";
  name: string;
  amount: number;
  category_id: string | null;
  frequency: "monthly" | "weekly";
  day_of_month: number | null;
  day_of_week: number | null;
  active?: boolean;
};

type Category = { id: string; name: string };

type RecurringRow = {
  id: string;
  kind: string;
  name: string;
  amount: number | string;
  category_id: string | null;
  frequency: string;
  day_of_month: number | null;
  day_of_week: number | null;
  active: boolean;
};

function BudgetPage() {
  const qc = useQueryClient();
  const catsFn = useServerFn(listCategories);
  const recFn = useServerFn(listRecurring);
  const saveCat = useServerFn(upsertCategory);
  const delCat = useServerFn(deleteCategory);
  const saveRec = useServerFn(upsertRecurring);
  const delRec = useServerFn(deleteRecurring);

  const catsQ = useQuery({ queryKey: ["categories"], queryFn: () => catsFn({ data: undefined }) });
  const recQ = useQuery({ queryKey: ["recurring"], queryFn: () => recFn({ data: undefined }) });

  const saveCatM = useMutation({
    mutationFn: (d: Parameters<typeof saveCat>[0]["data"]) => saveCat({ data: d }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const delCatM = useMutation({
    mutationFn: (id: string) => delCat({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const saveRecM = useMutation({
    mutationFn: (d: Parameters<typeof saveRec>[0]["data"]) => saveRec({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delRecM = useMutation({
    mutationFn: (id: string) => delRec({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const cats = catsQ.data ?? [];
  const recs = recQ.data ?? [];

  const [newCatName, setNewCatName] = useState("");
  const [editingRec, setEditingRec] = useState<RecurringRow | null>(null);

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Budget</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Categories & monthly limits (EGP)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cats.map((c) => (
              <CategoryRow
                key={c.id}
                initial={c}
                onSave={(next) => saveCatM.mutate({ id: c.id, ...next })}
                onDelete={() => delCatM.mutate(c.id)}
              />
            ))}
            <form
              className="flex gap-2 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCatName.trim()) return;
                saveCatM.mutate(
                  { name: newCatName.trim(), monthly_limit: 0, color: "#64748b" },
                  { onSuccess: () => setNewCatName("") },
                );
              }}
            >
              <Input
                placeholder="New category name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
              />
              <Button type="submit">Add</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recurring expenses & income</CardTitle>
          </CardHeader>
          <CardContent>
            <RecurringForm
              key="add"
              mode="add"
              cats={cats}
              submitting={saveRecM.isPending}
              onSubmit={(values, reset) => saveRecM.mutate(values, { onSuccess: reset })}
            />

            {recs.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No recurring items yet.</p>
            ) : (
              <ul className="mt-4 divide-y">
                {recs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.kind} · {formatEGP(Number(r.amount))} ·{" "}
                        {r.frequency === "monthly"
                          ? `day ${r.day_of_month} monthly`
                          : `${WEEKDAYS[r.day_of_week ?? 1]} weekly`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={r.active}
                        onCheckedChange={(checked) =>
                          saveRecM.mutate({
                            id: r.id,
                            kind: r.kind as "expense" | "income",
                            name: r.name,
                            amount: Number(r.amount),
                            category_id: r.category_id,
                            frequency: r.frequency as "monthly" | "weekly",
                            day_of_month: r.day_of_month,
                            day_of_week: r.day_of_week,
                            active: checked,
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingRec(r as RecurringRow)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => delRecM.mutate(r.id)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editingRec} onOpenChange={(o) => !o && setEditingRec(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit recurring item</DialogTitle>
          </DialogHeader>
          {editingRec && (
            <RecurringForm
              key={editingRec.id}
              mode="edit"
              cats={cats}
              submitting={saveRecM.isPending}
              initial={editingRec}
              onSubmit={(values) =>
                saveRecM.mutate(
                  { id: editingRec.id, ...values, active: editingRec.active },
                  { onSuccess: () => setEditingRec(null) },
                )
              }
            />
          )}
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function RecurringForm({
  mode,
  cats,
  submitting,
  initial,
  onSubmit,
}: {
  mode: "add" | "edit";
  cats: Category[];
  submitting: boolean;
  initial?: RecurringRow;
  onSubmit: (values: RecurringValues, reset: () => void) => void;
}) {
  const [rKind, setRKind] = useState<"expense" | "income">(
    (initial?.kind as "expense" | "income") ?? "expense",
  );
  const [rName, setRName] = useState(initial?.name ?? "");
  const [rAmount, setRAmount] = useState(initial ? String(initial.amount) : "");
  const [rCat, setRCat] = useState<string>(initial?.category_id ?? "");
  const [rFreq, setRFreq] = useState<"monthly" | "weekly">(
    (initial?.frequency as "monthly" | "weekly") ?? "monthly",
  );
  const [rDom, setRDom] = useState(String(initial?.day_of_month ?? 1));
  const [rDow, setRDow] = useState(String(initial?.day_of_week ?? 1));

  const reset = () => {
    setRName("");
    setRAmount("");
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(rAmount);
    if (!rName || !Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter name and valid amount");
      return;
    }
    onSubmit(
      {
        kind: rKind,
        name: rName,
        amount: amt,
        category_id: rKind === "expense" ? rCat || null : null,
        frequency: rFreq,
        day_of_month: rFreq === "monthly" ? Number(rDom) : null,
        day_of_week: rFreq === "weekly" ? Number(rDow) : null,
      },
      reset,
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Tabs value={rKind} onValueChange={(v) => setRKind(v as "expense" | "income")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="expense">Expense</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Rent, Salary…" />
        </div>
        <div className="space-y-1.5">
          <Label>Amount (EGP)</Label>
          <Input type="number" min="0" step="0.01" value={rAmount} onChange={(e) => setRAmount(e.target.value)} />
        </div>
      </div>
      {rKind === "expense" && (
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={rCat} onValueChange={setRCat}>
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
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Frequency</Label>
          <Select value={rFreq} onValueChange={(v) => setRFreq(v as "monthly" | "weekly")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {rFreq === "monthly" ? (
          <div className="space-y-1.5">
            <Label>Day of month</Label>
            <Input type="number" min="1" max="31" value={rDom} onChange={(e) => setRDom(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Day of week</Label>
            <Select value={rDow} onValueChange={setRDow}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((n, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {mode === "add" ? "Add recurring" : "Save changes"}
      </Button>
    </form>
  );
}

function CategoryRow({
  initial,
  onSave,
  onDelete,
}: {
  initial: { name: string; monthly_limit: number | string; color: string };
  onSave: (next: { name: string; monthly_limit: number; color: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [limit, setLimit] = useState(String(initial.monthly_limit ?? 0));
  const [color, setColor] = useState(initial.color);
  const dirty =
    name !== initial.name ||
    Number(limit) !== Number(initial.monthly_limit) ||
    color !== initial.color;

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-9 w-9 cursor-pointer rounded border"
        aria-label="Color"
      />
      <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
      <Input
        type="number"
        min="0"
        step="1"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        className="w-28"
        placeholder="Limit"
      />
      <Button
        size="sm"
        variant={dirty ? "default" : "secondary"}
        disabled={!dirty}
        onClick={() => onSave({ name, monthly_limit: Number(limit) || 0, color })}
      >
        Save
      </Button>
      <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
