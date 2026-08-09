import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { users, memberships, membershipPlans, bookings } from "@/db/schema";
import { router, protectedProcedure, staffProcedure, adminProcedure } from "../trpc";

export const membersRouter = router({
  profile: protectedProcedure.query(async ({ ctx }) => {
    const membership = await ctx.db
      .select({
        id: memberships.id,
        status: memberships.status,
        startDate: memberships.startDate,
        endDate: memberships.endDate,
        creditsRemaining: memberships.creditsRemaining,
        planName: membershipPlans.name,
        planCredits: membershipPlans.classCredits,
      })
      .from(memberships)
      .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .where(eq(memberships.userId, ctx.user.id))
      .orderBy(desc(memberships.endDate))
      .get();

    const [{ attended }] = await ctx.db
      .select({ attended: sql<number>`count(*)` })
      .from(bookings)
      .where(and(eq(bookings.userId, ctx.user.id), eq(bookings.status, "attended")));

    return {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      phone: ctx.user.phone,
      role: ctx.user.role,
      membership: membership ?? null,
      classesAttended: Number(attended),
    };
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        phone: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.user.id))
        .returning()
        .get();
    }),

  search: staffProcedure
    .input(z.object({ q: z.string().default(""), limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      const term = `%${input.q.trim()}%`;
      return ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          role: users.role,
          active: users.active,
        })
        .from(users)
        .where(
          input.q.trim()
            ? or(like(users.name, term), like(users.email, term))
            : undefined,
        )
        .limit(input.limit);
    }),

  byId: staffProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.select().from(users).where(eq(users.id, input.id)).get();

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      const history = await ctx.db
        .select({
          id: memberships.id,
          planName: membershipPlans.name,
          startDate: memberships.startDate,
          endDate: memberships.endDate,
          status: memberships.status,
          creditsRemaining: memberships.creditsRemaining,
        })
        .from(memberships)
        .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
        .where(eq(memberships.userId, user.id))
        .orderBy(desc(memberships.startDate));

      const { passwordHash: _omit, ...safe } = user;
      return { ...safe, memberships: history };
    }),

  setActive: adminProcedure
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(users)
        .set({ active: input.active })
        .where(eq(users.id, input.id))
        .returning()
        .get();
    }),

  setRole: adminProcedure
    .input(z.object({ id: z.number(), role: z.enum(["member", "trainer", "admin"]) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.id))
        .returning()
        .get();
    }),

  lookupByEmailOrPhone: staffProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const term = `%${input.query.trim()}%`;
      const user = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          role: users.role,
          active: users.active,
        })
        .from(users)
        .where(or(like(users.email, term), like(users.phone, term)))
        .get();

      if (!user || user.role !== "member") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      return user;
    }),
});
