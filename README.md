# MiniEdCRM

A small CRM for a training institute: manage leads, convert them into students,
run batches with attendance, and test students with timed quizzes and a leaderboard.

## Stack

| Layer    | Tech                                              |
| -------- | ------------------------------------------------- |
| API      | Node.js, Express 5, TypeScript, Zod               |
| Database | PostgreSQL 17 via Prisma ORM                      |
| Cache    | Redis (leaderboard, dashboard stats, rate limits) |
| Queue    | BullMQ on Redis (emails with retries)             |
| Frontend | React + Vite + Tailwind (Phase 7)                 |
| Ops      | Docker Compose, GitHub Actions, HTTPS deploy      |

## Project layout

```
miniED/
├── docker-compose.yml   Postgres + Redis for local dev
├── server/              REST API
│   ├── prisma/          schema.prisma and migrations
│   └── src/
│       ├── config/      env validation
│       ├── lib/         shared helpers (prisma client, errors)
│       ├── middleware/  auth, error handling, rate limiting
│       └── routes/      one router per module
└── client/              React app (coming later)
```

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
`embedded-postgres` package, using the same port and credentials as Docker. Keep that terminal open,
then in a second terminal:

```bash
cd server
npm run db:migrate
npm run db:seed                    # creates the first admin + a demo mentor
npm run dev
```

Seed account emails and passwords are set in `.env.example` (`SEED_*`).

## API

All responses are JSON. Errors always look like `{ "error": string, "details"?: object }`.
Protected routes need `Authorization: Bearer <token>`.

| Method | Path                    | Who     | What                                         |
| ------ | ----------------------- | ------- | -------------------------------------------- |
| GET    | `/api/health`           | anyone  | App and DB status                            |
| POST   | `/api/auth/signup`      | anyone  | Create a **student** account → `{token, user}` |
| POST   | `/api/auth/login`       | anyone  | → `{token, user}`                            |
| GET    | `/api/auth/me`          | any role| Current user                                 |
| POST   | `/api/users`            | Admin   | Create a user with any role                  |
| GET    | `/api/users?role=&page=&limit=` | Admin | List users (paginated)              |
| PATCH  | `/api/users/:id/status` | Admin   | `{isActive}` to deactivate or reactivate     |

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

**Lead rules**
- One lead per email (case-insensitive). Duplicates return `409` with `existingLeadId`.
- `ENROLLED` can't be set through `/stage`; enrolling creates a student account, so it goes through `POST /api/leads/:id/convert` (Phase 4). Enrolled leads are locked.
- Moving a lead to `LOST` clears its follow-up date so it stops getting reminders. Lost leads can be reopened.
- CSV import accepts common header names (`E-mail`, `Course Interest`, `Follow Up`...), imports valid rows in one transaction, and reports each skipped row with its row number and reason.

## Roadmap

- [x] **Phase 1, Foundation:** repo, server skeleton, Docker services, database schema
- [x] **Phase 2, Auth and RBAC:** signup/login, JWT, bcrypt, `requireRole()` middleware
- [x] **Phase 3, Leads:** CRUD, stages, notes, activity timeline, search/filter/pagination, CSV import
- [ ] **Phase 4, Conversion, batches and attendance:** enroll lead → student account, batches, daily attendance, attendance %
- [ ] **Phase 5, Quizzes and leaderboard:** MCQ builder, timed attempts, auto-scoring, Redis-cached leaderboard
- [ ] **Phase 6, Email queue:** BullMQ jobs for welcome, quiz result and daily follow-up emails, with retries
- [ ] **Phase 7, Dashboard, uploads and frontend:** admin charts, resume upload with type/size checks, React UI
- [ ] **Phase 8, Production:** rate limiting, tests, Dockerized app, GitHub Actions CI/CD, deploy with HTTPS

## Database design notes

- **Users** hold all three roles in one table, using a `role` enum. Students link to a single `batchId`.
- **Leads** keep a `convertedUserId`, so every student can be traced back to the lead they came from.
- **LeadActivity** is an append-only log that powers the timeline without changing past history.
- **Attendance** is unique per `(studentId, date)`, so marking a day twice updates the record instead of duplicating it.
- **QuizAttempt** is unique per `(quizId, studentId)` and stores `timeTakenMs` as the leaderboard tie-breaker.
- **Option.isCorrect** is never sent to students before they submit.
- Indexes follow real queries: leads by stage and date, follow-ups due, attendance by batch and date, attempts by quiz and score.
