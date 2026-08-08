import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { classes, bookings } from "@/db/schema";

type DbClient = typeof import("@/db").db;

/**
 * Cancels a class and bulk-cancels its "booked" member bookings.
 *
 * Preserved exactly as found -- see documents/day1-discovery-notes.md
 * finding 5, not fixed silently here:
 *  - does NOT refund the cancelled bookings' credits
 *  - does NOT touch "waitlisted" bookings (left pointing at a cancelled class)
 *  - does NOT touch corporateBookings for this class at all
 *  - sends no notification to anyone affected
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

    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
      .where(and(eq(bookings.classId, classId), eq(bookings.status, "booked")));

    return cls;
  });
}
