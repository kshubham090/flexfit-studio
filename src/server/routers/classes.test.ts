import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { bookings, memberships, corporateBookings, companies, notifications } from "@/db/schema";
import { callerAs } from "@/test/caller";
import {
  makeUser,
  makeMembership,
  makeClass,
  makeCompany,
  linkCompanyMember,
} from "@/test/fixtures";

describe(
  "classes.cancel -- CHARACTERIZES A GAP (see documents/day1-discovery-notes.md, finding 5): " +
    "admin cancelling a class only touches 'booked' rows in the personal bookings table",
  () => {
    it("cancels booked member bookings but does not refund their credits", async () => {
      const cls = await makeClass({ capacity: 5, creditCost: 2 });
      const member = await makeUser();
      const membership = await makeMembership(member, { creditsRemaining: 5 });
      const booking = await callerAs(member).bookings.book({ classId: cls.id });
      expect(booking.status).toBe("booked");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const updatedBooking = await db.select().from(bookings).where(eq(bookings.id, booking.id)).get();
      expect(updatedBooking?.status).toBe("cancelled");

      const updatedMembership = await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, membership.id))
        .get();
      // Credit was spent on booking (5 -> 3) and is NOT restored by the cancel.
      // If this ever fails with 5, the credit-refund gap has been fixed --
      // update the discovery notes rather than adjusting this expectation.
      expect(updatedMembership?.creditsRemaining).toBe(3);
    });

    it("leaves waitlisted member bookings pointed at the now-cancelled class, untouched", async () => {
      const cls = await makeClass({ capacity: 1, creditCost: 1 });
      const filler = await makeUser();
      await makeMembership(filler, { creditsRemaining: 5 });
      await callerAs(filler).bookings.book({ classId: cls.id });

      const waitlisted = await makeUser();
      await makeMembership(waitlisted, { creditsRemaining: 5 });
      const waitlistedBooking = await callerAs(waitlisted).bookings.book({ classId: cls.id });
      expect(waitlistedBooking.status).toBe("waitlisted");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const stillWaitlisted = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, waitlistedBooking.id))
        .get();
      // Orphaned: still "waitlisted" on a class that is now cancelled.
      expect(stillWaitlisted?.status).toBe("waitlisted");
    });

    it("does not touch corporate bookings for the class at all", async () => {
      const cls = await makeClass({ capacity: 5, creditCost: 2 });
      const company = await makeCompany({ creditPoolBalance: 10 });
      const employee = await makeUser();
      await linkCompanyMember(employee, company.id);
      const corpBooking = await callerAs(employee).corporateBookings.book({ classId: cls.id });
      expect(corpBooking.status).toBe("booked");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const stillBooked = await db
        .select()
        .from(corporateBookings)
        .where(eq(corporateBookings.id, corpBooking.id))
        .get();
      expect(stillBooked?.status).toBe("booked"); // untouched by the class cancellation

      const companyAfter = await db.select().from(companies).where(eq(companies.id, company.id)).get();
      expect(companyAfter?.creditPoolBalance).toBe(8); // never refunded either
    });

    it("sends no notification to any affected member", async () => {
      const cls = await makeClass({ capacity: 5 });
      const member = await makeUser();
      await makeMembership(member, { creditsRemaining: 5 });
      await callerAs(member).bookings.book({ classId: cls.id });

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const memberNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, member.id));
      expect(memberNotifications).toHaveLength(0);
    });
  },
);
