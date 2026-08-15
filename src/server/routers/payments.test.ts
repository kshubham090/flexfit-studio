import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, bookings } from "@/db/schema";
import { callerAs } from "@/test/caller";
import { makeUser, makePlan, makeClass, makeMembership } from "@/test/fixtures";

async function subscribeAndGetPayment(user: Awaited<ReturnType<typeof makeUser>>) {
  const plan = await makePlan({ classCredits: 5 });
  const membership = await callerAs(user).plans.subscribe({ planId: plan.id });
  const payment = await callerAs(user).payments.mine();
  return { membership, payment: payment[0] };
}

describe("payments.refund", () => {
  it("marks the payment refunded and cancels the associated membership", async () => {
    const user = await makeUser();
    const { membership, payment } = await subscribeAndGetPayment(user);

    const admin = await makeUser({ role: "admin" });
    const result = await callerAs(admin).payments.refund({ id: payment.id });
    expect(result.status).toBe("refunded");

    const updatedMembership = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(updatedMembership?.status).toBe("cancelled");
  });

  it("rejects refunding a payment that isn't in 'paid' status", async () => {
    const user = await makeUser();
    const { payment } = await subscribeAndGetPayment(user);

    const admin = await makeUser({ role: "admin" });
    await callerAs(admin).payments.refund({ id: payment.id });

    await expect(
      callerAs(admin).payments.refund({ id: payment.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it(
    "FIXED (see documents/day1-discovery-notes.md finding 7, " +
      "documents/day4-fix-and-log-notes.md): refunding a payment now also " +
      "cancels bookings made with that membership's credits",
    async () => {
      const user = await makeUser();
      const { membership, payment } = await subscribeAndGetPayment(user);
      const cls = await makeClass({ capacity: 2, creditCost: 1 });
      const booking = await callerAs(user).bookings.book({ classId: cls.id });
      expect(booking.status).toBe("booked");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).payments.refund({ id: payment.id });

      const membershipAfter = await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, membership.id))
        .get();
      expect(membershipAfter?.status).toBe("cancelled");

      const bookingAfter = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, booking.id))
        .get();
      expect(bookingAfter?.status).toBe("cancelled");
    },
  );

  it(
    "promotes the class's waitlist when a refund cancels a booked (not " +
      "just waitlisted) spot",
    async () => {
      const user = await makeUser();
      const { payment } = await subscribeAndGetPayment(user);
      const cls = await makeClass({ capacity: 1, creditCost: 1 });
      const booking = await callerAs(user).bookings.book({ classId: cls.id });
      expect(booking.status).toBe("booked");

      const waitlistedUser = await makeUser();
      await makeMembership(waitlistedUser, { creditsRemaining: 5 });
      const waitlistedBooking = await callerAs(waitlistedUser).bookings.book({
        classId: cls.id,
      });
      expect(waitlistedBooking.status).toBe("waitlisted");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).payments.refund({ id: payment.id });

      const promoted = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, waitlistedBooking.id))
        .get();
      expect(promoted?.status).toBe("booked");
    },
  );
});

describe("payments.markPaid", () => {
  it("rejects marking a refunded payment as paid", async () => {
    const user = await makeUser();
    const { payment } = await subscribeAndGetPayment(user);

    const admin = await makeUser({ role: "admin" });
    await callerAs(admin).payments.refund({ id: payment.id });

    await expect(
      callerAs(admin).payments.markPaid({ id: payment.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
