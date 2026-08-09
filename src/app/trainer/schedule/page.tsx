"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";

function ClassCard({
  classId,
  className,
  startsAt,
  room,
  durationMin,
  cancelled,
}: {
  classId: number;
  className: string;
  startsAt: string;
  room: string;
  durationMin: number;
  cancelled: boolean;
}) {
  const { data: roster, isLoading: rosterLoading } = trpc.bookings.rosterFor.useQuery({
    classId,
  });
  const { data: checkinData, isLoading: checkinLoading } =
    trpc.bookings.checkinCountFor.useQuery({ classId });

  const bookedCount =
    roster?.filter((r) => r.status === "booked" || r.status === "attended").length || 0;
  const checkins = checkinData?.count || 0;

  return (
    <div className="p-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{className}</div>
          <div className="muted mt-1 text-xs">
            {formatDateTime(startsAt)} · {room} · {durationMin} min
          </div>
          {!rosterLoading && !checkinLoading && (
            <div className="muted mt-2 text-xs">
              📊 {bookedCount} booked · ✓ {checkins} checked in
            </div>
          )}
          {cancelled && (
            <div
              className="mt-1 rounded px-2 py-1 text-xs"
              style={{ background: "#7f1d1d", color: "#fca5a5" }}
            >
              Cancelled
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function TrainerSchedulePage() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const { data: classes, isLoading: classesLoading } =
    trpc.trainers.upcomingClasses.useQuery(undefined, {
      enabled: user?.role === "trainer",
    });
  const { data: availability, isLoading: availLoading } =
    trpc.trainers.availability.useQuery(undefined, {
      enabled: user?.role === "trainer",
    });

  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const setAvailability = trpc.trainers.setAvailability.useMutation({
    onSuccess: async () => {
      await utils.trainers.availability.invalidate();
      setEditingDay(null);
      setStartTime("");
      setEndTime("");
    },
  });

  const removeAvailability = trpc.trainers.removeAvailability.useMutation({
    onSuccess: async () => {
      await utils.trainers.availability.invalidate();
    },
  });

  if (user?.role !== "trainer") {
    return <p className="muted">Access denied. Trainers only.</p>;
  }

  const isLoading = classesLoading || availLoading;

  const handleEditDay = (day: number) => {
    const existing = availability?.find((a) => a.dayOfWeek === day);
    setEditingDay(day);
    setStartTime(existing?.startTime || "");
    setEndTime(existing?.endTime || "");
  };

  const handleSave = () => {
    if (editingDay === null || !startTime || !endTime) return;
    setAvailability.mutate({
      dayOfWeek: editingDay,
      startTime,
      endTime,
    });
  };

  const handleRemove = (day: number) => {
    removeAvailability.mutate({ dayOfWeek: day });
  };

  if (isLoading) return <p className="muted">Loading...</p>;

  const availabilityMap = new Map(availability?.map((a) => [a.dayOfWeek, a]) || []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trainer Schedule</h1>
        <p className="muted mt-1 text-sm">
          Manage your availability and upcoming classes
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Upcoming Classes</h2>
        {classes && classes.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {classes.map((cls) => (
              <ClassCard
                key={cls.id}
                classId={cls.id}
                className={cls.name}
                startsAt={cls.startsAt}
                room={cls.room}
                durationMin={cls.durationMin}
                cancelled={cls.cancelled}
              />
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No upcoming classes.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Weekly Availability</h2>
        <div className="space-y-2">
          {DAYS.map((day, idx) => {
            const avail = availabilityMap.get(idx);
            const isEditing = editingDay === idx;

            return (
              <div key={idx} className="panel p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{day}</div>
                    {avail && !isEditing && (
                      <div className="muted mt-1 text-sm">
                        {avail.startTime} - {avail.endTime}
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="ml-4 flex gap-2">
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="rounded border px-2 py-1 text-sm"
                        style={{
                          borderColor: "var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--fg)",
                        }}
                      />
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="rounded border px-2 py-1 text-sm"
                        style={{
                          borderColor: "var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--fg)",
                        }}
                      />
                      <button
                        onClick={handleSave}
                        disabled={setAvailability.isPending || !startTime || !endTime}
                        className="btn btn-primary btn-sm"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingDay(null)}
                        className="btn btn-sm"
                        style={{
                          background: "var(--bg-secondary)",
                          color: "var(--fg)",
                          borderColor: "var(--border)",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="ml-4 flex gap-2">
                      <button
                        onClick={() => handleEditDay(idx)}
                        className="btn btn-sm"
                        style={{
                          background: "var(--bg-secondary)",
                          color: "var(--fg)",
                          borderColor: "var(--border)",
                        }}
                      >
                        {avail ? "Edit" : "Add"}
                      </button>
                      {avail && (
                        <button
                          onClick={() => handleRemove(idx)}
                          disabled={removeAvailability.isPending}
                          className="btn btn-sm"
                          style={{
                            background: "var(--bg-secondary)",
                            color: "#ef4444",
                            borderColor: "var(--border)",
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
