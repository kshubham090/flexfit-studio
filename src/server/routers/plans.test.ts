import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, memberships } from "@/db/schema";
import { callerAs } from "@/test/caller";
import { makeUser, makePlan } from "@/test/fixtures";

describe("plans.subscribe", () => {
  it("creates an active membership with the plan's credits and a paid payment record", async () => {
    const user = await makeUser();
    const plan = await makePlan({ priceCents: 4999, durationDays: 30, classCredits: 8 });

    const membership = await callerAs(user).plans.subscribe({ planId: plan.id, method: "upi" });

    expect(membership.status).toBe("active");
    expect(membership.creditsRemaining).toBe(8);

    const payment = await db
      .select()
      .from(payments)
      .where(eq(payments.membershipId, membership.id))
      .get();
    expect(payment?.status).toBe("paid");
    expect(payment?.amountCents).toBe(4999);
    expect(payment?.method).toBe("upi");
  });

  it("rejects subscribing to an inactive plan", async () => {
    const user = await makeUser();
    const plan = await makePlan({ active: false });

    await expect(callerAs(user).plans.subscribe({ planId: plan.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects subscribing to a plan that doesn't exist", async () => {
    const user = await makeUser();

    await expect(
      callerAs(user).plans.subscribe({ planId: 999_999_999 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it(
    "CHARACTERIZES A GAP (see documents/day1-discovery-notes.md, finding 6): " +
      "subscribing twice leaves two simultaneous active memberships, and " +
      "booking picks whichever has the later endDate -- the other's credits " +
      "become unreachable, not merged or flagged",
    async () => {
      const user = await makeUser();
      const shortPlan = await makePlan({ durationDays: 10, classCredits: 3 });
      const longPlan = await makePlan({ durationDays: 60, classCredits: 20 });

      const first = await callerAs(user).plans.subscribe({ planId: shortPlan.id });
      const second = await callerAs(user).plans.subscribe({ planId: longPlan.id });

      const allMemberships = await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, user.id));
      expect(allMemberships).toHaveLength(2);
      expect(allMemberships.every((m) => m.status === "active")).toBe(true);

      // Both memberships are independently active; nothing merges or flags
      // this. If this test ever starts failing because subscribe() now
      // rejects a second active membership, finding 6 has been fixed --
      // update discovery notes rather than adjusting this expectation.
      expect(first.id).not.toBe(second.id);
    },
  );
});
