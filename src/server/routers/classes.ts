import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { classes, bookings, users } from "@/db/schema";
import { router, publicProcedure, staffProcedure, adminProcedure } from "../trpc";
import { cancelClass } from "../domain/classes/service";
import { checkTrainerAvailability } from "../domain/shared/trainerAvailability";

export const classesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          from: z.string().optional(),
          to: z.string().optional(),
          includeCancelled: z.boolean().default(false),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.from) filters.push(gte(classes.startsAt, input.from));
      if (input.to) filters.push(lte(classes.startsAt, input.to));
      if (!input.includeCancelled) filters.push(eq(classes.cancelled, false));

      const rows = await ctx.db
        .select({
          id: classes.id,
          name: classes.name,
          description: classes.description,
          room: classes.room,
          capacity: classes.capacity,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          creditCost: classes.creditCost,
          cancelled: classes.cancelled,
          trainerName: users.name,
          booked: sql<number>`(
            select count(*) from ${bookings}
            where ${bookings.classId} = ${classes.id}
              and ${bookings.status} = 'booked'
          )`.as("booked"),
        })
        .from(classes)
        .leftJoin(users, eq(classes.trainerId, users.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(classes.startsAt));

      return rows.map((r) => ({
        ...r,
        spotsLeft: Math.max(0, r.capacity - Number(r.booked)),
        full: Number(r.booked) >= r.capacity,
      }));
    }),

  byId: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const cls = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.id))
        .get();

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      const roster = await ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          memberName: users.name,
          memberEmail: users.email,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(bookings.classId, cls.id));

      return { ...cls, roster };
    }),

  create: staffProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        trainerId: z.number().optional(),
        room: z.string().min(1),
        capacity: z.number().int().positive(),
        startsAt: z.string(),
        durationMin: z.number().int().positive().default(60),
        creditCost: z.number().int().min(0).default(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fixes documents/day1-discovery-notes.md finding 9: trainer
      // availability used to be advisory only -- trainers.checkAvailability
      // computed a real conflict check, but nothing called it here. See
      // documents/day4-fix-and-log-notes.md.
      if (input.trainerId != null) {
        const availability = await checkTrainerAvailability(
          ctx.db,
          input.trainerId,
          input.startsAt,
          input.durationMin,
        );
        if (!availability.available) {
          throw new TRPCError({ code: "CONFLICT", message: availability.reason });
        }
      }

      return ctx.db
        .insert(classes)
        .values({
          ...input,
          description: input.description ?? null,
          trainerId: input.trainerId ?? null,
        })
        .returning()
        .get();
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        room: z.string().min(1).optional(),
        capacity: z.number().int().positive().optional(),
        startsAt: z.string().optional(),
        trainerId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;

      const current = await ctx.db.select().from(classes).where(eq(classes.id, id)).get();
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      // Same fix as classes.create (finding 9) -- re-check availability
      // against whatever the trainer/start time will be after this patch,
      // excluding this class itself from the conflict check.
      const effectiveTrainerId =
        patch.trainerId !== undefined ? patch.trainerId : current.trainerId;
      const effectiveStartsAt = patch.startsAt ?? current.startsAt;
      if (effectiveTrainerId != null) {
        const availability = await checkTrainerAvailability(
          ctx.db,
          effectiveTrainerId,
          effectiveStartsAt,
          current.durationMin,
          id,
        );
        if (!availability.available) {
          throw new TRPCError({ code: "CONFLICT", message: availability.reason });
        }
      }

      const updated = await ctx.db
        .update(classes)
        .set(patch)
        .where(eq(classes.id, id))
        .returning()
        .get();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }
      return updated;
    }),

  cancel: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => cancelClass(ctx.db, input.id)),
});
