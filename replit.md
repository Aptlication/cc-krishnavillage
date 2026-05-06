# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Hosts the Krishna Village Guest Notification App — a mobile PWA for guests at Krishna Village (525 Tyalgum Rd, Eungella NSW) to receive push notifications about their stay from housekeeping staff.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Mobile**: Expo (React Native) with expo-router, expo-notifications

## Artifacts

### Mobile App (`artifacts/mobile`)
- Expo mobile app for Krishna Village guests
- Guest registration screen (name + room number + push token)
- Notifications feed screen (shows room updates, activities, etc.) with tap-to-expand detail modal
- Settings screen (per-type notification preferences stored in AsyncStorage)
- Staff/admin screen (previously PIN-protected — now uses username/password login)
- Warm earthy color palette: ochre (#8B5E3C), forest green (#5C7A3E), cream (#FAF6F0)
- Push: Expo native (SDK 53+ requires development build, not Expo Go) + Web Push via VAPID

### Staff Admin Dashboard (`artifacts/admin`)
- React+Vite web app served directly by a Vite dev server workflow at `/admin/`
- In development: Vite dev server runs on port 8080 (PORT=8080) with HMR — source changes in `artifacts/admin/src/` are reflected instantly with no manual rebuild
- In production: built to `artifacts/admin/dist/public/` and served as static files via the artifact's `publicDir` config
- Login page: username + password form (no PIN); authenticates via POST /api/staff/login, stores JWT session in localStorage as `staffSession`
- Guest list page: shows all registered guests with room numbers, searchable
- Maintenance page: shows open/resolved maintenance requests in tabs; resolved requests display "Resolved by [Name]" with timestamp and resolution note
- Notifications page: send form (title, message, target room or broadcast) + notification history showing who sent each notification
- Staff Accounts page (accessible to ALL staff): shows a "Change Your Password" form for self-service password changes; admins additionally see the account management section (create accounts, activate/deactivate, reset any staff member's password, and set email aliases for each staff member via inline pencil-edit UI)
- Staff Expenses & Reimbursements section (bottom of Staff Accounts page): spreadsheet-style claims table with columns Item No, Date, Description, Project, Amount (AUD), Receipt, Status, Reimbursed By, Date Reimbursed; admins see all claims grouped by staff member and can bulk-reimburse (with optional notes) or reject claims; non-admin staff must complete a second-tier login (email + password) before viewing their own claims; "Add Expense" button lets any authenticated staff member submit manual out-of-pocket claims (date, description, project, amount, receipt upload); sidebar badge on "Staff Accounts" nav shows count of pending expense claims for admins
- Warm terracotta/sage color palette (`#C4633A` primary, sage green accents)
- Uses `setAuthTokenGetter` to automatically attach Bearer token to all API requests
- Health-check plugin in `vite.config.ts` only intercepts `/healthz` and `/admin/healthz` — all other requests (including `/admin/`) pass through to Vite for normal SPA serving
- `build:watch` script available (`pnpm --filter @workspace/admin run build:watch`) for watch-mode static builds as an alternative

### API Server (`artifacts/api-server`)
- Express server handling guest registration, push notifications, and staff authentication
- Routes:
  - `POST /api/staff/login` — authenticate with username+password, returns JWT token
  - `GET /api/staff/accounts` — list staff accounts (admin token required)
  - `POST /api/staff/accounts` — create staff account (admin token required)
  - `PATCH /api/staff/accounts/:id/deactivate` — deactivate account (admin token required)
  - `PATCH /api/staff/accounts/:id/activate` — reactivate account (admin token required)
  - `PATCH /api/staff/accounts/:id/password` — change or reset password (staff can change own with currentPassword; admins can reset any account without currentPassword)
  - `POST /api/guests/register` — upsert guest with push token and optional web push subscription
  - `GET /api/guests` — staff-only (requires Bearer token)
  - `GET /api/notifications` — guest notification history (room-filtered + broadcasts); staff history requires Bearer token
  - `POST /api/notifications/send` — staff-only (requires Bearer token); records `sentByName` for attribution
  - `GET /api/vapid-public-key` — returns VAPID public key for browser push subscription
  - `POST /api/maintenance` — submit a maintenance request (public)
  - `GET /api/maintenance` — list maintenance reports (staff only); supports `?status=open|resolved`
  - `PATCH /api/maintenance/:id/resolve` — resolve a request (staff only); records `resolvedByStaffId` and `resolvedByName` from JWT
- Also serves admin static files at `/admin/` (SPA with catch-all for wouter routing)

## Authentication

- Staff authentication uses JWT tokens (`bcryptjs` v3 for password hashing with own types, `jsonwebtoken` for tokens)
- Tokens expire in 8 hours
- `JWT_SECRET` env var controls signing key:
  - **Development**: if unset, a cryptographically random ephemeral key is generated (sessions don't survive restart)
  - **Production** (`NODE_ENV=production`): server hard-fails at startup if `JWT_SECRET` is not set
- Default admin account bootstrap: server awaits account creation before accepting connections
  - **Development**: if no accounts exist and `INITIAL_ADMIN_PASSWORD` is not set, a random password is generated with `crypto.randomBytes` and printed once to stderr only (not the pino log stream)
  - **Production**: if no accounts exist and `INITIAL_ADMIN_PASSWORD` is not set, server exits with error
  - If `INITIAL_ADMIN_PASSWORD` is set, it is used as the initial admin password and is never logged
- Staff middleware: `artifacts/api-server/src/middlewares/staffAuth.ts`
- `requireStaffAuth` performs per-request DB lookup to verify account is still active — deactivated accounts are revoked immediately, not at token expiry

## Environment / Secrets

- `JWT_SECRET` — **Required secret** that signs staff auth tokens. Stored as an encrypted Replit Secret (never committed to version control). Persists across server restarts so staff sessions remain valid after deployments or crashes. In production (`NODE_ENV=production`), the server hard-fails at startup if this is not set. To rotate: generate a new value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and update the Replit Secret — note that rotating invalidates all active sessions.
- `INITIAL_ADMIN_PASSWORD` — optional; sets the initial admin password on first startup. If not set, a random password is generated and shown on stderr (dev only). Not needed if staff accounts already exist in the database.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — required secrets for Web Push (PWA) delivery. Generate with `web-push generate-vapid-keys`. Keys were regenerated in May 2026 after the originals were found to be invalid (API logged "VAPID keys are invalid — web push disabled" at startup). After rotating keys, the production deployment must be redeployed to pick them up.
- `STAFF_PIN` — no longer required (removed from all routes). The old PIN-based auth has been replaced by database-backed accounts.

## Database Tables

- `guest_registrations` — stores guest name, room number, push token, optional web push subscription JSON, created_at
- `notifications` — stores sent notifications with title, body, type, target_room, sent_at, recipient_count, sent_by_staff_id, sent_by_name
- `maintenance_reports` — stores maintenance requests with urgency, photos, status, resolution
- `staff_accounts` — stores staff members with username, password_hash, display_name, role (admin/housekeeper), active status, created_at

## Notification Types

- `room_ready` — room has been cleaned
- `activity` — program or event announcement
- `checkout_reminder` — check-out time reminder
- `general` — general information

## Deployment Rollout (Staff Accounts Migration)

Before deploying the API server for the first time after the Task #3 staff accounts migration, the production database must have the new schema applied:

1. Set `JWT_SECRET` env var (required in production)
2. Set `INITIAL_ADMIN_PASSWORD` env var (required on first boot with no staff accounts)
3. Run `pnpm --filter @workspace/db run push` against the production DB to apply schema changes:
   - New `staff_accounts` table
   - New `sent_by_staff_id` and `sent_by_name` columns on `notifications`
4. Deploy the API server — it will bootstrap the default admin account on startup
5. Log in as admin to verify, then rotate the `INITIAL_ADMIN_PASSWORD` (can unset after first boot)

> **Note**: `POST /api/notifications` (legacy PIN-based endpoint) now returns `410 Gone`. Any older clients must be updated to use `POST /api/notifications/send` with Bearer token auth.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/mobile run expo` — run Expo dev server for React Native / Expo Go testing (native devices)
- `pnpm --filter @workspace/mobile run serve` — run static PWA server (same as `dev`; serves dist/)
- `node artifacts/api-server/tests/auth-integration.mjs` — run staff auth integration tests (requires API running on port 8083)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
