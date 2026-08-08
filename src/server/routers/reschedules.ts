import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { reschedules, classes } from "@/db/schema";
import { router, protectedProcedure } from "../trpc";
import { reschedule, validateRescheduleRequest } from "../domain/reschedules/service";
import { FREE_RESCHEDULE_HOURS } from "../domain/reschedules/policy";

export { FREE_RESCHEDULE_HOURS };

export const reschedulesRouter = router({
  reschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      reschedule(ctx.db, ctx.user.id, input.fromBookingId, input.toClassId),
    ),

  history: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: reschedules.id,
        rescheduledAt: reschedules.rescheduledAt,
        fromClassName: classes.name,
        fromClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        fromClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        toClassName: sql<string>`(
          SELECT ${classes.name} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
      })
      .from(reschedules)
      .innerJoin(classes, eq(reschedules.fromClassId, classes.id))
      .where(eq(reschedules.userId, ctx.user.id))
      .orderBy(desc(reschedules.rescheduledAt));
  }),

  validateReschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await validateRescheduleRequest(
        ctx.db,
        ctx.user.id,
        input.fromBookingId,
        input.toClassId,
      );

      // Same shape as before: { valid: false, reason } or
      // { valid: true, targetIsFull } -- `code` is only needed by the
      // `reschedule` mutation's TRPCError, not surfaced to this query.
      if (!result.valid) {
        return { valid: false, reason: result.reason };
      }
      return { valid: true, targetIsFull: result.targetIsFull };
    }),
});
