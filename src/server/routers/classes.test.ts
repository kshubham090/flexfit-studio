import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  memberships,
  corporateBookings,
  companies,
  notifications,
} from "@/db/schema";
import { callerAs } from "@/test/caller";
import {
  makeUser,
  makeMembership,
  makeClass,
  makeCompany,
  linkCompanyMember,
} from "@/test/fixtures";

describe(
  "classes.cancel -- FIXED (see documents/day1-discovery-notes.md finding 5, " +
    "documents/day4-fix-and-log-notes.md): admin cancelling a class now " +
    "refunds credits, cancels waitlisted rows, touches corporate bookings, " +
    "and notifies everyone affected",
  () => {
    it("cancels booked member bookings and refunds their credits", async () => {
      const cls = await makeClass({ capacity: 5, creditCost: 2 });
      const member = await makeUser();
      const membership = await makeMembership(member, { creditsRemaining: 5 });
      const booking = await callerAs(member).bookings.book({ classId: cls.id });
      expect(booking.status).toBe("booked");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const updatedBooking = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, booking.id))
        .get();
      expect(updatedBooking?.status).toBe("cancelled");

      const updatedMembership = await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, membership.id))
        .get();
      // Credit was spent on booking (5 -> 3) and IS restored by the cancel now.
      expect(updatedMembership?.creditsRemaining).toBe(5);
    });

    it("cancels waitlisted member bookings on the now-cancelled class", async () => {
      const cls = await makeClass({ capacity: 1, creditCost: 1 });
      const filler = await makeUser();
      await makeMembership(filler, { creditsRemaining: 5 });
      await callerAs(filler).bookings.book({ classId: cls.id });

      const waitlisted = await makeUser();
      await makeMembership(waitlisted, { creditsRemaining: 5 });
      const waitlistedBooking = await callerAs(waitlisted).bookings.book({
        classId: cls.id,
      });
      expect(waitlistedBooking.status).toBe("waitlisted");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const updated = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, waitlistedBooking.id))
        .get();
      expect(updated?.status).toBe("cancelled");
    });

    it("cancels corporate bookings for the class and refunds the credit pool", async () => {
      const cls = await makeClass({ capacity: 5, creditCost: 2 });
      const company = await makeCompany({ creditPoolBalance: 10 });
      const employee = await makeUser();
      await linkCompanyMember(employee, company.id);
      const corpBooking = await callerAs(employee).corporateBookings.book({
        classId: cls.id,
      });
      expect(corpBooking.status).toBe("booked");

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const updated = await db
        .select()
        .from(corporateBookings)
        .where(eq(corporateBookings.id, corpBooking.id))
        .get();
      expect(updated?.status).toBe("cancelled");

      const companyAfter = await db
        .select()
        .from(companies)
        .where(eq(companies.id, company.id))
        .get();
      expect(companyAfter?.creditPoolBalance).toBe(10); // fully refunded
    });

    it("notifies every affected member (booked and waitlisted) with type class_cancelled", async () => {
      const cls = await makeClass({ capacity: 1 });
      const booked = await makeUser();
      await makeMembership(booked, { creditsRemaining: 5 });
      await callerAs(booked).bookings.book({ classId: cls.id });

      const waitlisted = await makeUser();
      await makeMembership(waitlisted, { creditsRemaining: 5 });
      await callerAs(waitlisted).bookings.book({ classId: cls.id });

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const bookedNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, booked.id));
      expect(bookedNotifications.some((n) => n.type === "class_cancelled")).toBe(true);

      const waitlistedNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, waitlisted.id));
      expect(waitlistedNotifications.some((n) => n.type === "class_cancelled")).toBe(true);
    });

    it("notifies an affected corporate booking's member too", async () => {
      const cls = await makeClass({ capacity: 5 });
      const company = await makeCompany({ creditPoolBalance: 10 });
      const employee = await makeUser();
      await linkCompanyMember(employee, company.id);
      await callerAs(employee).corporateBookings.book({ classId: cls.id });

      const admin = await makeUser({ role: "admin" });
      await callerAs(admin).classes.cancel({ id: cls.id });

      const employeeNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, employee.id));
      expect(employeeNotifications.some((n) => n.type === "class_cancelled")).toBe(true);
    });
  },
);
