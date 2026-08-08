# Day 2 restructuring notes

## Structure

Introduced `src/server/domain/<feature>/` as the application-service layer
sitting under `src/server/routers/`:

```
domain/
  shared/
    time.ts          hoursUntil() -- was duplicated in 3 routers
    membership.ts     activeMembershipFor() -- was duplicated in 2 routers
  bookings/
    policy.ts          FREE_CANCELLATION_HOURS, UNLIMITED_CREDITS
    service.ts          bookMember, cancelMember, markMemberAttended
  corporate-bookings/
    policy.ts           CORPORATE_FREE_CANCELLATION_HOURS
    service.ts           bookCorporate, cancelCorporate, markCorporateAttended
  reschedules/
    policy.ts            FREE_RESCHEDULE_HOURS
    service.ts            validateRescheduleRequest, reschedule
  classes/
    service.ts             cancelClass
```

Routers are now zod input validation + auth level (already encoded by
`protectedProcedure`/`staffProcedure`/`adminProcedure`) + a call into the
service + output shaping. Simple single-table CRUD/queries (`classes.list`,
`classes.byId`, `classes.create`, `classes.update`, and every router's
read-only `mine`/`rosterFor`/`history`/etc.) were deliberately **not**
extracted -- they have no cross-table side effects, so pulling them into
`domain/` would be abstraction with no payoff.

**Decision: `domain/bookings` and `domain/corporate-bookings` stay
separate**, not merged into one booking domain, even though their
book/cancel logic is structurally near-identical. Finding 2 (capacity not
shared between the two tables) is a *behavior* question -- merging the
domains now would resolve it as a side effect of restructuring instead of
a deliberate, logged decision. Revisit only as its own change.

Each router's public exports (e.g. `FREE_CANCELLATION_HOURS` from
`bookings.ts`) are preserved via re-export from the moved policy module, so
nothing importing them -- including the characterization tests -- needed to
change.

## Two more findings, surfaced while extracting (added to the running list)

11. **`reschedules.reschedule` fetches the rider's membership "to check for
    unlimited credits" and never uses the result.** Dead read, zero effect
    on any persisted state or the returned value (confirmed by reading the
    rest of the function before removing it). Removed as part of the
    extraction -- this is waste, not behavior, so it's a safe structural
    change rather than one requiring a test update.
12. **`corporateBookings.markAttended` accepts a `source` input (validated
    by zod) but never persists it** -- unlike `bookings.markAttended`,
    which does. Preserved exactly (service function takes the param but
    intentionally ignores it, matching current behavior byte-for-byte);
    not fixed here.

## Verification

Every extraction step was typechecked (`npx tsc --noEmit`) and run against
the full 26-test characterization suite with **zero test file edits** --
if a "pure" refactor had actually changed behavior, the suite would have
caught it at that step, not at the end.

## Transaction boundaries

All 8 mutation functions now run their full read-check-write sequence
inside `db.transaction(async (tx) => ...)`:
`bookMember`, `cancelMember`, `markMemberAttended`, `bookCorporate`,
`cancelCorporate`, `markCorporateAttended`, `reschedule` (which passes its
`tx` into `validateRescheduleRequest`, so the read-validate-write sequence
is one atomic unit), and `cancelClass`.

The libsql client here runs against a local file (not an HTTP-replica
connection), so this is fully supported -- confirmed empirically, not just
assumed: the full 26-test suite (which exercises every one of these
functions through real inserts/updates) stayed green after wrapping,
including the tests with multi-step sequences like waitlist promotion.

`validateRescheduleRequest` and `activeMembershipFor`/`getCompanyForMember`
now take a shared `AnyDb` type (`src/server/domain/shared/db.ts`) instead
of the plain db client type, since Drizzle's transaction callback (`tx`)
is a structurally-compatible but distinct TypeScript type from the db
client `reschedule`/`bookMember`/etc. themselves receive from the router.

**Caveat, stated plainly:** none of these functions have an internal code
path where a write happens and *then* a business-logic throw happens after
it (every validation runs before the first write) -- so there's no
business-logic-triggered rollback to demonstrate with the current test
suite. What the transaction wrapping actually protects against is a
DB-level failure mid-sequence (a dropped connection, a constraint
violation on a later statement), which isn't something the characterization
suite fault-injects. The suite confirms the change is behavior-neutral on
every existing path, not that rollback-under-failure specifically works --
that would need a dedicated fault-injection test if it's worth the time.
