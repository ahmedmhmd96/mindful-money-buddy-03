import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Wallet, LayoutDashboard, ListPlus, Target, Trophy, Sparkles, Settings, LogOut } from "lucide-react";

export function AppShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  const links = [
    { to: "/", label: "Dashboard", Icon: LayoutDashboard },
    { to: "/transactions", label: "Transactions", Icon: ListPlus },
    { to: "/budget", label: "Budget", Icon: Target },
    { to: "/goals", label: "Goals", Icon: Trophy },
    { to: "/advice", label: "AI Advice", Icon: Sparkles },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Wallet className="h-5 w-5 text-primary" />
            My Budget
          </div>
          <nav className="ml-4 flex flex-1 flex-wrap gap-1">
            {links.map(({ to, label, Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                activeProps={{ className: "bg-accent text-foreground" }}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-1 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
