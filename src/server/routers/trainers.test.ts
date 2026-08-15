import { describe, it, expect } from "vitest";
import { callerAs } from "@/test/caller";
import { makeUser, makeClass } from "@/test/fixtures";

// Fixed UTC instant so the derived day-of-week/time-of-day are deterministic
// regardless of when/where the test runs -- the router itself computes
// dayOfWeek via getUTCDay(), so we mirror that here rather than assume.
const FIXED_STARTS_AT = "2030-06-10T10:00:00.000Z";
const DAY_OF_WEEK = new Date(FIXED_STARTS_AT).getUTCDay();

describe("trainers.checkAvailability", () => {
  it("is available within a set window with no conflicting class", async () => {
    const trainer = await makeUser({ role: "trainer" });
    await callerAs(trainer).trainers.setAvailability({
      dayOfWeek: DAY_OF_WEEK,
      startTime: "08:00",
      endTime: "18:00",
    });

    const admin = await makeUser({ role: "admin" });
    const result = await callerAs(admin).trainers.checkAvailability({
      trainerId: trainer.id,
      startsAt: FIXED_STARTS_AT,
      durationMin: 60,
    });
    expect(result).toEqual({ available: true });
  });

  it("is unavailable when no availability is set for that day", async () => {
    const trainer = await makeUser({ role: "trainer" });
    const admin = await makeUser({ role: "admin" });

    const result = await callerAs(admin).trainers.checkAvailability({
      trainerId: trainer.id,
      startsAt: FIXED_STARTS_AT,
      durationMin: 60,
    });
    expect(result).toEqual({
      available: false,
      reason: "No availability set for this day",
    });
  });

  it("is unavailable outside the set window", async () => {
    const trainer = await makeUser({ role: "trainer" });
    await callerAs(trainer).trainers.setAvailability({
      dayOfWeek: DAY_OF_WEEK,
      startTime: "08:00",
      endTime: "09:00",
    });

    const admin = await makeUser({ role: "admin" });
    const result = await callerAs(admin).trainers.checkAvailability({
      trainerId: trainer.id,
      startsAt: FIXED_STARTS_AT, // 10:00, outside 08:00-09:00
      durationMin: 60,
    });
    expect(result).toEqual({ available: false, reason: "Outside availability hours" });
  });

  it("is unavailable when the trainer already has an overlapping class", async () => {
    const trainer = await makeUser({ role: "trainer" });
    await callerAs(trainer).trainers.setAvailability({
      dayOfWeek: DAY_OF_WEEK,
      startTime: "08:00",
      endTime: "18:00",
    });
    await makeClass({
      trainerId: trainer.id,
      startsAt: FIXED_STARTS_AT,
      durationMin: 60,
    });

    const admin = await makeUser({ role: "admin" });
    const result = await callerAs(admin).trainers.checkAvailability({
      trainerId: trainer.id,
      startsAt: FIXED_STARTS_AT,
      durationMin: 60,
    });
    expect(result).toEqual({
      available: false,
      reason: "Trainer already has a class at this time",
    });
  });

  it(
    "FIXED (see documents/day1-discovery-notes.md finding 9, " +
      "documents/day4-fix-and-log-notes.md): classes.create now enforces " +
      "the same availability check classes.checkAvailability computes",
    async () => {
      const trainer = await makeUser({ role: "trainer" });
      await callerAs(trainer).trainers.setAvailability({
        dayOfWeek: DAY_OF_WEEK,
        startTime: "08:00",
        endTime: "18:00",
      });
      await makeClass({
        trainerId: trainer.id,
        startsAt: FIXED_STARTS_AT,
        durationMin: 60,
      });

      const admin = await makeUser({ role: "admin" });
      const check = await callerAs(admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: FIXED_STARTS_AT,
        durationMin: 60,
      });
      expect(check.available).toBe(false);

      await expect(
        callerAs(admin).classes.create({
          name: "Double-booked class",
          room: "Studio B",
          capacity: 5,
          trainerId: trainer.id,
          startsAt: FIXED_STARTS_AT,
          durationMin: 60,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    },
  );

  it("rejects classes.update when the patch would create a trainer conflict", async () => {
    const trainer = await makeUser({ role: "trainer" });
    await callerAs(trainer).trainers.setAvailability({
      dayOfWeek: DAY_OF_WEEK,
      startTime: "08:00",
      endTime: "18:00",
    });
    await makeClass({ trainerId: trainer.id, startsAt: FIXED_STARTS_AT, durationMin: 60 });

    const admin = await makeUser({ role: "admin" });
    const otherClass = await makeClass({ room: "Studio C" });

    await expect(
      callerAs(admin).classes.update({
        id: otherClass.id,
        trainerId: trainer.id,
        startsAt: FIXED_STARTS_AT,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows classes.update to touch a class's own trainer/time without self-conflicting", async () => {
    const trainer = await makeUser({ role: "trainer" });
    await callerAs(trainer).trainers.setAvailability({
      dayOfWeek: DAY_OF_WEEK,
      startTime: "08:00",
      endTime: "18:00",
    });
    const admin = await makeUser({ role: "admin" });
    const cls = await callerAs(admin).classes.create({
      name: "Original",
      room: "Studio B",
      capacity: 5,
      trainerId: trainer.id,
      startsAt: FIXED_STARTS_AT,
      durationMin: 60,
    });

    const updated = await callerAs(admin).classes.update({
      id: cls.id,
      capacity: 6,
    });
    expect(updated.capacity).toBe(6);
  });
});
