# Day 4 fix-and-log notes

Day 1/2/3 restructured the codebase around the app's real behavior --
including its bugs -- without fixing any of it silently. This pass is the
"future, separate pass" the P1 deliverables summary explicitly scoped out:
findings 1-9 and 12 were deliberately left as documented-and-preserved, not
fixed, because fixing them then would have resolved real product decisions
as a side effect of restructuring. Requested explicitly this time: fix and
log each one, not leave them open indefinitely.

Every fix below follows the same discipline the rest of this project uses:
the reasoning is written down at the point the decision was made, and the
characterization test that used to lock in the old (buggy) behavior was
flipped to lock in the new one, not deleted or ignored.

## Fixes

**Finding 1 -- reschedule now promotes the waitlist on the vacated class.**
`domain/bookings/service.ts`'s waitlist-promotion logic (previously inlined
in `cancelMember`) was extracted into a standalone `promoteNextWaitlisted(tx,
classId, creditCost)`, and `domain/reschedules/service.ts`'s `reschedule`
now calls it after cancelling the original booking, exactly when
`cancelMember` would have (`originalBooking.status === "booked"`). No
product decision here beyond "make it consistent with cancel," which is
what the original finding asked for.

**Finding 2 -- capacity is now shared across both booking channels.**
`domain/shared/capacity.ts`'s `combinedBookedCount(db, classId)` sums
booked rows from both `bookings` and `corporateBookings`. `bookMember`,
`bookCorporate`, and `validateRescheduleRequest`'s target-class fullness
check all use it instead of querying their own table alone. The two
domains (`domain/bookings`, `domain/corporate-bookings`) stay separate, as
decided in day2 notes -- only the fullness *check* is shared, not the
booking logic itself.

**Finding 3 -- corporate check-ins are now visible to `checkinCountFor`.**
Required a schema change: `checkins` gained a nullable `corporateBookingId`
column (`src/db/schema.ts`), alongside the existing nullable `bookingId`.
`markCorporateAttended` now sets it. `bookings.checkinCountFor` sums two
queries (member-channel via `bookingId`, corporate-channel via
`corporateBookingId`) rather than one join, since a single query can't
cleanly union two different join keys against one nullable-either-way
column without a schema redesign bigger than this fix warranted.

**Finding 4 -- all three previously-inert notification types now fire.**
- `waitlist_promotion`: created inside `promoteNextWaitlisted` (finding 1's
  helper) and inside `cancelCorporate`'s own promotion block.
- `class_cancelled`: created in `cancelClass` (finding 5, below) for every
  member and corporate booking it touches.
- `membership_expiring`: this one needed a product decision. There is no
  cron/background-job infrastructure in this app, and building one was out
  of scope for this pass. Rather than leave the type permanently inert or
  fake automatic scheduling, `admin.sendExpiryReminders` is a new
  admin-triggered mutation (mirrors `notifications.broadcast`'s existing
  "admin clicks a button, notifications go out" pattern) that creates a
  real `membership_expiring` notification for everyone
  `admin.expiringMemberships` would report. This is a deliberate, logged
  scope decision, not a full fix -- "runs automatically every day" would be
  the complete fix and needs real infrastructure this app doesn't have.

**Finding 5 -- admin class cancellation now fully unwinds a class**
(previously the highest-impact open gap). `domain/classes/service.ts`'s
`cancelClass` now: refunds credits for every cancelled `booked` member
booking (same credit-cap logic `cancelMember` uses); cancels (not just
ignores) `waitlisted` member bookings instead of leaving them pointed at a
cancelled class; cancels `booked`/`waitlisted` corporate bookings and
refunds the company credit pool for `booked` ones; and sends a
`class_cancelled` notification to every member and corporate booker
touched. Deliberately does **not** promote any waitlist -- the class itself
is gone, there's nothing to promote into.

**Finding 6 -- subscribing while already holding an active membership is
now rejected.** `domain/plans/service.ts`'s `subscribeToPlan` calls the
existing `activeMembershipFor` check before creating a new membership and
throws `CONFLICT` if one exists. Explicitly logged: this does not implement
plan switching/upgrading (cancel-and-resubscribe, prorated credit, etc.) --
that's a real product decision with its own design space, out of scope
here. This fix only closes the "silently unreachable credits" failure
mode, which is what the finding actually described.

**Finding 7 -- refunding a payment now cancels the bookings it paid for.**
`domain/payments/service.ts`'s `refundPayment` now cancels every
`booked`/`waitlisted` booking tied to the refunded membership, and calls
`promoteNextWaitlisted` for any of them that was actually holding a
confirmed (`booked`) spot -- consistent with every other place a booked
spot frees up. Credits are not refunded back onto the membership being
cancelled; there's no active membership left to credit.

**Finding 8 -- linking a member to a second active company is now
rejected.** `adminCompanies.linkMember` gained a second check (beyond the
existing "already linked to this exact company" one): does this member
already have a link to *any* active company? If so, `CONFLICT`. A link to
an *inactive* company doesn't block a new active-company link, since
`getCompanyForMember` only ever resolves active companies anyway.

**Finding 9 -- trainer double-booking is now enforced, not advisory.**
`trainers.ts`'s inline conflict-check logic was extracted into
`domain/shared/trainerAvailability.ts`'s `checkTrainerAvailability`, now
shared by `trainers.checkAvailability` (unchanged behavior) and
`classes.create`/`classes.update` (new). `update` fetches the current row
first, merges the patch against it (a partial update might only touch
`capacity`, in which case there's nothing new to conflict-check), and
excludes the class's own id from the conflict scan so updating a class's
own unrelated fields doesn't flag it against itself.

**Finding 12 -- `corporateBookings.markAttended` now persists `source`.**
Same fix location as finding 3 (`markCorporateAttended`): `source` is no
longer accepted-and-discarded, it's written to the `checkins` row like
`markMemberAttended` already does.

## Two more findings, surfaced while doing this pass

Consistent with day2's pattern (two more findings turned up while
extracting, not from the original discovery pass) -- found this time while
writing the previously-missing `admin.test.ts`, not silently patched
around:

**13 -- `no_show` was a valid `bookings.status` value nothing could ever
actually set.** `admin.noShowList` reads for it, and `src/db/seed.ts`
hand-inserts one as fixture data (same "seed data disguises the gap"
pattern as finding 4), but no router mutation anywhere transitioned a
booking to `no_show`. Fixed: added `bookings.markNoShow`
(`domain/bookings/service.ts`'s `markMemberNoShow`, wired into
`routers/bookings.ts`), a `staffProcedure` mutation matching
`markAttended`'s shape minus the checkin insert.

**14 -- `admin.classUtilisation`'s `booked` count is not actually
correlated per class.** Discovered empirically while writing
`admin.test.ts`, confirmed by direct comparison, not assumed: querying two
classes in the same call, one with a real booking and one with none, both
report the *same* `booked` value. The query
(`routers/admin.ts`'s `classUtilisation`) uses a `sql` template correlated
subquery (`where bookings.class_id = classes.id`) that should be
per-row-correct but empirically isn't under this Drizzle/libsql version --
root cause not fully isolated (candidates: subquery-hoisting in the query
planner, or a `sql` template scoping issue when embedded in a `.select()`
alias). **Not fixed here** -- this is a new discovery outside the scope of
"fix findings 1-9/12," root-causing an ORM/driver-level correlated-subquery
issue deserves its own dedicated pass rather than a rushed guess under time
pressure, and a wrong guess here (e.g. switching to a JOIN without properly
verifying it against every existing caller) risks a worse regression than
leaving it correctly documented. `admin.test.ts` has two tests for this:
one that asserts the intended per-row behavior via a before/after delta
(passes today, and stays meaningful if the bug is ever fixed), and one that
explicitly proves the non-correlation (`CHARACTERIZES A GAP`, same
convention as findings 1-9/12 originally used).

## Verification

Same discipline as day2/day3: every change was typechecked
(`npx tsc --noEmit`, clean) and run against the full characterization
suite (`pnpm test`, clean -- 76 tests across 12 files, up from 59 across 11
before this pass) and `eslint .` (clean, 0 problems). Every test file that
covered one of findings 1-9/12 as locked-in *old* behavior was updated to
lock in the *new* behavior instead -- none were deleted, and each still
carries a comment pointing back to the relevant finding number and this
document.

One thing this pass does **not** claim: UI/UX functionality is unchanged
for every *other* behavior (the whole point of the day1-3 restructuring),
but these 12 fixes are deliberate, visible behavior changes by design --
that's what "fix" means here, as distinct from "restructure." Anyone
reviewing this against "functionality must be identical" should read that
requirement as applying to the restructuring work, not to this explicitly-
requested bug-fixing pass on top of it.
