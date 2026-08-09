import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, desc } from "drizzle-orm";
import {
  companies,
  companyMembers,
  users,
  corporateBookings,
  classes,
} from "@/db/schema";
import { router, adminProcedure } from "../trpc";

export const adminCompaniesRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: companies.id,
        name: companies.name,
        contactEmail: companies.contactEmail,
        creditPoolBalance: companies.creditPoolBalance,
        active: companies.active,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .orderBy(desc(companies.createdAt));
  }),

  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const company = await ctx.db
        .select()
        .from(companies)
        .where(eq(companies.id, input.id))
        .get();

      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
      }

      const members = await ctx.db
        .select({
          id: users.id,
          companyMemberId: companyMembers.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
        })
        .from(companyMembers)
        .innerJoin(users, eq(companyMembers.userId, users.id))
        .where(eq(companyMembers.companyId, company.id))
        .orderBy(users.name);

      const recentBookings = await ctx.db
        .select({
          id: corporateBookings.id,
          status: corporateBookings.status,
          creditsUsed: corporateBookings.creditsUsed,
          bookedAt: corporateBookings.bookedAt,
          className: classes.name,
          startsAt: classes.startsAt,
          memberName: users.name,
        })
        .from(corporateBookings)
        .innerJoin(classes, eq(corporateBookings.classId, classes.id))
        .innerJoin(users, eq(corporateBookings.userId, users.id))
        .where(eq(corporateBookings.companyId, company.id))
        .orderBy(desc(corporateBookings.bookedAt))
        .limit(20);

      return {
        ...company,
        members,
        recentBookings,
      };
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        contactEmail: z.string().email(),
        creditPoolBalance: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.db
        .insert(companies)
        .values({
          name: input.name,
          contactEmail: input.contactEmail,
          creditPoolBalance: input.creditPoolBalance,
          active: true,
        })
        .returning()
        .get();

      return created;
    }),

  updateActive: adminProcedure
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const company = await ctx.db
        .select()
        .from(companies)
        .where(eq(companies.id, input.id))
        .get();

      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
      }

      return ctx.db
        .update(companies)
        .set({ active: input.active })
        .where(eq(companies.id, input.id))
        .returning()
        .get();
    }),

  topUp: adminProcedure
    .input(z.object({ id: z.number(), amount: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const company = await ctx.db
        .select()
        .from(companies)
        .where(eq(companies.id, input.id))
        .get();

      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
      }

      return ctx.db
        .update(companies)
        .set({
          creditPoolBalance: company.creditPoolBalance + input.amount,
        })
        .where(eq(companies.id, input.id))
        .returning()
        .get();
    }),

  linkMember: adminProcedure
    .input(z.object({ companyId: z.number(), userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const company = await ctx.db
        .select()
        .from(companies)
        .where(eq(companies.id, input.companyId))
        .get();

      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
      }

      const user = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .get();

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }

      if (user.role !== "member") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only members can be linked to companies.",
        });
      }

      const existing = await ctx.db
        .select()
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.userId, input.userId),
            eq(companyMembers.companyId, input.companyId),
          ),
        )
        .get();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This member is already linked to this company.",
        });
      }

      return ctx.db
        .insert(companyMembers)
        .values({
          userId: input.userId,
          companyId: input.companyId,
        })
        .returning()
        .get();
    }),

  unlinkMember: adminProcedure
    .input(z.object({ companyMemberId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const companyMember = await ctx.db
        .select()
        .from(companyMembers)
        .where(eq(companyMembers.id, input.companyMemberId))
        .get();

      if (!companyMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Company member link not found.",
        });
      }

      await ctx.db
        .delete(companyMembers)
        .where(eq(companyMembers.id, input.companyMemberId));

      return { ok: true };
    }),
});
