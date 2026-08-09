import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { bookings, classes, reschedules, type Booking, type GymClass } from "@/db/schema";
import { hoursUntil } from "../shared/time";
import type { AnyDb } from "../shared/db";
import { FREE_RESCHEDULE_HOURS } from "./policy";

type DbClient = typeof import("@/db").db;

type RescheduleErrorCode = "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT";

type ValidationResult =
  | { valid: false; code: RescheduleErrorCode; reason: string }
  | {
      valid: true;
      originalBooking: Booking;
      originalClass: GymClass;
      targetClass: GymClass;
      targetIsFull: boolean;
    };

/**
 * Shared by both `reschedule` (mutation) and `validateReschedule` (query) --
 * this is the ~140 lines that used to be duplicated between them
 * (documents/day1-discovery-notes.md finding 10). `reschedule` throws using
 * `code`/`reason` below; `validateReschedule` returns `{ valid, reason }`
 * as-is, matching each call site's original output shape exactly.
 */
export async function validateRescheduleRequest(
  db: AnyDb,
  userId: number,
  fromBookingId: number,
  toClassId: number,
): Promise<ValidationResult> {
  const originalRow = await db
    .select({ booking: bookings, cls: classes })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(eq(bookings.id, fromBookingId))
    .get();

  if (!originalRow) {
    return { valid: false, code: "NOT_FOUND", reason: "Booking not found." };
  }

  const originalBooking = originalRow.booking;
  const originalClass = originalRow.cls;

  if (originalBooking.userId !== userId) {
    return {
      valid: false,
      code: "FORBIDDEN",
      reason: "You cannot reschedule this booking.",
    };
  }

  if (originalBooking.status !== "booked" && originalBooking.status !== "waitlisted") {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "This booking is no longer active.",
    };
  }

  const hoursBeforeOriginal = hoursUntil(originalClass.startsAt);
  if (hoursBeforeOriginal < FREE_RESCHEDULE_HOURS) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
    };
  }

  const targetClass = await db
    .select()
    .from(classes)
    .where(eq(classes.id, toClassId))
    .get();

  if (!targetClass) {
    return { valid: false, code: "NOT_FOUND", reason: "Target class not found." };
  }

  if (targetClass.name !== originalClass.name) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "You can only reschedule to a class with the same name.",
    };
  }

  if (targetClass.id === originalClass.id) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "You are already booked for this class.",
    };
  }

  if (hoursUntil(targetClass.startsAt) <= 0) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "This class has already started.",
    };
  }

  if (targetClass.cancelled) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "This class has been cancelled.",
    };
  }

  const existingBooking = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, targetClass.id),
        eq(bookings.userId, userId),
        sql`${bookings.status} in ('booked', 'waitlisted')`,
      ),
    )
    .get();

  if (existingBooking) {
    return {
      valid: false,
      code: "CONFLICT",
      reason: "You already have an active booking for this class.",
    };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(and(eq(bookings.classId, targetClass.id), eq(bookings.status, "booked")));

  const targetIsFull = Number(count) >= targetClass.capacity;

  return { valid: true, originalBooking, originalClass, targetClass, targetIsFull };
}

/**
 * Cancels the original booking directly (not via domain/bookings'
 * cancelMember), so it does NOT trigger waitlist promotion on the vacated
 * class -- documents/day1-discovery-notes.md finding 1. Preserved exactly;
 * not a silent fix.
 */
export async function reschedule(
  db: DbClient,
  userId: number,
  fromBookingId: number,
  toClassId: number,
) {
  return db.transaction(async (tx) => {
    const validation = await validateRescheduleRequest(
      tx,
      userId,
      fromBookingId,
      toClassId,
    );

    if (!validation.valid) {
      throw new TRPCError({ code: validation.code, message: validation.reason });
    }

    const { originalBooking, originalClass, targetClass, targetIsFull } = validation;

    // Credits carry over at whatever was originally spent -- not re-priced
    // against the target class's own creditCost, even if it differs.
    const newBooking = await tx
      .insert(bookings)
      .values({
        classId: targetClass.id,
        userId,
        membershipId: originalBooking.membershipId,
        status: targetIsFull ? "waitlisted" : "booked",
        creditsUsed: originalBooking.creditsUsed,
      })
      .returning()
      .get();

    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
      .where(eq(bookings.id, originalBooking.id));

    await tx.insert(reschedules).values({
      userId,
      fromBookingId: originalBooking.id,
      toBookingId: newBooking.id,
      fromClassId: originalClass.id,
      toClassId: targetClass.id,
    });

    return {
      ok: true,
      newBooking,
      newStatus: targetIsFull ? "waitlisted" : "booked",
    };
  });
}
