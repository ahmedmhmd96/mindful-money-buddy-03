import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AccuracyKind = "actual" | "expected" | "scenario";

const styles: Record<AccuracyKind, string> = {
  actual: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  expected: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  scenario: "bg-violet-100 text-violet-800 hover:bg-violet-100",
};

const labels: Record<AccuracyKind, string> = {
  actual: "Actual",
  expected: "Expected",
  scenario: "Scenario",
};

export function AccuracyBadge({ kind, className }: { kind: AccuracyKind; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", styles[kind], className)}>
      {labels[kind]}
    </Badge>
  );
}
