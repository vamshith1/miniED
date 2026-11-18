# MiniEdCRM

A small CRM for a training institute: manage leads, convert them into students,
run batches with attendance, and test students with timed quizzes and a leaderboard.

## Stack

| Layer    | Tech                                              |
| -------- | ------------------------------------------------- |
| API      | Node.js, Express 5, TypeScript, Zod               |
| Database | PostgreSQL 17 via Prisma ORM                      |
| Cache    | Redis (leaderboard, dashboard stats, rate limits) |
| Queue    | BullMQ on Redis, or on Postgres without Redis (emails with retries) |
| Email    | Nodemailer over SMTP; saved to `.outbox/` in dev  |
| Frontend | React 19, Vite, Tailwind 4, TanStack Query, Recharts |
| Ops      | Docker Compose, GitHub Actions, HTTPS deploy      |

## Project layout

```
miniED/
├── docker-compose.yml   Postgres + Redis for local dev
├── server/              REST API
│   ├── prisma/          schema.prisma and migrations
│   └── src/
│       ├── config/      env validation
│       ├── lib/         shared helpers (prisma, cache, errors, dates, pagination)
│       ├── middleware/  auth, error handling, rate limiting
│       └── modules/     one folder per feature: routes, schemas, service
└── client/              React app (Vite dev server proxies /api to :4000)
```

## Deploying

Free hosting (Render + Neon + Brevo, $0) is described step by step in [DEPLOY.md](DEPLOY.md). In production one
Node process serves the API, the built web app and the email worker:

```bash
npm run build      # from the repo root: builds client/ and server/
npm start          # applies database migrations, then starts the server
```

Production settings (see `server/.env.example`): `NODE_ENV=production`, `CLIENT_URL` (https), `SMTP_URL`,
`TRUST_PROXY=1` behind a proxy, `CRON_SECRET` for the GitHub Action that sends the 9:00 reminders, and optionally
`BCRYPT_ROUNDS=10` on slow free CPUs.

## Running locally

Requires Node 20+ and Docker Desktop.

```bash
docker compose up -d               # start Postgres and Redis
cd server
cp .env.example .env               # then set JWT_SECRET
npm install
npm run db:migrate                 # create tables
npm run dev                        # API on http://localhost:4000
```

Check it: `GET http://localhost:4000/api/health` should return `{"status":"ok","db":"up"}`.

### Without Docker

If Docker isn't available, `npm run db:local` runs a real Postgres 17 server through the
`embedded-postgres` package, using the same port and credentials as Docker. The database is created as
UTF-8 (Windows would default to WIN1252, which can't store Hindi names or emoji). If yours was made
before this, it prints a warning: `npm run db:local -- --recreate` rebuilds it empty. Keep that terminal
open, then in a second terminal:

```bash
cd server
npm run db:migrate
npm run db:seed                    # creates the first admin + a demo mentor
npm run dev
```

Seed account emails and passwords are set in `.env.example` (`SEED_*`).

Then start the web app in a third terminal and open http://localhost:5173:

```bash
cd client
npm install
npm run dev
```

### Tests

```bash
cd server
npm test                           # Vitest + Supertest: unit and API tests, no server needed
npm run test:smoke                 # 261 end-to-end checks against a running API (npm run dev)
```

`npm test` needs only the database server (Docker or `npm run db:local`). It runs against its own
`miniedcrm_test` database on that server (or `TEST_DATABASE_URL`), creates it and applies the migrations,
and empties it at the start of every run, so your development data is never touched. Redis isn't needed and
no email is sent. See [server/tests/smoke](server/tests/smoke/README.md) for the smoke tests.

**CI.** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push to `main` and every pull request:
typecheck and build of both apps, `npm test`, then the built API is started against a fresh Postgres and
`npm run test:smoke` runs against it.

Redis is optional while developing: if `REDIS_URL` is missing or unreachable, the API logs
`Cache: ... using in-memory cache` and caches in memory instead, and the email queue uses Postgres.
Production should always use Redis, because the in-memory cache isn't shared between servers.

**Emails in development.** Without `SMTP_URL`, nothing is sent: each email is saved as
`server/.outbox/<id>.eml`, which opens in any mail app. `GET /api/health` shows which cache, queue and
mail backend are in use. By default the API also runs the email worker. To run it separately (as in
production), start the API with `RUN_WORKER=false` and run `npm run worker` in another terminal.

## API

All responses are JSON. Errors always look like `{ "error": string, "details"?: object }`.

**Signing in.** Login, signup and password changes return `{token, user}` and also set an `mecrm_session` cookie
(httpOnly, `SameSite=Lax`, `Secure` in production, path `/api`). The web app uses only the cookie, so page scripts
never see the token. API clients can send `Authorization: Bearer <token>` instead. Requests that use the cookie and
change data must also send `X-Requested-With: miniedcrm`, which other websites can't add (CSRF protection).
`POST /api/auth/logout` clears the cookie.

**Rate limits** (`429` with `Retry-After` and `RateLimit-*` headers; Redis-backed when Redis is connected, else in memory):

| Limit | Allowed |
| ----- | ------- |
| Any API request | 300 per minute per IP (`/api/health` is exempt) |
| Login | 10 per 15 min per IP + email, and 50 per 15 min per IP |
| Signup | 10 per hour per IP |
| Forgot / reset password | 10 per hour per IP |
| Change password | 10 per 15 min per user |
| File uploads / CSV imports | 30 / 20 per hour per user |

In development, requests from your own machine skip the limits; set `RATE_LIMIT_LOCAL=true` to test them.
Behind a proxy (Render, Caddy), set `TRUST_PROXY=1` or every visitor shares the proxy's IP and its limits.

**Production checks.** With `NODE_ENV=production` the API refuses to start without `SMTP_URL`, with a non-https
`CLIENT_URL`, or with the example `JWT_SECRET`, and lists what to fix.

| Method | Path                    | Who     | What                                         |
| ------ | ----------------------- | ------- | -------------------------------------------- |
| GET    | `/api/health`           | anyone  | App and DB status                            |
| POST   | `/api/auth/signup`      | anyone  | Create a **student** account → `{token, user}` |
| POST   | `/api/auth/login`       | anyone  | → `{token, user}`                            |
| GET    | `/api/auth/me`          | any role| Current user                                 |
| POST   | `/api/auth/change-password` | any role | `{currentPassword, newPassword}` → new `{token, user}`; other devices are signed out |
| POST   | `/api/auth/forgot-password` | anyone | `{email}` → always the same 200 answer; emails a reset link if the account exists |
| GET    | `/api/auth/reset-password?token=` | anyone | 200 `{email}` if the link still works, else 400 |
| POST   | `/api/auth/reset-password` | anyone | `{token, newPassword}`; signs out every session |
| POST   | `/api/users`            | Admin   | Create a user with any role                  |
| GET    | `/api/users?role=&page=&limit=` | Admin | List users (paginated)              |
| PATCH  | `/api/users/:id/status` | Admin   | `{isActive}` to deactivate or reactivate     |

**Passwords and sessions**
- Each user has a `tokenVersion`, copied into their sign-in token. Changing or resetting the password bumps it,
  which signs out every existing session at once (`401 "Your session has ended"`).
- Reset links are random 32-byte tokens that work once, for 1 hour. Only a SHA-256 hash is stored, a new request
  replaces the old link, and at most one reset email goes out per minute per person. Asking for a reset never
  reveals whether an email has an account.
- Every change or reset sends a "your password was changed" email saying what to do if it wasn't you.

### Leads (Admin only)

| Method | Path                       | What                                                        |
| ------ | -------------------------- | ----------------------------------------------------------- |
| GET    | `/api/leads`               | List. Query: `search`, `stage`, `source`, `assignedToId`, `followUpDue=true`, `sort=newest\|oldest\|name\|followUp`, `page`, `limit` |
| POST   | `/api/leads`               | Create `{name, email, phone?, source?, courseInterest?, nextFollowUpAt?, assignedToId?}` |
| POST   | `/api/leads/import`        | CSV upload (form field `file`, max 2 MB / 5000 rows). See [samples/leads-sample.csv](server/samples/leads-sample.csv) |
| GET    | `/api/leads/:id`           | One lead                                                    |
| PATCH  | `/api/leads/:id`           | Update fields; `assignedToId` / `nextFollowUpAt` accept `null` |
| DELETE | `/api/leads/:id`           | Delete (not allowed once enrolled)                          |
| PATCH  | `/api/leads/:id/stage`     | `{stage, note?}`. Logs to the timeline                      |
| GET    | `/api/leads/:id/notes`     | Notes, newest first                                         |
| POST   | `/api/leads/:id/notes`     | `{body}`                                                    |
| GET    | `/api/leads/:id/timeline`  | Activity log, newest first                                  |

| POST   | `/api/leads/:id/convert`   | `{batchId, password?}`. Creates the student account and enrolls the lead (see below) |

**Lead rules**
- One lead per email (case-insensitive). Duplicates return `409` with `existingLeadId`.
- `ENROLLED` can't be set through `/stage`; enrolling creates a student account, so it goes through `POST /api/leads/:id/convert` (Phase 4). Enrolled leads are locked.
- Moving a lead to `LOST` clears its follow-up date so it stops getting reminders. Lost leads can be reopened.
- CSV import accepts common header names (`E-mail`, `Course Interest`, `Follow Up`...), imports valid rows in one transaction, and reports each skipped row with its row number and reason.

**Converting a lead** runs in one transaction: it creates the STUDENT account (from the lead's name, email and phone),
places them in the batch, marks the lead `ENROLLED`, links the lead to the student and logs `CONVERTED` on the timeline.
If any step fails, nothing changes. If two admins convert the same lead at once, only one succeeds. When no
`password` is sent, a temporary one is generated and sent in the student's welcome email; the response only says
`welcomeEmail: {id, status}`. If the email couldn't even be queued (`status: "FAILED"`), the password is returned once
in the response instead, so the admin can still hand it over.

### Batches

| Method | Path                                   | Who                 | What                                  |
| ------ | -------------------------------------- | ------------------- | ------------------------------------- |
| GET    | `/api/batches`                         | any role            | Admin: all. Mentor: their batches. Student: their own |
| POST   | `/api/batches`                         | Admin               | `{name, course, startDate, endDate?, mentorId?}` (dates `YYYY-MM-DD`) |
| GET    | `/api/batches/:id`                     | any role, if theirs | One batch with mentor and student count |
| PATCH  | `/api/batches/:id`                     | Admin               | Update; `endDate` / `mentorId` accept `null` |
| GET    | `/api/batches/:id/students`            | Admin, its mentor   | Student roster                        |
| POST   | `/api/batches/:id/students`            | Admin               | `{studentId}`: add or move a student  |
| DELETE | `/api/batches/:id/students/:studentId` | Admin               | Remove a student from the batch       |

A batch the user can't access returns `404`, not `403`, so batch IDs can't be discovered by guessing.

### Attendance

| Method | Path                                   | Who               | What                                          |
| ------ | -------------------------------------- | ----------------- | --------------------------------------------- |
| PUT    | `/api/batches/:id/attendance`          | Admin, its mentor | `{date, records: [{studentId, status}]}` marks a whole day |
| GET    | `/api/batches/:id/attendance?date=`    | Admin, its mentor | Roster for that day; `status: null` = not marked |
| GET    | `/api/batches/:id/attendance/summary`  | Admin, its mentor | Each student's %, plus the batch average       |
| GET    | `/api/attendance/me`                   | Student           | Own counts, %, and the last 30 days            |

- Status is `PRESENT`, `LATE` or `ABSENT`. **LATE counts as attended:** % = (present + late) / days marked.
- Marking the same day again updates it (one record per student per day).
- No future dates, no dates outside the batch's start/end, and every student must belong to the batch.

### Quizzes

| Method | Path                            | Who                     | What                                        |
| ------ | ------------------------------- | ----------------------- | ------------------------------------------- |
| GET    | `/api/quizzes?batchId=`         | any role                | Managers: their batches' quizzes. Students: published quizzes in their batch, with `myAttempt` |
| POST   | `/api/quizzes`                  | Admin, batch mentor     | Create a draft `{batchId, title, description?, durationSeconds, questions?}` |
| GET    | `/api/quizzes/:id`              | Admin, batch mentor     | Full quiz including correct answers         |
| PUT    | `/api/quizzes/:id`              | Admin, batch mentor     | Replace a draft (title, settings, all questions) |
| POST   | `/api/quizzes/:id/publish`      | Admin, batch mentor     | Publish (needs at least 1 question; locks editing) |
| DELETE | `/api/quizzes/:id`              | Admin, batch mentor     | Only if nobody has attempted it             |
| GET    | `/api/quizzes/:id/attempts`     | Admin, batch mentor     | Every attempt with status and score         |
| POST   | `/api/quizzes/:id/start`        | Student in the batch    | Starts the timer (or resumes) → questions without answers, `expiresAt` |
| POST   | `/api/quizzes/:id/submit`       | Student in the batch    | `{answers: [{questionId, optionId|null}]}` → score and review |
| GET    | `/api/quizzes/:id/result`       | Student                 | Own score and answer review                 |
| GET    | `/api/quizzes/:id/leaderboard`  | Managers + batch students | Ranked by score, then time taken (cached) |
| GET    | `/api/batches/:id/leaderboard`  | Anyone who can see the batch | Total score across the batch's quizzes (cached) |

Question format: `{text, points?, options: [{text, isCorrect}]}`. 2–6 options, **exactly one** correct.

**How a timed attempt works**
1. `start` records `startedAt` on the server. The server's clock is the only one that counts, so changing the browser clock does nothing.
2. Students never receive `isCorrect` until they've submitted.
3. `submit` is graded on the server. Unanswered questions count as wrong. One attempt per student per quiz, and a double submit only scores once.
4. Submissions later than `durationSeconds` + **15 s grace** are marked `EXPIRED` with score 0. Submissions inside the grace window count, with time taken capped at the limit.

**Leaderboard caching**
- Both leaderboards are cached for 5 minutes under `lb:quiz:<id>` and `lb:batch:<id>`.
- Every successful submit deletes both keys (and `dashboard:stats`), so the next read rebuilds fresh data. The TTL is only a safety net.
- Responses carry `X-Cache: HIT` or `MISS`. One cached copy is shared by every viewer, so it contains names only, never emails.
- Ranking uses competition style: equal score and time share a rank (1, 2, 2, 4).

### Dashboard and documents

| Method | Path                              | Who                        | What                                    |
| ------ | --------------------------------- | -------------------------- | --------------------------------------- |
| GET    | `/api/dashboard/stats`            | Admin                      | Leads by stage/source/week, conversion rate, follow-ups due, attendance by batch, quiz and email numbers. Cached 60 s (`X-Cache`) |
| POST   | `/api/documents`                  | any role                   | Multipart `file` + `kind` (`RESUME` default, or `OTHER`). A new resume replaces the old one |
| GET    | `/api/documents?ownerId=`         | owner, admin, batch mentor | List a user's files (default: your own)  |
| GET    | `/api/documents/:id/download`     | owner, admin, batch mentor | Download as an attachment               |
| DELETE | `/api/documents/:id`              | owner, admin               | Delete the file and its record          |

**Upload checks:** PDF, DOCX or DOC only, up to 5 MB, and up to 10 `OTHER` files per person. The file's first bytes must
match its extension, so an `.exe` or image renamed to `.pdf` is rejected (a `.docx` must also be a real Word ZIP).
Files are stored in the database by default (`FILE_STORAGE=database`, a separate `DocumentBlob` table so lists never
load file contents), which works on free hosts whose disk is wiped on every deploy. `FILE_STORAGE=disk` keeps them in
`server/uploads` (`UPLOAD_DIR`) instead, under random names, never the user's file name. Rejected uploads are never
stored. Downloads are always sent as attachments with `Cache-Control: no-store`. Other users get `404`, as with batches.

### Web app

| Role    | Pages |
| ------- | ----- |
| Admin   | Dashboard (charts, each with a table view), Leads (search, filters, CSV import, lead detail with notes, timeline, stage and enrolment), Batches, Users, Emails |
| Mentor  | My batches: roster with attendance % and resumes, daily attendance marking, quiz builder (draft → publish), attempts and leaderboards |
| Student | Home (attendance, quizzes, batch leaderboard), timed quiz with server-side timer and auto-submit, result review, resume upload |

The token is kept in `localStorage`. Pages check roles too, but the API is what enforces them.

### Emails (Admin only)

| Method | Path                          | What                                                        |
| ------ | ----------------------------- | ----------------------------------------------------------- |
| GET    | `/api/emails`                 | Email log, newest first. Query: `status`, `template`, `to`, `page`, `limit` |
| GET    | `/api/emails/:id`             | One email: status, attempts, last error                     |
| POST   | `/api/emails/follow-ups/run`  | Send today's follow-up reminders now (same as the daily job) |

| Email            | Sent when                                         | To                    |
| ---------------- | ------------------------------------------------- | --------------------- |
| `welcome`        | Signup, admin creates a user, lead conversion     | The new user (with the temporary password after a conversion) |
| `quiz-result`    | A student submits a quiz in time                  | The student: score, %, time and current rank |
| `lead-follow-up` | Daily at 9:00 (`FOLLOW_UP_CRON`)                  | Each assignee, one email listing their leads due today or overdue |

**How sending works**
1. The action (signup, submit...) saves an `EmailLog` row and adds a job to the `email` queue. It doesn't wait
   for the email, and a mail problem never fails the request.
2. Jobs carry IDs, and the worker loads the data when it sends, so emails are always up to date.
   The one exception is the temporary password, which is encrypted (AES-256-GCM) inside the job.
3. A failed send is retried up to 5 times, waiting 30 s, 1 min, 2 min, 4 min (`EMAIL_MAX_ATTEMPTS`,
   `EMAIL_RETRY_DELAY_MS`). The log shows `QUEUED` while retrying, then `SENT` or `FAILED` with the last error.
   If retrying can't help (the user was deleted), it fails right away.
4. The queue runs on Redis when it's reachable, otherwise on BullMQ's Postgres backend (a separate `bullmq`
   schema in the same database). Either way, queued jobs survive a restart.

**Follow-up reminders** cover open leads (not `ENROLLED` or `LOST`) with `nextFollowUpAt` today or earlier.
Unassigned leads, or leads assigned to a deactivated user, go to every active admin. Running the scan again
the same day skips anyone already reminded, unless their email failed. Each reminded lead gets `REMINDER_SENT`
on its timeline.

## Roadmap

- [x] **Phase 1, Foundation:** repo, server skeleton, Docker services, database schema
- [x] **Phase 2, Auth and RBAC:** signup/login, JWT, bcrypt, `requireRole()` middleware
- [x] **Phase 3, Leads:** CRUD, stages, notes, activity timeline, search/filter/pagination, CSV import
- [x] **Phase 4, Conversion, batches and attendance:** enroll lead → student account, batches, daily attendance, attendance %
- [x] **Phase 5, Quizzes and leaderboard:** MCQ builder, timed attempts, auto-scoring, Redis-cached leaderboard
- [x] **Phase 6, Email queue:** BullMQ jobs for welcome, quiz result and daily follow-up emails, with retries
- [x] **Phase 7, Dashboard, uploads and frontend:** admin charts, resume upload with type/size checks, React UI
- [x] **Change and reset password** by email, signing out other sessions
- [x] **Phase 8, Production:** rate limiting, cookie sessions, free-hosting build (Render + Neon), Vitest + Supertest suite, GitHub Actions CI
- [ ] **Go live:** create the Neon, Brevo and Render accounts and deploy, following [DEPLOY.md](DEPLOY.md)

## Database design notes

- **Users** hold all three roles in one table, using a `role` enum. Students link to a single `batchId`.
- **Leads** keep a `convertedUserId`, so every student can be traced back to the lead they came from.
- **LeadActivity** is an append-only log that powers the timeline without changing past history.
- **Attendance** is unique per `(studentId, date)`, so marking a day twice updates the record instead of duplicating it.
- **QuizAttempt** is unique per `(quizId, studentId)` and stores `timeTakenMs` as the leaderboard tie-breaker.
- **Option.isCorrect** is never sent to students before they submit.
- **EmailLog** has one row per email, so admins can see what was sent, what's retrying and what failed.
- Indexes follow real queries: leads by stage and date, follow-ups due, attendance by batch and date, attempts by quiz and score.
