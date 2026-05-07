import { Router } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { faqItemsTable, serviceAssetsTable } from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireStaffAuth, requireAdminRole, resolveTenant } from "../middlewares/staffAuth";
import type { StaffRequest, TenantRequest } from "../middlewares/staffAuth";
import { objectStorageClient, ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const objectStorageService = new ObjectStorageService();

const servicesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ─── GET /services/faqs (public — guests fetch this) ──────────────────────────
servicesRouter.get("/services/faqs", resolveTenant, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const items = await db
    .select()
    .from(faqItemsTable)
    .where(eq(faqItemsTable.tenantId, tenantId))
    .orderBy(asc(faqItemsTable.sortOrder), asc(faqItemsTable.id));

  res.json(items.map((item) => ({
    id: item.id,
    question: item.question,
    answer: item.answer,
    sortOrder: item.sortOrder,
  })));
});

// ─── POST /services/faqs (admin only) ─────────────────────────────────────────
servicesRouter.post("/services/faqs", requireStaffAuth, requireAdminRole, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const { question, answer, sortOrder } = req.body as {
    question?: string;
    answer?: string;
    sortOrder?: number;
  };

  if (!question?.trim() || !answer?.trim()) {
    res.status(400).json({ error: "question and answer are required" });
    return;
  }

  const [inserted] = await db
    .insert(faqItemsTable)
    .values({
      tenantId,
      question: question.trim(),
      answer: answer.trim(),
      sortOrder: sortOrder ?? 0,
    })
    .returning();

  res.status(201).json({
    id: inserted.id,
    question: inserted.question,
    answer: inserted.answer,
    sortOrder: inserted.sortOrder,
  });
});

// ─── PATCH /services/faqs/:id ─────────────────────────────────────────────────
servicesRouter.patch("/services/faqs/:id", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid FAQ ID" }); return; }

  const tenantId = (req as unknown as TenantRequest).tenantId;

  const [existing] = await db
    .select()
    .from(faqItemsTable)
    .where(and(eq(faqItemsTable.id, id), eq(faqItemsTable.tenantId, tenantId)));

  if (!existing) { res.status(404).json({ error: "FAQ not found" }); return; }

  const { question, answer, sortOrder } = req.body as {
    question?: string;
    answer?: string;
    sortOrder?: number;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (question !== undefined) {
    if (!question.trim()) { res.status(400).json({ error: "question must not be empty" }); return; }
    updates["question"] = question.trim();
  }
  if (answer !== undefined) {
    if (!answer.trim()) { res.status(400).json({ error: "answer must not be empty" }); return; }
    updates["answer"] = answer.trim();
  }
  if (sortOrder !== undefined) {
    updates["sortOrder"] = sortOrder;
  }

  const [updated] = await db
    .update(faqItemsTable)
    .set(updates)
    .where(and(eq(faqItemsTable.id, id), eq(faqItemsTable.tenantId, tenantId)))
    .returning();

  res.json({
    id: updated.id,
    question: updated.question,
    answer: updated.answer,
    sortOrder: updated.sortOrder,
  });
});

// ─── DELETE /services/faqs/:id ────────────────────────────────────────────────
servicesRouter.delete("/services/faqs/:id", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid FAQ ID" }); return; }

  const tenantId = (req as unknown as TenantRequest).tenantId;

  const [existing] = await db
    .select()
    .from(faqItemsTable)
    .where(and(eq(faqItemsTable.id, id), eq(faqItemsTable.tenantId, tenantId)));

  if (!existing) { res.status(404).json({ error: "FAQ not found" }); return; }

  await db
    .delete(faqItemsTable)
    .where(and(eq(faqItemsTable.id, id), eq(faqItemsTable.tenantId, tenantId)));

  res.json({ ok: true });
});

// ─── Reorder FAQs: POST /services/faqs/reorder ────────────────────────────────
servicesRouter.post("/services/faqs/reorder", requireStaffAuth, requireAdminRole, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const { order } = req.body as { order?: number[] };

  if (!Array.isArray(order) || order.some((v) => typeof v !== "number")) {
    res.status(400).json({ error: "order must be an array of FAQ IDs" });
    return;
  }

  await Promise.all(
    order.map((id, idx) =>
      db
        .update(faqItemsTable)
        .set({ sortOrder: idx, updatedAt: new Date() })
        .where(and(eq(faqItemsTable.id, id), eq(faqItemsTable.tenantId, tenantId)))
    )
  );

  res.json({ ok: true });
});

// ─── GET /services/yoga-schedule (public — guests fetch this) ─────────────────
servicesRouter.get("/services/yoga-schedule", resolveTenant, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const [asset] = await db
    .select()
    .from(serviceAssetsTable)
    .where(
      and(
        eq(serviceAssetsTable.tenantId, tenantId),
        eq(serviceAssetsTable.assetKey, "yoga_schedule")
      )
    );

  if (!asset) {
    res.json({ url: null });
    return;
  }

  res.json({ url: asset.url, updatedAt: asset.updatedAt.toISOString() });
});

// ─── POST /services/yoga-schedule (admin only — upload file) ──────────────────
servicesRouter.post(
  "/services/yoga-schedule",
  requireStaffAuth,
  requireAdminRole,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded — send a multipart/form-data request with field 'file'" });
      return;
    }

    const ALLOWED_MIME_TYPES = new Set([
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "text/csv", "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      res.status(400).json({ error: "Accepted formats: JPEG, PNG, GIF, WebP, PDF, CSV, XLS, XLSX" });
      return;
    }

    const tenantId = (req as unknown as TenantRequest).tenantId;

    if (!objectStorageClient) {
      res.status(503).json({ error: "File storage is not available — configure R2 credentials." });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const key = `yoga-schedule/${randomUUID()}${ext}`;

    try {
      const url = await objectStorageService.uploadFile(key, file.buffer, file.mimetype);

      await db
        .insert(serviceAssetsTable)
        .values({ tenantId, assetKey: "yoga_schedule", url })
        .onConflictDoNothing();

      await db
        .update(serviceAssetsTable)
        .set({ url, updatedAt: new Date() })
        .where(
          and(
            eq(serviceAssetsTable.tenantId, tenantId),
            eq(serviceAssetsTable.assetKey, "yoga_schedule")
          )
        );

      res.json({ url, updatedAt: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, "Failed to upload yoga schedule file to App Storage");
      res.status(500).json({ error: "Failed to store file" });
    }
  }
);

// ─── DELETE /services/yoga-schedule (admin only) ──────────────────────────────
servicesRouter.delete("/services/yoga-schedule", requireStaffAuth, requireAdminRole, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;

  await db
    .delete(serviceAssetsTable)
    .where(
      and(
        eq(serviceAssetsTable.tenantId, tenantId),
        eq(serviceAssetsTable.assetKey, "yoga_schedule")
      )
    );

  res.json({ ok: true });
});

// ─── GET /services/contact-settings (public — guests fetch this) ───────────────
servicesRouter.get("/services/contact-settings", resolveTenant, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const assets = await db
    .select()
    .from(serviceAssetsTable)
    .where(
      and(
        eq(serviceAssetsTable.tenantId, tenantId)
      )
    );

  const driverRow = assets.find((a) => a.assetKey === "driver_phone");
  const buggyRow = assets.find((a) => a.assetKey === "buggy_phone");

  const driverAt = driverRow?.updatedAt ?? null;
  const buggyAt = buggyRow?.updatedAt ?? null;
  const latestAt = driverAt && buggyAt
    ? (driverAt >= buggyAt ? driverAt : buggyAt)
    : (driverAt ?? buggyAt);

  res.json({
    driverPhone: driverRow?.url ?? null,
    buggyPhone: buggyRow?.url ?? null,
    updatedAt: latestAt?.toISOString() ?? null,
  });
});

// ─── PUT /services/contact-settings (admin only) ──────────────────────────────
servicesRouter.put("/services/contact-settings", requireStaffAuth, requireAdminRole, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const { driverPhone, buggyPhone } = req.body as {
    driverPhone?: string | null;
    buggyPhone?: string | null;
  };

  const now = new Date();

  if (driverPhone !== undefined) {
    if (driverPhone === null || driverPhone.trim() === "") {
      await db
        .delete(serviceAssetsTable)
        .where(
          and(
            eq(serviceAssetsTable.tenantId, tenantId),
            eq(serviceAssetsTable.assetKey, "driver_phone")
          )
        );
    } else {
      await db
        .insert(serviceAssetsTable)
        .values({ tenantId, assetKey: "driver_phone", url: driverPhone.trim(), updatedAt: now })
        .onConflictDoNothing();
      await db
        .update(serviceAssetsTable)
        .set({ url: driverPhone.trim(), updatedAt: now })
        .where(
          and(
            eq(serviceAssetsTable.tenantId, tenantId),
            eq(serviceAssetsTable.assetKey, "driver_phone")
          )
        );
    }
  }

  if (buggyPhone !== undefined) {
    if (buggyPhone === null || buggyPhone.trim() === "") {
      await db
        .delete(serviceAssetsTable)
        .where(
          and(
            eq(serviceAssetsTable.tenantId, tenantId),
            eq(serviceAssetsTable.assetKey, "buggy_phone")
          )
        );
    } else {
      await db
        .insert(serviceAssetsTable)
        .values({ tenantId, assetKey: "buggy_phone", url: buggyPhone.trim(), updatedAt: now })
        .onConflictDoNothing();
      await db
        .update(serviceAssetsTable)
        .set({ url: buggyPhone.trim(), updatedAt: now })
        .where(
          and(
            eq(serviceAssetsTable.tenantId, tenantId),
            eq(serviceAssetsTable.assetKey, "buggy_phone")
          )
        );
    }
  }

  const assets = await db
    .select()
    .from(serviceAssetsTable)
    .where(eq(serviceAssetsTable.tenantId, tenantId));

  const driverRow = assets.find((a) => a.assetKey === "driver_phone");
  const buggyRow = assets.find((a) => a.assetKey === "buggy_phone");

  res.json({
    driverPhone: driverRow?.url ?? null,
    buggyPhone: buggyRow?.url ?? null,
    updatedAt: now.toISOString(),
  });
});

export default servicesRouter;
