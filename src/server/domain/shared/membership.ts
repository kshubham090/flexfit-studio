import { and, desc, eq, sql } from "drizzle-orm";
import { memberships } from "@/db/schema";
import type { AnyDb } from "./db";

/**
 * Whichever active membership has the latest end date. If a user somehow
 * holds more than one active membership, the others are simply not
 * returned here -- see documents/day1-discovery-notes.md finding 6.
 */
export async function activeMembershipFor(db: AnyDb, userId: number) {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        sql`${memberships.endDate} >= ${today}`,
      ),
    )
    .orderBy(desc(memberships.endDate))
    .get();
}
