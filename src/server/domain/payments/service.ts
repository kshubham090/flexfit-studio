import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { payments, memberships } from "@/db/schema";

type DbClient = typeof import("@/db").db;

/**
 * Marks a payment refunded and cancels its associated membership. Does NOT
 * touch any bookings made with that membership's credits -- see
 * documents/day1-discovery-notes.md finding 7. Preserved exactly.
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
    }

    return updated;
  });
}
