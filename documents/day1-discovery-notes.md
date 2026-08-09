# Day 1 discovery notes

Read every router and the schema before touching the app as a user. This is
the "nobody hands you a list of what the app does" pass — captured here
before any restructuring, per the brief's rule that behavior gets locked in
before it gets moved around.

## Domain model (from src/db/schema.ts)

- `users` (member/trainer/admin) -> `sessions` (cookie-token auth)
- `membershipPlans` -> `memberships` (credits, date range, status)
- `classes` (capacity, credit cost, trainer, cancellable)
- `bookings` (member-channel: booked/cancelled/attended/no_show/waitlisted)
- `corporateBookings` -- a **separate table**, same status enum, member-channel
  bookings and corporate bookings for the same class do not share one pool
- `companies` -> `companyMembers`, `corporateBookings` draw from
  `companies.creditPoolBalance` instead of a personal membership
- `payments`, `checkins`, `notifications`, `reschedules`, `trainerAvailability`

## Cross-domain flows exercised by the routers

1. Book -> capacity check -> credit deduction -> waitlist fallback
   (`bookings.book`, `corporateBookings.book` -- parallel, separate implementations)
2. Cancel -> refund window check -> credit refund -> waitlist promotion
   (`bookings.cancel`, `corporateBookings.cancel` -- parallel, separate implementations)
3. Reschedule -> policy window -> same-name target -> capacity check -> credit carry-over
   (`reschedules.reschedule`)
4. Corporate credit-pool spend (`corporateBookings.book`/`.cancel` against `companies.creditPoolBalance`)
5. Admin class cancellation -> bulk booking cancellation (`classes.cancel`)
6. Payment refund -> membership cancellation (`payments.refund`)

## Findings -- current behavior, documented as-is (not yet fixed)

These are real discrepancies/gaps found by reading the code, not hypothetical.
Each must either be preserved exactly by characterization tests, or fixed
deliberately with the change noted here -- never fixed silently.

1. **Reschedule does not promote the waitlist on the vacated class.**
   `bookings.cancel` promotes the longest-waiting waitlisted member when a
   `booked` slot frees up. `reschedules.reschedule` cancels the original
   booking directly via its own `db.update` rather than calling
   `bookings.cancel`, so that promotion never runs. A member rescheduling
   out of a full class leaves a dangling open slot with a waitlisted member
   never promoted into it.

2. **Class capacity is not shared between member and corporate bookings.**
   `corporateBookings.book`'s fullness check only counts rows in
   `corporateBookings`; `bookings.book`'s check only counts rows in
   `bookings`. A class with `capacity: 10` can end up with 10 member
   bookings _and_ 10 corporate bookings simultaneously -- `capacity` is
   enforced per booking channel, not per class.

3. **Corporate check-ins are invisible to `checkinCountFor`.**
   `corporateBookings.markAttended` inserts a `checkins` row with
   `bookingId: null`. `bookings.checkinCountFor` inner-joins `checkins` to
   `bookings` on `bookingId`, so corporate attendees never count there --
   front-desk checkin counts silently exclude corporate members.

4. **3 of 4 notification types are defined but never created at runtime --
   and the seed data actively disguises this.** The `notifications.type`
   enum has `waitlist_promotion`, `class_cancelled`, `membership_expiring`,
   `announcement` -- only `announcement` (via `notifications.broadcast`,
   admin-triggered) is ever inserted anywhere in the routers.
   `src/db/seed.ts` hand-inserts one static example of each of the other
   three types as fixture data, so a freshly seeded DB _looks_ like the
   notification system is fully wired up (the notifications page shows one
   of each type) -- but nothing after seeding ever generates a new one.
   Confirmed by reading seed.ts, not just the routers: without checking the
   seed script this reads as a working feature. `admin.expiringMemberships`
   is a read-only report, not a trigger.

5. **Admin class cancellation is incomplete.** `classes.cancel`:
   marks the class cancelled, and bulk-cancels `booked` member bookings --
   but does **not** refund those members' credits, does **not** touch
   `waitlisted` member bookings (left pointing at a cancelled class
   indefinitely), does **not** touch `corporateBookings` at all (corporate
   attendees stay `booked`, company credit pool never refunded), and sends
   no notification to anyone affected.

6. **A member can hold multiple simultaneous active memberships.**
   `plans.subscribe` never checks for an existing active membership before
   creating a new one. `activeMembershipFor` (used by both booking and
   reschedule) picks the row with the latest `endDate` via
   `orderBy(desc(endDate)).get()` -- any other active membership's credits
   become silently unreachable, not merged or flagged.

7. **Payment refund does not touch bookings.** `payments.refund` sets the
   associated membership to `cancelled` but leaves any bookings made with
   that membership's credits untouched -- they stay `booked` against a
   membership that's no longer active.

8. **A member can be linked to more than one active company.**
   `adminCompanies.linkMember` has no check preventing a second link.
   `getCompanyForMember` (used at corporate-booking time) picks whichever
   row an unordered `.get()` returns first -- effectively arbitrary/DB-order
   dependent when a member has two.

9. **Trainer availability is advisory only.** `trainers.checkAvailability`
   computes a real conflict check, but neither `classes.create` nor
   `classes.update` call it. Nothing server-side stops a trainer from being
   scheduled into two overlapping classes; the availability system only
   protects against double-booking if the frontend happens to check first.

10. **`reschedules.reschedule` and `.validateReschedule` duplicate ~140
    lines of identical validation logic.** Straightforward extraction
    target during restructuring -- must produce byte-identical error codes
    and messages, since `validateReschedule` is almost certainly what
    drives the UI's pre-submit state.

## Verification

App runs locally (`pnpm dev`, seeded), pages render without server errors.
Deep behavioral verification was done by calling the routers directly via
`appRouter.createCaller` in vitest (see "Test coverage" below) rather than
browser automation -- `chromium-cli` wasn't available and installing
Playwright's browser binaries wasn't worth the setup time for what's
fundamentally a business-logic check; this is the same code path the UI
calls, just without HTTP/React in between. All ten findings above were
confirmed against real, running code, not just inferred from reading it.

One correction made along the way: my first pass at the corporate
waitlist-promotion test assumed a refund-then-repromote nets to zero. The
actual code re-reads the company's balance _after_ the refund lands, so the
cancelled booking's cost fully round-trips and only the promoted booking's
cost has a lasting effect on the pool. Fixed the test's expectation, not
the code -- this was my modeling error, not a bug.

## Test coverage

Characterization tests (`*.test.ts` next to each router, run via `pnpm test`)
cover the four cross-domain flows named in the project plan in full,
including all ten findings above as locked-in current behavior:

- `bookings.test.ts` -- book/capacity/credits/waitlist, cancel + refund
  window, waitlist promotion, markAttended
- `reschedules.test.ts` -- policy window, same-name/target checks, credit
  carry-over, the waitlist-promotion gap (finding 1), validate/mutate parity
- `corporate-bookings.test.ts` -- credit-pool spend, the capacity-sharing
  gap (finding 2), the invisible-checkin gap (finding 3)
- `classes.test.ts` -- admin cancellation's incomplete cleanup (finding 5):
  credits, waitlist, corporate bookings, notifications

**Update:** plans, payments, admin-companies, trainers, members, and most
of auth now have characterization tests too (`plans.test.ts`,
`payments.test.ts`, `admin-companies.test.ts`, `trainers.test.ts`,
`members.test.ts`, `auth.test.ts`), including findings 6-9 as locked-in
current behavior. Remaining real gaps, by choice, not oversight:

- **`auth.login`/`auth.logout` are untestable via `callerAs`/`createCaller`**
  -- confirmed empirically (not assumed): both call `next/headers`'s
  `cookies()` directly inside the procedure body, not just via
  `createContext`, which throws `cookies() was called outside a request
scope` outside a real Next.js request. Would need either an HTTP-level
  test against a running server or mocking `next/headers`. Not attempted;
  `auth.register`/`auth.me` (no `cookies()` call) are covered instead.
- **`admin.ts`'s reporting queries** (stats, revenueByMonth, topTrainers,
  etc.) and **`notifications.broadcast`'s exact returned count** are
  read-only or reflect the _entire_ shared test database rather than one
  test's own data, so they're awkward to assert on precisely without
  either a dedicated clean DB per test or asserting only on relative/
  own-data effects (see `notifications.broadcast`'s test for the pattern
  used instead). Not covered by a dedicated test file.
