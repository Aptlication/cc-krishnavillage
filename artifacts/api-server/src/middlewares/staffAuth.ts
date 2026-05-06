import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { staffAccountsTable, tenantsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = (() => {
  const envSecret = process.env["JWT_SECRET"];
  if (!envSecret) {
    if (process.env["NODE_ENV"] === "production") {
      console.error("[staffAuth] FATAL: JWT_SECRET env var must be set in production. Exiting.");
      process.exit(1);
    }
    const generated = randomBytes(32).toString("hex");
    console.warn("[staffAuth] JWT_SECRET not set — using ephemeral secret. Sessions will not survive server restart. Set JWT_SECRET in production.");
    return generated;
  }
  return envSecret;
})();

export type StaffRole = "admin" | "housekeeper" | "maintenance";

export interface StaffTokenPayload {
  staffId: number;
  username: string;
  displayName: string;
  role: StaffRole;
  tenantId: number;
}

/** Request type guaranteed to have tenantId set (by resolveTenant or requireStaffAuth middleware). */
export type TenantRequest = Request & { tenantId: number };

/** Request type guaranteed to have both staff and tenantId set (by requireStaffAuth middleware). */
export type StaffRequest = Request & { staff: StaffTokenPayload; tenantId: number };

export function signStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verifyStaffToken(token: string): StaffTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as StaffTokenPayload;
  } catch {
    return null;
  }
}

export function requireStaffAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  const token =
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null) ??
    (req.headers["x-staff-token"] as string | undefined) ??
    null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized: missing staff token" });
    return;
  }

  const payload = verifyStaffToken(token);
  if (!payload) {
    res.status(401).json({ error: "Unauthorized: invalid or expired token" });
    return;
  }

  db.select({ active: staffAccountsTable.active, role: staffAccountsTable.role, tenantId: staffAccountsTable.tenantId, sessionsRevokedBefore: staffAccountsTable.sessionsRevokedBefore })
    .from(staffAccountsTable)
    .where(eq(staffAccountsTable.id, payload.staffId))
    .limit(1)
    .then(async ([account]) => {
      if (!account) {
        res.status(401).json({ error: "Unauthorized: account not found" });
        return;
      }
      if (!account.active) {
        res.status(401).json({ error: "Unauthorized: account is deactivated" });
        return;
      }

      const tenantId = account.tenantId ?? payload.tenantId ?? 1;

      const tokenJwt = jwt.decode(token) as { iat?: number } | null;
      const issuedAt = tokenJwt?.iat;

      // Check per-account session revocation timestamp
      if (account.sessionsRevokedBefore) {
        const revokedAtSeconds = Math.floor(account.sessionsRevokedBefore.getTime() / 1000);
        if (issuedAt !== undefined && issuedAt <= revokedAtSeconds) {
          res.status(401).json({ error: "Unauthorized: session has been revoked" });
          return;
        }
      }

      const [tenant] = await db
        .select({ sessionsRevokedBefore: tenantsTable.sessionsRevokedBefore })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);

      if (tenant?.sessionsRevokedBefore) {
        // Compare at second granularity: iat is whole seconds, so floor the cutoff.
        // Tokens issued in the same second as revocation are also rejected (<=) since
        // they may have been issued before the revocation within that second.
        const revokedAtSeconds = Math.floor(tenant.sessionsRevokedBefore.getTime() / 1000);
        if (issuedAt !== undefined && issuedAt <= revokedAtSeconds) {
          res.status(401).json({ error: "Unauthorized: session has been revoked" });
          return;
        }
      }

      const staffedReq = req as unknown as StaffRequest;
      staffedReq.staff = {
        ...payload,
        role: account.role as StaffRole,
        tenantId,
      };
      staffedReq.tenantId = staffedReq.staff.tenantId;
      next();
    })
    .catch(() => {
      res.status(500).json({ error: "Internal server error" });
    });
}

export function requireAdminRole(req: Request, res: Response, next: NextFunction): void {
  const staffed = req as unknown as StaffRequest;
  if (!staffed.staff) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (staffed.staff.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admin role required" });
    return;
  }
  next();
}

/**
 * Middleware for public/guest routes.
 * Reads the X-Tenant-ID header (defaults to 1 for backwards compat).
 * Attaches tenantId to req so route handlers can scope DB queries.
 */
export function resolveTenant(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["x-tenant-id"];
  const raw = Array.isArray(header) ? header[0] : header;
  const tenantId = raw ? parseInt(raw, 10) : 1;
  if (isNaN(tenantId) || tenantId <= 0) {
    res.status(400).json({ error: "Invalid X-Tenant-ID header" });
    return;
  }
  (req as unknown as TenantRequest).tenantId = tenantId;
  next();
}
