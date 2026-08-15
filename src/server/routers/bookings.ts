import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { bookings, classes, checkins, corporateBookings, users } from "@/db/schema";
import { router, protectedProcedure, staffProcedure } from "../trpc";
import {
  bookMember,
  cancelMember,
  markMemberAttended,
  markMemberNoShow,
} from "../domain/bookings/service";
import { FREE_CANCELLATION_HOURS, UNLIMITED_CREDITS } from "../domain/bookings/policy";

export { FREE_CANCELLATION_HOURS, UNLIMITED_CREDITS };

export const bookingsRouter = router({
  mine: protectedProcedure
    .input(z.object({ includePast: z.boolean().default(false) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: bookings.id,
          status: bookings.status,
          creditsUsed: bookings.creditsUsed,
          bookedAt: bookings.bookedAt,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          cancelled: classes.cancelled,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.userId, ctx.user.id))
        .orderBy(asc(classes.startsAt));

      const now = new Date();
      return rows.filter((r) => (input.includePast ? true : new Date(r.startsAt) >= now));
    }),

  book: protectedProcedure
    .input(z.object({ classId: z.number() }))
    .mutation(async ({ ctx, input }) => bookMember(ctx.db, ctx.user.id, input.classId)),

  cancel: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => cancelMember(ctx.db, input.bookingId, ctx.user)),

  markAttended: staffProcedure
    .input(
      z.object({
        bookingId: z.number(),
        source: z.enum(["front_desk", "kiosk", "app"]).default("front_desk"),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      markMemberAttended(ctx.db, input.bookingId, input.source),
    ),

  // Fixes finding 13 (newly found, not one of the original 12 -- see
  // documents/day4-fix-and-log-notes.md): "no_show" was a valid status
  // nothing could ever actually set.
  markNoShow: staffProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => markMemberNoShow(ctx.db, input.bookingId)),

  rosterFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          memberId: users.id,
          memberName: users.name,
          memberEmail: users.email,
          bookedAt: bookings.bookedAt,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(bookings.classId, input.classId))
        .orderBy(asc(bookings.bookedAt));
    }),

  upcomingForMember: staffProcedure
    .input(z.object({ userId: z.number(), hoursAhead: z.number().default(2) }))
    .query(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const futureTime = new Date(
        Date.now() + input.hoursAhead * 60 * 60 * 1000,
      ).toISOString();

      return ctx.db
        .select({
          bookingId: bookings.id,
          bookingStatus: bookings.status,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          capacity: classes.capacity,
          trainerId: classes.trainerId,
          trainerName: users.name,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .leftJoin(users, eq(classes.trainerId, users.id))
        .where(
          and(
            eq(bookings.userId, input.userId),
            eq(bookings.status, "booked"),
            sql`${classes.startsAt} >= ${now}`,
            sql`${classes.startsAt} <= ${futureTime}`,
            eq(classes.cancelled, false),
          ),
        )
        .orderBy(classes.startsAt);
    }),

  // Counts check-ins across BOTH channels for the class -- fixes
  // documents/day1-discovery-notes.md finding 3: corporate check-ins used
  // to be invisible here since checkins.bookingId is always null for them.
  // See documents/day4-fix-and-log-notes.md.
  checkinCountFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [memberResult] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(checkins)
        .innerJoin(bookings, eq(checkins.bookingId, bookings.id))
        .where(eq(bookings.classId, input.classId));

      const [corporateResult] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(checkins)
        .innerJoin(corporateBookings, eq(checkins.corporateBookingId, corporateBookings.id))
        .where(eq(corporateBookings.classId, input.classId));

      return {
        count: Number(memberResult?.count ?? 0) + Number(corporateResult?.count ?? 0),
      };
    }),

  waitlisted: protectedProcedure.query(async ({ ctx }) => {
    const waitlistedBookings = await ctx.db
      .select({
        bookingId: bookings.id,
        classId: classes.id,
        className: classes.name,
        room: classes.room,
        startsAt: classes.startsAt,
        durationMin: classes.durationMin,
        capacity: classes.capacity,
        bookedAt: bookings.bookedAt,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(and(eq(bookings.userId, ctx.user.id), eq(bookings.status, "waitlisted")))
      .orderBy(asc(classes.startsAt));

    // For each waitlisted booking, calculate position in queue
    const result = await Promise.all(
      waitlistedBookings.map(async (wb) => {
        const [{ position }] = await ctx.db
          .select({ position: sql<number>`count(*)` })
          .from(bookings)
          .where(
            and(
              eq(bookings.classId, wb.classId),
              eq(bookings.status, "waitlisted"),
              sql`${bookings.bookedAt} < ${wb.bookedAt}`,
            ),
          );

        return {
          ...wb,
          position: Number(position) + 1, // +1 because we're counting those before us
        };
      }),
    );

    return result;
  }),
});
