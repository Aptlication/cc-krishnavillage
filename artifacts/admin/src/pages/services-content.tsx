import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  useGetServiceFaqs,
  useCreateServiceFaq,
  useUpdateServiceFaq,
  useDeleteServiceFaq,
  useReorderServiceFaqs,
  useGetYogaSchedule,
  useDeleteYogaSchedule,
  useGetContactSettings,
  useUpdateContactSettings,
  getGetServiceFaqsQueryKey,
  getGetYogaScheduleQueryKey,
  getGetContactSettingsQueryKey,
  type FaqItem,
} from "@workspace/api-client-react";
import {
  HelpCircle,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Loader2,
  Upload,
  FileText,
  FileSpreadsheet,
  ExternalLink,
  FileX,
  Calendar,
  Phone,
} from "lucide-react";

function getFileKind(url: string): "image" | "pdf" | "spreadsheet" | "other" {
  const lower = url.toLowerCase().split("?")[0];
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(lower)) return "image";
  if (/\.pdf$/.test(lower)) return "pdf";
  if (/\.(xlsx|xls|csv)$/.test(lower)) return "spreadsheet";
  return "other";
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

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export default function ServicesContent() {
  const { session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: faqs, isLoading: faqsLoading } = useGetServiceFaqs();
  const { data: yogaSchedule, isLoading: yogaLoading } = useGetYogaSchedule();
  const { data: contactSettings, isLoading: contactLoading } = useGetContactSettings();

  const createFaq = useCreateServiceFaq();
  const updateFaq = useUpdateServiceFaq();
  const deleteFaq = useDeleteServiceFaq();
  const reorderFaqs = useReorderServiceFaqs();
  const deleteYoga = useDeleteYogaSchedule();
  const updateContact = useUpdateContactSettings();

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<FaqItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<FaqItem | null>(null);

  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");

  const [yogaUploading, setYogaUploading] = useState(false);
  const [confirmDeleteYoga, setConfirmDeleteYoga] = useState(false);
  const [confirmPublishYoga, setConfirmPublishYoga] = useState(false);
  const [pendingYogaFile, setPendingYogaFile] = useState<File | null>(null);

  const [driverPhoneEdit, setDriverPhoneEdit] = useState("");
  const [buggyPhoneEdit, setBuggyPhoneEdit] = useState("");
  const [contactEditing, setContactEditing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop state
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isAdmin = session?.role === "admin";

  function openEdit(item: FaqItem) {
    setEditItem(item);
    setEditQuestion(item.question);
    setEditAnswer(item.answer);
  }

  async function handleCreate() {
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    const nextOrder = faqs ? faqs.length : 0;
    try {
      await createFaq.mutateAsync({
        data: { question: newQuestion.trim(), answer: newAnswer.trim(), sortOrder: nextOrder },
      });
      await queryClient.invalidateQueries({ queryKey: getGetServiceFaqsQueryKey() });
      setNewQuestion("");
      setNewAnswer("");
      setAddOpen(false);
      toast({ title: "FAQ added" });
    } catch {
      toast({ title: "Failed to add FAQ", variant: "destructive" });
    }
  }

  async function handleUpdate() {
    if (!editItem || !editQuestion.trim() || !editAnswer.trim()) return;
    try {
      await updateFaq.mutateAsync({
        id: editItem.id,
        data: { question: editQuestion.trim(), answer: editAnswer.trim() },
      });
      await queryClient.invalidateQueries({ queryKey: getGetServiceFaqsQueryKey() });
      setEditItem(null);
      toast({ title: "FAQ updated" });
    } catch {
      toast({ title: "Failed to update FAQ", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!deleteItem) return;
    try {
      await deleteFaq.mutateAsync({ id: deleteItem.id });
      await queryClient.invalidateQueries({ queryKey: getGetServiceFaqsQueryKey() });
      setDeleteItem(null);
      toast({ title: "FAQ deleted" });
    } catch {
      toast({ title: "Failed to delete FAQ", variant: "destructive" });
    }
  }

  const handleDragStart = useCallback((idx: number) => {
    dragIndexRef.current = idx;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (fromIdx === null || fromIdx === dropIdx || !faqs) return;
    const sorted = [...faqs].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(dropIdx, 0, moved);
    const order = sorted.map((f) => f.id);
    try {
      await reorderFaqs.mutateAsync({ data: { order } });
      await queryClient.invalidateQueries({ queryKey: getGetServiceFaqsQueryKey() });
    } catch {
      toast({ title: "Failed to reorder", variant: "destructive" });
    }
  }, [faqs, reorderFaqs, queryClient, toast]);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);

  function handleYogaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
    ];
    if (!allowed.includes(file.type)) {
      toast({ title: "Please upload an image file (JPEG, PNG, GIF, or WebP)", variant: "destructive" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setPendingYogaFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDeployYoga() {
    if (!pendingYogaFile) return;

    setYogaUploading(true);
    try {
      const token = getToken();
      const formData = new FormData();
      formData.append("file", pendingYogaFile);

      const resp = await fetch(`/api/services/yoga-schedule`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Upload failed");
      }

      await queryClient.invalidateQueries({ queryKey: getGetYogaScheduleQueryKey() });
      setPendingYogaFile(null);
      toast({ title: "Yoga schedule deployed — guests will see the new schedule now." });
    } catch (err) {
      toast({
        title: "Deploy failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setYogaUploading(false);
    }
  }

  async function handleDeleteYoga() {
    try {
      await deleteYoga.mutateAsync({} as never);
      await queryClient.invalidateQueries({ queryKey: getGetYogaScheduleQueryKey() });
      setConfirmDeleteYoga(false);
      toast({ title: "Yoga schedule file removed" });
    } catch {
      toast({ title: "Failed to remove file", variant: "destructive" });
    }
  }

  function openContactEdit() {
    setDriverPhoneEdit(contactSettings?.driverPhone ?? "");
    setBuggyPhoneEdit(contactSettings?.buggyPhone ?? "");
    setContactEditing(true);
  }

  async function handleContactSave() {
    try {
      await updateContact.mutateAsync({
        data: {
          driverPhone: driverPhoneEdit.trim() === "" ? "" : driverPhoneEdit.trim(),
          buggyPhone: buggyPhoneEdit.trim() === "" ? "" : buggyPhoneEdit.trim(),
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetContactSettingsQueryKey() });
      setContactEditing(false);
      toast({ title: "Contact numbers updated" });
    } catch {
      toast({ title: "Failed to update contact numbers", variant: "destructive" });
    }
  }

  const sortedFaqs = faqs
    ? [...faqs].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    : [];

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Services Content</h1>
          <p className="text-muted-foreground mt-1">
            Manage the FAQs and yoga schedule that guests see in the mobile app.
          </p>
          {!isAdmin && (
            <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-block">
              Admin access required to edit content.
            </div>
          )}
        </div>

        {/* ── FAQs ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Guest FAQs</CardTitle>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Add FAQ
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {faqsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </div>
            ) : sortedFaqs.length === 0 ? (
              <div className="text-muted-foreground text-sm py-6 text-center">
                No FAQ items yet. {isAdmin ? "Click Add FAQ to create the first one." : ""}
              </div>
            ) : (
              <div className="space-y-2">
                {sortedFaqs.map((item, idx) => (
                  <div
                    key={item.id}
                    draggable={isAdmin}
                    onDragStart={isAdmin ? () => handleDragStart(idx) : undefined}
                    onDragOver={isAdmin ? (e) => handleDragOver(e, idx) : undefined}
                    onDrop={isAdmin ? (e) => handleDrop(e, idx) : undefined}
                    onDragEnd={isAdmin ? handleDragEnd : undefined}
                    className={[
                      "flex items-start gap-3 rounded-md border p-3 bg-card transition-colors",
                      isAdmin ? "cursor-default" : "",
                      dragOverIndex === idx && dragIndexRef.current !== idx
                        ? "border-primary bg-primary/5"
                        : "border-border",
                    ].join(" ")}
                  >
                    <div className="flex items-center mt-0.5 shrink-0">
                      <GripVertical
                        className={[
                          "w-4 h-4",
                          isAdmin
                            ? "text-muted-foreground cursor-grab active:cursor-grabbing"
                            : "text-muted-foreground/40",
                        ].join(" ")}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground leading-snug">{item.question}</p>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{item.answer}</p>
                    </div>

                    {isAdmin && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(item)}
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteItem(item)}
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Contact Numbers ──────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Contact Numbers</CardTitle>
            </div>
            {isAdmin && !contactEditing && (
              <Button size="sm" variant="outline" onClick={openContactEdit}>
                <Pencil className="w-4 h-4 mr-1" />
                Edit
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {contactLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </div>
            ) : contactEditing ? (
              <div className="space-y-4 max-w-sm">
                <div className="space-y-1.5">
                  <Label>Driver Phone (Charana)</Label>
                  <Input
                    value={driverPhoneEdit}
                    onChange={(e) => setDriverPhoneEdit(e.target.value)}
                    placeholder="+61429725165"
                  />
                  <p className="text-xs text-muted-foreground">E.164 format recommended, e.g. +61412345678</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Buggy Hire / Reception Phone</Label>
                  <Input
                    value={buggyPhoneEdit}
                    onChange={(e) => setBuggyPhoneEdit(e.target.value)}
                    placeholder="+61429725165"
                  />
                  <p className="text-xs text-muted-foreground">E.164 format recommended, e.g. +61412345678</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleContactSave}
                    disabled={updateContact.isPending}
                    size="sm"
                  >
                    {updateContact.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setContactEditing(false)}
                    disabled={updateContact.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Driver (Charana)</p>
                    <p className="text-sm font-medium text-foreground">
                      {contactSettings?.driverPhone ?? <span className="text-muted-foreground italic">Not set — using default</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 py-2">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Buggy Hire / Reception</p>
                    <p className="text-sm font-medium text-foreground">
                      {contactSettings?.buggyPhone ?? <span className="text-muted-foreground italic">Not set — using default</span>}
                    </p>
                  </div>
                </div>
                {contactSettings?.updatedAt && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Last updated: {new Date(contactSettings.updatedAt).toLocaleString()}
                  </p>
                )}
                {!isAdmin && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                    Admin access required to edit.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Yoga Schedule ────────────────────────────────────────────── */}
        <Card data-section="yoga-schedule">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-green-600" />
              <CardTitle className="text-lg">Yoga Schedule</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {yogaLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </div>
            ) : yogaSchedule?.url ? (
              <div className="space-y-4">
                {(() => {
                  const kind = getFileKind(yogaSchedule.url);
                  if (kind === "image") {
                    return (
                      <div className="rounded-md overflow-hidden border border-border bg-muted/30 max-w-lg">
                        <img
                          src={yogaSchedule.url}
                          alt="Current yoga schedule"
                          className="w-full object-contain"
                        />
                      </div>
                    );
                  }
                  return (
                    <div className="flex items-center gap-3 p-4 rounded-md border border-border bg-muted/20 max-w-lg">
                      {kind === "pdf" ? (
                        <FileText className="w-8 h-8 text-red-500 shrink-0" />
                      ) : (
                        <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {kind === "pdf" ? "PDF" : "Spreadsheet"} — Yoga Schedule
                        </p>
                        <a
                          href={yogaSchedule.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open file
                        </a>
                      </div>
                    </div>
                  );
                })()}
                {yogaSchedule.updatedAt && (
                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(yogaSchedule.updatedAt).toLocaleString()}
                  </p>
                )}
                {isAdmin && (
                  <div className="space-y-3">
                    {pendingYogaFile && (
                      <div className="flex items-center gap-2 p-3 rounded-md border border-green-200 bg-green-50 max-w-lg flex-wrap">
                        <FileText className="w-4 h-4 text-green-700 shrink-0" />
                        <span className="text-sm text-green-800 font-medium flex-1 min-w-0 truncate">
                          {pendingYogaFile.name}
                        </span>
                      </div>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={yogaUploading}
                      >
                        <Upload className="w-4 h-4 mr-1.5" />
                        Replace Image
                      </Button>
                      {pendingYogaFile && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setConfirmPublishYoga(true)}
                            disabled={yogaUploading}
                            className="bg-green-700 hover:bg-green-800 text-white"
                          >
                            {yogaUploading ? (
                              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4 mr-1.5" />
                            )}
                            Deploy Schedule
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingYogaFile(null)}
                            disabled={yogaUploading}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive border-destructive/30"
                        onClick={() => setConfirmDeleteYoga(true)}
                        disabled={yogaUploading}
                      >
                        <FileX className="w-4 h-4 mr-1.5" />
                        Remove File
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border border-dashed border-border bg-muted/20 flex flex-col items-center justify-center py-12 max-w-lg">
                  <Calendar className="w-10 h-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground text-center">
                    No yoga schedule image uploaded yet.
                    <br />
                    Guests will see the built-in schedule until an image is uploaded.
                  </p>
                </div>
                {isAdmin && (
                  <div className="space-y-3">
                    {pendingYogaFile && (
                      <div className="flex items-center gap-2 p-3 rounded-md border border-green-200 bg-green-50 max-w-lg flex-wrap">
                        <FileText className="w-4 h-4 text-green-700 shrink-0" />
                        <span className="text-sm text-green-800 font-medium flex-1 min-w-0 truncate">
                          {pendingYogaFile.name}
                        </span>
                      </div>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={yogaUploading}
                      >
                        <Upload className="w-4 h-4 mr-1.5" />
                        Upload Schedule Image
                      </Button>
                      {pendingYogaFile && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setConfirmPublishYoga(true)}
                            disabled={yogaUploading}
                            className="bg-green-700 hover:bg-green-800 text-white"
                          >
                            {yogaUploading ? (
                              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4 mr-1.5" />
                            )}
                            Deploy Schedule
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingYogaFile(null)}
                            disabled={yogaUploading}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
              className="hidden"
              onChange={handleYogaUpload}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Add FAQ Dialog ───────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add FAQ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Question</Label>
              <Input
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="e.g. What are the check-in times?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Answer</Label>
              <Textarea
                value={newAnswer}
                onChange={(e) => setNewAnswer(e.target.value)}
                placeholder="Write the answer here…"
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newQuestion.trim() || !newAnswer.trim() || createFaq.isPending}
            >
              {createFaq.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Add FAQ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit FAQ Dialog ──────────────────────────────────────────── */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit FAQ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Question</Label>
              <Input
                value={editQuestion}
                onChange={(e) => setEditQuestion(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Answer</Label>
              <Textarea
                value={editAnswer}
                onChange={(e) => setEditAnswer(e.target.value)}
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button
              onClick={handleUpdate}
              disabled={!editQuestion.trim() || !editAnswer.trim() || updateFaq.isPending}
            >
              {updateFaq.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete FAQ Confirm ───────────────────────────────────────── */}
      <Dialog open={!!deleteItem} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete FAQ</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete this FAQ? This cannot be undone.
          </p>
          {deleteItem && (
            <p className="text-sm font-medium border rounded-md px-3 py-2 bg-muted/30">
              {deleteItem.question}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteFaq.isPending}
            >
              {deleteFaq.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Publish Yoga Schedule Confirm ────────────────────────────── */}
      <Dialog open={confirmPublishYoga} onOpenChange={(o) => { if (!o) setConfirmPublishYoga(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Yoga Schedule to Guests?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Guests will see the new schedule immediately once published. This will replace the current schedule.
            </p>
            {pendingYogaFile && (
              <p className="text-sm font-medium border rounded-md px-3 py-2 bg-muted/30 truncate">
                {pendingYogaFile.name}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPublishYoga(false)}>Cancel</Button>
            <Button
              className="bg-green-700 hover:bg-green-800 text-white"
              onClick={async () => {
                setConfirmPublishYoga(false);
                await handleDeployYoga();
              }}
              disabled={yogaUploading}
            >
              {yogaUploading && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Yoga Schedule Confirm ─────────────────────────────── */}
      <Dialog open={confirmDeleteYoga} onOpenChange={setConfirmDeleteYoga}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Yoga Schedule File</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will remove the current yoga schedule file. Guests will see the built-in schedule again until a new file is uploaded.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteYoga(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteYoga}
              disabled={deleteYoga.isPending}
            >
              {deleteYoga.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Remove File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
