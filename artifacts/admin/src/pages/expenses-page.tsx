import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Receipt, Lock, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  useGetStaffAccounts,
  getGetStaffAccountsQueryKey,
} from "@workspace/api-client-react";
import { ExpensesSection } from "./staff-expenses";

interface StaffProfile {
  id: number;
  email: string | null;
  displayName: string;
}

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("staffSession");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { session?: { token?: string }; token?: string };
    return parsed.session?.token ?? parsed.token ?? null;
  } catch {
    return null;
  }
}

function sessionKey(staffId: number) {
  return `expenses_verified_${staffId}`;
}

export default function ExpensesPage() {
  const { session } = useAuth();
  const staffId = session?.staffId;
  const isAdmin = session?.role === "admin";

  const [verified, setVerified] = useState(() => {
    if (!staffId) return false;
    return sessionStorage.getItem(sessionKey(staffId)) === "1";
  });

  useEffect(() => {
    if (staffId && !verified) {
      if (sessionStorage.getItem(sessionKey(staffId)) === "1") {
        setVerified(true);
      }
    }
  }, [staffId]);

  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(!verified);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const { data: accounts } = useGetStaffAccounts({
    query: {
      queryKey: getGetStaffAccountsQueryKey(),
      enabled: isAdmin && verified,
    },
  });

  useEffect(() => {
    if (verified) return;
    const token = getToken();
    fetch("/api/staff/me", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json() as Promise<StaffProfile>;
      })
      .then((p) => {
        setProfile(p);
        if (p.email) setEmail(p.email);
      })
      .catch(() => setProfileError("Could not load your profile. Please refresh."))
      .finally(() => setLoadingProfile(false));
  }, [verified]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    setVerifying(true);
    try {
      const token = getToken();
      const res = await fetch("/api/staff/verify-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setVerifyError(err.error ?? "Verification failed. Please try again.");
        return;
      }
      if (staffId) sessionStorage.setItem(sessionKey(staffId), "1");
      setVerified(true);
      setPassword("");
    } catch {
      setVerifyError("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const renderGate = () => {
    if (loadingProfile) {
      return (
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading…
        </div>
      );
    }

    if (profileError) {
      return (
        <Card className="max-w-sm mx-auto border-destructive/30">
          <CardContent className="pt-6 flex gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{profileError}</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="max-w-sm mx-auto">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-5 h-5 text-muted-foreground" />
            Identity verification required
          </CardTitle>
          <CardDescription>
            Enter your registered email address and password to access the expense
            ledger. This extra step keeps financial records secure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-4">
            {verifyError && (
              <p className="text-sm text-destructive" data-testid="verify-error">
                {verifyError}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="verify-email">Registered email address</Label>
              <Input
                id="verify-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                data-testid="input-verify-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-password">Password</Label>
              <Input
                id="verify-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                data-testid="input-verify-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={verifying || !email.trim() || !password}
              data-testid="button-verify-expenses"
            >
              {verifying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {verifying ? "Verifying…" : "Access Expenses"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-serif font-bold text-foreground flex items-center gap-2">
            <Receipt className="w-6 h-6" />
            Expenses &amp; Reimbursements
          </h2>
          <p className="text-muted-foreground">
            {verified
              ? isAdmin
                ? "All staff expense claims — select pending claims to mark as reimbursed."
                : "Your submitted expense claims."
              : "Financial records — identity verification required."}
          </p>
        </div>

        {verified ? (
          <ExpensesSection accounts={accounts} bypassGate />
        ) : (
          renderGate()
        )}
      </div>
    </Layout>
  );
}
