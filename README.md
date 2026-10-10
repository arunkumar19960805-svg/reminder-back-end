# Reminder Alarm & Meeting Management — Backend

Node.js + TypeScript + Express + Sequelize backend for alarm-style meeting reminders,
multi-user assignment and acknowledgement tracking.

Architecture follows `sreevetrivelanjwellery-node`: module folders of
`{model, service, controller, routes, validation}.ts`, zod request validation, a central
error handler, JWT auth with bcrypt hashing, Swagger JSDoc on routes, and
`sequelize.sync` + idempotent seeders for migrations.

**Two deliberate differences from the reference project**, both chosen for this build:

| | Reference | Here | Why |
|---|---|---|---|
| Database | MySQL | **PostgreSQL** | Requested; also gives `FOR UPDATE SKIP LOCKED` for the scheduler |
| Background jobs | BullMQ + Redis | **Database-backed scheduler** | No Redis available; the DB is the durable source of truth either way |

## Running it

PostgreSQL 18 runs user-locally on port **5433** (no sudo, no system service):

```bash
pgdev start      # start the cluster
pgdev status     # check it
pgdev psql -d reminder_app_dev   # open a shell
pgdev stop       # stop it
```

Then:

```bash
cd ~/projects/reminder-alarm-node
cp .env.example .env     # already done; fill in Firebase when you have it
npm install
npm run migrate          # creates tables + bootstrap admin
npm run dev              # http://localhost:4000, docs at /api-docs
npm test                 # 89 tests
```

The server binds `0.0.0.0` so the Android emulator can reach it at `http://10.0.2.2:4000`.

Default admin after `npm run migrate`: `admin@reminder.local` / `Admin@12345`.
**Change this immediately** — set `SEED_ADMIN_PASSWORD` before migrating, or change it in-app.

## How reminder scheduling works

The design separates two very different things:

- **Server-side push delivery.** The backend decides *when* a reminder is due and sends it
  through FCM. This is authoritative and works across all of a user's devices, but it
  depends on network reachability and on FCM actually delivering through Doze.
- **Device-side local scheduling.** The app also schedules a local notification from the
  device's own clock, so a reminder it already knows about still fires offline.

Neither alone is reliable; the app runs both and de-duplicates on `reminderInstanceId`.

### The pipeline

1. An admin creates an event with assignees and reminder rules (offsets like 30/10/5/0 min).
2. `materializeEventReminders` expands `occurrences × rules × assignees` into concrete
   `reminder_instances` rows, each with an absolute UTC `scheduled_at`.
3. A poller (`src/workers/reminder.worker.ts`) runs every 15s and claims due rows with:

   ```sql
   SELECT id FROM reminder_instances WHERE ... FOR UPDATE SKIP LOCKED
   ```

   `SKIP LOCKED` is what makes running several backend instances safe: each one takes a
   disjoint set of rows instead of blocking or double-sending.
4. Claimed rows move `pending → processing → sent | failed`, with bounded exponential
   backoff on failure (5 attempts, capped at 5 min).
5. Acknowledging flips the row to `acknowledged` and silences every later reminder for the
   same user and occurrence.

### Guarantees and non-guarantees

- **No duplicate reminders.** A unique index on `(assignment_id, rule_id, occurrence_start)`
  makes materialisation idempotent no matter how many times, or from how many processes,
  it runs.
- **Crash recovery.** A row claimed by a process that dies is reclaimed once its lease
  (`SCHEDULER_LEASE_MS`, default 120s) expires. A restart re-polls immediately.
- **Missed windows.** A reminder more than `SCHEDULER_STALE_AFTER_MS` (default 1h) late is
  marked `expired` rather than fired, so a server that was down overnight does not spam
  everyone at breakfast.
- **`sent` means accepted by FCM, not seen by a human.** Only an acknowledgement proves
  that. Delivery attempts are logged per device in `notification_attempts`.
- **Timezones.** Everything is stored UTC (`timestamptz`). Recurrence is stepped in the
  event's own IANA zone, so a daily 09:00 meeting stays 09:00 across a DST change — its
  UTC instant shifts, which is correct.

## Database tables

| Table | Purpose |
|---|---|
| `users` | Accounts, roles (`admin`/`user`), timezone, active flag |
| `refresh_tokens` | Rotating refresh tokens with revocation |
| `events` | Meetings/appointments/reminders, recurrence rules |
| `event_assignments` | Which users an event is assigned to |
| `event_reminder_rules` | Per-event offsets ("30 min before"), alarm flag, enabled flag |
| `reminder_instances` | **One materialised reminder per user per occurrence** — the scheduler's source of truth |
| `acknowledgements` | One row per acknowledged reminder (unique per reminder) |
| `devices` | Registered FCM tokens, bound to a user |
| `notification_attempts` | Per-device delivery attempt log |
| `audit_logs` | Sensitive operations, with passwords/tokens redacted |

Migrations run via `npm run migrate` (`sequelize.sync({ alter: true })` + seeders), matching
the reference project. The script **refuses to run against `NODE_ENV=production`** — generate
reviewed SQL for production instead.

## API

Full interactive docs at `http://localhost:4000/api-docs`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET/PATCH /auth/me`, `POST /auth/change-password` |
| Users (admin) | `POST /users`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `PATCH /users/:id/status`, `POST /users/:id/reset-password` |
| Events | `GET /events`, `GET /events/:id`, `POST /events` (admin), `PATCH /events/:id` (admin), `POST /events/:id/cancel` (admin), `POST /events/:id/assignments` (admin), `DELETE /events/:id/assignments/:userId` (admin), `GET /events/:id/status` (admin) |
| Reminders | `GET /reminders?scope=today\|upcoming\|overdue\|acknowledged`, `GET /reminders/history`, `GET /reminders/:id`, `POST /reminders/:id/acknowledge`, `PUT /reminders/events/:eventId/rules` (admin) |
| Devices | `POST /devices`, `GET /devices`, `POST /devices/unregister`, `DELETE /devices/:id` |
| Reports (admin) | `GET /reports/dashboard`, `GET /reports/delivery`, `GET /reports/events/:eventId/summary`, `GET /reports/users/summary` |

Responses follow the reference project's shape: `{ status: 'success', data, message? }` and
`{ status: 'error', statusCode, message, errors }`.

## Security

- Authorization is enforced server-side on every route; the mobile UI's role checks are
  cosmetic only.
- `authenticateToken` re-checks the account on every request, so deactivating a user
  revokes their still-valid JWT immediately rather than at expiry.
- Users can only read and acknowledge their own reminders. Cross-user access returns
  **404, not 403**, so the API does not confirm that another user's record exists.
- Push tokens are never returned by the API — only a masked `fcmTokenPreview`.
- Audit metadata is recursively redacted for password/token-shaped keys.
- Login is rate-limited separately (20 / 15 min) from the general API budget.

## Firebase setup (required for push)

Push is **optional at boot**: without credentials the server logs a warning, keeps
scheduling and recording reminders, and simply cannot deliver them. To enable it:

1. Firebase Console → create/select a project.
2. Project settings → **Service accounts** → *Generate new private key* → download the JSON.
3. Copy these three values into `.env` (never commit them):
   ```
   FIREBASE_PROJECT_ID=<project_id>
   FIREBASE_CLIENT_EMAIL=<client_email>
   FIREBASE_PRIVATE_KEY="<private_key, newlines kept as \n>"
   ```
4. Project settings → **General** → add an Android app with package
   `com.arunkumar.reminderalarm`, download `google-services.json`, and place it at
   `reminder-alarm-app/google-services.json`.
5. Restart the backend; the log should read `Firebase Admin initialised for project …`.

## Tests

```bash
npm test
```

89 tests across 5 suites covering authentication and token rotation, role enforcement,
cross-user data isolation, device-token ownership, multiple reminders per event,
duplicate-delivery prevention (including concurrent materialisation and concurrent
scheduler ticks), timezone/DST handling, recurrence, rescheduling and cancellation,
crash recovery and lease expiry, delivery failure with backoff, invalid-token cleanup,
acknowledgement idempotency and multi-device sync, and audit redaction.
