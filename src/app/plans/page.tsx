"use client";

import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/lib/format";

export default function PlansPage() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const { data: plans, isLoading } = trpc.plans.list.useQuery({});

  const subscribe = trpc.plans.subscribe.useMutation({
    onSuccess: async () => {
      await utils.members.profile.invalidate();
      await utils.payments.mine.invalidate();
    },
  });

  if (isLoading) return <p className="muted">Loading plans...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Membership plans</h1>

      {subscribe.error && (
        <p className="panel p-3 text-sm" style={{ color: "#f87171" }}>
          {subscribe.error.message}
        </p>
      )}

      {subscribe.isSuccess && (
        <p className="panel p-3 text-sm" style={{ color: "var(--accent)" }}>
          Membership activated.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {plans?.map((p) => (
          <div key={p.id} className="panel flex flex-col gap-3 p-5">
            <div>
              <h2 className="font-medium">{p.name}</h2>
              <p className="muted mt-1 text-sm">{p.description}</p>
            </div>

            <div className="text-2xl font-semibold">{formatMoney(p.priceCents)}</div>

            <p className="muted text-sm">
              {p.durationDays} days &middot;{" "}
              {p.classCredits >= 999 ? "Unlimited classes" : `${p.classCredits} credits`}
            </p>

            <button
              className="btn btn-primary mt-auto"
              disabled={!user || subscribe.isPending}
              onClick={() => subscribe.mutate({ planId: p.id, method: "card" })}
            >
              {user ? "Subscribe" : "Sign in to subscribe"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
