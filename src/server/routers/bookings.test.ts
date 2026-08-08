import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, memberships, checkins } from "@/db/schema";
import { callerAs } from "@/test/caller";
import { makeUser, makeMembership, makeClass, hoursFromNow } from "@/test/fixtures";
import { FREE_CANCELLATION_HOURS, UNLIMITED_CREDITS } from "./bookings";

describe("bookings.book", () => {
  it("books, deducts one credit, and returns status 'booked' when the class has room", async () => {
    const user = await makeUser();
    const membership = await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass({ capacity: 2, creditCost: 1 });

    const result = await callerAs(user).bookings.book({ classId: cls.id });

    expect(result.status).toBe("booked");
    expect(result.creditsUsed).toBe(1);

    const updatedMembership = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(updatedMembership?.creditsRemaining).toBe(4);
  });

  it("does not decrement credits for a plan with unlimited (999) credits", async () => {
    const user = await makeUser();
    const membership = await makeMembership(user, { creditsRemaining: UNLIMITED_CREDITS });
    const cls = await makeClass({ capacity: 2, creditCost: 3 });

    await callerAs(user).bookings.book({ classId: cls.id });

    const updated = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(updated?.creditsRemaining).toBe(UNLIMITED_CREDITS);
  });

  it("waitlists instead of booking once capacity is full, without spending a credit", async () => {
    const filler = await makeUser();
    const cls = await makeClass({ capacity: 1, creditCost: 2 });
    await makeMembership(filler, { creditsRemaining: 5 });
    await callerAs(filler).bookings.book({ classId: cls.id });

    const secondUser = await makeUser();
    const secondMembership = await makeMembership(secondUser, { creditsRemaining: 5 });

    const result = await callerAs(secondUser).bookings.book({ classId: cls.id });

    expect(result.status).toBe("waitlisted");
    expect(result.creditsUsed).toBe(0);

    const updated = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, secondMembership.id))
      .get();
    expect(updated?.creditsRemaining).toBe(5);
  });

  it("rejects booking without an active membership", async () => {
    const user = await makeUser();
    const cls = await makeClass();

    await expect(callerAs(user).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects booking with fewer credits than the class costs", async () => {
    const user = await makeUser();
    await makeMembership(user, { creditsRemaining: 1 });
    const cls = await makeClass({ creditCost: 2 });

    await expect(callerAs(user).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects a duplicate booking for a class the member is already on the list for", async () => {
    const user = await makeUser();
    await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass({ capacity: 2 });

    await callerAs(user).bookings.book({ classId: cls.id });

    await expect(callerAs(user).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects booking a cancelled class", async () => {
    const user = await makeUser();
    await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass({ cancelled: true });

    await expect(callerAs(user).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects booking a class that has already started", async () => {
    const user = await makeUser();
    await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass({ startsAt: hoursFromNow(-1) });

    await expect(callerAs(user).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("bookings.cancel", () => {
  it("refunds the credit when cancelling outside the free-cancellation window", async () => {
    const user = await makeUser();
    const membership = await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass({
      capacity: 2,
      creditCost: 2,
      startsAt: hoursFromNow(FREE_CANCELLATION_HOURS + 1),
    });
    const booking = await callerAs(user).bookings.book({ classId: cls.id });

    const result = await callerAs(user).bookings.cancel({ bookingId: booking.id });

    expect(result.refunded).toBe(true);
    const updated = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(updated?.creditsRemaining).toBe(5); // back to pre-booking balance
  });

  it("forfeits the credit when cancelling inside the free-cancellation window", async () => {
    const user = await makeUser();
    const membership = await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass({
      capacity: 2,
      creditCost: 2,
      startsAt: hoursFromNow(FREE_CANCELLATION_HOURS - 1),
    });
    const booking = await callerAs(user).bookings.book({ classId: cls.id });

    const result = await callerAs(user).bookings.cancel({ bookingId: booking.id });

    expect(result.refunded).toBe(false);
    const updated = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(updated?.creditsRemaining).toBe(3); // credit not returned
  });

  it("promotes the longest-waiting waitlisted member when a booked spot frees up", async () => {
    const cls = await makeClass({ capacity: 1, creditCost: 1, startsAt: hoursFromNow(48) });

    const first = await makeUser();
    await makeMembership(first, { creditsRemaining: 5 });
    const firstBooking = await callerAs(first).bookings.book({ classId: cls.id });
    expect(firstBooking.status).toBe("booked");

    const second = await makeUser();
    const secondMembership = await makeMembership(second, { creditsRemaining: 5 });
    const secondBooking = await callerAs(second).bookings.book({ classId: cls.id });
    expect(secondBooking.status).toBe("waitlisted");

    await callerAs(first).bookings.cancel({ bookingId: firstBooking.id });

    const promoted = await db.select().from(bookings).where(eq(bookings.id, secondBooking.id)).get();
    expect(promoted?.status).toBe("booked");
    expect(promoted?.creditsUsed).toBe(1);

    const membershipAfter = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, secondMembership.id))
      .get();
    expect(membershipAfter?.creditsRemaining).toBe(4); // credit spent on promotion
  });
});

describe("bookings.markAttended", () => {
  it("marks a booked booking attended and records a checkin linked to the booking", async () => {
    const user = await makeUser();
    await makeMembership(user, { creditsRemaining: 5 });
    const cls = await makeClass();
    const booking = await callerAs(user).bookings.book({ classId: cls.id });

    const admin = await makeUser({ role: "admin" });
    await callerAs(admin).bookings.markAttended({ bookingId: booking.id });

    const updated = await db.select().from(bookings).where(eq(bookings.id, booking.id)).get();
    expect(updated?.status).toBe("attended");

    const checkin = await db.select().from(checkins).where(eq(checkins.bookingId, booking.id)).get();
    expect(checkin).toBeTruthy();
    expect(checkin?.userId).toBe(user.id);
  });
});
