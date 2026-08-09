"use client";

import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";

export default function SchedulePage() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const { data: classes, isLoading } = trpc.classes.list.useQuery({
    from: new Date().toISOString(),
  });

  const book = trpc.bookings.book.useMutation({
    onSuccess: async () => {
      await utils.classes.list.invalidate();
      await utils.bookings.mine.invalidate();
    },
  });

  if (isLoading) return <p className="muted">Loading schedule...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Class schedule</h1>
        <p className="muted mt-1 text-sm">{classes?.length ?? 0} upcoming classes</p>
      </div>

      {book.error && (
        <p className="panel p-3 text-sm" style={{ color: "#f87171" }}>
          {book.error.message}
        </p>
      )}

      <div className="space-y-2">
        {classes?.map((c) => (
          <div key={c.id} className="panel flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{c.name}</h2>
                {c.full && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{ background: "#3a2a1a", color: "#fbbf24" }}
                  >
                    Full
                  </span>
                )}
              </div>
              <p className="muted mt-0.5 text-sm">
                {formatDateTime(c.startsAt)} &middot; {c.room} &middot;{" "}
                {c.trainerName ?? "Unassigned"} &middot; {c.durationMin} min
              </p>
            </div>

            <div className="text-right text-sm muted">
              <div>
                {c.spotsLeft} / {c.capacity} left
              </div>
              <div>
                {c.creditCost} credit{c.creditCost === 1 ? "" : "s"}
              </div>
            </div>

            <button
              className="btn btn-primary"
              disabled={!user || book.isPending}
              onClick={() => book.mutate({ classId: c.id })}
            >
              {c.full ? "Join waitlist" : "Book"}
            </button>
          </div>
        ))}
      </div>

      {!user && <p className="muted text-sm">Sign in to book a class.</p>}
    </div>
  );
}
