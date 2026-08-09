"use client";

import { trpc } from "@/lib/trpc";
import { formatDate, formatDateTime } from "@/lib/format";

export default function AdminAttendancePage() {
  const { data: user } = trpc.auth.me.useQuery();
  const { data: checkinsPerDay, isLoading: checkinsLoading } =
    trpc.admin.checkinsPerDay.useQuery();
  const { data: topTrainers, isLoading: trainersLoading } =
    trpc.admin.topTrainers.useQuery();
  const { data: noShowList, isLoading: noShowLoading } = trpc.admin.noShowList.useQuery();

  const isLoading = checkinsLoading || trainersLoading || noShowLoading;

  if (user?.role !== "admin") {
    return <p className="muted">Access denied. Admins only.</p>;
  }

  if (isLoading) return <p className="muted">Loading attendance data...</p>;

  const totalCheckins = (checkinsPerDay || []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="muted mt-1 text-sm">
          Last 14 days of check-ins and class attendance
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide">
            Total Check-ins (14d)
          </div>
          <div className="mt-1 text-xl font-semibold">{totalCheckins}</div>
        </div>

        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide">Top Trainer</div>
          <div className="mt-1 text-xl font-semibold">
            {topTrainers && topTrainers.length > 0 ? topTrainers[0].trainerName : "N/A"}
          </div>
        </div>

        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide">No-shows (14d)</div>
          <div className="mt-1 text-xl font-semibold">{noShowList?.length ?? 0}</div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Check-ins by Day (Last 14 Days)</h2>
        {checkinsPerDay && checkinsPerDay.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {checkinsPerDay.map((row) => (
              <div
                key={row.date}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span className="muted">{formatDate(row.date)}</span>
                <span className="font-medium">{row.count} check-ins</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No check-in data available.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Top Trainers by Attended Classes</h2>
        {topTrainers && topTrainers.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {topTrainers.map((trainer) => (
              <div key={trainer.trainerId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{trainer.trainerName}</div>
                    <div className="muted text-xs">
                      {trainer.classCount} classes taught
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{trainer.attendedCount}</div>
                    <div className="muted text-xs">attendees</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No trainer data available.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">No-shows (Last 14 Days)</h2>
        {noShowList && noShowList.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {noShowList.map((item) => (
              <div key={item.bookingId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{item.memberName}</div>
                    <div className="muted text-xs">{item.memberEmail}</div>
                    <div className="muted text-xs mt-1">{item.className}</div>
                    <div className="muted text-xs">{formatDateTime(item.classDate)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No no-shows in the last 14 days.</p>
        )}
      </section>
    </div>
  );
}
