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

    const membership = await callerAs(user).plans.subscribe({
      planId: plan.id,
      method: "upi",
    });

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

    await expect(
      callerAs(user).plans.subscribe({ planId: plan.id }),
    ).rejects.toMatchObject({
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
    "FIXED (see documents/day1-discovery-notes.md finding 6, " +
      "documents/day4-fix-and-log-notes.md): subscribing while already " +
      "holding an active membership is now rejected instead of silently " +
      "creating a second one",
    async () => {
      const user = await makeUser();
      const shortPlan = await makePlan({ durationDays: 10, classCredits: 3 });
      const longPlan = await makePlan({ durationDays: 60, classCredits: 20 });

      await callerAs(user).plans.subscribe({ planId: shortPlan.id });

      await expect(
        callerAs(user).plans.subscribe({ planId: longPlan.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const allMemberships = await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, user.id));
      expect(allMemberships).toHaveLength(1);
    },
  );
});
