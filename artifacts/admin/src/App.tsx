import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { useGuestListWatcher } from "@/hooks/use-guest-list-watcher";
import NotFound from "@/pages/not-found";
import Guests from "@/pages/guests";
import Maintenance from "@/pages/maintenance";
import Notifications from "@/pages/notifications";
import Staff from "@/pages/staff";
import ExpensesPage from "@/pages/expenses-page";
import ServicesContent from "@/pages/services-content";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

// Route all API calls through the admin server proxy (which injects the bypass
// token). BASE_URL is "/admin/" in embedded mode and "/" in standalone mode.
// Stripping the trailing slash gives "/admin" or "", and the api-client only
// prepends a non-empty string, so standalone mode is unaffected.
setBaseUrl(import.meta.env.BASE_URL.replace(/\/$/, "") || null);

setAuthTokenGetter(() => {
  try {
    const raw = localStorage.getItem("staffSession");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { session?: { token?: string }; token?: string };
    return parsed.session?.token ?? parsed.token ?? null;
  } catch {
    return null;
  }
});

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Guests} />
      <Route path="/guests" component={Guests} />
      <Route path="/maintenance" component={Maintenance} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/staff" component={Staff} />
      <Route path="/expenses" component={ExpensesPage} />
      <Route path="/services" component={ServicesContent} />
      <Route path="/login" component={Guests} />
      <Route component={NotFound} />
    </Switch>
  );
}

function GuestListWatcher() {
  useGuestListWatcher();
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <GuestListWatcher />
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
