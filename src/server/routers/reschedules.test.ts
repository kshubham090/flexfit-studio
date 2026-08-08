import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { callerAs } from "@/test/caller";
import { makeUser, makeMembership, makeClass, hoursFromNow } from "@/test/fixtures";
import { FREE_RESCHEDULE_HOURS } from "./reschedules";

describe("reschedules.reschedule", () => {
  it("books the target class, cancels the original, and keeps the same credits spent", async () => {
    const fromClass = await makeClass({ name: "Yoga", capacity: 2, creditCost: 2, startsAt: hoursFromNow(48) });
    const toClass = await makeClass({ name: "Yoga", capacity: 2, creditCost: 2, startsAt: hoursFromNow(72) });

    const member = await makeUser();
    await makeMembership(member, { creditsRemaining: 5 });
    const original = await callerAs(member).bookings.book({ classId: fromClass.id });

    const result = await callerAs(member).reschedules.reschedule({
      fromBookingId: original.id,
      toClassId: toClass.id,
    });

    expect(result.newStatus).toBe("booked");
    expect(result.newBooking.creditsUsed).toBe(2); // carried over, not re-charged

    const oldBooking = await db.select().from(bookings).where(eq(bookings.id, original.id)).get();
    expect(oldBooking?.status).toBe("cancelled");
  });

  it("rejects rescheduling to a class with a different name", async () => {
    const fromClass = await makeClass({ name: "Yoga", startsAt: hoursFromNow(48) });
    const toClass = await makeClass({ name: "Pilates", startsAt: hoursFromNow(72) });

    const member = await makeUser();
    await makeMembership(member, { creditsRemaining: 5 });
    const original = await callerAs(member).bookings.book({ classId: fromClass.id });

    await expect(
      callerAs(member).reschedules.reschedule({ fromBookingId: original.id, toClassId: toClass.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects rescheduling inside the free-reschedule window", async () => {
    const fromClass = await makeClass({
      name: "Yoga",
      startsAt: hoursFromNow(FREE_RESCHEDULE_HOURS - 1),
    });
    const toClass = await makeClass({ name: "Yoga", startsAt: hoursFromNow(48) });

    const member = await makeUser();
    await makeMembership(member, { creditsRemaining: 5 });
    const original = await callerAs(member).bookings.book({ classId: fromClass.id });

    await expect(
      callerAs(member).reschedules.reschedule({ fromBookingId: original.id, toClassId: toClass.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it(
    "CHARACTERIZES A GAP (see documents/day1-discovery-notes.md, finding 1): " +
      "rescheduling out of a full class does NOT promote the class's waitlist, " +
      "unlike a direct cancel",
    async () => {
      const fromClass = await makeClass({ name: "Yoga", capacity: 1, creditCost: 1, startsAt: hoursFromNow(48) });
      const toClass = await makeClass({ name: "Yoga", capacity: 2, creditCost: 1, startsAt: hoursFromNow(72) });

      const member = await makeUser();
      await makeMembership(member, { creditsRemaining: 5 });
      const original = await callerAs(member).bookings.book({ classId: fromClass.id });
      expect(original.status).toBe("booked");

      const waitlistedUser = await makeUser();
      await makeMembership(waitlistedUser, { creditsRemaining: 5 });
      const waitlistedBooking = await callerAs(waitlistedUser).bookings.book({ classId: fromClass.id });
      expect(waitlistedBooking.status).toBe("waitlisted");

      await callerAs(member).reschedules.reschedule({
        fromBookingId: original.id,
        toClassId: toClass.id,
      });

      const stillWaitlisted = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, waitlistedBooking.id))
        .get();
      // If this ever comes back "booked", reschedule has been made
      // consistent with cancel's promotion behavior -- update discovery
      // notes finding 1 rather than adjusting this expectation.
      expect(stillWaitlisted?.status).toBe("waitlisted");
    },
  );
});

describe("reschedules.validateReschedule", () => {
  it("agrees with reschedule's own validation for the same inputs (parity, given the duplicated logic)", async () => {
    const fromClass = await makeClass({ name: "Yoga", startsAt: hoursFromNow(48) });
    const toClass = await makeClass({ name: "Pilates", startsAt: hoursFromNow(72) });

    const member = await makeUser();
    await makeMembership(member, { creditsRemaining: 5 });
    const original = await callerAs(member).bookings.book({ classId: fromClass.id });

    const validation = await callerAs(member).reschedules.validateReschedule({
      fromBookingId: original.id,
      toClassId: toClass.id,
    });
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe("You can only reschedule to a class with the same name.");

    await expect(
      callerAs(member).reschedules.reschedule({ fromBookingId: original.id, toClassId: toClass.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "You can only reschedule to a class with the same name.",
    });
  });
});
