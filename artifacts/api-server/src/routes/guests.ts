import { Router } from "express";
import { db } from "@workspace/db";
import { guestRegistrationsTable, insertGuestRegistrationSchema } from "@workspace/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { requireStaffAuth, resolveTenant } from "../middlewares/staffAuth";
import type { TenantRequest } from "../middlewares/staffAuth";

const guestsRouter = Router();

// ── Register (new guest) ───────────────────────────────────────────────────────
guestsRouter.post("/guests/register", resolveTenant, async (req, res) => {
  const parsed = insertGuestRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const tenantId = (req as unknown as TenantRequest).tenantId;
  const { name: rawName, roomNumber: rawRoom, pushToken, webPushSubscription } = parsed.data;

  // Reject blank push tokens — the client always supplies one; an empty string
  // means something went wrong on the client side.
  if (!pushToken || !pushToken.trim()) {
    res.status(400).json({ error: "Invalid push token" });
    return;
  }

  // Normalise on the server side so the DB is always clean.
  const name = rawName.trim();
  const roomNumber = rawRoom.trim().toUpperCase();

  // ── Look up ALL existing registrations for this room. ──────────────────────
  // Uniqueness is determined by NAME, not by device/pushToken.  Two different
  // devices can share the same localStorage-generated token (e.g. shared
  // browser), so relying on token comparison alone lets a second person on the
  // same device silently overwrite the first person's registration.
  const roomRegistrations = await db
    .select({ id: guestRegistrationsTable.id, name: guestRegistrationsTable.name, pushToken: guestRegistrationsTable.pushToken })
    .from(guestRegistrationsTable)
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.roomNumber, roomNumber),
      ),
    );

  // If the room has any record with a DIFFERENT surname → it is taken.
  const differentNameRecord = roomRegistrations.find(
    (r) => r.name.toLowerCase() !== name.toLowerCase(),
  );
  if (differentNameRecord) {
    res.status(409).json({
      code: "room_taken",
      error: "That room is already taken. Please double check your booking and try again.",
    });
    return;
  }

  // If the room already has a record with the SAME surname → duplicate.
  // Direct the guest to use "Returning Guest" instead.
  const sameNameRecord = roomRegistrations.find(
    (r) => r.name.toLowerCase() === name.toLowerCase(),
  );
  if (sameNameRecord) {
    res.status(409).json({
      code: "duplicate",
      error: "You're already registered for that surname and room. Use Returning Guest to reconnect your device.",
    });
    return;
  }

  // ── No conflict — insert a fresh registration. ─────────────────────────────
  const [inserted] = await db
    .insert(guestRegistrationsTable)
    .values({ name, roomNumber, pushToken, webPushSubscription, tenantId })
    .returning();

  res.status(201).json({
    id: inserted.id,
    name: inserted.name,
    roomNumber: inserted.roomNumber,
    createdAt: inserted.createdAt.toISOString(),
    updatedAt: inserted.updatedAt.toISOString(),
  });
});

// ── Login (returning guest re-links device) ───────────────────────────────────
guestsRouter.post("/guests/login", resolveTenant, async (req, res) => {
  const { name, roomNumber, pushToken, webPushSubscription } = req.body as {
    name?: unknown;
    roomNumber?: unknown;
    pushToken?: unknown;
    webPushSubscription?: unknown;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!roomNumber || typeof roomNumber !== "string" || !roomNumber.trim()) {
    res.status(400).json({ error: "roomNumber is required" });
    return;
  }

  // Normalise inputs server-side so lookup is always clean regardless of client.
  const normName = name.trim();
  const normRoom = roomNumber.trim().toUpperCase();
  const normToken = typeof pushToken === "string" && pushToken.trim() ? pushToken.trim() : null;

  const tenantId = (req as unknown as TenantRequest).tenantId;

  // ── Fetch ALL records for this room so we can detect conflicts. ─────────────
  const allRoomRecords = await db
    .select()
    .from(guestRegistrationsTable)
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.roomNumber, normRoom),
      ),
    );

  // If the room has a record with a DIFFERENT surname, it is taken by someone
  // else.  Returning Guest login must not proceed — the person may be using a
  // stale session from a previous stay or a different booking.
  const conflictRecord = allRoomRecords.find(
    (r) => r.name.toLowerCase() !== normName.toLowerCase(),
  );
  if (conflictRecord) {
    res.status(409).json({
      code: "room_taken",
      error: "That room is registered to a different guest. Please contact Reception if you believe this is an error.",
    });
    return;
  }

  // Find the record that matches name (case-insensitive).
  const existing = allRoomRecords.find(
    (r) => r.name.toLowerCase() === normName.toLowerCase(),
  );

  if (!existing) {
    res
      .status(404)
      .json({ error: "No guest found with that name and room number. Please register first." });
    return;
  }

  const sub = typeof webPushSubscription === "string" ? webPushSubscription : null;

  // Only update the push token if a new one was supplied; keep the old one otherwise.
  const tokenToStore = normToken ?? existing.pushToken;

  const [updated] = await db
    .update(guestRegistrationsTable)
    .set({ pushToken: tokenToStore, webPushSubscription: sub, updatedAt: new Date() })
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.id, existing.id),
      ),
    )
    .returning();

  res.json({
    id: updated.id,
    name: updated.name,
    roomNumber: updated.roomNumber,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// ── Update guest profile (self-service, authenticated by pushToken) ────────────
guestsRouter.put("/guests/:id", resolveTenant, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid guest ID" });
    return;
  }

  const { pushToken, name, roomNumber } = req.body as {
    pushToken?: unknown;
    name?: unknown;
    roomNumber?: unknown;
  };

  if (!pushToken || typeof pushToken !== "string" || !pushToken.trim()) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  if (!roomNumber || typeof roomNumber !== "string" || !roomNumber.trim()) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const tenantId = (req as unknown as TenantRequest).tenantId;

  const existing = await db
    .select()
    .from(guestRegistrationsTable)
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.id, id),
      ),
    );

  if (existing.length === 0) {
    res.status(404).json({ error: "Guest not found" });
    return;
  }

  if (existing[0].pushToken !== pushToken) {
    res.status(403).json({ error: "Forbidden: push token does not match" });
    return;
  }

  const [updated] = await db
    .update(guestRegistrationsTable)
    .set({ name: (name as string).trim(), roomNumber: (roomNumber as string).trim().toUpperCase(), updatedAt: new Date() })
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.id, id),
      ),
    )
    .returning();

  res.json({
    id: updated.id,
    name: updated.name,
    roomNumber: updated.roomNumber,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// ── Delete guest (self-service, authenticated by pushToken) ───────────────────
guestsRouter.delete("/guests/:id", resolveTenant, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid guest ID" });
    return;
  }

  const { pushToken } = req.body as { pushToken?: unknown };

  if (!pushToken || typeof pushToken !== "string" || !pushToken.trim()) {
    res.status(400).json({ error: "pushToken is required" });
    return;
  }

  const tenantId = (req as unknown as TenantRequest).tenantId;

  const existing = await db
    .select()
    .from(guestRegistrationsTable)
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.id, id),
      ),
    );

  if (existing.length === 0) {
    res.status(404).json({ error: "Guest not found" });
    return;
  }

  if (existing[0].pushToken !== pushToken) {
    res.status(403).json({ error: "Forbidden: push token does not match" });
    return;
  }

  await db
    .delete(guestRegistrationsTable)
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.id, id),
      ),
    );

  res.status(204).send();
});

// ── Staff: remove a guest (no push token required) ────────────────────────────
guestsRouter.delete("/guests/:id/staff", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid guest ID" });
    return;
  }

  const tenantId = (req as unknown as TenantRequest).tenantId;

  const existing = await db
    .select()
    .from(guestRegistrationsTable)
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.id, id),
      ),
    );

  if (existing.length === 0) {
    res.status(404).json({ error: "Guest not found" });
    return;
  }

  await db
    .delete(guestRegistrationsTable)
    .where(
      and(
        eq(guestRegistrationsTable.tenantId, tenantId),
        eq(guestRegistrationsTable.id, id),
      ),
    );

  res.status(204).send();
});

// ── Staff: list all guests for this tenant ────────────────────────────────────
guestsRouter.get("/guests", requireStaffAuth, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const { roomNumber } = req.query;

  const conditions = [eq(guestRegistrationsTable.tenantId, tenantId)];
  if (roomNumber && typeof roomNumber === "string") {
    conditions.push(eq(guestRegistrationsTable.roomNumber, roomNumber));
  }

  const guests = await db
    .select()
    .from(guestRegistrationsTable)
    .where(and(...conditions));

  res.json(
    guests.map((g) => ({
      id: g.id,
      name: g.name,
      roomNumber: g.roomNumber,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    })),
  );
});

export default guestsRouter;
