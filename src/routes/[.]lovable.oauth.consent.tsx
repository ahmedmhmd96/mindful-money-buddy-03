import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AuthorizationDetails = {
  client?: { name?: string; client_id?: string };
  redirect_uri?: string;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
};

// Beta namespace on supabase-js — typed locally so we don't reach into node_modules.
type OAuthNs = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
};
const oauth = () =>
  (supabase.auth as unknown as { oauth: OAuthNs }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: supabase-js reads session from localStorage, absent during SSR.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  component: Consent,
});

function Consent() {
  const { authorization_id } = Route.useSearch();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authorization_id || !session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await oauth().getAuthorizationDetails(authorization_id);
      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else {
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authorization_id, session]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setError("No redirect returned by the authorization server.");
      setBusy(false);
      return;
    }
    window.location.href = target;
  }

  if (!authorization_id) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Missing authorization_id.</p>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          You need to sign in to Mindful Money Buddy before approving this connection. Sign in in
          another tab, then reload this page.
        </p>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Loading authorization details…</p>
      </Shell>
    );
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <Shell>
      <p className="text-sm">
        <strong>{clientName}</strong> is asking to connect to your Mindful Money Buddy account. It
        will be able to call the enabled tools while you are signed in — read your transactions,
        budget, recurring commitments, and goals, and add new transactions on your behalf.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Your row-level security still applies: {clientName} can only see and change your own data.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <Button disabled={busy} onClick={() => decide(true)} className="flex-1">
          {busy ? "Working…" : "Approve"}
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => decide(false)} className="flex-1">
          Cancel
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Connect an app</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
