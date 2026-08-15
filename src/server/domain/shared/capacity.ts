import { and, eq, sql } from "drizzle-orm";
import { bookings, corporateBookings } from "@/db/schema";
import type { AnyDb } from "./db";

/**
 * Combined "booked" count for a class across BOTH booking channels.
 *
 * Fixes documents/day1-discovery-notes.md finding 2: capacity used to be
 * checked against each channel's own table independently, so a class could
 * end up with `capacity` member bookings AND `capacity` corporate bookings
 * at once. Both bookMember and bookCorporate now check fullness against
 * this shared count instead of their own table alone -- capacity is
 * enforced per class, not per channel. See documents/day4-fix-and-log-notes.md.
 */
export async function combinedBookedCount(db: AnyDb, classId: number): Promise<number> {
  const [{ memberCount }] = await db
    .select({ memberCount: sql<number>`count(*)` })
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.status, "booked")));

  const [{ corporateCount }] = await db
    .select({ corporateCount: sql<number>`count(*)` })
    .from(corporateBookings)
    .where(and(eq(corporateBookings.classId, classId), eq(corporateBookings.status, "booked")));

  return Number(memberCount) + Number(corporateCount);
}
