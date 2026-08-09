"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";

export default function CompanyDetailsPage() {
  const params = useParams();
  const id = parseInt(params.id as string);
  const {
    data: company,
    isLoading,
    refetch,
  } = trpc.adminCompanies.getById.useQuery({ id });
  const [topUpAmount, setTopUpAmount] = useState("");
  const [showTopUpForm, setShowTopUpForm] = useState(false);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const { data: memberSearchData } = trpc.members.search.useQuery(
    { q: memberQuery },
    { enabled: memberQuery.length > 2 },
  );

  const topUpMutation = trpc.adminCompanies.topUp.useMutation({
    onSuccess: () => {
      setTopUpAmount("");
      setShowTopUpForm(false);
      refetch();
    },
  });

  const activeMutation = trpc.adminCompanies.updateActive.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const linkMutation = trpc.adminCompanies.linkMember.useMutation({
    onSuccess: () => {
      setMemberQuery("");
      setShowMemberForm(false);
      refetch();
    },
  });

  const unlinkMutation = trpc.adminCompanies.unlinkMember.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handleTopUp = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(topUpAmount);
    if (amount > 0) {
      topUpMutation.mutate({ id, amount });
    }
  };

  const handleToggleActive = () => {
    if (company) {
      activeMutation.mutate({ id, active: !company.active });
    }
  };

  const handleLinkMember = (userId: number) => {
    linkMutation.mutate({ companyId: id, userId });
  };

  if (isLoading) return <p className="muted">Loading...</p>;
  if (!company) return <p className="muted">Company not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <p className="muted text-sm">{company.contactEmail}</p>
        </div>
        <button
          onClick={handleToggleActive}
          className={company.active ? "btn btn-danger btn-sm" : "btn btn-sm"}
          disabled={activeMutation.isPending}
        >
          {company.active ? "Deactivate" : "Activate"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide mb-2">
            Credit Pool Balance
          </div>
          <div className="text-2xl font-semibold">{company.creditPoolBalance}</div>
          <button
            onClick={() => setShowTopUpForm(!showTopUpForm)}
            className="btn btn-sm mt-3"
          >
            Top Up
          </button>
        </div>

        <div className="panel p-4">
          <div className="muted text-xs uppercase tracking-wide mb-2">Linked Members</div>
          <div className="text-2xl font-semibold">{company.members.length}</div>
          <button
            onClick={() => setShowMemberForm(!showMemberForm)}
            className="btn btn-sm mt-3"
          >
            Add Member
          </button>
        </div>
      </div>

      {showTopUpForm && (
        <div className="panel p-4">
          <form onSubmit={handleTopUp} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">Top Up Amount</label>
              <input
                type="number"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="w-full px-3 py-2 border rounded"
                style={{ borderColor: "var(--border)" }}
                placeholder="Number of credits"
                disabled={topUpMutation.isPending}
                min="1"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn"
                disabled={topUpMutation.isPending || !topUpAmount}
              >
                {topUpMutation.isPending ? "Processing..." : "Top Up"}
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => setShowTopUpForm(false)}
                disabled={topUpMutation.isPending}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showMemberForm && (
        <div className="panel p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-2">Search Members</label>
            <input
              type="text"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              style={{ borderColor: "var(--border)" }}
              placeholder="Search by name or email (3+ chars)"
              disabled={linkMutation.isPending}
            />
          </div>

          {memberSearchData && memberSearchData.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {memberSearchData
                .filter((user) => !company.members.some((m) => m.id === user.id))
                .map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-2 border rounded"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex-1">
                      <div className="font-medium text-sm">{user.name}</div>
                      <div className="text-xs muted">{user.email}</div>
                    </div>
                    <button
                      onClick={() => handleLinkMember(user.id)}
                      className="btn btn-sm"
                      disabled={linkMutation.isPending}
                    >
                      Add
                    </button>
                  </div>
                ))}
            </div>
          )}

          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              setShowMemberForm(false);
              setMemberQuery("");
            }}
            disabled={linkMutation.isPending}
          >
            Done
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-medium">Linked Members ({company.members.length})</h2>
        {company.members.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {company.members.map((member) => (
              <div key={member.id} className="flex items-center gap-4 p-3">
                <div className="flex-1">
                  <div className="font-medium text-sm">{member.name}</div>
                  <div className="text-xs muted">{member.email}</div>
                </div>
                <button
                  onClick={() =>
                    unlinkMutation.mutate({ companyMemberId: member.companyMemberId })
                  }
                  className="btn-outline btn-sm text-red-600"
                  disabled={unlinkMutation.isPending}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel p-4 text-center muted">No members linked yet</div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-medium">Recent Corporate Bookings</h2>
        {company.recentBookings.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {company.recentBookings.map((booking) => (
              <div key={booking.id} className="p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{booking.className}</span>
                  <span
                    className={
                      booking.status === "attended" ? "text-green-600" : undefined
                    }
                  >
                    {booking.status}
                  </span>
                </div>
                <div className="muted">
                  {booking.memberName} · {formatDateTime(booking.startsAt)}
                </div>
                <div className="muted">Credits used: {booking.creditsUsed}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel p-4 text-center muted">No bookings yet</div>
        )}
      </div>
    </div>
  );
}
