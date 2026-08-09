"use client";

import { trpc } from "@/lib/trpc";
import { formatMoney, formatDate } from "@/lib/format";

export default function AdminReportsPage() {
  const { data: revenueByMonth, isLoading: monthLoading } =
    trpc.admin.revenueByMonth.useQuery();
  const { data: revenueByMethod, isLoading: methodLoading } =
    trpc.admin.revenueByMethod.useQuery();
  const { data: expiringMembers, isLoading: expiringLoading } =
    trpc.admin.expiringMemberships.useQuery();
  const { data: refundData, isLoading: refundLoading } =
    trpc.admin.refundCount.useQuery();

  const isLoading = monthLoading || methodLoading || expiringLoading || refundLoading;

  if (isLoading) return <p className="muted">Loading reports...</p>;

  const totalRevenue = (revenueByMonth || []).reduce(
    (sum, row) => sum + row.totalCents,
    0,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="muted mt-1 text-sm">Payment analytics and member insights</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide">Total Revenue</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(totalRevenue)}</div>
        </div>

        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide">Refunds Issued</div>
          <div className="mt-1 text-xl font-semibold">{refundData?.count ?? 0}</div>
        </div>

        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide">Payment Methods</div>
          <div className="mt-1 text-xl font-semibold">{revenueByMethod?.length ?? 0}</div>
        </div>

        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide">Expiring Soon</div>
          <div className="mt-1 text-xl font-semibold">{expiringMembers?.length ?? 0}</div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Revenue by Month</h2>
        {revenueByMonth && revenueByMonth.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {revenueByMonth.map((row) => (
              <div
                key={row.month}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span className="muted">{row.month}</span>
                <span className="font-medium">{formatMoney(row.totalCents)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No revenue data available.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Revenue by Payment Method</h2>
        {revenueByMethod && revenueByMethod.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {revenueByMethod.map((row) => (
              <div
                key={row.method}
                className="flex items-center justify-between p-3 text-sm"
              >
                <div className="flex-1">
                  <div className="capitalize">{row.method}</div>
                  <div className="muted text-xs">{row.count} transactions</div>
                </div>
                <span className="font-medium">{formatMoney(row.totalCents)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No payment method data available.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Memberships Expiring in 14 Days</h2>
        {expiringMembers && expiringMembers.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {expiringMembers.map((member) => (
              <div key={member.memberId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{member.memberName}</div>
                    <div className="muted text-xs">{member.memberEmail}</div>
                  </div>
                  <div className="text-right">
                    <div className="muted text-xs">{member.planName}</div>
                    <div className="text-xs">{formatDate(member.expiresAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No memberships expiring in the next 14 days.</p>
        )}
      </section>
    </div>
  );
}
