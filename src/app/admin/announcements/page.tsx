"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function AnnouncementsPage() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const broadcast = trpc.notifications.broadcast.useMutation({
    onSuccess: () => {
      setTitle("");
      setMessage("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim() && message.trim()) {
      broadcast.mutate({ title, message });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Broadcast Announcement</h1>

      <div className="panel p-6 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              style={{ borderColor: "var(--border)" }}
              placeholder="Announcement title"
              disabled={broadcast.isPending}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              style={{ borderColor: "var(--border)" }}
              placeholder="Announcement message"
              rows={6}
              disabled={broadcast.isPending}
            />
          </div>

          <button
            type="submit"
            className="btn"
            disabled={broadcast.isPending || !title.trim() || !message.trim()}
          >
            {broadcast.isPending ? "Sending..." : "Send to all members"}
          </button>
        </form>

        {success && (
          <div
            className="mt-4 p-3 rounded"
            style={{ backgroundColor: "rgba(34, 197, 94, 0.1)" }}
          >
            <p style={{ color: "var(--accent)" }}>
              Announcement sent to {broadcast.data?.count || 0} members!
            </p>
          </div>
        )}

        {broadcast.error && (
          <div
            className="mt-4 p-3 rounded"
            style={{ backgroundColor: "rgba(239, 68, 68, 0.1)" }}
          >
            <p style={{ color: "#ef4444" }}>{broadcast.error.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
