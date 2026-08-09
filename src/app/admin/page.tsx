"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { formatMoney, formatDateTime } from "@/lib/format";

export default function AdminPage() {
  const {
    data: stats,
    isLoading,
    error,
  } = trpc.admin.stats.useQuery(undefined, {
    retry: false,
  });
  const { data: utilisation } = trpc.admin.classUtilisation.useQuery({ limit: 8 });
  const { data: payments } = trpc.payments.all.useQuery({ limit: 10 });

  if (isLoading) return <p className="muted">Loading...</p>;
  if (error) return <p className="muted">{error.message}</p>;

  const tiles: [string, string][] = [
    ["Members", String(stats!.totalMembers)],
    ["Active memberships", String(stats!.activeMemberships)],
    ["Upcoming classes", String(stats!.upcomingClasses)],
    ["Revenue", formatMoney(stats!.revenueCents)],
    ["Check-ins", String(stats!.totalCheckins)],
    ["Pending payments", String(stats!.pendingPayments)],
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <div className="flex gap-2">
          <Link href="/admin/companies" className="btn btn-sm">
            Corporate Memberships
          </Link>
          <Link href="/admin/reports" className="btn btn-sm">
            Reports
          </Link>
          <Link href="/admin/announcements" className="btn btn-sm">
            Send announcement
          </Link>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="panel p-4">
            <div className="muted text-xs uppercase tracking-wide">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Class utilisation</h2>
        <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
          {utilisation?.map((c) => (
            <div key={c.id} className="flex items-center gap-4 p-3 text-sm">
              <span className="flex-1">{c.name}</span>
              <span className="muted">{formatDateTime(c.startsAt)}</span>
              <span className="muted">
                {c.booked}/{c.capacity}
              </span>
              <span style={{ color: c.utilisation > 0.8 ? "var(--accent)" : undefined }}>
                {Math.round(c.utilisation * 100)}%
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Recent payments</h2>
        <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
          {payments?.map((p) => (
            <div key={p.id} className="flex items-center gap-4 p-3 text-sm">
              <span className="flex-1">{p.memberName}</span>
              <span className="muted">{p.method}</span>
              <span className="muted">{p.status}</span>
              <span>{formatMoney(p.amountCents)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
