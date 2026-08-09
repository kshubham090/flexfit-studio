import { db } from "@/db";
import { hashPassword } from "@/lib/password";
import {
  users,
  membershipPlans,
  memberships,
  classes,
  companies,
  companyMembers,
  notifications,
  type User,
} from "@/db/schema";

// Fixtures never assume a clean/global DB (tests share one SQLite file, see
// vitest.config.ts) -- every row is created fresh per call with a unique
// email/name so tests only ever assert on IDs they created themselves.
let counter = 0;
function unique(label: string) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<User> {
  return db
    .insert(users)
    .values({
      email: `${unique("user")}@test.local`,
      passwordHash: hashPassword("password123"),
      name: unique("Test User"),
      role: "member",
      ...overrides,
    })
    .returning()
    .get();
}

export async function makePlan(overrides: Partial<typeof membershipPlans.$inferInsert> = {}) {
  return db
    .insert(membershipPlans)
    .values({
      name: unique("Plan"),
      priceCents: 5000,
      durationDays: 30,
      classCredits: 10,
      active: true,
      ...overrides,
    })
    .returning()
    .get();
}

/** Active membership for `user`, defaulting to a plan with 10 credits and a
 * far-future end date so it never accidentally reads as expired. */
export async function makeMembership(
  user: User,
  overrides: Partial<typeof memberships.$inferInsert> = {},
) {
  const plan = await makePlan();
  const today = new Date().toISOString().slice(0, 10);
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return db
    .insert(memberships)
    .values({
      userId: user.id,
      planId: plan.id,
      startDate: today,
      endDate: farFuture,
      creditsRemaining: plan.classCredits,
      status: "active",
      ...overrides,
    })
    .returning()
    .get();
}

/** A class defaulting to capacity 1, starting well in the future (so
 * booking-window checks pass) and costing 1 credit. */
export async function makeClass(overrides: Partial<typeof classes.$inferInsert> = {}) {
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  return db
    .insert(classes)
    .values({
      name: unique("Class"),
      room: "Studio A",
      capacity: 1,
      startsAt,
      durationMin: 60,
      creditCost: 1,
      cancelled: false,
      ...overrides,
    })
    .returning()
    .get();
}

export async function makeCompany(overrides: Partial<typeof companies.$inferInsert> = {}) {
  return db
    .insert(companies)
    .values({
      name: unique("Company"),
      contactEmail: `${unique("company")}@test.local`,
      creditPoolBalance: 100,
      active: true,
      ...overrides,
    })
    .returning()
    .get();
}

export async function linkCompanyMember(user: User, companyId: number) {
  return db
    .insert(companyMembers)
    .values({ userId: user.id, companyId })
    .returning()
    .get();
}

/** Inserted directly (no router mutation creates a single targeted
 * notification -- see documents/day1-discovery-notes.md finding 4), for
 * arranging test state only. */
export async function makeNotification(
  user: User,
  overrides: Partial<typeof notifications.$inferInsert> = {},
) {
  return db
    .insert(notifications)
    .values({
      userId: user.id,
      type: "announcement",
      title: unique("Notice"),
      message: "Test notification",
      read: false,
      ...overrides,
    })
    .returning()
    .get();
}

/** Hours-from-now ISO timestamp, for building classes at specific offsets
 * relative to policy windows (e.g. just inside/outside a cancellation
 * window). */
export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
