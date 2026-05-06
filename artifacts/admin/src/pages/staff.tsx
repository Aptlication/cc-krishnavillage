import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { UserPlus, UserX, UserCheck, ShieldCheck, User, KeyRound, ShieldAlert, Mail, Check, X, Pencil, LogOut, Bell } from "lucide-react";
import {
  useGetStaffAccounts,
  getGetStaffAccountsQueryKey,
  useCreateStaffAccount,
  useDeactivateStaffAccount,
  useActivateStaffAccount,
  useChangeStaffPassword,
  useRevokeAllStaffSessions,
  useRevokeStaffAccountSessions,
  useUpdateStaffEmailAlias,
  useGetSecurityEvents,
  getGetSecurityEventsQueryKey,
  ApiError,
} from "@workspace/api-client-react";

export default function Staff() {
  const { session, pushEnabled, setPushEnabled } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"housekeeper" | "admin" | "maintenance">("housekeeper");
  const [formError, setFormError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);

  const [resetConfirmId, setResetConfirmId] = useState<number | null>(null);
  const [resetConfirmUsername, setResetConfirmUsername] = useState("");
  const [resetTargetId, setResetTargetId] = useState<number | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revokeAccountConfirmId, setRevokeAccountConfirmId] = useState<number | null>(null);

  const [deactivateConfirmId, setDeactivateConfirmId] = useState<number | null>(null);
  const [deactivateConfirmUsername, setDeactivateConfirmUsername] = useState("");

  const [emailEditId, setEmailEditId] = useState<number | null>(null);
  const [emailEditValue, setEmailEditValue] = useState("");
  const [emailEditError, setEmailEditError] = useState<string | null>(null);

  const { data: accounts, isLoading } = useGetStaffAccounts({
    query: {
      queryKey: getGetStaffAccountsQueryKey(),
      enabled: !!session?.token && session.role === "admin",
    },
  });

  const { data: securityEvents, isLoading: securityEventsLoading } = useGetSecurityEvents({
    query: {
      queryKey: getGetSecurityEventsQueryKey(),
      enabled: !!session?.token && session.role === "admin",
    },
  });

  const createMutation = useCreateStaffAccount({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account created", description: `${displayName} can now log in.` });
        setUsername("");
        setPassword("");
        setDisplayName("");
        setRole("housekeeper");
        setFormError(null);
        void queryClient.invalidateQueries({ queryKey: getGetStaffAccountsQueryKey() });
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        setFormError(apiErr?.error ?? (err instanceof Error ? err.message : "Failed to create account"));
      },
    },
  });

  const deactivateMutation = useDeactivateStaffAccount({
    mutation: {
      onSuccess: (updated) => {
        toast({ title: "Account deactivated", description: `${updated.displayName}'s account has been deactivated.` });
        void queryClient.invalidateQueries({ queryKey: getGetStaffAccountsQueryKey() });
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        const message = apiErr?.error ?? (err instanceof Error ? err.message : "Failed to deactivate account");
        toast({ title: "Error", description: message, variant: "destructive" });
      },
    },
  });

  const activateMutation = useActivateStaffAccount({
    mutation: {
      onSuccess: (updated) => {
        toast({ title: "Account activated", description: `${updated.displayName}'s account has been reactivated.` });
        void queryClient.invalidateQueries({ queryKey: getGetStaffAccountsQueryKey() });
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        const message = apiErr?.error ?? (err instanceof Error ? err.message : "Failed to activate account");
        toast({ title: "Error", description: message, variant: "destructive" });
      },
    },
  });

  const changePasswordMutation = useChangeStaffPassword({
    mutation: {
      onSuccess: () => {
        toast({ title: "Password updated", description: "Your password has been changed successfully." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPwError(null);
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        setPwError(apiErr?.error ?? (err instanceof Error ? err.message : "Failed to change password"));
      },
    },
  });

  const revokeSessionsMutation = useRevokeAllStaffSessions({
    mutation: {
      onSuccess: () => {
        toast({
          title: "All sessions revoked",
          description: "All staff members have been signed out and must log in again.",
        });
        setShowRevokeConfirm(false);
        void queryClient.invalidateQueries({ queryKey: getGetSecurityEventsQueryKey() });
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        const message = apiErr?.error ?? (err instanceof Error ? err.message : "Failed to revoke sessions");
        toast({ title: "Error", description: message, variant: "destructive" });
        setShowRevokeConfirm(false);
      },
    },
  });

  const revokeAccountSessionsMutation = useRevokeStaffAccountSessions({
    mutation: {
      onSuccess: (_, variables) => {
        const target = accounts?.find((a) => a.id === variables.id);
        toast({
          title: "Session revoked",
          description: `${target?.displayName ?? "Staff member"} has been signed out.`,
        });
        setRevokeAccountConfirmId(null);
        void queryClient.invalidateQueries({ queryKey: getGetSecurityEventsQueryKey() });
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        const message = apiErr?.error ?? (err instanceof Error ? err.message : "Failed to revoke session");
        toast({ title: "Error", description: message, variant: "destructive" });
        setRevokeAccountConfirmId(null);
      },
    },
  });

  const updateEmailMutation = useUpdateStaffEmailAlias({
    mutation: {
      onSuccess: (updated) => {
        toast({
          title: "Email updated",
          description: updated.email
            ? `Email set to ${updated.email}`
            : "Email removed",
        });
        setEmailEditId(null);
        setEmailEditValue("");
        setEmailEditError(null);
        void queryClient.invalidateQueries({
          queryKey: getGetStaffAccountsQueryKey(),
        });
      },
      onError: (err: unknown) => {
        const apiErr =
          err instanceof ApiError
            ? (err.data as { error?: string })
            : null;
        setEmailEditError(
          apiErr?.error ??
            (err instanceof Error ? err.message : "Failed to update email"),
        );
      },
    },
  });

  const adminResetMutation = useChangeStaffPassword({
    mutation: {
      onSuccess: () => {
        toast({ title: "Password reset", description: "The staff member's password has been reset." });
        setResetTargetId(null);
        setResetNewPassword("");
        setResetError(null);
      },
      onError: (err: unknown) => {
        const apiErr = err instanceof ApiError ? (err.data as { error?: string }) : null;
        setResetError(apiErr?.error ?? (err instanceof Error ? err.message : "Failed to reset password"));
      },
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!username.trim() || !password.trim() || !displayName.trim()) {
      setFormError("All fields are required");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }
    createMutation.mutate({ data: { username: username.trim(), password, displayName: displayName.trim(), role: role as "admin" | "housekeeper" } });
  };

  const handleToggle = (id: number, currentlyActive: boolean) => {
    if (currentlyActive) {
      deactivateMutation.mutate({ id });
    } else {
      activateMutation.mutate({ id });
    }
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (!currentPassword) {
      setPwError("Current password is required");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match");
      return;
    }
    if (!session?.staffId) return;
    changePasswordMutation.mutate({
      id: session.staffId,
      data: { currentPassword, newPassword },
    });
  };

  const handleAdminReset = (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    if (resetNewPassword.length < 8) {
      setResetError("Password must be at least 8 characters");
      return;
    }
    if (resetTargetId === null) return;
    adminResetMutation.mutate({
      id: resetTargetId,
      data: { newPassword: resetNewPassword },
    });
  };

  const isTogglePending = deactivateMutation.isPending || activateMutation.isPending;

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-serif font-bold text-foreground">Staff Accounts</h2>
          <p className="text-muted-foreground">Manage staff accounts and update your password.</p>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              Change Your Password
            </CardTitle>
            <CardDescription>Enter your current password and choose a new one.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
              {pwError && (
                <p className="text-sm text-destructive" data-testid="pw-error">{pwError}</p>
              )}
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  data-testid="input-current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password-self">New Password</Label>
                <Input
                  id="new-password-self"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                  data-testid="input-new-password-self"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  data-testid="input-confirm-password"
                />
              </div>
              <Button
                type="submit"
                disabled={changePasswordMutation.isPending}
                data-testid="button-change-password"
              >
                {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notification Preferences
            </CardTitle>
            <CardDescription>Control which alerts you receive on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 max-w-sm">
              <div className="space-y-0.5">
                <Label htmlFor="push-alerts-toggle" className="text-sm font-medium">
                  Urgent maintenance alerts
                </Label>
                <p className="text-xs text-muted-foreground">
                  Receive a browser push notification when an urgent maintenance request is submitted.
                </p>
              </div>
              <Switch
                id="push-alerts-toggle"
                checked={pushEnabled}
                onCheckedChange={setPushEnabled}
                data-testid="toggle-push-alerts"
              />
            </div>
          </CardContent>
        </Card>

        {session?.role === "admin" && (
          <Card className="border-destructive/40 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                <ShieldAlert className="w-5 h-5" />
                Security Actions
              </CardTitle>
              <CardDescription>
                Use these actions during a security incident. Revoking sessions immediately signs out all staff.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!showRevokeConfirm ? (
                <Button
                  variant="destructive"
                  onClick={() => setShowRevokeConfirm(true)}
                  data-testid="button-revoke-sessions"
                >
                  <ShieldAlert className="w-4 h-4 mr-2" />
                  Revoke all sessions
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-destructive">
                    This will immediately sign out all staff, including yourself. Everyone will need to log in again. Are you sure?
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="destructive"
                      onClick={() => revokeSessionsMutation.mutate({} as never)}
                      disabled={revokeSessionsMutation.isPending}
                      data-testid="button-confirm-revoke"
                    >
                      {revokeSessionsMutation.isPending ? "Revoking..." : "Yes, sign out everyone"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowRevokeConfirm(false)}
                      disabled={revokeSessionsMutation.isPending}
                      data-testid="button-cancel-revoke"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {session?.role === "admin" && (
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                Security Log
              </CardTitle>
              <CardDescription>
                A record of security actions taken on this account, such as session revocations.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {securityEventsLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : !securityEvents || securityEvents.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No security events recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-border" data-testid="security-events-list">
                  {securityEvents.map((event) => (
                    <div
                      key={event.id}
                      className="px-4 py-3 flex items-start justify-between gap-4"
                      data-testid={`security-event-${event.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-destructive/10 text-destructive shrink-0">
                          <ShieldAlert className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {event.eventType === "sessions_revoked"
                              ? "All sessions revoked"
                              : event.eventType === "account_sessions_revoked"
                              ? `Session revoked for ${event.targetStaffDisplayName ?? "a staff member"}`
                              : event.eventType}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            By {event.triggeredByDisplayName ?? "Unknown"}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {format(new Date(event.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {session?.role === "admin" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-5">
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <UserPlus className="w-5 h-5" />
                    Add Staff Member
                  </CardTitle>
                  <CardDescription>Create a login for a new housekeeper or admin.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreate} className="space-y-4">
                    {formError && (
                      <p className="text-sm text-destructive">{formError}</p>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="displayName">Full Name</Label>
                      <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Sarah Johnson"
                        data-testid="input-display-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-username">Username</Label>
                      <Input
                        id="new-username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="e.g. sarah.j"
                        autoComplete="off"
                        data-testid="input-new-username"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-password">Password</Label>
                      <Input
                        id="new-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min. 8 characters"
                        autoComplete="new-password"
                        data-testid="input-new-password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={role} onValueChange={(v) => setRole(v as "housekeeper" | "admin" | "maintenance")}>
                        <SelectTrigger id="role" data-testid="select-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="housekeeper">Housekeeper</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createMutation.isPending}
                      data-testid="button-create-account"
                    >
                      {createMutation.isPending ? "Creating..." : "Create Account"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-7">
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Current Staff</CardTitle>
                  <CardDescription>All staff members who have access to the portal.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {isLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="p-4 animate-pulse flex items-center justify-between">
                          <div className="space-y-2">
                            <div className="h-4 bg-muted rounded w-32"></div>
                            <div className="h-3 bg-muted rounded w-20"></div>
                          </div>
                          <div className="h-8 bg-muted rounded w-24"></div>
                        </div>
                      ))
                    ) : !accounts || accounts.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        No staff accounts found.
                      </div>
                    ) : (
                      accounts.map((account) => (
                        <div key={account.id}>
                          <div
                            className="p-4 flex items-center justify-between gap-4"
                            data-testid={`row-staff-${account.id}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`p-2 rounded-lg ${account.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                {account.role === "admin" ? (
                                  <ShieldCheck className="w-4 h-4" />
                                ) : (
                                  <User className="w-4 h-4" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-foreground">{account.displayName}</span>
                                  <Badge variant={account.active ? "default" : "secondary"} className="text-xs">
                                    {account.active ? "Active" : "Inactive"}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  @{account.username} · {account.role} · joined {format(new Date(account.createdAt), "MMM d, yyyy")}
                                </p>
                                {/* Email field */}
                                {emailEditId === account.id ? (
                                  <div className="flex items-center gap-1.5 mt-1.5">
                                    <Mail className="w-3 h-3 text-muted-foreground shrink-0" />
                                    <Input
                                      type="email"
                                      value={emailEditValue}
                                      onChange={(e) => setEmailEditValue(e.target.value)}
                                      className="h-6 text-xs px-1.5 py-0 w-44"
                                      placeholder="staff@example.com"
                                      autoFocus
                                      data-testid={`input-email-${account.id}`}
                                    />
                                    <button
                                      className="text-green-600 hover:text-green-700"
                                      title="Save"
                                      onClick={() => {
                                        setEmailEditError(null);
                                        updateEmailMutation.mutate({
                                          id: account.id,
                                          data: { email: emailEditValue.trim() || null },
                                        });
                                      }}
                                      disabled={updateEmailMutation.isPending}
                                      data-testid={`button-save-email-${account.id}`}
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      className="text-muted-foreground hover:text-foreground"
                                      title="Cancel"
                                      onClick={() => {
                                        setEmailEditId(null);
                                        setEmailEditValue("");
                                        setEmailEditError(null);
                                      }}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                    {emailEditError && (
                                      <span className="text-xs text-destructive">{emailEditError}</span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 mt-1">
                                    <Mail className="w-3 h-3 text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">
                                      {account.email ?? "No email set"}
                                    </span>
                                    <button
                                      className="ml-0.5 text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
                                      title="Edit email"
                                      onClick={() => {
                                        setEmailEditId(account.id);
                                        setEmailEditValue(account.email ?? "");
                                        setEmailEditError(null);
                                      }}
                                      data-testid={`button-edit-email-${account.id}`}
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground"
                                title="Reset password"
                                onClick={() => {
                                  if (resetConfirmId === account.id || resetTargetId === account.id) {
                                    setResetConfirmId(null);
                                    setResetConfirmUsername("");
                                    setResetTargetId(null);
                                    setResetNewPassword("");
                                    setResetError(null);
                                  } else {
                                    setResetConfirmId(account.id);
                                    setResetConfirmUsername("");
                                    setResetTargetId(null);
                                    setResetNewPassword("");
                                    setResetError(null);
                                  }
                                }}
                                data-testid={`button-reset-password-${account.id}`}
                              >
                                <KeyRound className="w-4 h-4 mr-1" />
                                Reset
                              </Button>
                              {account.id !== session?.staffId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-orange-600 hover:text-orange-700"
                                  title="Sign out this staff member"
                                  onClick={() => setRevokeAccountConfirmId(revokeAccountConfirmId === account.id ? null : account.id)}
                                  disabled={revokeAccountSessionsMutation.isPending}
                                  data-testid={`button-revoke-account-${account.id}`}
                                >
                                  <LogOut className="w-4 h-4 mr-1" />
                                  Sign out
                                </Button>
                              )}
                              {account.id !== session?.staffId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={account.active ? "text-destructive hover:text-destructive" : "text-primary"}
                                  onClick={() => {
                                    if (account.active) {
                                      if (deactivateConfirmId === account.id) {
                                        setDeactivateConfirmId(null);
                                        setDeactivateConfirmUsername("");
                                      } else {
                                        setDeactivateConfirmId(account.id);
                                        setDeactivateConfirmUsername("");
                                      }
                                    } else {
                                      handleToggle(account.id, false);
                                    }
                                  }}
                                  disabled={isTogglePending}
                                  data-testid={`button-toggle-${account.id}`}
                                >
                                  {account.active ? (
                                    <>
                                      <UserX className="w-4 h-4 mr-1" />
                                      Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <UserCheck className="w-4 h-4 mr-1" />
                                      Activate
                                    </>
                                  )}
                                </Button>
                              )}
                            </div>
                          </div>
                          {resetConfirmId === account.id && (
                            <div className="px-4 pb-4 bg-muted/30" data-testid={`reset-confirm-panel-${account.id}`}>
                              <div className="pt-3 space-y-3">
                                <p className="text-sm font-medium">
                                  Reset password for <span className="text-foreground font-semibold">{account.displayName}</span> (@{account.username})?
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  This will let you set a new password for their account. They will need to use the new password on their next login.
                                </p>
                                <div className="space-y-1.5">
                                  <Label htmlFor={`reset-confirm-username-${account.id}`} className="text-xs">
                                    Type <span className="font-semibold text-foreground">@{account.username}</span> to confirm
                                  </Label>
                                  <Input
                                    id={`reset-confirm-username-${account.id}`}
                                    value={resetConfirmUsername}
                                    onChange={(e) => setResetConfirmUsername(e.target.value)}
                                    placeholder={account.username}
                                    autoComplete="off"
                                    className="h-8 text-sm max-w-xs"
                                    data-testid={`input-reset-confirm-username-${account.id}`}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={resetConfirmUsername !== account.username}
                                    onClick={() => {
                                      setResetConfirmId(null);
                                      setResetConfirmUsername("");
                                      setResetTargetId(account.id);
                                      setResetNewPassword("");
                                      setResetError(null);
                                    }}
                                    data-testid={`button-confirm-reset-${account.id}`}
                                  >
                                    Yes, reset password
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setResetConfirmId(null);
                                      setResetConfirmUsername("");
                                    }}
                                    data-testid={`button-cancel-reset-confirm-${account.id}`}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                          {revokeAccountConfirmId === account.id && (
                            <div className="px-4 pb-4 bg-orange-50 dark:bg-orange-950/20 border-t border-orange-200/50 dark:border-orange-800/30" data-testid={`revoke-account-confirm-panel-${account.id}`}>
                              <div className="pt-3 space-y-3">
                                <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
                                  Sign out <span className="font-semibold">{account.displayName}</span>?
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  This will immediately invalidate their current session. They will need to log in again. Other staff are unaffected.
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-orange-500 text-orange-700 hover:bg-orange-100 dark:border-orange-400 dark:text-orange-300 dark:hover:bg-orange-900/30"
                                    onClick={() => revokeAccountSessionsMutation.mutate({ id: account.id })}
                                    disabled={revokeAccountSessionsMutation.isPending}
                                    data-testid={`button-confirm-revoke-account-${account.id}`}
                                  >
                                    {revokeAccountSessionsMutation.isPending ? "Signing out..." : "Yes, sign them out"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setRevokeAccountConfirmId(null)}
                                    disabled={revokeAccountSessionsMutation.isPending}
                                    data-testid={`button-cancel-revoke-account-${account.id}`}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                          {deactivateConfirmId === account.id && (
                            <div className="px-4 pb-4 bg-destructive/5 border-t border-destructive/20" data-testid={`deactivate-confirm-panel-${account.id}`}>
                              <div className="pt-3 space-y-3">
                                <p className="text-sm font-medium text-destructive">
                                  Deactivate <span className="font-semibold">{account.displayName}</span>?
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  This will prevent them from logging in. You can reactivate the account at any time.
                                </p>
                                <div className="space-y-1.5">
                                  <Label htmlFor={`deactivate-confirm-username-${account.id}`} className="text-xs">
                                    Type <span className="font-semibold text-foreground">@{account.username}</span> to confirm
                                  </Label>
                                  <Input
                                    id={`deactivate-confirm-username-${account.id}`}
                                    value={deactivateConfirmUsername}
                                    onChange={(e) => setDeactivateConfirmUsername(e.target.value)}
                                    placeholder={account.username}
                                    autoComplete="off"
                                    className="h-8 text-sm max-w-xs"
                                    data-testid={`input-deactivate-confirm-username-${account.id}`}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={deactivateConfirmUsername !== account.username || isTogglePending}
                                    onClick={() => {
                                      setDeactivateConfirmId(null);
                                      setDeactivateConfirmUsername("");
                                      deactivateMutation.mutate({ id: account.id });
                                    }}
                                    data-testid={`button-confirm-deactivate-${account.id}`}
                                  >
                                    {deactivateMutation.isPending ? "Deactivating..." : "Yes, deactivate"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setDeactivateConfirmId(null);
                                      setDeactivateConfirmUsername("");
                                    }}
                                    data-testid={`button-cancel-deactivate-${account.id}`}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                          {resetTargetId === account.id && (
                            <div className="px-4 pb-4 bg-muted/30">
                              <form onSubmit={handleAdminReset} className="flex items-end gap-3 pt-3">
                                <div className="flex-1 space-y-1">
                                  {resetError && (
                                    <p className="text-xs text-destructive" data-testid="reset-error">{resetError}</p>
                                  )}
                                  <Label htmlFor={`reset-pw-${account.id}`} className="text-xs">
                                    New password for {account.displayName}
                                  </Label>
                                  <Input
                                    id={`reset-pw-${account.id}`}
                                    type="password"
                                    value={resetNewPassword}
                                    onChange={(e) => setResetNewPassword(e.target.value)}
                                    placeholder="Min. 8 characters"
                                    autoComplete="new-password"
                                    data-testid={`input-reset-password-${account.id}`}
                                  />
                                </div>
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={adminResetMutation.isPending}
                                  data-testid={`button-set-password-${account.id}`}
                                >
                                  {adminResetMutation.isPending ? "Saving..." : "Set Password"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setResetTargetId(null);
                                    setResetNewPassword("");
                                    setResetError(null);
                                  }}
                                >
                                  Cancel
                                </Button>
                              </form>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
