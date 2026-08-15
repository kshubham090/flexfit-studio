import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { payments, memberships, bookings, classes } from "@/db/schema";
import { promoteNextWaitlisted } from "../bookings/service";

type DbClient = typeof import("@/db").db;

/**
 * Marks a payment refunded, cancels its associated membership, and now also
 * cancels any of that membership's still-active bookings -- fixes
 * documents/day1-discovery-notes.md finding 7: bookings used to stay
 * "booked"/"waitlisted" against a membership that's no longer active. A
 * booking that was actually holding a confirmed spot promotes that class's
 * waitlist on the way out, same as any other cancellation. Credits are not
 * refunded back onto the membership being cancelled -- there is no active
 * membership left to credit. See documents/day4-fix-and-log-notes.md.
 */
export async function refundPayment(db: DbClient, paymentId: number) {
  return db.transaction(async (tx) => {
    const row = await tx.select().from(payments).where(eq(payments.id, paymentId)).get();

    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
    }
    if (row.status !== "paid") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only paid payments can be refunded.",
      });
    }

    const updated = await tx
      .update(payments)
      .set({ status: "refunded" })
      .where(eq(payments.id, paymentId))
      .returning()
      .get();

    if (row.membershipId) {
      await tx
        .update(memberships)
        .set({ status: "cancelled" })
        .where(eq(memberships.id, row.membershipId));

      const affectedBookings = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.membershipId, row.membershipId),
            inArray(bookings.status, ["booked", "waitlisted"]),
          ),
        );

      for (const booking of affectedBookings) {
        await tx
          .update(bookings)
          .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
          .where(eq(bookings.id, booking.id));

        if (booking.status === "booked") {
          const cls = await tx.select().from(classes).where(eq(classes.id, booking.classId)).get();
          if (cls) {
            await promoteNextWaitlisted(tx, cls.id, cls.creditCost);
          }
        }
      }
    }

    return updated;
  });
}
