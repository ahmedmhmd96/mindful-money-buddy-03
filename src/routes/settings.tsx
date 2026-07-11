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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  deleteAllTransactions,
  getSettings,
  updateSettings,
} from "@/lib/budget.functions";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — My Budget" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const settingsFn = useServerFn(getSettings);
  const saveSettings = useServerFn(updateSettings);
  const wipeTx = useServerFn(deleteAllTransactions);

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsFn({ data: undefined }),
  });
  const currentCycleDay = settingsQ.data?.cycle_end_day ?? 31;
  const [cycleDayInput, setCycleDayInput] = useState("");

  const saveSettingsM = useMutation({
    mutationFn: (cycle_end_day: number) => saveSettings({ data: { cycle_end_day } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Cycle end day saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const wipeTxM = useMutation({
    mutationFn: () => wipeTx({ data: undefined }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["recurring"] });
      toast.success(`Deleted ${res.deleted} transaction${res.deleted === 1 ? "" : "s"}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Cycle settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(cycleDayInput || currentCycleDay);
              if (!Number.isInteger(n) || n < 1 || n > 31) {
                toast.error("Enter a day between 1 and 31");
                return;
              }
              saveSettingsM.mutate(n);
            }}
          >
            <div className="space-y-1.5">
              <Label>End of month (day)</Label>
              <Input
                type="number"
                min={1}
                max={31}
                className="w-32"
                placeholder={String(currentCycleDay)}
                value={cycleDayInput}
                onChange={(e) => setCycleDayInput(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={saveSettingsM.isPending}>
              Save
            </Button>
            <p className="text-xs text-muted-foreground">
              Current: day {currentCycleDay}. The dashboard divides projected net by the days
              left until this day to compute your daily spending limit.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Delete all transactions</div>
              <p className="text-xs text-muted-foreground">
                Permanently removes every posted transaction. Categories, recurring items, and
                goals are kept. Recurring items will re-post from the current period.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={wipeTxM.isPending}>
                  {wipeTxM.isPending ? "Deleting…" : "Delete all transactions"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all transactions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete every transaction on your account. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => wipeTxM.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
