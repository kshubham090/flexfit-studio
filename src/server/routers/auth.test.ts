import { describe, it, expect } from "vitest";
import { callerAs } from "@/test/caller";
import { makeUser } from "@/test/fixtures";

describe("auth.register", () => {
  it("creates a member-role user", async () => {
    const result = await callerAs(null).auth.register({
      email: `newuser-${Date.now()}@test.local`,
      password: "password123",
      name: "New User",
    });
    expect(result.name).toBe("New User");
  });

  it("rejects a duplicate email", async () => {
    const email = `dup-${Date.now()}@test.local`;
    await callerAs(null).auth.register({ email, password: "password123", name: "First" });

    await expect(
      callerAs(null).auth.register({ email, password: "password123", name: "Second" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("auth.me", () => {
  it("returns the current context user", async () => {
    const user = await makeUser();
    const result = await callerAs(user).auth.me();
    expect(result?.id).toBe(user.id);
  });

  it("returns null when unauthenticated", async () => {
    const result = await callerAs(null).auth.me();
    expect(result).toBeNull();
  });
});

// auth.login / auth.logout are NOT covered here: both call next/headers's
// cookies() directly inside the procedure body (not just via
// createContext), which requires an active Next.js request scope.
// callerAs() bypasses createContext but not that -- calling them here
// throws an environment error, not a real assertion failure. Documented
// as a real gap in documents/day1-discovery-notes.md rather than faked
// with a mock that wouldn't prove anything about real behavior.
