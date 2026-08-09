"use client";

import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";

export default function NotificationsPage() {
  const {
    data: notifications,
    isLoading,
    error,
  } = trpc.notifications.list.useQuery(undefined, { retry: false });
  const markAllAsRead = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      // Refresh the list
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const utils = trpc.useUtils();

  if (isLoading) return <p className="muted">Loading...</p>;
  if (error) return <p className="muted">{error.message}</p>;

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        {unreadCount > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
          >
            Mark all as read
          </button>
        )}
      </div>

      {!notifications || notifications.length === 0 ? (
        <p className="muted">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className="panel p-4"
              style={{
                opacity: notif.read ? 0.6 : 1,
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium">{notif.title}</div>
                  <div className="mt-1 text-sm muted">{notif.message}</div>
                  <div className="mt-2 text-xs muted">
                    {formatDateTime(notif.createdAt)}
                  </div>
                </div>
                {!notif.read && (
                  <div
                    className="mt-1 h-2 w-2 rounded-full"
                    style={{ backgroundColor: "var(--accent)" }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
