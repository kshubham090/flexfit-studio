import { describe, it, expect } from "vitest";
import { callerAs } from "@/test/caller";
import { makeUser, makeMembership } from "@/test/fixtures";

describe("members.profile", () => {
  it("includes membership details when one exists", async () => {
    const user = await makeUser({ name: "Priya" });
    await makeMembership(user, { creditsRemaining: 6 });

    const profile = await callerAs(user).members.profile();
    expect(profile.name).toBe("Priya");
    expect(profile.membership?.creditsRemaining).toBe(6);
    expect(profile.classesAttended).toBe(0);
  });

  it("returns membership: null with no membership", async () => {
    const user = await makeUser();
    const profile = await callerAs(user).members.profile();
    expect(profile.membership).toBeNull();
  });
});

describe("members.byId", () => {
  it("never leaks the password hash to staff", async () => {
    const member = await makeUser();
    const admin = await makeUser({ role: "admin" });

    const result = await callerAs(admin).members.byId({ id: member.id });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("rejects an unknown id", async () => {
    const admin = await makeUser({ role: "admin" });
    await expect(callerAs(admin).members.byId({ id: 999_999_999 })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });
});

describe("members.setActive / setRole", () => {
  it("deactivates a member", async () => {
    const admin = await makeUser({ role: "admin" });
    const member = await makeUser();

    const result = await callerAs(admin).members.setActive({
      id: member.id,
      active: false,
    });
    expect(result?.active).toBe(false);
  });

  it("changes a member's role", async () => {
    const admin = await makeUser({ role: "admin" });
    const member = await makeUser();

    const result = await callerAs(admin).members.setRole({
      id: member.id,
      role: "trainer",
    });
    expect(result?.role).toBe("trainer");
  });
});

describe("members.lookupByEmailOrPhone", () => {
  it("finds a member by email", async () => {
    const staff = await makeUser({ role: "admin" });
    const member = await makeUser();

    const result = await callerAs(staff).members.lookupByEmailOrPhone({
      query: member.email,
    });
    expect(result.id).toBe(member.id);
  });

  it("rejects a match that isn't a member (e.g. a trainer)", async () => {
    const staff = await makeUser({ role: "admin" });
    const trainer = await makeUser({ role: "trainer" });

    await expect(
      callerAs(staff).members.lookupByEmailOrPhone({ query: trainer.email }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
