import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  classes,
  bookings,
  corporateBookings,
  memberships,
  companies,
  notifications,
} from "@/db/schema";
import { UNLIMITED_CREDITS } from "../bookings/policy";

type DbClient = typeof import("@/db").db;

/**
 * Cancels a class and unwinds every booking against it, on both channels.
 *
 * Fixes documents/day1-discovery-notes.md finding 5 (previously the
 * highest-impact open gap) -- this used to only bulk-cancel "booked" member
 * bookings, with no refund, no waitlist cleanup, no corporate handling, and
 * no notification. Now:
 *  - booked member bookings: refunded (same credit-cap logic as
 *    cancelMember), cancelled, notified
 *  - waitlisted member bookings: cancelled (no credits were ever spent, so
 *    nothing to refund), notified
 *  - booked corporate bookings: company credit pool refunded, cancelled,
 *    notified
 *  - waitlisted corporate bookings: cancelled, notified
 * See documents/day4-fix-and-log-notes.md.
 */
export async function cancelClass(db: DbClient, classId: number) {
  return db.transaction(async (tx) => {
    const cls = await tx
      .update(classes)
      .set({ cancelled: true })
      .where(eq(classes.id, classId))
      .returning()
      .get();

    if (!cls) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
    }

    const affectedMemberBookings = await tx
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.classId, classId), inArray(bookings.status, ["booked", "waitlisted"])),
      );

    for (const booking of affectedMemberBookings) {
      await tx
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
        .where(eq(bookings.id, booking.id));

      if (booking.status === "booked" && booking.creditsUsed > 0 && booking.membershipId) {
        const ms = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.id, booking.membershipId))
          .get();

        if (ms && ms.creditsRemaining < UNLIMITED_CREDITS) {
          await tx
            .update(memberships)
            .set({ creditsRemaining: ms.creditsRemaining + booking.creditsUsed })
            .where(eq(memberships.id, ms.id));
        }
      }

      await tx.insert(notifications).values({
        userId: booking.userId,
        type: "class_cancelled",
        title: "Class cancelled",
        message: `${cls.name} on ${cls.startsAt} has been cancelled.${
          booking.status === "booked" ? " Any credits spent have been refunded." : ""
        }`,
      });
    }

    const affectedCorporateBookings = await tx
      .select()
      .from(corporateBookings)
      .where(
        and(
          eq(corporateBookings.classId, classId),
          inArray(corporateBookings.status, ["booked", "waitlisted"]),
        ),
      );

    for (const booking of affectedCorporateBookings) {
      await tx
        .update(corporateBookings)
        .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
        .where(eq(corporateBookings.id, booking.id));

      if (booking.status === "booked" && booking.creditsUsed > 0) {
        const company = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, booking.companyId))
          .get();

        if (company) {
          await tx
            .update(companies)
            .set({ creditPoolBalance: company.creditPoolBalance + booking.creditsUsed })
            .where(eq(companies.id, company.id));
        }
      }

      await tx.insert(notifications).values({
        userId: booking.userId,
        type: "class_cancelled",
        title: "Class cancelled",
        message: `${cls.name} on ${cls.startsAt} has been cancelled.${
          booking.status === "booked" ? " Your company's credit pool has been refunded." : ""
        }`,
      });
    }

    return cls;
  });
}
