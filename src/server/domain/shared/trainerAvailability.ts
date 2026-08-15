import { and, eq, ne } from "drizzle-orm";
import { classes, trainerAvailability } from "@/db/schema";
import type { AnyDb } from "./db";

type AvailabilityResult = { available: true } | { available: false; reason: string };

/**
 * The conflict check trainers.checkAvailability has always computed, now
 * shared so classes.create/update can enforce it too -- fixes
 * documents/day1-discovery-notes.md finding 9: this used to be advisory
 * only (nothing server-side stopped a trainer being double-booked).
 * `excludeClassId` lets an update check against a class's own trainer
 * without flagging the class as conflicting with itself.
 * See documents/day4-fix-and-log-notes.md.
 */
export async function checkTrainerAvailability(
  db: AnyDb,
  trainerId: number,
  startsAt: string,
  durationMin: number,
  excludeClassId?: number,
): Promise<AvailabilityResult> {
  const classStart = new Date(startsAt);
  const classEnd = new Date(classStart.getTime() + durationMin * 60000);

  const dayOfWeek = classStart.getUTCDay();
  const startTimeStr =
    String(classStart.getUTCHours()).padStart(2, "0") +
    ":" +
    String(classStart.getUTCMinutes()).padStart(2, "0");
  const endTimeStr =
    String(classEnd.getUTCHours()).padStart(2, "0") +
    ":" +
    String(classEnd.getUTCMinutes()).padStart(2, "0");

  const availability = await db
    .select()
    .from(trainerAvailability)
    .where(
      and(
        eq(trainerAvailability.trainerId, trainerId),
        eq(trainerAvailability.dayOfWeek, dayOfWeek),
      ),
    )
    .get();

  if (!availability) {
    return { available: false, reason: "No availability set for this day" };
  }

  const isWithinAvailability =
    startTimeStr >= availability.startTime && endTimeStr <= availability.endTime;

  if (!isWithinAvailability) {
    return { available: false, reason: "Outside availability hours" };
  }

  const conflictFilters = [eq(classes.trainerId, trainerId), eq(classes.cancelled, false)];
  if (excludeClassId !== undefined) {
    conflictFilters.push(ne(classes.id, excludeClassId));
  }

  const conflictingClasses = await db
    .select()
    .from(classes)
    .where(and(...conflictFilters));

  for (const cls of conflictingClasses) {
    const existStart = new Date(cls.startsAt);
    const existEnd = new Date(existStart.getTime() + cls.durationMin * 60000);

    if (classStart < existEnd && classEnd > existStart) {
      return { available: false, reason: "Trainer already has a class at this time" };
    }
  }

  return { available: true };
}
