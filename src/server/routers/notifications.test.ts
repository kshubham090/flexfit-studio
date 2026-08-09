import { describe, it, expect } from "vitest";
import { callerAs } from "@/test/caller";
import { makeUser, makeNotification } from "@/test/fixtures";

describe("notifications.list / unreadCount / markAllAsRead", () => {
  it("only returns the current user's own notifications, unread by default", async () => {
    const user = await makeUser();
    const otherUser = await makeUser();
    await makeNotification(user, { title: "Mine" });
    await makeNotification(otherUser, { title: "Not mine" });

    const list = await callerAs(user).notifications.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Mine");

    const unread = await callerAs(user).notifications.unreadCount();
    expect(unread).toBe(1);
  });

  it("markAllAsRead clears unreadCount for that user only", async () => {
    const user = await makeUser();
    await makeNotification(user);
    await makeNotification(user);

    await callerAs(user).notifications.markAllAsRead();

    const unread = await callerAs(user).notifications.unreadCount();
    expect(unread).toBe(0);
  });
});

describe("notifications.broadcast", () => {
  it(
    "delivers to a freshly created member (the DB is shared across test " +
      "files, so this checks one specific member's inbox rather than the " +
      "global count broadcast() returns, which reflects every member ever " +
      "created in this test run)",
    async () => {
      const member = await makeUser();
      const admin = await makeUser({ role: "admin" });

      await callerAs(admin).notifications.broadcast({
        title: "Studio closed",
        message: "Closed for maintenance on Sunday.",
      });

      const list = await callerAs(member).notifications.list();
      expect(
        list.some((n) => n.title === "Studio closed" && n.type === "announcement"),
      ).toBe(true);
    },
  );

  it("rejects a non-admin caller", async () => {
    const trainer = await makeUser({ role: "trainer" });
    await expect(
      callerAs(trainer).notifications.broadcast({ title: "x", message: "y" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
