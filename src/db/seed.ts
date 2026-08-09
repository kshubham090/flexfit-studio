import { db } from "./index";
import {
  users,
  sessions,
  membershipPlans,
  memberships,
  classes,
  bookings,
  checkins,
  payments,
  notifications,
  trainerAvailability,
  companies,
  companyMembers,
  corporateBookings,
  reschedules,
} from "./schema";
import { hashPassword } from "../lib/password";

function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCHours(6, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

function dateOnly(n: number): string {
  return daysFromNow(n).slice(0, 10);
}

async function seed() {
  console.log("Seeding FlexFit Studio...");

  await db.delete(reschedules);
  await db.delete(corporateBookings);
  await db.delete(companyMembers);
  await db.delete(companies);
  await db.delete(notifications);
  await db.delete(sessions);
  await db.delete(checkins);
  await db.delete(bookings);
  await db.delete(payments);
  await db.delete(memberships);
  await db.delete(classes);
  await db.delete(membershipPlans);
  await db.delete(trainerAvailability);
  await db.delete(users);

  const staff = await db
    .insert(users)
    .values([
      {
        email: "admin@flexfit.test",
        passwordHash: hashPassword("admin123"),
        name: "Priya Raman",
        phone: "+91 98450 11111",
        role: "admin",
      },
      {
        email: "arjun@flexfit.test",
        passwordHash: hashPassword("trainer123"),
        name: "Arjun Mehta",
        phone: "+91 98450 22222",
        role: "trainer",
      },
      {
        email: "sana@flexfit.test",
        passwordHash: hashPassword("trainer123"),
        name: "Sana Kapoor",
        phone: "+91 98450 33333",
        role: "trainer",
      },
      {
        email: "dmitri@flexfit.test",
        passwordHash: hashPassword("trainer123"),
        name: "Dmitri Volkov",
        phone: "+91 98450 44444",
        role: "trainer",
      },
    ])
    .returning();

  const memberSeed = [
    ["rahul.k@example.com", "Rahul Krishnan", "+91 90000 10001"],
    ["meera.n@example.com", "Meera Nair", "+91 90000 10002"],
    ["vikram.s@example.com", "Vikram Shetty", "+91 90000 10003"],
    ["aisha.b@example.com", "Aisha Begum", "+91 90000 10004"],
    ["tanvi.r@example.com", "Tanvi Rao", "+91 90000 10005"],
    ["karthik.p@example.com", "Karthik Pillai", "+91 90000 10006"],
    ["nikhil.j@example.com", "Nikhil Joshi", "+91 90000 10007"],
    ["divya.m@example.com", "Divya Menon", "+91 90000 10008"],
    ["farhan.a@example.com", "Farhan Ahmed", "+91 90000 10009"],
    ["sneha.g@example.com", "Sneha Gupta", "+91 90000 10010"],
    ["rohan.d@example.com", "Rohan Desai", "+91 90000 10011"],
    ["ananya.v@example.com", "Ananya Verma", "+91 90000 10012"],
  ];

  const members = await db
    .insert(users)
    .values(
      memberSeed.map(([email, name, phone]) => ({
        email,
        passwordHash: hashPassword("member123"),
        name,
        phone,
        role: "member" as const,
      })),
    )
    .returning();

  const plans = await db
    .insert(membershipPlans)
    .values([
      {
        name: "Drop-in Pack",
        description: "10 class credits, valid 90 days.",
        priceCents: 350000,
        durationDays: 90,
        classCredits: 10,
      },
      {
        name: "Monthly Unlimited",
        description: "Unlimited classes for 30 days.",
        priceCents: 450000,
        durationDays: 30,
        classCredits: 999,
      },
      {
        name: "Quarterly Unlimited",
        description: "Unlimited classes for 90 days.",
        priceCents: 1200000,
        durationDays: 90,
        classCredits: 999,
      },
      {
        name: "Annual Unlimited",
        description: "Unlimited classes for 365 days.",
        priceCents: 4000000,
        durationDays: 365,
        classCredits: 999,
      },
      {
        name: "Student Monthly",
        description: "Discounted monthly plan. Requires student ID at desk.",
        priceCents: 300000,
        durationDays: 30,
        classCredits: 999,
      },
      {
        name: "Legacy Founder Plan",
        description: "Closed to new signups.",
        priceCents: 200000,
        durationDays: 30,
        classCredits: 999,
        active: false,
      },
    ])
    .returning();

  const membershipRows = members.map((m, i) => {
    const plan = plans[i % 4];
    const started = -((i * 7) % 60);
    return {
      userId: m.id,
      planId: plan.id,
      startDate: dateOnly(started),
      endDate: dateOnly(started + plan.durationDays),
      creditsRemaining: plan.classCredits === 999 ? 999 : plan.classCredits - (i % 4),
      status: (started + plan.durationDays < 0 ? "expired" : "active") as
        "expired" | "active",
    };
  });

  const createdMemberships = await db
    .insert(memberships)
    .values(membershipRows)
    .returning();

  // Create companies and corporate members
  const createdCompanies = await db
    .insert(companies)
    .values([
      {
        name: "TechCorp Inc",
        contactEmail: "hr@techcorp.example.com",
        creditPoolBalance: 100,
        active: true,
      },
      {
        name: "FinServe Solutions",
        contactEmail: "wellness@finserve.example.com",
        creditPoolBalance: 80,
        active: true,
      },
    ])
    .returning();

  // Link some members to companies
  const companyMemberLinks = [
    { userId: members[0].id, companyId: createdCompanies[0].id },
    { userId: members[1].id, companyId: createdCompanies[0].id },
    { userId: members[2].id, companyId: createdCompanies[0].id },
    { userId: members[3].id, companyId: createdCompanies[1].id },
    { userId: members[4].id, companyId: createdCompanies[1].id },
  ];

  await db.insert(companyMembers).values(companyMemberLinks);

  await db.insert(payments).values(
    createdMemberships.map((ms, i) => ({
      userId: ms.userId,
      membershipId: ms.id,
      amountCents: plans.find((p) => p.id === ms.planId)!.priceCents,
      method: (["card", "upi", "cash", "transfer"] as const)[i % 4],
      status: (i === 3 ? "pending" : "paid") as "pending" | "paid",
      reference: `PAY-2026-${String(1000 + i)}`,
    })),
  );

  const classTemplates = [
    ["Sunrise Yoga", "Studio A", 18, 1, 6],
    ["HIIT Circuit", "Studio B", 14, 1, 7],
    ["Spin 45", "Spin Room", 20, 1, 7],
    ["Strength Basics", "Weights Floor", 10, 1, 18],
    ["Power Vinyasa", "Studio A", 18, 2, 18],
    ["Boxing Fundamentals", "Studio B", 12, 2, 19],
    ["Mobility & Recovery", "Studio A", 16, 1, 20],
    ["Advanced Spin", "Spin Room", 20, 2, 6],
  ];

  const classRows: (typeof classes.$inferInsert)[] = [];
  for (let day = -3; day <= 14; day++) {
    classTemplates.forEach((tpl, idx) => {
      const [name, room, capacity, creditCost, hour] = tpl as [
        string,
        string,
        number,
        number,
        number,
      ];
      if ((day + idx) % 3 === 0) return;
      const start = new Date(daysFromNow(day));
      start.setUTCHours(hour, idx % 2 === 0 ? 0 : 30, 0, 0);
      classRows.push({
        name,
        description: `${name} with our studio team.`,
        trainerId: staff[1 + (idx % 3)].id,
        room,
        capacity,
        startsAt: start.toISOString(),
        durationMin: name === "Spin 45" ? 45 : 60,
        creditCost,
        cancelled: day === 5 && idx === 2,
      });
    });
  }

  const createdClasses = await db.insert(classes).values(classRows).returning();

  await db.insert(trainerAvailability).values([
    { trainerId: staff[1].id, dayOfWeek: 0, startTime: "06:00", endTime: "12:00" },
    { trainerId: staff[1].id, dayOfWeek: 1, startTime: "06:00", endTime: "20:00" },
    { trainerId: staff[1].id, dayOfWeek: 2, startTime: "06:00", endTime: "14:00" },
    { trainerId: staff[1].id, dayOfWeek: 3, startTime: "08:00", endTime: "20:00" },
    { trainerId: staff[1].id, dayOfWeek: 4, startTime: "06:00", endTime: "18:00" },
    { trainerId: staff[1].id, dayOfWeek: 5, startTime: "07:00", endTime: "19:00" },
    { trainerId: staff[1].id, dayOfWeek: 6, startTime: "08:00", endTime: "16:00" },
    { trainerId: staff[2].id, dayOfWeek: 0, startTime: "08:00", endTime: "14:00" },
    { trainerId: staff[2].id, dayOfWeek: 1, startTime: "08:00", endTime: "18:00" },
    { trainerId: staff[2].id, dayOfWeek: 2, startTime: "10:00", endTime: "20:00" },
    { trainerId: staff[2].id, dayOfWeek: 3, startTime: "08:00", endTime: "16:00" },
    { trainerId: staff[2].id, dayOfWeek: 4, startTime: "09:00", endTime: "19:00" },
    { trainerId: staff[2].id, dayOfWeek: 5, startTime: "08:00", endTime: "20:00" },
    { trainerId: staff[2].id, dayOfWeek: 6, startTime: "10:00", endTime: "18:00" },
    { trainerId: staff[3].id, dayOfWeek: 0, startTime: "12:00", endTime: "20:00" },
    { trainerId: staff[3].id, dayOfWeek: 1, startTime: "12:00", endTime: "20:00" },
    { trainerId: staff[3].id, dayOfWeek: 2, startTime: "12:00", endTime: "20:00" },
    { trainerId: staff[3].id, dayOfWeek: 3, startTime: "12:00", endTime: "20:00" },
    { trainerId: staff[3].id, dayOfWeek: 4, startTime: "12:00", endTime: "20:00" },
    { trainerId: staff[3].id, dayOfWeek: 5, startTime: "12:00", endTime: "20:00" },
  ]);

  const bookingRows: (typeof bookings.$inferInsert)[] = [];
  createdClasses.forEach((cls, ci) => {
    const attendeeCount = (ci * 5) % (cls.capacity + 2);
    for (let a = 0; a < Math.min(attendeeCount, cls.capacity); a++) {
      const member = members[(ci + a) % members.length];
      const ms = createdMemberships.find((m) => m.userId === member.id);
      const isPast = new Date(cls.startsAt) < new Date(daysFromNow(0));
      bookingRows.push({
        classId: cls.id,
        userId: member.id,
        membershipId: ms?.id ?? null,
        status: isPast
          ? a % 7 === 0
            ? "no_show"
            : "attended"
          : a % 11 === 0
            ? "cancelled"
            : "booked",
        creditsUsed: cls.creditCost,
        cancelledAt: !isPast && a % 11 === 0 ? daysFromNow(-1) : null,
      });
    }
  });

  const createdBookings = await db.insert(bookings).values(bookingRows).returning();

  const attended = createdBookings.filter((b) => b.status === "attended");
  await db.insert(checkins).values(
    attended.map((b, i) => ({
      userId: b.userId,
      bookingId: b.id,
      source: (["front_desk", "kiosk", "app"] as const)[i % 3],
    })),
  );

  // Add sample notifications
  const sampleNotifications = [
    {
      userId: members[0].id,
      type: "waitlist_promotion" as const,
      title: "You've been promoted!",
      message:
        "You have been promoted from the waitlist to a confirmed spot for Sunrise Yoga.",
      read: false,
    },
    {
      userId: members[1].id,
      type: "class_cancelled" as const,
      title: "Class cancelled",
      message: "The HIIT Circuit class on Jul 23 has been cancelled by staff.",
      read: false,
    },
    {
      userId: members[2].id,
      type: "membership_expiring" as const,
      title: "Membership expiring soon",
      message: "Your membership expires in 5 days. Renew now to avoid interruption.",
      read: true,
    },
    {
      userId: members[3].id,
      type: "announcement" as const,
      title: "New class added!",
      message: "We've added a new Pilates class at 5pm on Wednesdays.",
      read: false,
    },
    {
      userId: members[0].id,
      type: "announcement" as const,
      title: "Studio maintenance",
      message:
        "Studio A will be closed for maintenance on Jul 29. All classes have been rescheduled.",
      read: false,
    },
  ];

  await db.insert(notifications).values(sampleNotifications);

  console.log(`  users:       ${staff.length + members.length}`);
  console.log(`  plans:       ${plans.length}`);
  console.log(`  memberships: ${createdMemberships.length}`);
  console.log(`  classes:     ${createdClasses.length}`);
  console.log(`  bookings:    ${createdBookings.length}`);
  console.log(`  checkins:    ${attended.length}`);
  console.log(`  notifications: ${sampleNotifications.length}`);
  console.log("Done.");
}

seed();
