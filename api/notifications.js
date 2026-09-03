// api/notifications.js
// GET /api/notifications               — get dashboard bell notifications (unread first)
// POST /api/notifications (mark-read)  — mark all or specific notifications as read
import { getDb } from "./_lib/db.js";
import { verifyToken } from "./_lib/auth.js";
import { ObjectId } from "mongodb";

export default async function handler(req, res) {
  let decoded;
  try {
    decoded = verifyToken(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const userObjId = ObjectId.isValid(decoded.userId) ? new ObjectId(decoded.userId) : null;
  const userStr = decoded.userId ? decoded.userId.toString() : "";
  const db = await getDb();
  const col = db.collection("notifications");

  const userQuery = {
    $or: [
      ...(userObjId ? [{ userId: userObjId }] : []),
      { userId: userStr },
    ],
  };

  // ── GET ────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      let notifications = await col
        .find(userQuery)
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();

      // Single-admin fallback if no notifications match exact userId
      if (notifications.length === 0) {
        notifications = await col.find({}).sort({ createdAt: -1 }).limit(50).toArray();
      }

      return res.status(200).json(
        notifications.map(n => ({
          ...n,
          _id: n._id.toString(),
          userId: n.userId ? n.userId.toString() : userStr,
          reminderId: n.reminderId?.toString() || null,
        }))
      );
    } catch (err) {
      console.error("[NOTIFICATIONS] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch notifications." });
    }
  }

  // ── POST (mark read) ───────────────────────────────────────
  if (req.method === "POST") {
    const { action, ids } = req.body || {};

    if (action === "mark-read") {
      try {
        if (ids && Array.isArray(ids) && ids.length > 0) {
          const validIds = ids.map(id => ObjectId.isValid(id) ? new ObjectId(id) : id);
          await col.updateMany(
            { _id: { $in: validIds } },
            { $set: { read: true } }
          );
        } else {
          // Mark all as read
          await col.updateMany({ read: false }, { $set: { read: true } });
        }
        return res.status(200).json({ message: "Notifications marked as read." });
      } catch (err) {
        console.error("[NOTIFICATIONS] mark-read error:", err);
        return res.status(500).json({ error: "Failed to update notifications." });
      }
    }

    return res.status(400).json({ error: "Unknown action." });
  }

  return res.status(405).json({ error: "Method not allowed." });
}
