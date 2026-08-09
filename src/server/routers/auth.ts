import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { users, sessions } from "@/db/schema";
import { verifyPassword, hashPassword } from "@/lib/password";
import { router, publicProcedure, protectedProcedure, SESSION_COOKIE } from "../trpc";

const SESSION_DAYS = 30;

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email.toLowerCase().trim()))
        .get();

      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Email or password is incorrect.",
        });
      }

      if (!user.active) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This account has been deactivated.",
        });
      }

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

      await ctx.db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      const store = await cookies();
      store.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      });

      return { id: user.id, name: user.name, role: user.role };
    }),

  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string().min(1),
        phone: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      const existing = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .get();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with that email already exists.",
        });
      }

      const created = await ctx.db
        .insert(users)
        .values({
          email,
          passwordHash: hashPassword(input.password),
          name: input.name,
          phone: input.phone ?? null,
          role: "member",
        })
        .returning()
        .get();

      return { id: created.id, name: created.name };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.token) {
      await ctx.db.delete(sessions).where(eq(sessions.token, ctx.token));
    }
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return { ok: true };
  }),
});
