import { Router } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  expenseClaimsTable,
  expenseReimbursementsTable,
  maintenanceReportsTable,
  staffAccountsTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireStaffAuth, requireAdminRole } from "../middlewares/staffAuth";
import type { StaffRequest, TenantRequest } from "../middlewares/staffAuth";
import { objectStorageClient } from "../lib/objectStorage";
import { sendNewExpenseClaimEmail, sendReimbursementEmail } from "../lib/email";
import { logger } from "../lib/logger";

const expensesRouter = Router();

/**
 * Returns true when the DB error is a unique-constraint violation (PG code 23505).
 * Drizzle ORM wraps the native pg error so we must walk the cause chain.
 */
function isUniqueConstraintError(err: unknown): boolean {
  let target: unknown = err;
  while (typeof target === "object" && target !== null) {
    if ("code" in target && (target as Record<string, unknown>).code === "23505") {
      return true;
    }
    target = (target as Record<string, unknown>).cause ?? null;
  }
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Alias for the staff member who performed the reimbursement
const reimbursedByStaff = alias(staffAccountsTable, "reimbursed_by_staff");

// ─── Helper: fetch full ExpenseClaim shape (with staffDisplayName/email) ──────
async function getFullClaim(claimId: number, tenantId: number) {
  const [row] = await db
    .select({
      id: expenseClaimsTable.id,
      tenantId: expenseClaimsTable.tenantId,
      staffId: expenseClaimsTable.staffId,
      staffDisplayName: staffAccountsTable.displayName,
      staffEmail: staffAccountsTable.email,
      maintenanceReportId: expenseClaimsTable.maintenanceReportId,
      claimDate: expenseClaimsTable.claimDate,
      description: expenseClaimsTable.description,
      project: expenseClaimsTable.project,
      amountAud: expenseClaimsTable.amountAud,
      receiptUrls: expenseClaimsTable.receiptUrls,
      status: expenseClaimsTable.status,
      rejectionNote: expenseClaimsTable.rejectionNote,
      createdAt: expenseClaimsTable.createdAt,
      reimbursedByName: reimbursedByStaff.displayName,
      reimbursedAt: expenseReimbursementsTable.reimbursedAt,
    })
    .from(expenseClaimsTable)
    .innerJoin(staffAccountsTable, eq(expenseClaimsTable.staffId, staffAccountsTable.id))
    .leftJoin(expenseReimbursementsTable, eq(expenseClaimsTable.id, expenseReimbursementsTable.claimId))
    .leftJoin(reimbursedByStaff, eq(expenseReimbursementsTable.reimbursedByStaffId, reimbursedByStaff.id))
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, claimId)));

  if (!row) return null;
  return {
    ...row,
    staffEmail: row.staffEmail ?? null,
    amountAud: row.amountAud?.toString() ?? "0",
    createdAt: row.createdAt.toISOString(),
    reimbursedByName: row.reimbursedByName ?? null,
    reimbursedAt: row.reimbursedAt ? row.reimbursedAt.toISOString() : null,
  };
}

// ─── Upload receipt file (multipart) ─────────────────────────────────────────
// POST /api/expenses/upload
// Accepts multipart/form-data with field "file"; persists to App Storage;
// returns { url } pointing to the serving endpoint.
expensesRouter.post(
  "/expenses/upload",
  requireStaffAuth,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded — send a multipart/form-data request with field 'file'" });
      return;
    }

    // Explicit allowlist only — SVG and other active-content types are
    // intentionally excluded to prevent stored XSS via public serving.
    const ALLOWED_MIME_TYPES = new Set([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
    ]);
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      res.status(400).json({ error: "Only JPEG, PNG, GIF, WebP images and PDFs are accepted" });
      return;
    }

    // Derive bucket and prefix entirely from PUBLIC_OBJECT_SEARCH_PATHS
    // (format: "/<bucketName>/<prefix>", comma-separated — use first entry).
    // Do NOT rely on DEFAULT_OBJECT_STORAGE_BUCKET_ID; the public search path
    // already encodes both the bucket and the object prefix.
    const publicSearchPaths = process.env["PUBLIC_OBJECT_SEARCH_PATHS"] ?? "";
    const firstPublicPath = publicSearchPaths.split(",")[0]?.trim() ?? "";
    if (!firstPublicPath) {
      res.status(503).json({ error: "Object storage not configured — PUBLIC_OBJECT_SEARCH_PATHS must be set" });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    const key = `receipts/${randomUUID()}${ext}`;

    try {
      // Parse the public search path into bucket + prefix
      // e.g. "/replit-objstore-xxx/public" → bucketName="replit-objstore-xxx", prefix="public"
      const normalized = firstPublicPath.startsWith("/") ? firstPublicPath.slice(1) : firstPublicPath;
      const firstSlash = normalized.indexOf("/");
      const bucketName = firstSlash > 0 ? normalized.slice(0, firstSlash) : normalized;
      const gcsPrefix = firstSlash > 0 ? normalized.slice(firstSlash + 1) : "";
      const gcsObjectName = gcsPrefix ? `${gcsPrefix}/${key}` : key; // e.g. "public/receipts/uuid.jpg"

      const bucket = objectStorageClient.bucket(bucketName);
      await bucket.file(gcsObjectName).save(file.buffer, {
        contentType: file.mimetype,
        resumable: false,
      });

      // Serving: GET /api/storage/public-objects/<key> (no auth required)
      // searchPublicObject("receipts/uuid.jpg") → searches "<firstPublicPath>/receipts/uuid.jpg"
      // = "/replit-objstore-xxx/public/receipts/uuid.jpg" → bucket.file("public/receipts/uuid.jpg") ✓
      const url = `/api/storage/public-objects/${key}`;
      res.json({ url });
    } catch (err) {
      logger.error({ err }, "Failed to upload receipt to App Storage");
      res.status(500).json({ error: "Failed to store file" });
    }
  }
);

// ─── Badge data (minimal, any tenant staff) ───────────────────────────────────
// GET /api/expenses/badges?maintenanceReportIds=1,2,3
// Returns only the fields needed for the maintenance-card badge so non-admin
// staff can see that a report has a linked expense without exposing the full
// claim payload (no staffEmail, no receiptUrls).
expensesRouter.get("/expenses/badges", requireStaffAuth, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const { maintenanceReportIds: raw } = req.query as { maintenanceReportIds?: string };
  const reportIds: number[] = raw
    ? raw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    : [];

  if (reportIds.length === 0) {
    res.json([]);
    return;
  }

  const rows = await db
    .select({
      maintenanceReportId: expenseClaimsTable.maintenanceReportId,
      amountAud: expenseClaimsTable.amountAud,
      description: expenseClaimsTable.description,
      project: expenseClaimsTable.project,
    })
    .from(expenseClaimsTable)
    .where(
      and(
        eq(expenseClaimsTable.tenantId, tenantId),
        inArray(expenseClaimsTable.maintenanceReportId, reportIds),
      ),
    )
    .orderBy(desc(expenseClaimsTable.id));

  // Deduplicate: keep only the most recent claim per maintenance report.
  // Ordering by id DESC means the first occurrence of each reportId is the newest.
  const seen = new Set<number>();
  const deduplicated = rows.filter((r) => {
    if (r.maintenanceReportId == null || seen.has(r.maintenanceReportId)) return false;
    seen.add(r.maintenanceReportId);
    return true;
  });

  res.json(
    deduplicated.map((r) => ({
      maintenanceReportId: r.maintenanceReportId,
      amountAud: r.amountAud?.toString() ?? "0",
      description: r.description ?? "",
      project: r.project ?? null,
    })),
  );
});

// ─── List claims ──────────────────────────────────────────────────────────────
// GET /api/expenses?staffId=&status=
expensesRouter.get("/expenses", requireStaffAuth, async (req, res) => {
  const staff = (req as unknown as StaffRequest).staff;
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const { staffId: staffIdParam, status } = req.query as {
    staffId?: string;
    status?: string;
  };

  const conditions = [eq(expenseClaimsTable.tenantId, tenantId)];

  if (staff.role !== "admin") {
    conditions.push(eq(expenseClaimsTable.staffId, staff.staffId));
  } else if (staffIdParam) {
    const sid = parseInt(staffIdParam, 10);
    if (!isNaN(sid)) conditions.push(eq(expenseClaimsTable.staffId, sid));
  }

  const validStatuses = ["claimed", "pending", "in_progress", "reimbursed", "rejected"];
  if (status && validStatuses.includes(status)) {
    conditions.push(eq(expenseClaimsTable.status, status));
  }

  const claims = await db
    .select({
      id: expenseClaimsTable.id,
      tenantId: expenseClaimsTable.tenantId,
      staffId: expenseClaimsTable.staffId,
      staffDisplayName: staffAccountsTable.displayName,
      staffEmail: staffAccountsTable.email,
      maintenanceReportId: expenseClaimsTable.maintenanceReportId,
      claimDate: expenseClaimsTable.claimDate,
      description: expenseClaimsTable.description,
      project: expenseClaimsTable.project,
      amountAud: expenseClaimsTable.amountAud,
      receiptUrls: expenseClaimsTable.receiptUrls,
      status: expenseClaimsTable.status,
      rejectionNote: expenseClaimsTable.rejectionNote,
      createdAt: expenseClaimsTable.createdAt,
      reimbursedByName: reimbursedByStaff.displayName,
      reimbursedAt: expenseReimbursementsTable.reimbursedAt,
    })
    .from(expenseClaimsTable)
    .innerJoin(staffAccountsTable, eq(expenseClaimsTable.staffId, staffAccountsTable.id))
    .leftJoin(expenseReimbursementsTable, eq(expenseClaimsTable.id, expenseReimbursementsTable.claimId))
    .leftJoin(reimbursedByStaff, eq(expenseReimbursementsTable.reimbursedByStaffId, reimbursedByStaff.id))
    .where(and(...conditions))
    .orderBy(desc(expenseClaimsTable.createdAt));

  res.json(
    claims.map((c) => ({
      ...c,
      staffEmail: c.staffEmail ?? null,
      amountAud: c.amountAud?.toString() ?? "0",
      createdAt: c.createdAt.toISOString(),
      reimbursedByName: c.reimbursedByName ?? null,
      reimbursedAt: c.reimbursedAt ? c.reimbursedAt.toISOString() : null,
    }))
  );
});

// ─── Create claim ─────────────────────────────────────────────────────────────
// POST /api/expenses
expensesRouter.post("/expenses", requireStaffAuth, async (req, res) => {
  const staff = (req as unknown as StaffRequest).staff;
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const {
    claimDate,
    description,
    project,
    amountAud,
    receiptUrls,
    maintenanceReportId,
    staffId: bodyStaffId,
  } = req.body as {
    claimDate?: string;
    description?: string;
    project?: string;
    amountAud?: string | number;
    receiptUrls?: string[];
    maintenanceReportId?: number;
    staffId?: number;
  };

  if (!claimDate || !description || amountAud == null) {
    res.status(400).json({ error: "claimDate, description, and amountAud are required" });
    return;
  }

  const parsedAmount = parseFloat(String(amountAud));
  if (isNaN(parsedAmount) || parsedAmount < 0) {
    res.status(400).json({ error: "amountAud must be a non-negative number" });
    return;
  }

  // Admins may create on behalf of another staff member — validate they belong to this tenant
  let targetStaffId = staff.staffId;
  if (staff.role === "admin" && bodyStaffId && bodyStaffId !== staff.staffId) {
    const [targetStaff] = await db
      .select({ id: staffAccountsTable.id })
      .from(staffAccountsTable)
      .where(and(eq(staffAccountsTable.id, bodyStaffId), eq(staffAccountsTable.tenantId, tenantId)));
    if (!targetStaff) {
      res.status(404).json({ error: "Target staff member not found in this tenant" });
      return;
    }
    targetStaffId = bodyStaffId;
  }

  // Validate maintenanceReportId belongs to the same tenant before linking
  if (maintenanceReportId != null) {
    const [report] = await db
      .select({ id: maintenanceReportsTable.id })
      .from(maintenanceReportsTable)
      .where(and(
        eq(maintenanceReportsTable.id, maintenanceReportId),
        eq(maintenanceReportsTable.tenantId, tenantId),
      ));
    if (!report) {
      res.status(404).json({ error: "Maintenance report not found in this tenant" });
      return;
    }
  }

  const [inserted] = await db
    .insert(expenseClaimsTable)
    .values({
      tenantId,
      staffId: targetStaffId,
      maintenanceReportId: maintenanceReportId ?? null,
      claimDate,
      description: description.trim(),
      project: project?.trim() ?? null,
      amountAud: parsedAmount.toFixed(2),
      receiptUrls: receiptUrls ?? [],
    })
    .returning({ id: expenseClaimsTable.id });

  const full = await getFullClaim(inserted.id, tenantId);
  if (!full) { res.status(500).json({ error: "Failed to retrieve created claim" }); return; }

  // Notify accounting email of new claim — fire-and-forget, non-blocking
  const accountingEmail = process.env["ACCOUNTING_EMAIL"];
  if (accountingEmail) {
    const adminOrigin = (process.env["ADMIN_ORIGIN"] ?? "https://krishnavillage.com.au").replace(/\/$/, "");
    const adminExpensesUrl = `${adminOrigin}/admin/expenses`;
    sendNewExpenseClaimEmail({
      toEmail: accountingEmail,
      claimantName: full.staffDisplayName,
      amountAud: full.amountAud,
      claimDate: full.claimDate,
      description: full.description,
      project: full.project,
      adminExpensesUrl,
    }).catch((err) => logger.error({ err }, "Error sending new expense claim email"));
  } else {
    logger.warn("ACCOUNTING_EMAIL not set — skipping new expense claim notification email");
  }

  res.status(201).json(full);
});

// ─── Update claim ─────────────────────────────────────────────────────────────
// PATCH /api/expenses/:id
expensesRouter.patch("/expenses/:id", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid claim ID" }); return; }

  const staff = (req as unknown as StaffRequest).staff;
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const [existing] = await db
    .select()
    .from(expenseClaimsTable)
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }

  if (staff.role !== "admin" && existing.staffId !== staff.staffId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (staff.role !== "admin") {
    if (existing.status !== "claimed" && existing.status !== "pending") {
      res.status(409).json({ error: "Claims can only be edited while in Claimed status" });
      return;
    }
  } else if (existing.status === "reimbursed") {
    res.status(409).json({ error: "Cannot edit a reimbursed claim" });
    return;
  }

  const { claimDate, description, project, amountAud, receiptUrls } = req.body as {
    claimDate?: string;
    description?: string;
    project?: string;
    amountAud?: string | number;
    receiptUrls?: string[];
  };

  const updates: Record<string, unknown> = {};

  if (claimDate !== undefined) {
    if (!claimDate || typeof claimDate !== "string") {
      res.status(400).json({ error: "claimDate must be a non-empty string" });
      return;
    }
    updates["claimDate"] = claimDate;
  }

  if (description !== undefined) {
    if (!description || typeof description !== "string" || !description.trim()) {
      res.status(400).json({ error: "description must be a non-empty string" });
      return;
    }
    updates["description"] = description.trim();
  }

  if (project !== undefined) {
    updates["project"] = project?.trim() ?? null;
  }

  if (amountAud !== undefined) {
    if (amountAud == null) {
      res.status(400).json({ error: "amountAud cannot be null" });
      return;
    }
    const parsed = parseFloat(String(amountAud));
    if (isNaN(parsed) || parsed < 0) {
      res.status(400).json({ error: "amountAud must be a non-negative number" });
      return;
    }
    updates["amountAud"] = parsed.toFixed(2);
  }

  if (receiptUrls !== undefined) {
    if (!Array.isArray(receiptUrls)) {
      res.status(400).json({ error: "receiptUrls must be an array" });
      return;
    }
    updates["receiptUrls"] = receiptUrls;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  await db
    .update(expenseClaimsTable)
    .set(updates)
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  const full = await getFullClaim(id, tenantId);
  if (!full) { res.status(404).json({ error: "Claim not found after update" }); return; }
  res.json(full);
});

// ─── Withdraw claim (claimed → withdrawn, owner only) ─────────────────────────
// PATCH /api/expenses/:id/withdraw
expensesRouter.patch("/expenses/:id/withdraw", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid claim ID" }); return; }

  const staff = (req as unknown as StaffRequest).staff;
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const [existing] = await db
    .select()
    .from(expenseClaimsTable)
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }

  if (staff.role !== "admin" && existing.staffId !== staff.staffId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (existing.status !== "claimed" && existing.status !== "pending") {
    res.status(409).json({ error: "Only Claimed expenses can be withdrawn" });
    return;
  }

  await db
    .update(expenseClaimsTable)
    .set({ status: "withdrawn" })
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  const full = await getFullClaim(id, tenantId);
  if (!full) { res.status(404).json({ error: "Claim not found after update" }); return; }
  res.json(full);
});

// ─── Acknowledge claim (claimed → in_progress) ────────────────────────────────
// POST /api/expenses/:id/acknowledge
expensesRouter.post("/expenses/:id/acknowledge", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid claim ID" }); return; }

  const tenantId = (req as unknown as TenantRequest).tenantId;

  const [existing] = await db
    .select()
    .from(expenseClaimsTable)
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }

  if (existing.status !== "claimed" && existing.status !== "pending") {
    res.status(409).json({ error: `Cannot acknowledge a claim with status '${existing.status}'` });
    return;
  }

  await db
    .update(expenseClaimsTable)
    .set({ status: "in_progress" })
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  const full = await getFullClaim(id, tenantId);
  if (!full) { res.status(404).json({ error: "Claim not found after update" }); return; }
  res.json(full);
});

// ─── Reimburse claim ──────────────────────────────────────────────────────────
// POST /api/expenses/:id/reimburse
expensesRouter.post("/expenses/:id/reimburse", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid claim ID" }); return; }

  const staff = (req as unknown as StaffRequest).staff;
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const [claim] = await db
    .select({
      claim: expenseClaimsTable,
      staffEmail: staffAccountsTable.email,
      staffDisplayName: staffAccountsTable.displayName,
    })
    .from(expenseClaimsTable)
    .innerJoin(staffAccountsTable, eq(expenseClaimsTable.staffId, staffAccountsTable.id))
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }
  if (claim.claim.status === "reimbursed") {
    res.status(409).json({ error: "Claim is already reimbursed" });
    return;
  }
  if (claim.claim.status === "rejected") {
    res.status(409).json({ error: "Cannot reimburse a rejected claim" });
    return;
  }

  const { notes } = req.body as { notes?: string };
  const trimmedNotes = notes?.trim() ?? null;

  // Wrap insert + status update in a transaction so concurrent reimburse
  // calls are safe. The unique index on expense_reimbursements.claimId
  // provides the DB-level uniqueness guarantee.
  let reimbursement: typeof expenseReimbursementsTable.$inferSelect;
  try {
    reimbursement = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(expenseReimbursementsTable)
        .values({
          tenantId,
          claimId: id,
          reimbursedByStaffId: staff.staffId,
          notes: trimmedNotes,
        })
        .returning();

      await tx
        .update(expenseClaimsTable)
        .set({ status: "reimbursed" })
        .where(eq(expenseClaimsTable.id, id));

      return inserted;
    });
  } catch (err: unknown) {
    // Unique-constraint violation → concurrent reimburse already succeeded
    if (isUniqueConstraintError(err)) {
      res.status(409).json({ error: "Claim is already reimbursed" });
      return;
    }
    throw err;
  }

  // Send email outside the transaction (network I/O; failure is non-fatal)
  let emailSent = false;
  if (claim.staffEmail) {
    emailSent = await sendReimbursementEmail({
      toEmail: claim.staffEmail,
      toName: claim.staffDisplayName,
      claimDescription: claim.claim.description,
      claimDate: claim.claim.claimDate,
      project: claim.claim.project,
      amountAud: claim.claim.amountAud?.toString() ?? "0",
      reimbursedByName: staff.displayName,
      notes: trimmedNotes,
    });

    if (emailSent) {
      await db
        .update(expenseReimbursementsTable)
        .set({ emailSent: true })
        .where(eq(expenseReimbursementsTable.id, reimbursement.id));
    }
  }

  res.json({
    reimbursementId: reimbursement.id,
    claimId: id,
    reimbursedAt: reimbursement.reimbursedAt.toISOString(),
    emailSent,
  });
});

// ─── Reject claim ─────────────────────────────────────────────────────────────
// POST /api/expenses/:id/reject
expensesRouter.post("/expenses/:id/reject", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid claim ID" }); return; }

  const tenantId = (req as unknown as TenantRequest).tenantId;
  const { note } = req.body as { note?: string };

  const [existing] = await db
    .select()
    .from(expenseClaimsTable)
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }
  if (existing.status === "reimbursed") {
    res.status(409).json({ error: "Cannot reject a reimbursed claim" });
    return;
  }

  await db
    .update(expenseClaimsTable)
    .set({ status: "rejected", rejectionNote: note?.trim() ?? null })
    .where(and(eq(expenseClaimsTable.tenantId, tenantId), eq(expenseClaimsTable.id, id)));

  const full = await getFullClaim(id, tenantId);
  if (!full) { res.status(404).json({ error: "Claim not found after update" }); return; }
  res.json(full);
});

// ─── Count pending claims (for sidebar badge) ─────────────────────────────────
// GET /api/expenses/pending-count
expensesRouter.get("/expenses/pending-count", requireStaffAuth, requireAdminRole, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const rows = await db
    .select({ id: expenseClaimsTable.id })
    .from(expenseClaimsTable)
    .where(and(
      eq(expenseClaimsTable.tenantId, tenantId),
      inArray(expenseClaimsTable.status, ["claimed", "in_progress"]),
    ));

  res.json({ count: rows.length });
});

export default expensesRouter;
