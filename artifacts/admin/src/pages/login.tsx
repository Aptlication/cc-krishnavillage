import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AlertCircle, User, KeyRound, Eye, EyeOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useStaffLogin, ApiError } from "@workspace/api-client-react";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, sessionExpired } = useAuth();

  const loginMutation = useStaffLogin({
    mutation: {
      onSuccess: (data) => {
        login(data);
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        setError(apiErr?.error ?? "Invalid credentials. Please try again.");
        setPassword("");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password");
      return;
    }

    loginMutation.mutate({ data: { username: username.trim(), password } });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <img
            src={`${import.meta.env.BASE_URL}kv-icon.png`}
            alt="Krishna Village"
            className="w-20 h-20 mx-auto mb-3 rounded-2xl object-contain"
          />
          <h1
            className="text-4xl tracking-wide"
            style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400, color: '#1a5276' }}
          >Krishna Village</h1>
          <p
            className="text-lg"
            style={{ fontFamily: "'Cormorant SC', serif", fontWeight: 300, letterSpacing: '0.12em', color: '#2e86c1' }}
          >Eco Yoga Community</p>
          <p className="text-muted-foreground uppercase tracking-widest text-xs font-medium pt-1">Staff Portal</p>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Staff Login</CardTitle>
            <CardDescription>Enter your staff credentials to access the dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {sessionExpired && !error && (
                <Alert variant="destructive" className="py-2.5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>Your session has expired. Please sign in again.</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive" className="py-2.5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10"
                    placeholder="your.username"
                    autoFocus
                    autoComplete="username"
                    data-testid="input-username"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending}
                data-testid="button-login"
              >
                {loginMutation.isPending ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
