"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import type { AppRouter } from "@/server/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type LookedUpMember = RouterOutputs["members"]["lookupByEmailOrPhone"];

export default function KioskPage() {
  const { data: user } = trpc.auth.me.useQuery();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<LookedUpMember | null>(null);
  const [checkinSuccess, setCheckinSuccess] = useState<{
    memberName: string;
    className: string;
  } | null>(null);

  const lookupMember = trpc.members.lookupByEmailOrPhone.useQuery(
    { query: searchQuery },
    { enabled: !!searchQuery && searchQuery.length > 2 },
  );

  const upcomingClasses = trpc.bookings.upcomingForMember.useQuery(
    { userId: selectedMember?.id || 0, hoursAhead: 2 },
    { enabled: !!selectedMember },
  );

  const memberDetails = trpc.members.byId.useQuery(
    { id: selectedMember?.id || 0 },
    { enabled: !!selectedMember },
  );

  const markAttended = trpc.bookings.markAttended.useMutation({
    onSuccess: (_, variables) => {
      const classInfo = upcomingClasses.data?.find(
        (c) => c.bookingId === variables.bookingId,
      );
      if (classInfo && selectedMember) {
        setCheckinSuccess({
          memberName: selectedMember.name,
          className: classInfo.className,
        });
        setTimeout(() => {
          setCheckinSuccess(null);
          setSearchQuery("");
          setSelectedMember(null);
        }, 3000);
        upcomingClasses.refetch();
      }
    },
  });

  if (user?.role !== "admin" && user?.role !== "trainer") {
    return <p className="muted">Access denied. Staff only.</p>;
  }

  const isMembershipExpired =
    memberDetails.data &&
    memberDetails.data.memberships &&
    memberDetails.data.memberships.length > 0
      ? new Date(memberDetails.data.memberships[0].endDate) < new Date()
      : false;

  const hasNoCredits = memberDetails.data?.memberships?.[0]?.creditsRemaining === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check-in Kiosk</h1>
        <p className="muted mt-1 text-sm">
          Look up a member and check them in to upcoming classes
        </p>
      </div>

      {checkinSuccess && (
        <div
          className="rounded border p-4"
          style={{ borderColor: "#16a34a", background: "#064e3b", color: "#bbf7d0" }}
        >
          <div className="font-medium">✓ Check-in successful</div>
          <div className="muted mt-1 text-sm">
            {checkinSuccess.memberName} checked in to {checkinSuccess.className}
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Find Member</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Email or phone number"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--fg)",
            }}
          />
        </div>

        {lookupMember.isLoading && <p className="muted text-sm">Searching...</p>}
        {lookupMember.error && (
          <p className="text-sm" style={{ color: "#ef4444" }}>
            Member not found
          </p>
        )}
        {lookupMember.data && !selectedMember && (
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{lookupMember.data.name}</div>
                <div className="muted text-xs mt-1">{lookupMember.data.email}</div>
                {lookupMember.data.phone && (
                  <div className="muted text-xs">{lookupMember.data.phone}</div>
                )}
              </div>
              <button
                onClick={() => setSelectedMember(lookupMember.data)}
                className="btn btn-primary btn-sm"
              >
                Select
              </button>
            </div>
          </div>
        )}
      </section>

      {selectedMember && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Member: {selectedMember.name}</h2>
            <button
              onClick={() => {
                setSelectedMember(null);
                setSearchQuery("");
              }}
              className="btn btn-sm"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--fg)",
                borderColor: "var(--border)",
              }}
            >
              Change member
            </button>
          </div>

          {memberDetails.data?.memberships &&
            memberDetails.data.memberships.length > 0 && (
              <div className="space-y-2">
                {isMembershipExpired && (
                  <div
                    className="rounded border p-3 text-sm"
                    style={{
                      borderColor: "#dc2626",
                      background: "#7f1d1d",
                      color: "#fca5a5",
                    }}
                  >
                    ⚠ Membership has expired
                  </div>
                )}
                {hasNoCredits && (
                  <div
                    className="rounded border p-3 text-sm"
                    style={{
                      borderColor: "#dc2626",
                      background: "#7f1d1d",
                      color: "#fca5a5",
                    }}
                  >
                    ⚠ No credits remaining
                  </div>
                )}
              </div>
            )}

          {upcomingClasses.isLoading && (
            <p className="muted text-sm">Loading classes...</p>
          )}
          {upcomingClasses.data && upcomingClasses.data.length === 0 && (
            <p className="muted text-sm">No classes in the next 2 hours</p>
          )}
          {upcomingClasses.data && upcomingClasses.data.length > 0 && (
            <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
              {upcomingClasses.data.map((cls) => (
                <div key={cls.bookingId} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{cls.className}</div>
                      <div className="muted mt-1 text-sm">
                        {formatDateTime(cls.startsAt)} · {cls.room} · {cls.durationMin}{" "}
                        min
                      </div>
                      {cls.trainerName && (
                        <div className="muted text-xs mt-1">
                          Trainer: {cls.trainerName}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        markAttended.mutate({
                          bookingId: cls.bookingId,
                          source: "kiosk",
                        })
                      }
                      disabled={
                        markAttended.isPending || isMembershipExpired || hasNoCredits
                      }
                      className="btn btn-primary btn-sm ml-4"
                    >
                      Check in
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
