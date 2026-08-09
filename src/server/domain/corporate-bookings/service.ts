import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  corporateBookings,
  classes,
  companies,
  companyMembers,
  checkins,
  type User,
} from "@/db/schema";
import { hoursUntil } from "../shared/time";
import type { AnyDb } from "../shared/db";
import { CORPORATE_FREE_CANCELLATION_HOURS } from "./policy";

type DbClient = typeof import("@/db").db;

// Deliberately separate from domain/bookings -- corporate and personal
// bookings are two independent channels against the same `classes` table
// (see documents/day1-discovery-notes.md finding 2: capacity is enforced
// per channel, not per class). Merging the two domains would resolve that
// gap as a side effect of restructuring instead of a deliberate decision,
// so it stays untouched here.

async function getCompanyForMember(db: AnyDb, userId: number) {
  return db
    .select()
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(and(eq(companyMembers.userId, userId), eq(companies.active, true)))
    .get();
}

export async function bookCorporate(db: DbClient, userId: number, classId: number) {
  return db.transaction(async (tx) => {
    const cls = await tx.select().from(classes).where(eq(classes.id, classId)).get();

    if (!cls) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
    }
    if (cls.cancelled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This class has been cancelled.",
      });
    }
    if (hoursUntil(cls.startsAt) <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This class has already started.",
      });
    }

    const existing = await tx
      .select()
      .from(corporateBookings)
      .where(
        and(
          eq(corporateBookings.classId, cls.id),
          eq(corporateBookings.userId, userId),
          inArray(corporateBookings.status, ["booked", "waitlisted"]),
        ),
      )
      .get();

    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "You are already on the list for this class.",
      });
    }

    const companyRow = await getCompanyForMember(tx, userId);
    if (!companyRow) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not linked to an active company.",
      });
    }

    const company = companyRow.companies;
    if (company.creditPoolBalance < cls.creditCost) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your company does not have enough credits.",
      });
    }

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(corporateBookings)
      .where(
        and(
          eq(corporateBookings.classId, cls.id),
          eq(corporateBookings.status, "booked"),
        ),
      );

    const isFull = Number(count) >= cls.capacity;

    const created = await tx
      .insert(corporateBookings)
      .values({
        classId: cls.id,
        userId,
        companyId: company.id,
        status: isFull ? "waitlisted" : "booked",
        creditsUsed: isFull ? 0 : cls.creditCost,
      })
      .returning()
      .get();

    if (!isFull) {
      await tx
        .update(companies)
        .set({ creditPoolBalance: company.creditPoolBalance - cls.creditCost })
        .where(eq(companies.id, company.id));
    }

    return created;
  });
}

export async function cancelCorporate(
  db: DbClient,
  bookingId: number,
  requestingUser: User,
) {
  return db.transaction(async (tx) => {
    const row = await tx
      .select({ booking: corporateBookings, cls: classes })
      .from(corporateBookings)
      .innerJoin(classes, eq(corporateBookings.classId, classes.id))
      .where(eq(corporateBookings.id, bookingId))
      .get();

    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }

    const isOwner = row.booking.userId === requestingUser.id;
    const isStaff = requestingUser.role === "admin" || requestingUser.role === "trainer";
    if (!isOwner && !isStaff) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You cannot cancel this booking.",
      });
    }

    if (row.booking.status !== "booked" && row.booking.status !== "waitlisted") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This booking is no longer active.",
      });
    }

    const refundable =
      hoursUntil(row.cls.startsAt) >= CORPORATE_FREE_CANCELLATION_HOURS &&
      row.booking.creditsUsed > 0;

    await tx
      .update(corporateBookings)
      .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
      .where(eq(corporateBookings.id, row.booking.id));

    if (refundable) {
      const company = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, row.booking.companyId))
        .get();

      if (company) {
        await tx
          .update(companies)
          .set({ creditPoolBalance: company.creditPoolBalance + row.booking.creditsUsed })
          .where(eq(companies.id, company.id));
      }
    }

    // Freeing a confirmed spot promotes the member who has waited longest.
    if (row.booking.status === "booked") {
      const next = await tx
        .select()
        .from(corporateBookings)
        .where(
          and(
            eq(corporateBookings.classId, row.cls.id),
            eq(corporateBookings.status, "waitlisted"),
          ),
        )
        .orderBy(asc(corporateBookings.bookedAt))
        .get();

      if (next) {
        await tx
          .update(corporateBookings)
          .set({ status: "booked", creditsUsed: row.cls.creditCost })
          .where(eq(corporateBookings.id, next.id));

        const company = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, next.companyId))
          .get();

        if (company && company.creditPoolBalance >= row.cls.creditCost) {
          await tx
            .update(companies)
            .set({
              creditPoolBalance: Math.max(
                0,
                company.creditPoolBalance - row.cls.creditCost,
              ),
            })
            .where(eq(companies.id, company.id));
        }
      }
    }

    return { ok: true, refunded: refundable };
  });
}

export async function markCorporateAttended(
  db: DbClient,
  bookingId: number,
  _source: "front_desk" | "kiosk" | "app",
) {
  return db.transaction(async (tx) => {
    const booking = await tx
      .select()
      .from(corporateBookings)
      .where(eq(corporateBookings.id, bookingId))
      .get();

    if (!booking) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    if (booking.status !== "booked") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only confirmed bookings can be checked in.",
      });
    }

    await tx
      .update(corporateBookings)
      .set({ status: "attended" })
      .where(eq(corporateBookings.id, booking.id));

    // bookingId is deliberately null here, matching current behavior -- see
    // documents/day1-discovery-notes.md finding 3: this makes corporate
    // checkins invisible to bookings.checkinCountFor. Not fixed silently.
    await tx.insert(checkins).values({
      userId: booking.userId,
      bookingId: null,
    });

    return { ok: true };
  });
}
