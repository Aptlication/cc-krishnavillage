import { Router } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { staffAccountsTable, tenantsTable, securityEventsTable, staffPushSubscriptionsTable } from "@workspace/db/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { signStaffToken, requireStaffAuth, requireAdminRole } from "../middlewares/staffAuth";
import type { StaffTokenPayload, StaffRole } from "../middlewares/staffAuth";
import type { Request } from "express";
import { logger } from "../lib/logger";

const staffRouter = Router();

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

async function ensureDefaultTenant(): Promise<number> {
  const existing = await db.select().from(tenantsTable).limit(1);
  if (existing.length > 0) return existing[0].id;
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "Krishna Village", slug: "krishna-village" })
    .returning();
  logger.info({ tenantId: tenant.id }, "Created default tenant: Krishna Village");
  return tenant.id;
}

async function ensureDefaultAdmin() {
  const isProduction = process.env["NODE_ENV"] === "production";
  try {
    const defaultTenantId = await ensureDefaultTenant();
    const existing = await db.select().from(staffAccountsTable).limit(1);
    const envPassword = process.env["INITIAL_ADMIN_PASSWORD"];

    logger.info(
      { accountsExist: existing.length > 0, initialAdminPasswordSet: Boolean(envPassword) },
      "ensureDefaultAdmin: startup check"
    );

    if (existing.length === 0) {
      if (!envPassword && isProduction) {
        throw new Error(
          "INITIAL_ADMIN_PASSWORD env var must be set in production before first start. " +
          "No staff accounts exist and auto-generation is disabled in production."
        );
      }

      const generatedPassword = envPassword == null
        ? randomBytes(10).toString("base64url")
        : null;
      const initialPassword = envPassword ?? generatedPassword!;
      const hash = await bcrypt.hash(initialPassword, 12);
      await db.insert(staffAccountsTable).values({
        username: "admin",
        passwordHash: hash,
        displayName: "Admin",
        role: "admin",
        active: true,
        tenantId: defaultTenantId,
      });

      if (generatedPassword != null) {
        process.stderr.write(
          `\n[SETUP] Default admin created — username: admin  password: ${generatedPassword}\n` +
          "[SETUP] Change this password immediately after first login, or set INITIAL_ADMIN_PASSWORD before first start.\n\n"
        );
      } else {
        logger.info("Created default admin account: username=admin (password set from INITIAL_ADMIN_PASSWORD)");
      }
    } else if (envPassword) {
      // Always sync the admin password to match INITIAL_ADMIN_PASSWORD so that
      // changing the secret and redeploying is enough to reset the password.
      // Trim to guard against accidental whitespace in the secret value.
      logger.info("ensureDefaultAdmin: syncing admin password from INITIAL_ADMIN_PASSWORD");
      const hash = await bcrypt.hash(envPassword.trim(), 12);
      const updated = await db
        .update(staffAccountsTable)
        .set({ passwordHash: hash })
        .where(eq(staffAccountsTable.username, "admin"))
        .returning({ id: staffAccountsTable.id });
      logger.info({ rowsUpdated: updated.length }, "Admin password synced from INITIAL_ADMIN_PASSWORD");
    } else {
      logger.info("ensureDefaultAdmin: INITIAL_ADMIN_PASSWORD not set — skipping password sync (accounts already exist)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to ensure default admin account");
    if (isProduction) {
      logger.error("Fatal error in production — exiting");
      process.exit(1);
    }
  }
}

export { ensureDefaultAdmin };

staffRouter.post("/staff/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  // Temporary bypass: if ADMIN_BYPASS_SECRET is set and the password matches,
  // return a valid admin token without checking the DB. Remove once login is stable.
  const bypassSecret = process.env["ADMIN_BYPASS_SECRET"];
  if (bypassSecret && password === bypassSecret && username === "admin") {
    const payload: StaffTokenPayload = {
      staffId: 0,
      username: "admin",
      displayName: "Admin (bypass)",
      role: "admin" as StaffRole,
      tenantId: 1,
    };
    const token = signStaffToken(payload);
    logger.warn("Admin login via ADMIN_BYPASS_SECRET — remove this env var once DB auth is working");
    res.json({ token, staffId: 0, username: "admin", role: "admin", displayName: "Admin (bypass)" });
    return;
  }

  let [account] = await db
    .select()
    .from(staffAccountsTable)
    .where(eq(staffAccountsTable.username, username));

  // If no username match and the identifier looks like an email, try email lookup
  if (!account && username.includes("@")) {
    [account] = await db
      .select()
      .from(staffAccountsTable)
      .where(eq(staffAccountsTable.email, username.trim().toLowerCase()));
  }

  if (!account) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!account.active) {
    res.status(401).json({ error: "Account is deactivated" });
    return;
  }

  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const payload: StaffTokenPayload = {
    staffId: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role as StaffRole,
    tenantId: account.tenantId,
  };

  const token = signStaffToken(payload);

  res.json({
    token,
    staffId: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
  });
});

staffRouter.get("/staff/accounts", requireStaffAuth, requireAdminRole, async (req, res) => {
  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const accounts = await db
    .select({
      id: staffAccountsTable.id,
      username: staffAccountsTable.username,
      displayName: staffAccountsTable.displayName,
      role: staffAccountsTable.role,
      active: staffAccountsTable.active,
      email: staffAccountsTable.email,
      createdAt: staffAccountsTable.createdAt,
    })
    .from(staffAccountsTable)
    .where(eq(staffAccountsTable.tenantId, staff.tenantId))
    .orderBy(staffAccountsTable.createdAt);

  res.json(
    accounts.map((a) => ({
      ...a,
      email: a.email ?? null,
      createdAt: a.createdAt.toISOString(),
    }))
  );
});

staffRouter.post("/staff/accounts", requireStaffAuth, requireAdminRole, async (req, res) => {
  const { username, password, displayName, role } = req.body as {
    username?: string;
    password?: string;
    displayName?: string;
    role?: StaffRole;
  };

  if (!username || !password || !displayName) {
    res.status(400).json({ error: "username, password, and displayName are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const allowedRoles: StaffRole[] = ["admin", "housekeeper", "maintenance"];
  const accountRole: StaffRole = role && allowedRoles.includes(role) ? role : "housekeeper";

  const existing = await db
    .select()
    .from(staffAccountsTable)
    .where(eq(staffAccountsTable.username, username));

  if (existing.length > 0) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [account] = await db
    .insert(staffAccountsTable)
    .values({ username, passwordHash, displayName, role: accountRole, active: true })
    .returning();

  res.status(201).json({
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    active: account.active,
    createdAt: account.createdAt.toISOString(),
  });
});

staffRouter.patch("/staff/accounts/:id/deactivate", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  if (staff.staffId === id) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }

  const [updated] = await db
    .update(staffAccountsTable)
    .set({ active: false })
    .where(eq(staffAccountsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  try {
    await db
      .delete(staffPushSubscriptionsTable)
      .where(eq(staffPushSubscriptionsTable.staffId, id));
  } catch (err) {
    logger.warn({ err, staffId: id }, "Failed to delete push subscriptions for deactivated staff account");
  }

  res.json({
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    role: updated.role,
    active: updated.active,
    createdAt: updated.createdAt.toISOString(),
  });
});

staffRouter.delete("/staff/accounts/:id", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  if (staff.staffId === id) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  const [account] = await db
    .select({ id: staffAccountsTable.id, tenantId: staffAccountsTable.tenantId })
    .from(staffAccountsTable)
    .where(and(eq(staffAccountsTable.id, id), eq(staffAccountsTable.tenantId, staff.tenantId)));

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(staffPushSubscriptionsTable)
      .where(eq(staffPushSubscriptionsTable.staffId, id));

    await tx
      .delete(staffAccountsTable)
      .where(and(eq(staffAccountsTable.id, id), eq(staffAccountsTable.tenantId, staff.tenantId)));
  });

  logger.info({ staffId: id, deletedBy: staff.staffId }, "Staff account and push subscriptions deleted");

  res.status(204).send();
});

staffRouter.patch("/staff/accounts/:id/activate", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const [updated] = await db
    .update(staffAccountsTable)
    .set({ active: true })
    .where(eq(staffAccountsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  res.json({
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    role: updated.role,
    active: updated.active,
    createdAt: updated.createdAt.toISOString(),
  });
});

staffRouter.patch("/staff/accounts/:id/password", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const isOwnAccount = staff.staffId === id;
  const isAdmin = staff.role === "admin";

  if (!isOwnAccount && !isAdmin) {
    res.status(403).json({ error: "You can only change your own password" });
    return;
  }

  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [account] = await db
    .select()
    .from(staffAccountsTable)
    .where(eq(staffAccountsTable.id, id));

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const requiresCurrentPassword = isOwnAccount && !isAdmin;
  const currentPasswordProvided = !!currentPassword;

  if (requiresCurrentPassword && !currentPasswordProvided) {
    res.status(400).json({ error: "Current password is required" });
    return;
  }

  if (currentPasswordProvided) {
    const valid = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(staffAccountsTable)
    .set({ passwordHash: newHash })
    .where(eq(staffAccountsTable.id, id));

  if (!isOwnAccount) {
    logger.info({ staffId: id, resetBy: staff.staffId }, "Staff password reset by admin");
  }
  res.status(204).send();
});

// ─── Get own profile (includes email) ────────────────────────────────────────
staffRouter.get("/staff/me", requireStaffAuth, async (req, res) => {
  const staff = (req as Request & { staff: StaffTokenPayload }).staff;

  const [account] = await db
    .select({
      id: staffAccountsTable.id,
      username: staffAccountsTable.username,
      displayName: staffAccountsTable.displayName,
      role: staffAccountsTable.role,
      active: staffAccountsTable.active,
      email: staffAccountsTable.email,
      tenantId: staffAccountsTable.tenantId,
      createdAt: staffAccountsTable.createdAt,
    })
    .from(staffAccountsTable)
    .where(and(eq(staffAccountsTable.id, staff.staffId), eq(staffAccountsTable.tenantId, staff.tenantId)));

  if (!account) { res.status(404).json({ error: "Account not found" }); return; }

  res.json({
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    active: account.active,
    email: account.email ?? null,
    createdAt: account.createdAt.toISOString(),
  });
});

// ─── Set / update a staff member's email address ──────────────────────────────
staffRouter.patch("/staff/accounts/:id/email", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid account ID" }); return; }

  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const isOwnAccount = staff.staffId === id;
  const isAdmin = staff.role === "admin";

  if (!isOwnAccount && !isAdmin) {
    res.status(403).json({ error: "You can only update your own email" });
    return;
  }

  const { email } = req.body as { email?: string | null };

  // Allow null / empty string to clear the email
  const normalised = email && typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;

  // Tenant-scoped update to prevent cross-tenant modification
  try {
    const [updated] = await db
      .update(staffAccountsTable)
      .set({ email: normalised })
      .where(and(eq(staffAccountsTable.id, id), eq(staffAccountsTable.tenantId, staff.tenantId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Account not found" }); return; }

    res.json({
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      active: updated.active,
      email: updated.email ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      res.status(409).json({ error: "This email address is already in use by another account in this organisation" });
      return;
    }
    throw err;
  }
});

// ─── Alias: PATCH /staff/:id/email (same handler as /staff/accounts/:id/email) ─
staffRouter.patch("/staff/:id/email", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid account ID" }); return; }

  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const isOwnAccount = staff.staffId === id;
  const isAdmin = staff.role === "admin";

  if (!isOwnAccount && !isAdmin) {
    res.status(403).json({ error: "You can only update your own email" });
    return;
  }

  const { email } = req.body as { email?: string | null };
  const normalised = email && typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;

  try {
    const [updated] = await db
      .update(staffAccountsTable)
      .set({ email: normalised })
      .where(and(eq(staffAccountsTable.id, id), eq(staffAccountsTable.tenantId, staff.tenantId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Account not found" }); return; }

    res.json({
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      active: updated.active,
      email: updated.email ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      res.status(409).json({ error: "This email address is already in use by another account in this organisation" });
      return;
    }
    throw err;
  }
});

staffRouter.post("/staff/verify-password", requireStaffAuth, async (req, res) => {
  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const [account] = await db
    .select()
    .from(staffAccountsTable)
    .where(and(eq(staffAccountsTable.tenantId, staff.tenantId), eq(staffAccountsTable.email, email.trim().toLowerCase())));

  if (!account) {
    res.status(401).json({ error: "No account found with that email address" });
    return;
  }

  if (account.id !== staff.staffId) {
    res.status(403).json({ error: "You can only verify your own account" });
    return;
  }

  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  res.json({ verified: true });
});

staffRouter.post("/staff/sessions/revoke-all", requireStaffAuth, requireAdminRole, async (req, res) => {
  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const tenantId = staff.tenantId;

  const revokedAt = new Date();

  const staffAccount = await db
    .select({ displayName: staffAccountsTable.displayName })
    .from(staffAccountsTable)
    .where(eq(staffAccountsTable.id, staff.staffId))
    .limit(1);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tenantsTable)
      .set({ sessionsRevokedBefore: sql`${revokedAt.toISOString()}::timestamptz` })
      .where(eq(tenantsTable.id, tenantId))
      .returning({ sessionsRevokedBefore: tenantsTable.sessionsRevokedBefore });

    if (!row) return null;

    await tx.insert(securityEventsTable).values({
      tenantId,
      eventType: "sessions_revoked",
      triggeredByStaffId: staff.staffId,
      triggeredByDisplayName: staffAccount[0]?.displayName ?? null,
    });

    return row;
  });

  if (!updated) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  logger.info({ tenantId, revokedBy: staff.staffId, revokedAt }, "All staff sessions revoked");

  res.json({ revokedBefore: revokedAt.toISOString() });
});

staffRouter.post("/staff/accounts/:id/revoke-sessions", requireStaffAuth, requireAdminRole, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const tenantId = staff.tenantId;

  const revokedAt = new Date();

  const [adminAccount, targetAccount] = await Promise.all([
    db
      .select({ displayName: staffAccountsTable.displayName })
      .from(staffAccountsTable)
      .where(eq(staffAccountsTable.id, staff.staffId))
      .limit(1),
    db
      .select({ id: staffAccountsTable.id, displayName: staffAccountsTable.displayName, tenantId: staffAccountsTable.tenantId })
      .from(staffAccountsTable)
      .where(eq(staffAccountsTable.id, id))
      .limit(1),
  ]);

  if (!targetAccount[0]) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (targetAccount[0].tenantId !== tenantId) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(staffAccountsTable)
      .set({ sessionsRevokedBefore: sql`${revokedAt.toISOString()}::timestamptz` })
      .where(eq(staffAccountsTable.id, id));

    await tx.insert(securityEventsTable).values({
      tenantId,
      eventType: "account_sessions_revoked",
      triggeredByStaffId: staff.staffId,
      triggeredByDisplayName: adminAccount[0]?.displayName ?? null,
      targetStaffId: id,
      targetStaffDisplayName: targetAccount[0].displayName,
    });
  });

  logger.info({ tenantId, revokedBy: staff.staffId, targetStaffId: id, revokedAt }, "Staff account sessions revoked");

  res.json({ revokedBefore: revokedAt.toISOString() });
});

staffRouter.get("/staff/security-events", requireStaffAuth, requireAdminRole, async (req, res) => {
  const staff = (req as Request & { staff: StaffTokenPayload }).staff;
  const tenantId = staff.tenantId;

  const events = await db
    .select()
    .from(securityEventsTable)
    .where(eq(securityEventsTable.tenantId, tenantId))
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(50);

  res.json(events);
});

/**
 * POST /api/admin/reset-password
 * Resets the admin account password without requiring a login session.
 * Protected by the x-bypass-secret header (must match ADMIN_BYPASS_SECRET).
 * Returns 404 when ADMIN_BYPASS_SECRET is not configured so the endpoint
 * is invisible in unconfigured deployments.
 */
staffRouter.post("/admin/reset-password", async (req, res) => {
  const bypassSecret = process.env["ADMIN_BYPASS_SECRET"];
  if (!bypassSecret) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const providedSecret = req.headers["x-bypass-secret"];
  if (!providedSecret || providedSecret !== bypassSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword || typeof newPassword !== "string" || newPassword.trim().length === 0) {
    res.status(400).json({ error: "newPassword is required" });
    return;
  }

  const hash = await bcrypt.hash(newPassword.trim(), 12);
  const updated = await db
    .update(staffAccountsTable)
    .set({ passwordHash: hash })
    .where(eq(staffAccountsTable.username, "admin"))
    .returning({ id: staffAccountsTable.id });

  if (updated.length === 0) {
    res.status(404).json({ error: "Admin account not found" });
    return;
  }

  logger.info("Admin password reset via POST /api/admin/reset-password");
  res.json({ success: true });
});

export default staffRouter;
