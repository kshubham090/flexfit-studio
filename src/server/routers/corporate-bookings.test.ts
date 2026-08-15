import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { companies, checkins } from "@/db/schema";
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
    "FIXED (see documents/day1-discovery-notes.md finding 2, " +
      "documents/day4-fix-and-log-notes.md): capacity is now shared across " +
      "both booking channels, so a personal booking counts against a " +
      "corporate booking's fullness check on the same class",
    async () => {
      const cls = await makeClass({ capacity: 1, creditCost: 1 });

      // Fill capacity via a personal-membership booking.
      const member = await makeUser();
      await makeMembership(member, { creditsRemaining: 5 });
      const memberBooking = await callerAs(member).bookings.book({ classId: cls.id });
      expect(memberBooking.status).toBe("booked");

      // Corporate booking's fullness check now counts both tables, so it
      // sees the personal booking above and waitlists instead of booking.
      const company = await makeCompany({ creditPoolBalance: 10 });
      const employee = await makeUser();
      await linkCompanyMember(employee, company.id);
      const corporateBooking = await callerAs(employee).corporateBookings.book({
        classId: cls.id,
      });

      expect(corporateBooking.status).toBe("waitlisted");
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
    "FIXED (see documents/day1-discovery-notes.md finding 3, " +
      "documents/day4-fix-and-log-notes.md): records a checkin with " +
      "corporateBookingId set, so bookings.checkinCountFor now counts " +
      "corporate attendees too",
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
      expect(count.count).toBe(1);
    },
  );

  it(
    "persists the source it's given (finding 12, previously silently " +
      "discarded -- see documents/day4-fix-and-log-notes.md)",
    async () => {
      const cls = await makeClass({ capacity: 2 });
      const company = await makeCompany({ creditPoolBalance: 10 });
      const employee = await makeUser();
      await linkCompanyMember(employee, company.id);
      const booking = await callerAs(employee).corporateBookings.book({
        classId: cls.id,
      });

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).corporateBookings.markAttended({
        bookingId: booking.id,
        source: "kiosk",
      });

      const checkin = await db
        .select()
        .from(checkins)
        .where(
          and(eq(checkins.corporateBookingId, booking.id), eq(checkins.userId, employee.id)),
        )
        .get();
      expect(checkin?.source).toBe("kiosk");
    },
  );
});
