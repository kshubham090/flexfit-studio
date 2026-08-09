import { describe, it, expect } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { callerAs } from "@/test/caller";
import { makeUser, makeCompany, makeClass } from "@/test/fixtures";

describe("adminCompanies.linkMember", () => {
  it("links a member to a company", async () => {
    const admin = await makeUser({ role: "admin" });
    const company = await makeCompany();
    const member = await makeUser();

    const link = await callerAs(admin).adminCompanies.linkMember({
      companyId: company.id,
      userId: member.id,
    });
    expect(link.companyId).toBe(company.id);
    expect(link.userId).toBe(member.id);
  });

  it("rejects linking a non-member (e.g. a trainer)", async () => {
    const admin = await makeUser({ role: "admin" });
    const company = await makeCompany();
    const trainer = await makeUser({ role: "trainer" });

    await expect(
      callerAs(admin).adminCompanies.linkMember({
        companyId: company.id,
        userId: trainer.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects linking the same member to the same company twice", async () => {
    const admin = await makeUser({ role: "admin" });
    const company = await makeCompany();
    const member = await makeUser();

    await callerAs(admin).adminCompanies.linkMember({
      companyId: company.id,
      userId: member.id,
    });

    await expect(
      callerAs(admin).adminCompanies.linkMember({
        companyId: company.id,
        userId: member.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it(
    "CHARACTERIZES A GAP (see documents/day1-discovery-notes.md, finding 8): " +
      "a member can be linked to more than one active company at once; a " +
      "corporate booking silently draws from whichever one an unordered " +
      "lookup happens to return first",
    async () => {
      const admin = await makeUser({ role: "admin" });
      const companyA = await makeCompany({ creditPoolBalance: 10 });
      const companyB = await makeCompany({ creditPoolBalance: 10 });
      const member = await makeUser();

      await callerAs(admin).adminCompanies.linkMember({
        companyId: companyA.id,
        userId: member.id,
      });
      // Second link to a DIFFERENT company is not rejected -- no check
      // exists for "already linked elsewhere", only "already linked to
      // this exact company" (covered above).
      await callerAs(admin).adminCompanies.linkMember({
        companyId: companyB.id,
        userId: member.id,
      });

      const cls = await makeClass({ capacity: 2, creditCost: 4 });
      const booking = await callerAs(member).corporateBookings.book({ classId: cls.id });
      expect(booking.status).toBe("booked");

      // Exactly one of the two companies was debited -- which one is an
      // implementation detail of an unordered query, not a guaranteed
      // contract, so assert on the combined total rather than picking a
      // side. If this ever fails, either the gap was fixed (linking now
      // rejected) or the pick became something else -- check discovery
      // notes finding 8 before adjusting this expectation.
      const rows = await db
        .select()
        .from(companies)
        .where(inArray(companies.id, [companyA.id, companyB.id]));
      const totalBalance = rows.reduce((sum, c) => sum + c.creditPoolBalance, 0);
      expect(totalBalance).toBe(16); // 20 combined starting balance - 4 spent
    },
  );
});
