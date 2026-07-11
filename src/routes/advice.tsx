import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { getBudgetAdvice } from "@/lib/advice.functions";

export const Route = createFileRoute("/advice")({
  head: () => ({ meta: [{ title: "AI Advice — My Budget" }] }),
  component: AdvicePage,
});

function AdvicePage() {
  const adviceFn = useServerFn(getBudgetAdvice);
  const m = useMutation({
    mutationFn: () => adviceFn({ data: undefined }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">AI budgeting advice</h1>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Personalized recommendations
          </CardTitle>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Thinking…" : "Get advice"}
          </Button>
        </CardHeader>
        <CardContent>
          {m.data?.ok ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>{m.data.advice}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click <strong>Get advice</strong> to analyze your current-month spending vs. category
              limits and get tailored EGP suggestions.
            </p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
