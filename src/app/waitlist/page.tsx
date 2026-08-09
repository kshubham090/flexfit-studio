"use client";

import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";

export default function WaitlistPage() {
  const utils = trpc.useUtils();
  const { data: waitlisted, isLoading } = trpc.bookings.waitlisted.useQuery();
  const cancel = trpc.bookings.cancel.useMutation({
    onSuccess: async () => {
      await utils.bookings.waitlisted.invalidate();
      await utils.bookings.mine.invalidate();
      await utils.classes.list.invalidate();
    },
  });

  if (isLoading) return <p className="muted">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waitlist</h1>
        <p className="muted mt-1 text-sm">Classes you&apos;re waitlisted for</p>
      </div>

      {cancel.error && (
        <p className="panel p-3 text-sm" style={{ color: "#f87171" }}>
          {cancel.error.message}
        </p>
      )}

      {waitlisted?.length ? (
        <div className="space-y-2">
          {waitlisted.map((w) => (
            <div key={w.bookingId} className="panel flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{w.className}</h3>
                  <span
                    className="rounded px-2 py-1 text-xs font-medium"
                    style={{ background: "#3a2a1a", color: "#fbbf24" }}
                  >
                    #{w.position} in queue
                  </span>
                </div>
                <p className="muted mt-0.5 text-sm">
                  {formatDateTime(w.startsAt)} &middot; {w.room} &middot; {w.durationMin}{" "}
                  min
                </p>
              </div>

              <button
                className="btn"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ bookingId: w.bookingId })}
              >
                Leave waitlist
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted text-sm">You&apos;re not waitlisted for any classes.</p>
      )}
    </div>
  );
}
