import { describe, it, expect } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { callerAs } from "@/test/caller";
import { makeUser, makeCompany } from "@/test/fixtures";

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
    "FIXED (see documents/day1-discovery-notes.md finding 8, " +
      "documents/day4-fix-and-log-notes.md): linking a member to a second " +
      "active company is now rejected",
    async () => {
      const admin = await makeUser({ role: "admin" });
      const companyA = await makeCompany({ creditPoolBalance: 10 });
      const companyB = await makeCompany({ creditPoolBalance: 10 });
      const member = await makeUser();

      await callerAs(admin).adminCompanies.linkMember({
        companyId: companyA.id,
        userId: member.id,
      });

      await expect(
        callerAs(admin).adminCompanies.linkMember({
          companyId: companyB.id,
          userId: member.id,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const rows = await db
        .select()
        .from(companies)
        .where(inArray(companies.id, [companyA.id, companyB.id]));
      const totalBalance = rows.reduce((sum, c) => sum + c.creditPoolBalance, 0);
      expect(totalBalance).toBe(20); // untouched -- the second link never happened
    },
  );

  it("still allows linking to an active company after an inactive-company link", async () => {
    const admin = await makeUser({ role: "admin" });
    const inactiveCompany = await makeCompany({ active: false });
    const activeCompany = await makeCompany();
    const member = await makeUser();

    await callerAs(admin).adminCompanies.linkMember({
      companyId: inactiveCompany.id,
      userId: member.id,
    });

    const link = await callerAs(admin).adminCompanies.linkMember({
      companyId: activeCompany.id,
      userId: member.id,
    });
    expect(link.companyId).toBe(activeCompany.id);
  });
});
