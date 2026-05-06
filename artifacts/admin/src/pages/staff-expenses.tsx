import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import {
  LogIn,
  Plus,
  Receipt,
  FileText,
  ExternalLink,
  CheckCircle2,
  XCircle,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Loader2,
  Upload,
  Clock,
  Inbox,
  Pencil,
  Undo2,
} from "lucide-react";
import {
  useGetExpenseClaims,
  getGetExpenseClaimsQueryKey,
  getGetExpensePendingCountQueryKey,
  useCreateExpenseClaim,
  useUpdateExpenseClaim,
  useWithdrawExpenseClaim,
  useReimburseExpenseClaim,
  useRejectExpenseClaim,
  ApiError,
  type ExpenseClaim,
  type StaffAccount,
} from "@workspace/api-client-react";


function formatAmount(amountStr: string): string {
  const n = parseFloat(amountStr);
  return isNaN(n) ? "$0.00" : `$${n.toFixed(2)}`;
}

function calcTotals(claims: ExpenseClaim[]) {
  const net = claims.reduce((s, c) => s + parseFloat(c.amountAud), 0);
  const due = claims
    .filter((c) => c.status === "claimed" || c.status === "in_progress" || c.status === "pending")
    .reduce((s, c) => s + parseFloat(c.amountAud), 0);
  return { net, due };
}

function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem("staffSession");
    const parsed = JSON.parse(raw ?? "{}") as { session?: { token?: string }; token?: string };
    return parsed.session?.token ?? parsed.token ?? null;
  } catch {
    return null;
  }
}

async function uploadReceiptFile(file: File): Promise<string> {
  let token: string | null = null;
  try {
    const raw = localStorage.getItem("staffSession");
    const parsed = JSON.parse(raw ?? "{}") as {
      session?: { token?: string };
      token?: string;
    };
    token = parsed.session?.token ?? parsed.token ?? null;
  } catch {
    /* empty */
  }
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/expenses/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Upload failed");
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}


function StatusBadge({ status }: { status: ExpenseClaim["status"] }) {
  if (status === "claimed" || status === "pending")
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
        Claimed
      </Badge>
    );
  if (status === "in_progress")
    return (
      <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 text-xs">
        In Progress
      </Badge>
    );
  if (status === "reimbursed")
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs">
        Reimbursed
      </Badge>
    );
  if (status === "withdrawn")
    return (
      <Badge className="bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100 text-xs">
        Withdrawn
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-xs">
      Rejected
    </Badge>
  );
}


function ClaimCountdownChip({ createdAt, now }: { createdAt: string; now: number }) {
  const DEADLINE_MS = 48 * 60 * 60 * 1000;
  const deadline = parseISO(createdAt).getTime() + DEADLINE_MS;
  const diffMs = deadline - now;
  const overdue = diffMs <= 0;
  const absDiffMs = Math.abs(diffMs);
  const totalMins = Math.floor(absDiffMs / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;

  const label = overdue
    ? hours > 0
      ? `${hours}h ${mins}m overdue`
      : `${mins}m overdue`
    : hours > 0
      ? `due in ${hours}h ${mins}m`
      : `due in ${mins}m`;

  const chipClass = overdue
    ? "bg-red-100 text-red-700 border-red-200"
    : diffMs < 6 * 60 * 60 * 1000
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full border ${chipClass}`}
      title={`48-hour acknowledgement window started at ${format(parseISO(createdAt), "d MMM yyyy HH:mm")}`}
    >
      <Clock className="w-3 h-3 shrink-0" />
      {label}
    </span>
  );
}


function ReceiptThumbs({ urls }: { urls: string[] }) {
  if (!urls.length)
    return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex gap-1.5 flex-wrap">
      {urls.map((url, i) => {
        const isPdf =
          url.toLowerCase().includes(".pdf") ||
          url.toLowerCase().includes("pdf");
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Receipt ${i + 1}`}
            className="flex items-center gap-0.5 text-primary hover:opacity-80"
          >
            {isPdf ? (
              <span className="flex items-center gap-0.5 text-xs underline">
                <FileText className="w-3.5 h-3.5" />
                PDF
              </span>
            ) : (
              <span className="relative group">
                <img
                  src={url}
                  alt={`Receipt ${i + 1}`}
                  className="w-9 h-9 object-cover rounded border border-border cursor-pointer"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                <ExternalLink className="w-2.5 h-2.5 absolute bottom-0.5 right-0.5 text-white opacity-70" />
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}


interface ReimburseDialogProps {
  claims: ExpenseClaim[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ReimburseDialog({
  claims,
  open,
  onClose,
  onSuccess,
}: ReimburseDialogProps) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [processing, setProcessing] = useState(false);
  const reimburseMutation = useReimburseExpenseClaim();

  const handleConfirm = async () => {
    setProcessing(true);
    let succeeded = 0;
    for (const claim of claims) {
      try {
        await reimburseMutation.mutateAsync({
          id: claim.id,
          data: { notes: notes.trim() || null },
        });
        succeeded++;
      } catch {
        toast({
          title: `Failed to reimburse claim #${claim.id}`,
          variant: "destructive",
        });
      }
    }
    setProcessing(false);
    if (succeeded > 0) {
      toast({
        title:
          succeeded === 1
            ? "Claim reimbursed"
            : `${succeeded} claims reimbursed`,
        description: "A confirmation email has been sent to the claimant(s).",
      });
      onSuccess();
    }
    setNotes("");
    onClose();
  };

  const total = claims.reduce((s, c) => s + parseFloat(c.amountAud), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !processing && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Reimbursed</DialogTitle>
          <DialogDescription>
            {claims.length === 1
              ? "Confirm reimbursement of this expense claim."
              : `Confirm reimbursement of ${claims.length} expense claims.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
            {claims.map((c) => (
              <div
                key={c.id}
                className="px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.staffDisplayName} ·{" "}
                    {format(parseISO(c.claimDate), "d MMM yyyy")}
                  </p>
                </div>
                <span className="font-semibold text-green-700 shrink-0 text-sm">
                  {formatAmount(c.amountAud)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-sm font-semibold px-1">
            <span>Total</span>
            <span className="text-green-700">${total.toFixed(2)}</span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reimburse-notes" className="text-sm">
              Notes (optional)
            </Label>
            <Textarea
              id="reimburse-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Reimbursed via bank transfer on 1 May 2026"
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={processing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={processing}
            className="bg-green-600 hover:bg-green-700 text-white"
            data-testid="button-confirm-reimburse"
          >
            {processing && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            {processing ? "Processing…" : "Confirm Reimbursement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


interface RejectDialogProps {
  claim: ExpenseClaim | null;
  onClose: () => void;
  onSuccess: () => void;
}

function RejectDialog({ claim, onClose, onSuccess }: RejectDialogProps) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rejectMutation = useRejectExpenseClaim({
    mutation: {
      onSuccess: () => {
        toast({ title: "Claim rejected" });
        onSuccess();
        onClose();
        setNote("");
        setError(null);
      },
      onError: (err: unknown) => {
        const apiErr =
          err instanceof ApiError
            ? (err.data as { error?: string })
            : null;
        setError(
          apiErr?.error ??
            (err instanceof Error ? err.message : "Failed to reject"),
        );
      },
    },
  });

  return (
    <Dialog open={!!claim} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject Expense Claim</DialogTitle>
          {claim && (
            <DialogDescription>
              Reject &ldquo;{claim.description}&rdquo; (
              {formatAmount(claim.amountAud)}) by {claim.staffDisplayName}.
            </DialogDescription>
          )}
        </DialogHeader>
        {claim && (
          <div className="space-y-2">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Label htmlFor="reject-note" className="text-sm">
              Reason (optional)
            </Label>
            <Textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for rejection…"
              rows={3}
              className="text-sm resize-none"
            />
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={rejectMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              claim &&
              rejectMutation.mutate({
                id: claim.id,
                data: { note: note.trim() || null },
              })
            }
            disabled={rejectMutation.isPending}
            data-testid="button-confirm-reject"
          >
            {rejectMutation.isPending ? "Rejecting…" : "Reject Claim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


interface AddExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  isAdmin: boolean;
  accounts: StaffAccount[] | undefined;
}

function AddExpenseDialog({
  open,
  onClose,
  onSuccess,
  isAdmin,
  accounts,
}: AddExpenseDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [claimDate, setClaimDate] = useState(
    () => format(new Date(), "yyyy-MM-dd"),
  );
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [amountAud, setAmountAud] = useState("");
  const [targetStaffId, setTargetStaffId] = useState("");
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setClaimDate(format(new Date(), "yyyy-MM-dd"));
    setDescription("");
    setProject("");
    setAmountAud("");
    setTargetStaffId("");
    setUploadedUrls([]);
    setUploadError(null);
    setFormError(null);
  };

  const createMutation = useCreateExpenseClaim({
    mutation: {
      onSuccess: () => {
        toast({ title: "Expense claim added" });
        onSuccess();
        onClose();
        resetForm();
      },
      onError: (err: unknown) => {
        const apiErr =
          err instanceof ApiError
            ? (err.data as { error?: string })
            : null;
        setFormError(
          apiErr?.error ??
            (err instanceof Error ? err.message : "Failed to create claim"),
        );
      },
    },
  });

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadReceiptFile(file);
      setUploadedUrls((prev) => [...prev, url]);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!description.trim()) {
      setFormError("Description is required");
      return;
    }
    const amount = parseFloat(amountAud);
    if (isNaN(amount) || amount <= 0) {
      setFormError("Enter a valid amount greater than $0");
      return;
    }
    const body: Parameters<typeof createMutation.mutate>[0]["data"] = {
      claimDate,
      description: description.trim(),
      project: project.trim() || null,
      amountAud: amount.toFixed(2),
      receiptUrls: uploadedUrls,
    };
    if (isAdmin && targetStaffId) {
      body.staffId = parseInt(targetStaffId, 10);
    }
    createMutation.mutate({ data: body });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          resetForm();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Expense Claim</DialogTitle>
          <DialogDescription>
            Add a manual out-of-pocket expense not linked to a maintenance
            report.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}
          {isAdmin && accounts && (
            <div className="space-y-1.5">
              <Label htmlFor="exp-staff" className="text-sm">
                Staff Member
              </Label>
              <select
                id="exp-staff"
                value={targetStaffId}
                onChange={(e) => setTargetStaffId(e.target.value)}
                className="w-full text-sm border border-input rounded-md px-3 py-2 bg-background"
                data-testid="select-exp-staff"
              >
                <option value="">Select staff member…</option>
                {accounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-date" className="text-sm">
                Date
              </Label>
              <Input
                id="exp-date"
                type="date"
                value={claimDate}
                onChange={(e) => setClaimDate(e.target.value)}
                className="text-sm"
                data-testid="input-exp-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount" className="text-sm">
                Amount (AUD)
              </Label>
              <Input
                id="exp-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amountAud}
                onChange={(e) => setAmountAud(e.target.value)}
                className="text-sm"
                data-testid="input-exp-amount"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-description" className="text-sm">
              Description
            </Label>
            <Input
              id="exp-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Fuel for site visit"
              className="text-sm"
              data-testid="input-exp-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-project" className="text-sm">
              Project (optional)
            </Label>
            <Input
              id="exp-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="e.g. Accommodation, Maintenance"
              className="text-sm"
              data-testid="input-exp-project"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Receipt (optional)</Label>
            {uploadError && (
              <p className="text-xs text-destructive">{uploadError}</p>
            )}
            {uploadedUrls.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {uploadedUrls.map((url, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
                  >
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                    <span>Receipt {i + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setUploadedUrls((prev) =>
                          prev.filter((_, j) => j !== i),
                        )
                      }
                      className="ml-1 text-muted-foreground hover:text-destructive"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-1" />
                )}
                {uploading ? "Uploading…" : "Upload receipt"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf"
                onChange={handleFileChange}
              />
              <span className="text-xs text-muted-foreground">
                JPEG, PNG, PDF
              </span>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onClose();
                resetForm();
              }}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || uploading}
              data-testid="button-add-expense-submit"
            >
              {createMutation.isPending ? "Saving…" : "Add Claim"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


interface EditExpenseDialogProps {
  claim: ExpenseClaim | null;
  onClose: () => void;
  onSuccess: () => void;
}

function EditExpenseDialog({ claim, onClose, onSuccess }: EditExpenseDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [claimDate, setClaimDate] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [amountAud, setAmountAud] = useState("");
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (claim) {
      setClaimDate(claim.claimDate);
      setDescription(claim.description);
      setProject(claim.project ?? "");
      setAmountAud(claim.amountAud);
      setUploadedUrls(claim.receiptUrls ?? []);
      setUploadError(null);
      setFormError(null);
    }
  }, [claim]);

  const updateMutation = useUpdateExpenseClaim({
    mutation: {
      onSuccess: () => {
        toast({ title: "Expense claim updated" });
        onSuccess();
        onClose();
      },
      onError: (err: unknown) => {
        const apiErr =
          err instanceof ApiError ? (err.data as { error?: string }) : null;
        setFormError(
          apiErr?.error ??
            (err instanceof Error ? err.message : "Failed to update claim"),
        );
      },
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadReceiptFile(file);
      setUploadedUrls((prev) => [...prev, url]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!claim) return;
    if (!description.trim()) {
      setFormError("Description is required");
      return;
    }
    const amount = parseFloat(amountAud);
    if (isNaN(amount) || amount <= 0) {
      setFormError("Enter a valid amount greater than $0");
      return;
    }
    updateMutation.mutate({
      id: claim.id,
      data: {
        claimDate,
        description: description.trim(),
        project: project.trim() || null,
        amountAud: amount.toFixed(2),
        receiptUrls: uploadedUrls,
      },
    });
  };

  return (
    <Dialog open={!!claim} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Expense Claim</DialogTitle>
          <DialogDescription>
            Update the details of your expense claim. Changes are only allowed
            while the claim is still in Claimed status.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-exp-date" className="text-sm">
                Date
              </Label>
              <Input
                id="edit-exp-date"
                type="date"
                value={claimDate}
                onChange={(e) => setClaimDate(e.target.value)}
                className="text-sm"
                data-testid="input-edit-exp-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-exp-amount" className="text-sm">
                Amount (AUD)
              </Label>
              <Input
                id="edit-exp-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amountAud}
                onChange={(e) => setAmountAud(e.target.value)}
                className="text-sm"
                data-testid="input-edit-exp-amount"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-exp-description" className="text-sm">
              Description
            </Label>
            <Input
              id="edit-exp-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Fuel for site visit"
              className="text-sm"
              data-testid="input-edit-exp-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-exp-project" className="text-sm">
              Project (optional)
            </Label>
            <Input
              id="edit-exp-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="e.g. Accommodation, Maintenance"
              className="text-sm"
              data-testid="input-edit-exp-project"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Receipt (optional)</Label>
            {uploadError && (
              <p className="text-xs text-destructive">{uploadError}</p>
            )}
            {uploadedUrls.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {uploadedUrls.map((url, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
                  >
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                    <span>Receipt {i + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setUploadedUrls((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="ml-1 text-muted-foreground hover:text-destructive"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-1" />
                )}
                {uploading ? "Uploading…" : "Upload receipt"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf"
                onChange={handleFileChange}
              />
              <span className="text-xs text-muted-foreground">
                JPEG, PNG, PDF
              </span>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending || uploading}
              data-testid="button-edit-expense-submit"
            >
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


interface WithdrawConfirmDialogProps {
  claim: ExpenseClaim | null;
  onClose: () => void;
  onSuccess: () => void;
}

function WithdrawConfirmDialog({
  claim,
  onClose,
  onSuccess,
}: WithdrawConfirmDialogProps) {
  const { toast } = useToast();

  const withdrawMutation = useWithdrawExpenseClaim({
    mutation: {
      onSuccess: () => {
        toast({ title: "Expense claim withdrawn" });
        onSuccess();
        onClose();
      },
      onError: (err: unknown) => {
        const apiErr =
          err instanceof ApiError ? (err.data as { error?: string }) : null;
        toast({
          title: "Failed to withdraw claim",
          description:
            apiErr?.error ??
            (err instanceof Error ? err.message : "Please try again."),
          variant: "destructive",
        });
      },
    },
  });

  return (
    <Dialog open={!!claim} onOpenChange={(o) => !o && !withdrawMutation.isPending && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Withdraw Expense Claim</DialogTitle>
          {claim && (
            <DialogDescription>
              Are you sure you want to withdraw &ldquo;{claim.description}&rdquo;
              ({formatAmount(claim.amountAud)})? This cannot be undone.
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={withdrawMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => claim && withdrawMutation.mutate({ id: claim.id })}
            disabled={withdrawMutation.isPending}
            data-testid="button-confirm-withdraw"
          >
            {withdrawMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Undo2 className="w-4 h-4 mr-2" />
            )}
            {withdrawMutation.isPending ? "Withdrawing…" : "Withdraw Claim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


interface SecondTierLoginCardProps {
  currentStaffId: number | undefined;
  onSuccess: (s: { staffId: number; displayName: string }) => void;
}

function SecondTierLoginCard({
  currentStaffId,
  onSuccess,
}: SecondTierLoginCardProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: email.trim().toLowerCase(),
          password,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(err.error ?? "Invalid email or password");
        return;
      }
      const data = (await res.json()) as {
        staffId: number;
        displayName: string;
        role: string;
      };
      if (currentStaffId !== undefined && data.staffId !== currentStaffId) {
        setError("This email does not match your current account");
        return;
      }
      onSuccess({ staffId: data.staffId, displayName: data.displayName });
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="border-border shadow-sm max-w-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <LogIn className="w-4 h-4" />
          Sign in to view your expenses
        </CardTitle>
        <CardDescription className="text-xs">
          Enter your email and password to access your personal expense ledger.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="exp-email" className="text-sm">
              Email
            </Label>
            <Input
              id="exp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="text-sm"
              data-testid="input-expenses-email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-pw" className="text-sm">
              Password
            </Label>
            <Input
              id="exp-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="text-sm"
              data-testid="input-expenses-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            size="sm"
            disabled={pending}
            data-testid="button-expenses-login"
          >
            {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {pending ? "Signing in…" : "View my expenses"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}


interface ExpensesSectionProps {
  accounts: StaffAccount[] | undefined;
  bypassGate?: boolean;
}

export function ExpensesSection({ accounts, bypassGate = false }: ExpensesSectionProps) {
  const { session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = session?.role === "admin";

  const [expensesSession, setExpensesSession] = useState<{
    staffId: number;
    displayName: string;
  } | null>(null);

  type StatusFilter = "claimed" | "in_progress" | "reimbursed" | "rejected";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("claimed");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [reimburseOpen, setReimburseOpen] = useState(false);
  const [rejectClaim, setRejectClaim] = useState<ExpenseClaim | null>(null);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [editClaim, setEditClaim] = useState<ExpenseClaim | null>(null);
  const [withdrawClaim, setWithdrawClaim] = useState<ExpenseClaim | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(
    new Set(),
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const canView = isAdmin || bypassGate || !!expensesSession;

  // Include staffId+role in the query key so cached admin data is never
  // returned to a different staff member who logs in on the same device.
  const scopedClaimsKey = [
    ...getGetExpenseClaimsQueryKey(),
    session?.staffId,
    session?.role,
  ] as const;

  const { data: claims, isLoading } = useGetExpenseClaims(undefined, {
    query: {
      queryKey: scopedClaimsKey,
      enabled: canView,
    },
  });

  const invalidateClaims = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetExpenseClaimsQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetExpensePendingCountQueryKey(),
    });
  };

  const statusCounts = useMemo(() => {
    if (!claims) return { claimed: 0, in_progress: 0, reimbursed: 0, rejected: 0 };
    return {
      claimed: claims.filter((c) => c.status === "claimed" || c.status === "pending").length,
      in_progress: claims.filter((c) => c.status === "in_progress").length,
      reimbursed: claims.filter((c) => c.status === "reimbursed").length,
      rejected: claims.filter((c) => c.status === "rejected").length,
    };
  }, [claims]);

  const filteredClaims = useMemo(
    () =>
      claims?.filter((c) =>
        statusFilter === "claimed"
          ? c.status === "claimed" || c.status === "pending"
          : c.status === statusFilter,
      ) ?? [],
    [claims, statusFilter],
  );

  const groupedClaims = useMemo(() => {
    const groups = new Map<
      number,
      { staffDisplayName: string; claims: ExpenseClaim[] }
    >();
    for (const claim of filteredClaims) {
      if (!groups.has(claim.staffId)) {
        groups.set(claim.staffId, {
          staffDisplayName: claim.staffDisplayName,
          claims: [],
        });
      }
      groups.get(claim.staffId)!.claims.push(claim);
    }
    return [...groups.entries()].map(([staffId, g]) => ({
      staffId,
      ...g,
    }));
  }, [filteredClaims]);

  const { mutate: runAcknowledge, isPending: acknowledging } = useMutation({
    mutationFn: async (claimIds: number[]) => {
      const token = getAuthToken();
      const results = await Promise.allSettled(
        claimIds.map((id) =>
          fetch(`/api/expenses/${id}/acknowledge`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }).then(async (r) => {
            if (!r.ok) {
              const err = (await r.json().catch(() => ({}))) as { error?: string };
              throw new Error(err.error ?? "Acknowledge failed");
            }
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: claimIds.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      toast({
        title: failed === 0 ? "Claims acknowledged" : "Partially acknowledged",
        description:
          failed === 0
            ? `${total} claim${total !== 1 ? "s" : ""} marked as In Progress.`
            : `${total - failed} of ${total} acknowledged; ${failed} failed.`,
        variant: failed > 0 ? "destructive" : "default",
      });
      setSelectedIds(new Set());
      invalidateClaims();
    },
    onError: () => {
      toast({ title: "Acknowledgement failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedClaims = filteredClaims.filter((c) => selectedIds.has(c.id));
  const claimedSelected = selectedClaims.filter((c) => c.status === "claimed" || c.status === "pending");
  const inProgressSelected = selectedClaims.filter((c) => c.status === "in_progress");

  const overallTotals = useMemo(() => {
    if (!claims) return { net: 0, due: 0 };
    return calcTotals(claims);
  }, [claims]);

  const tableHeaders = (showCheckbox: boolean, showActions: boolean, showPersonalActions = false) => (
    <TableHeader>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        {showCheckbox && <TableHead className="w-10 py-2" />}
        <TableHead className="text-xs w-10 py-2">#</TableHead>
        <TableHead className="text-xs py-2 whitespace-nowrap">Date</TableHead>
        <TableHead className="text-xs py-2">Description</TableHead>
        <TableHead className="text-xs py-2">Project</TableHead>
        <TableHead className="text-xs py-2 whitespace-nowrap">
          Amount (AUD)
        </TableHead>
        <TableHead className="text-xs py-2">Receipt</TableHead>
        <TableHead className="text-xs py-2">Status</TableHead>
        <TableHead className="text-xs py-2 whitespace-nowrap">
          Reimbursed By
        </TableHead>
        <TableHead className="text-xs py-2 whitespace-nowrap">
          Date Reimbursed
        </TableHead>
        {showActions && (
          <TableHead className="text-xs py-2">Actions</TableHead>
        )}
        {showPersonalActions && (
          <TableHead className="text-xs py-2">Actions</TableHead>
        )}
      </TableRow>
    </TableHeader>
  );

  const claimRow = (
    claim: ExpenseClaim,
    idx: number,
    showCheckbox: boolean,
    showActions: boolean,
    showPersonalActions = false,
  ) => {
    const isClaimed = claim.status === "claimed" || claim.status === "pending";
    const DEADLINE_MS = 48 * 60 * 60 * 1000;
    const isOverdue =
      isClaimed &&
      claim.createdAt &&
      parseISO(claim.createdAt).getTime() + DEADLINE_MS < now;

    let rowClass = "";
    if (selectedIds.has(claim.id)) {
      rowClass = "bg-primary/5";
    } else if (isOverdue) {
      rowClass = "bg-red-50";
    } else if (
      isClaimed &&
      claim.createdAt &&
      parseISO(claim.createdAt).getTime() + DEADLINE_MS - now < 6 * 60 * 60 * 1000
    ) {
      rowClass = "bg-amber-50";
    }

    return (
    <TableRow
      key={claim.id}
      className={rowClass || undefined}
    >
      {showCheckbox && (
        <TableCell className="py-2">
          {(claim.status === "claimed" || claim.status === "pending" || claim.status === "in_progress") && (
            <Checkbox
              checked={selectedIds.has(claim.id)}
              onCheckedChange={() => toggleSelect(claim.id)}
              aria-label={`Select claim ${claim.id}`}
            />
          )}
        </TableCell>
      )}
      <TableCell className="text-xs text-muted-foreground py-2">
        {idx + 1}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap py-2">
        {format(parseISO(claim.claimDate), "d MMM yyyy")}
      </TableCell>
      <TableCell className="text-xs py-2 max-w-[180px]">
        <div className="font-medium truncate">{claim.description}</div>
        {claim.rejectionNote && (
          <div className="text-destructive text-xs truncate mt-0.5">
            {claim.rejectionNote}
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground py-2">
        {claim.project ?? "—"}
      </TableCell>
      <TableCell className="text-xs font-semibold py-2">
        {formatAmount(claim.amountAud)}
      </TableCell>
      <TableCell className="py-2">
        <ReceiptThumbs urls={claim.receiptUrls} />
      </TableCell>
      <TableCell className="py-2">
        <div className="flex flex-row flex-wrap items-center gap-1.5">
          <StatusBadge status={claim.status} />
          {(claim.status === "claimed" || claim.status === "pending") && claim.createdAt && (
            <ClaimCountdownChip createdAt={claim.createdAt} now={now} />
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground py-2">
        {claim.reimbursedByName ?? "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground py-2 whitespace-nowrap">
        {claim.reimbursedAt
          ? format(parseISO(claim.reimbursedAt), "d MMM yyyy")
          : "—"}
      </TableCell>
      {showActions && (
        <TableCell className="py-2">
          <div className="flex items-center gap-1 flex-wrap">
            {(claim.status === "claimed" || claim.status === "pending") && (
              <Button
                variant="ghost"
                size="sm"
                className="text-blue-700 hover:text-blue-800 text-xs h-7 px-2"
                onClick={() => runAcknowledge([claim.id])}
                disabled={acknowledging}
                data-testid={`button-acknowledge-${claim.id}`}
              >
                <Inbox className="w-3.5 h-3.5 mr-1" />
                Acknowledge
              </Button>
            )}
            {claim.status === "in_progress" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-green-700 hover:text-green-800 text-xs h-7 px-2"
                onClick={() => {
                  setSelectedIds(new Set([claim.id]));
                  setReimburseOpen(true);
                }}
                data-testid={`button-reimburse-${claim.id}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                Reimburse
              </Button>
            )}
            {(claim.status === "claimed" || claim.status === "pending" || claim.status === "in_progress") && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive text-xs h-7 px-2"
                onClick={() => setRejectClaim(claim)}
                data-testid={`button-reject-${claim.id}`}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                Reject
              </Button>
            )}
          </div>
        </TableCell>
      )}
      {showPersonalActions && (
        <TableCell className="py-2">
          {(claim.status === "claimed" || claim.status === "pending") && (
            <div className="flex items-center gap-1 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary text-xs h-7 px-2"
                onClick={() => setEditClaim(claim)}
                data-testid={`button-edit-${claim.id}`}
              >
                <Pencil className="w-3.5 h-3.5 mr-1" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive text-xs h-7 px-2"
                onClick={() => setWithdrawClaim(claim)}
                data-testid={`button-withdraw-${claim.id}`}
              >
                <Undo2 className="w-3.5 h-3.5 mr-1" />
                Withdraw
              </Button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
  };

  return (
    <div className="space-y-4" data-testid="expenses-section">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            Staff Expenses &amp; Reimbursements
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdmin
              ? "Claims follow the workflow: Claimed → In Progress → Reimbursed."
              : "View and submit your expense claims for reimbursement."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && claimedSelected.length > 0 && (
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => runAcknowledge(claimedSelected.map((c) => c.id))}
              disabled={acknowledging}
              data-testid="button-acknowledge-selected"
            >
              {acknowledging ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Inbox className="w-4 h-4 mr-1" />
              )}
              Acknowledge {claimedSelected.length} Claim{claimedSelected.length !== 1 ? "s" : ""}
            </Button>
          )}
          {isAdmin && inProgressSelected.length > 0 && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setReimburseOpen(true)}
              data-testid="button-reimburse-selected"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Reimburse {inProgressSelected.length} Claim{inProgressSelected.length !== 1 ? "s" : ""}
            </Button>
          )}
          {canView && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddExpenseOpen(true)}
              data-testid="button-add-expense"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Expense
            </Button>
          )}
        </div>
      </div>

      {/* Second-tier login for non-admin */}
      {!isAdmin && !expensesSession && (
        <SecondTierLoginCard
          currentStaffId={session?.staffId}
          onSuccess={(s) => setExpensesSession(s)}
        />
      )}

      {/* Confirmed identity banner (non-admin) */}
      {!isAdmin && expensesSession && (
        <div className="flex items-center gap-2 text-sm bg-muted/40 rounded-md px-3 py-2 border border-border">
          <LogIn className="w-4 h-4 text-primary shrink-0" />
          <span className="text-muted-foreground">
            Viewing expenses for{" "}
            <span className="font-medium text-foreground">
              {expensesSession.displayName}
            </span>
          </span>
          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => {
              setExpensesSession(null);
              setSelectedIds(new Set());
            }}
          >
            Sign out
          </button>
        </div>
      )}

      {/* Workflow status tabs (admin only) */}
      {canView && isAdmin && (
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {(
            [
              { key: "claimed" as const, label: "Claimed", icon: <Receipt className="w-3.5 h-3.5" />, count: statusCounts.claimed, activeColor: "border-amber-500 text-amber-700" },
              { key: "in_progress" as const, label: "In Progress", icon: <Clock className="w-3.5 h-3.5" />, count: statusCounts.in_progress, activeColor: "border-blue-500 text-blue-700" },
              { key: "reimbursed" as const, label: "Reimbursed", icon: <CheckCircle2 className="w-3.5 h-3.5" />, count: statusCounts.reimbursed, activeColor: "border-green-500 text-green-700" },
              { key: "rejected" as const, label: "Rejected", icon: <XCircle className="w-3.5 h-3.5" />, count: statusCounts.rejected, activeColor: "border-destructive text-destructive" },
            ] satisfies { key: StatusFilter; label: string; icon: ReactNode; count: number; activeColor: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key);
                setSelectedIds(new Set());
              }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                statusFilter === tab.key
                  ? tab.activeColor
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`tab-${tab.key}`}
            >
              {tab.icon}
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center ${
                  statusFilter === tab.key ? "bg-current/10" : "bg-muted"
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Claims table */}
      {canView && (
        <Card className="border-border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading expense claims…
            </div>
          ) : !claims || claims.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No expense claims found.
            </div>
          ) : isAdmin ? (
            // ── Admin view: grouped by staff member ──
            <div className="overflow-x-auto">
              {groupedClaims.map(
                ({ staffId, staffDisplayName, claims: groupClaims }) => {
                  const { net, due } = calcTotals(groupClaims);
                  const isCollapsed = collapsedGroups.has(staffId);
                  return (
                    <div
                      key={staffId}
                      className="border-b border-border last:border-0"
                    >
                      <button
                        onClick={() =>
                          setCollapsedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(staffId)) next.delete(staffId);
                            else next.add(staffId);
                            return next;
                          })
                        }
                        className="w-full px-4 py-2.5 bg-muted/50 flex items-center gap-2 text-sm font-semibold text-foreground hover:bg-muted/80 transition-colors border-b border-border"
                        data-testid={`group-${staffId}`}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 shrink-0" />
                        )}
                        {staffDisplayName}
                        <span className="ml-auto flex gap-5 text-xs font-normal text-muted-foreground">
                          <span>
                            Net Total:{" "}
                            <strong className="text-foreground">
                              ${net.toFixed(2)}
                            </strong>
                          </span>
                          <span>
                            Balance Due:{" "}
                            <strong className="text-primary">
                              ${due.toFixed(2)}
                            </strong>
                          </span>
                          <span>
                            {groupClaims.length} claim
                            {groupClaims.length !== 1 ? "s" : ""}
                          </span>
                        </span>
                      </button>
                      {!isCollapsed && (
                        <Table>
                          {tableHeaders(true, true)}
                          <TableBody>
                            {groupClaims.map((claim, idx) =>
                              claimRow(claim, idx, true, true),
                            )}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  );
                },
              )}
              {/* Overall totals */}
              <div className="px-4 py-3 bg-muted/30 flex justify-end gap-8 text-sm font-semibold border-t border-border">
                <span>
                  Overall Net:{" "}
                  <span className="text-foreground">
                    ${overallTotals.net.toFixed(2)}
                  </span>
                </span>
                <span>
                  Overall Balance Due:{" "}
                  <span className="text-primary">
                    ${overallTotals.due.toFixed(2)}
                  </span>
                </span>
              </div>
            </div>
          ) : (
            // ── Personal view: flat list ──
            <div className="overflow-x-auto">
              <Table>
                {tableHeaders(false, false, true)}
                <TableBody>
                  {claims.map((claim, idx) =>
                    claimRow(claim, idx, false, false, true),
                  )}
                </TableBody>
              </Table>
              <div className="px-4 py-3 bg-muted/30 flex justify-end gap-8 text-sm font-semibold border-t border-border">
                <span>
                  Net Total:{" "}
                  <span className="text-foreground">
                    ${overallTotals.net.toFixed(2)}
                  </span>
                </span>
                <span>
                  Balance Due:{" "}
                  <span className="text-primary">
                    ${overallTotals.due.toFixed(2)}
                  </span>
                </span>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Dialogs */}
      <ReimburseDialog
        claims={inProgressSelected}
        open={reimburseOpen}
        onClose={() => setReimburseOpen(false)}
        onSuccess={() => {
          setSelectedIds(new Set());
          invalidateClaims();
        }}
      />
      <RejectDialog
        claim={rejectClaim}
        onClose={() => setRejectClaim(null)}
        onSuccess={invalidateClaims}
      />
      <AddExpenseDialog
        open={addExpenseOpen}
        onClose={() => setAddExpenseOpen(false)}
        onSuccess={invalidateClaims}
        isAdmin={isAdmin}
        accounts={accounts}
      />
      <EditExpenseDialog
        claim={editClaim}
        onClose={() => setEditClaim(null)}
        onSuccess={invalidateClaims}
      />
      <WithdrawConfirmDialog
        claim={withdrawClaim}
        onClose={() => setWithdrawClaim(null)}
        onSuccess={invalidateClaims}
      />
    </div>
  );
}
