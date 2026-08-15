import { describe, it, expect } from "vitest";
import { callerAs } from "@/test/caller";
import { makeUser, makeMembership, makeClass, makePlan } from "@/test/fixtures";

// admin's reporting queries read across the entire shared test database
// (see documents/day1-discovery-notes.md's "Test coverage" section for why
// this router had no dedicated test file before). Every test here follows
// the same pattern established in notifications.broadcast's test: assert
// on a before/after delta or on a row identifiable by an ID this test
// itself created, never on an absolute count.

describe("admin.stats", () => {
  it("totalMembers increases by exactly one when a member is created", async () => {
    const before = await callerAs(await makeUser({ role: "admin" })).admin.stats();
    await makeUser();
    const after = await callerAs(await makeUser({ role: "admin" })).admin.stats();
    expect(after.totalMembers).toBe(before.totalMembers + 1);
  });
});

describe("admin.classUtilisation", () => {
  // "booked" is computed by a correlated subquery per row in admin.ts, so
  // in principle it should be resistant to a delta-based assertion the same
  // way an actually-per-row value would be: whether the query is correctly
  // correlated or (see the gap test below) not, booking exactly one more
  // seat should move this specific class's reported "booked" up by exactly
  // one either way.
  it("booked count for this test's own class increases by one after a booking", async () => {
    const cls = await makeClass({ capacity: 4 });
    const admin = await makeUser({ role: "admin" });

    const before = await callerAs(admin).admin.classUtilisation({ limit: 1000 });
    const bookedBefore = before.find((r) => r.id === cls.id)?.booked ?? 0;

    const member = await makeUser();
    await makeMembership(member, { creditsRemaining: 5 });
    await callerAs(member).bookings.book({ classId: cls.id });

    const after = await callerAs(admin).admin.classUtilisation({ limit: 1000 });
    const row = after.find((r) => r.id === cls.id);

    expect(row).toBeTruthy();
    expect(row?.booked).toBe(bookedBefore + 1);
  });

  it(
    "CHARACTERIZES A GAP -- newly found while writing this test file, NOT " +
      "one of the original 12/13 findings (see documents/day4-fix-and-log-" +
      "notes.md, logged as finding 14 rather than silently worked around): " +
      "the per-class 'booked' count is not actually correlated per class -- " +
      "two classes with different real booking counts report the same number",
    async () => {
      const clsWithBooking = await makeClass({ capacity: 5 });
      const clsWithoutBooking = await makeClass({ capacity: 5 });
      const member = await makeUser();
      await makeMembership(member, { creditsRemaining: 5 });
      await callerAs(member).bookings.book({ classId: clsWithBooking.id });

      const admin = await makeUser({ role: "admin" });
      const rows = await callerAs(admin).admin.classUtilisation({ limit: 1000 });
      const rowWith = rows.find((r) => r.id === clsWithBooking.id);
      const rowWithout = rows.find((r) => r.id === clsWithoutBooking.id);

      // A correctly-correlated query would show rowWithout.booked === 0
      // regardless of what rowWith shows. If this ever starts failing
      // because they diverge, the correlation bug has been fixed -- update
      // discovery notes rather than adjusting this expectation.
      expect(rowWith?.booked).toBe(rowWithout?.booked);
    },
  );
});

describe("admin.revenueByMonth / revenueByMethod", () => {
  it("both increase by the payment amount for a subscription just created", async () => {
    const admin = await makeUser({ role: "admin" });
    const before = await callerAs(admin).admin.revenueByMethod();
    const beforeUpi = before.find((r) => r.method === "upi")?.totalCents ?? 0;

    const user = await makeUser();
    const plan = await makePlan({ priceCents: 3300 });
    await callerAs(user).plans.subscribe({ planId: plan.id, method: "upi" });

    const after = await callerAs(admin).admin.revenueByMethod();
    const afterUpi = after.find((r) => r.method === "upi")?.totalCents ?? 0;
    expect(afterUpi).toBe(beforeUpi + 3300);
  });
});

describe("admin.expiringMemberships", () => {
  it("includes a membership expiring within 14 days, by this test's own user", async () => {
    const user = await makeUser();
    const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await makeMembership(user, { endDate: in5Days });

    const admin = await makeUser({ role: "admin" });
    const rows = await callerAs(admin).admin.expiringMemberships();

    expect(rows.some((r) => r.memberId === user.id && r.expiresAt === in5Days)).toBe(true);
  });

  it("excludes a membership expiring more than 14 days out", async () => {
    const user = await makeUser();
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await makeMembership(user, { endDate: in30Days });

    const admin = await makeUser({ role: "admin" });
    const rows = await callerAs(admin).admin.expiringMemberships();

    expect(rows.some((r) => r.memberId === user.id)).toBe(false);
  });
});

describe("admin.sendExpiryReminders", () => {
  it("creates a membership_expiring notification for a member expiring soon", async () => {
    const user = await makeUser();
    const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await makeMembership(user, { endDate: in5Days });

    const admin = await makeUser({ role: "admin" });
    const result = await callerAs(admin).admin.sendExpiryReminders();
    expect(result.count).toBeGreaterThanOrEqual(1);

    const list = await callerAs(user).notifications.list();
    expect(list.some((n) => n.type === "membership_expiring")).toBe(true);
  });
});

describe("admin.refundCount", () => {
  it("increases by exactly one after a refund", async () => {
    const admin = await makeUser({ role: "admin" });
    const before = await callerAs(admin).admin.refundCount();

    const user = await makeUser();
    const plan = await makePlan();
    await callerAs(user).plans.subscribe({ planId: plan.id });
    const payment = (await callerAs(user).payments.mine())[0];
    await callerAs(admin).payments.refund({ id: payment.id });

    const after = await callerAs(admin).admin.refundCount();
    expect(after.count).toBe(before.count + 1);
  });
});

describe("admin.checkinsPerDay", () => {
  it("today's bucket increases by one after a check-in", async () => {
    const admin = await makeUser({ role: "admin" });
    const today = new Date().toISOString().slice(0, 10);
    const before = await callerAs(admin).admin.checkinsPerDay();
    const beforeToday = before.find((r) => r.date === today)?.count ?? 0;

    const user = await makeUser();
    await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass();
    const booking = await callerAs(user).bookings.book({ classId: cls.id });
    await callerAs(admin).bookings.markAttended({ bookingId: booking.id });

    const after = await callerAs(admin).admin.checkinsPerDay();
    const afterToday = after.find((r) => r.date === today)?.count ?? 0;
    expect(afterToday).toBe(beforeToday + 1);
  });
});

describe("admin.topTrainers", () => {
  it("lists a trainer with an attended booking in the last 14 days", async () => {
    const trainer = await makeUser({ role: "trainer" });
    const member = await makeUser();
    await makeMembership(member, { creditsRemaining: 5 });

    // topTrainers filters on the class's startsAt (last 14 days), but
    // bookings.book itself rejects a class that's already started -- so
    // book against makeClass's default future startsAt, then markAttended,
    // which doesn't re-check startsAt.
    const cls = await makeClass({ trainerId: trainer.id });
    const booking = await callerAs(member).bookings.book({ classId: cls.id });

    const admin = await makeUser({ role: "admin" });
    await callerAs(admin).bookings.markAttended({ bookingId: booking.id });

    const rows = await callerAs(admin).admin.topTrainers();
    const row = rows.find((r) => r.trainerId === trainer.id);
    expect(row).toBeTruthy();
    expect(row?.attendedCount).toBeGreaterThanOrEqual(1);
  });
});

describe("admin.noShowList", () => {
  it(
    "lists a booking marked no-show via the newly-added bookings.markNoShow " +
      "(finding 13 -- see documents/day4-fix-and-log-notes.md: 'no_show' " +
      "used to be unreachable through any real mutation)",
    async () => {
      const trainer = await makeUser({ role: "trainer" });
      const cls = await makeClass({ trainerId: trainer.id });
      const member = await makeUser();
      await makeMembership(member, { creditsRemaining: 5 });
      const booking = await callerAs(member).bookings.book({ classId: cls.id });

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).bookings.markNoShow({ bookingId: booking.id });

      const rows = await callerAs(admin).admin.noShowList();
      const row = rows.find((r) => r.bookingId === booking.id);
      expect(row).toBeTruthy();
      expect(row?.memberId).toBe(member.id);
      expect(row?.trainerName).toBe(trainer.name);
    },
  );
});
