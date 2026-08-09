import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { callerAs } from "@/test/caller";
import {
  makeUser,
  makeMembership,
  makeClass,
  makeCompany,
  linkCompanyMember,
} from "@/test/fixtures";

describe("corporateBookings.book", () => {
  it("spends the company credit pool instead of a personal membership", async () => {
    const company = await makeCompany({ creditPoolBalance: 10 });
    const employee = await makeUser();
    await linkCompanyMember(employee, company.id);
    const cls = await makeClass({ capacity: 2, creditCost: 3 });

    const result = await callerAs(employee).corporateBookings.book({ classId: cls.id });

    expect(result.status).toBe("booked");
    const updatedCompany = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .get();
    expect(updatedCompany?.creditPoolBalance).toBe(7);
  });

  it("rejects a member with no active company link", async () => {
    const employee = await makeUser();
    const cls = await makeClass();

    await expect(
      callerAs(employee).corporateBookings.book({ classId: cls.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it(
    "CHARACTERIZES A GAP: capacity is checked per booking table, so a class's " +
      "capacity can be exceeded when both personal and corporate members book it " +
      "(see documents/day1-discovery-notes.md, finding 2)",
    async () => {
      const cls = await makeClass({ capacity: 1, creditCost: 1 });

      // Fill capacity via a personal-membership booking.
      const member = await makeUser();
      await makeMembership(member, { creditsRemaining: 5 });
      const memberBooking = await callerAs(member).bookings.book({ classId: cls.id });
      expect(memberBooking.status).toBe("booked");

      // Corporate booking's fullness check only counts corporateBookings rows,
      // so it does not see the personal booking above and also books instead
      // of waitlisting -- this is the actual current behavior being locked in.
      const company = await makeCompany({ creditPoolBalance: 10 });
      const employee = await makeUser();
      await linkCompanyMember(employee, company.id);
      const corporateBooking = await callerAs(employee).corporateBookings.book({
        classId: cls.id,
      });

      expect(corporateBooking.status).toBe("booked");
      // Class capacity was 1; two independent "booked" rows now exist for it
      // across the two tables. If this test ever fails because status came
      // back "waitlisted", the capacity-sharing gap has been fixed -- update
      // discovery notes finding 2 rather than "fixing" this test blindly.
    },
  );
});

describe("corporateBookings.cancel", () => {
  it("promotes the longest-waiting corporate waitlist entry and refunds the pool outside the window", async () => {
    const cls = await makeClass({ capacity: 1, creditCost: 2 });
    const company = await makeCompany({ creditPoolBalance: 10 });

    const first = await makeUser();
    await linkCompanyMember(first, company.id);
    const firstBooking = await callerAs(first).corporateBookings.book({
      classId: cls.id,
    });

    const second = await makeUser();
    await linkCompanyMember(second, company.id);
    const secondBooking = await callerAs(second).corporateBookings.book({
      classId: cls.id,
    });
    expect(secondBooking.status).toBe("waitlisted");

    await callerAs(first).corporateBookings.cancel({ bookingId: firstBooking.id });

    const companyAfter = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .get();
    // Pool: 10 -(book first, 2)-> 8 -(refund on cancel, +2)-> 10 -(promote
    // second, -2)-> 8. The refund and the promotion charge are sequential
    // updates against the company's balance at each point in time (the
    // promotion re-reads the row after the refund has already landed), so
    // the first booking's cost fully round-trips and only the promoted
    // booking's cost has a lasting effect.
    expect(companyAfter?.creditPoolBalance).toBe(8);
  });
});

describe("corporateBookings.markAttended", () => {
  it(
    "CHARACTERIZES A GAP: records a checkin with no bookingId, so " +
      "bookings.checkinCountFor never counts corporate attendees " +
      "(see documents/day1-discovery-notes.md, finding 3)",
    async () => {
      const cls = await makeClass({ capacity: 2 });
      const company = await makeCompany({ creditPoolBalance: 10 });
      const employee = await makeUser();
      await linkCompanyMember(employee, company.id);
      const booking = await callerAs(employee).corporateBookings.book({
        classId: cls.id,
      });

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).corporateBookings.markAttended({ bookingId: booking.id });

      const count = await callerAs(admin).bookings.checkinCountFor({ classId: cls.id });
      expect(count.count).toBe(0); // the corporate check-in is invisible here
    },
  );
});
