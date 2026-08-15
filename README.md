# FlexFit Studio

Class booking and membership management for a single gym site. Members book classes, buy memberships and spend class credits. Staff run the front desk, manage trainers and pull reports. Companies buy credit pools their employees book against.

## Requirements

Node 20 or newer, and pnpm. If you don't have pnpm:

```bash
npm install -g pnpm
```

The database is SQLite and lives in a file. There's no server to install and no account to create.

## Getting set up

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

That gets you a populated studio at http://localhost:3000 with a couple of weeks of classes either side of today.

`db:push` creates `flexfit.db` and applies the schema. `db:seed` fills it with sample members, plans, classes and bookings.

## Signing in

| Role    | Email               | Password   |
| ------- | ------------------- | ---------- |
| Admin   | admin@flexfit.test  | admin123   |
| Trainer | arjun@flexfit.test  | trainer123 |
| Member  | rahul.k@example.com | member123  |

Every seeded member uses `member123`. The other member emails are in `src/db/seed.ts`.

## Commands

| Command         | What it does                                       |
| --------------- | -------------------------------------------------- |
| `pnpm dev`      | Development server on port 3000                    |
| `pnpm build`    | Production build                                   |
| `pnpm db:push`  | Apply the schema in `src/db/schema.ts`             |
| `pnpm db:seed`  | Wipe the data and reseed                           |
| `pnpm db:reset` | Delete the database file, then push and seed again |

`db:reset` is the one you want when the data gets into a state you don't like. It's destructive and it's meant to be.

## Two things that will waste your time

Don't run `pnpm build` while `pnpm dev` is running. The build writes over the directory the dev server is using and the app starts throwing `MODULE_NOT_FOUND`. Nothing is actually broken. Stop the dev server, delete `.next`, start it again. If you want to typecheck while the server is up, use `npx tsc --noEmit` instead.

If you're changing anything in `src/db/schema.ts`, run `pnpm db:push` afterwards or the app and the database will disagree with each other in confusing ways.

## Testing

```bash
pnpm test                              # full characterization suite
npx vitest run path/to/file.test.ts    # a single file
```

Tests call the tRPC routers directly (`appRouter.createCaller`), bypassing
HTTP and `next/headers` entirely, against an isolated SQLite file (not
`flexfit.db`) that's rebuilt once per run. See `src/test/` for the harness
and `documents/day1-discovery-notes.md`'s "Test coverage" section for
exactly what's covered and what's deliberately not (with reasons).

## Layout

```
src/
  app/            routes and pages
  components/     shared components
  db/             schema, client, seed data
  lib/            helpers
  server/
    routers/      tRPC procedures -- zod input, auth level, thin
    domain/       business logic + multi-table transactions
    trpc.ts       context, procedure builders
  test/           characterization test harness
documents/        restructuring notes, findings, decisions
```

## Structural decisions and why

This codebase was restructured with one hard constraint: **behavior had to
stay identical**, verified by characterization tests written _before_ any
code moved, not after. The full narrative is in `documents/`:

- **`day1-discovery-notes.md`** -- the domain model and cross-domain flows
  as found by reading the code, plus every behavioral inconsistency found
  along the way (12 findings originally, since grown to 14 -- see
  `day4-fix-and-log-notes.md`). Each was documented and locked in by a test
  rather than fixed silently at the time, per the rule: fix-and-log or
  leave-and-document, never fix-and-forget. Findings 1-9 and 12 are now
  actually fixed (day4); 10 and 11 were safe structural cleanups fixed
  immediately during day2; 14 is still deliberately open.
- **`day2-restructuring-notes.md`** -- the `src/server/domain/<feature>/`
  layer this restructuring introduced, and why: routers were doing input
  validation, auth, business logic, and DB access all in one file: business
  logic and multi-table transactions moved to `domain/`, leaving routers as
  zod + auth level + a service call. Only routers with real cross-table
  mutations got a domain layer (`bookings`, `corporate-bookings`,
  `reschedules`, `classes`, `plans`, `payments`) -- simple single-table CRUD
  stayed in its router, since extracting it would be abstraction with no
  payoff. `domain/bookings` and `domain/corporate-bookings` were
  deliberately **not** merged despite near-identical logic, because doing
  so would silently resolve a real capacity-sharing bug as a side effect of
  restructuring instead of a deliberate, logged decision.
- Every mutation that touches more than one table now runs inside
  `db.transaction()` -- confirmed working against this project's local
  libsql setup by the full test suite staying green through the change,
  not assumed.
- **`day4-fix-and-log-notes.md`** -- the "future, separate pass" day1
  explicitly deferred: findings 1-9 and 12 (all except the two safe
  structural cleanups) are now actually fixed, each with the product
  decision it required written down at the point it was made, and every
  characterization test that locked in the old behavior flipped to lock in
  the new one instead of being deleted. Also documents two more findings
  (13, 14) surfaced while doing this pass -- one fixed, one deliberately
  left open with the reasoning for not guessing at a fix under time
  pressure. The "behavior must stay identical" constraint above describes
  the day1-3 restructuring; this pass is explicitly the opposite of that
  by design -- it changes behavior, on purpose, with each change logged.

Every step of the restructuring was typechecked and run against the full
characterization suite **with zero test-file edits** -- the guarantee that
"pure" refactoring steps actually stayed behavior-neutral, not just an
assumption.
