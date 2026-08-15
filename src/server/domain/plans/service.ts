import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { membershipPlans, memberships, payments } from "@/db/schema";
import { activeMembershipFor } from "../shared/membership";

type DbClient = typeof import("@/db").db;

function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Creates a new active membership plus its paid payment record. Now rejects
 * if the user already holds an active membership -- fixes
 * documents/day1-discovery-notes.md finding 6: a user used to be able to
 * hold more than one simultaneously, with the older one's credits becoming
 * silently unreachable. A member wanting to switch plans mid-cycle needs an
 * explicit product decision (upgrade credit, refund, etc.) that's out of
 * scope here; this only stops the silent-unreachable-credits case. See
 * documents/day4-fix-and-log-notes.md.
 */
export async function subscribeToPlan(
  db: DbClient,
  userId: number,
  planId: number,
  method: "card" | "cash" | "upi" | "transfer",
) {
  return db.transaction(async (tx) => {
    const plan = await tx
      .select()
      .from(membershipPlans)
      .where(eq(membershipPlans.id, planId))
      .get();

    if (!plan) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found." });
    }
    if (!plan.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This plan is no longer available.",
      });
    }

    const existingMembership = await activeMembershipFor(tx, userId);
    if (existingMembership) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "You already have an active membership. Cancel or wait for it to expire before subscribing to a new plan.",
      });
    }

    const today = new Date().toISOString().slice(0, 10);

    const membership = await tx
      .insert(memberships)
      .values({
        userId,
        planId: plan.id,
        startDate: today,
        endDate: addDays(today, plan.durationDays),
        creditsRemaining: plan.classCredits,
        status: "active",
      })
      .returning()
      .get();

    await tx.insert(payments).values({
      userId,
      membershipId: membership.id,
      amountCents: plan.priceCents,
      method,
      status: "paid",
      reference: `PAY-${Date.now()}`,
    });

    return membership;
  });
}
