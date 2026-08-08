import { appRouter } from "@/server/routers/_app";
import { db } from "@/db";
import type { User } from "@/db/schema";

/**
 * Build a tRPC caller as a given user, bypassing HTTP and the
 * next/headers-dependent createContext (see CLAUDE.md "Testing approach").
 * Pass `null` for unauthenticated (publicProcedure-only) calls.
 */
export function callerAs(user: User | null) {
  return appRouter.createCaller({ db, user, token: null });
}
