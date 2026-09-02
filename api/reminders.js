// api/reminders.js
// GET /api/reminders            — fetch all reminders for HOD
// POST /api/reminders           — create a reminder
// PUT /api/reminders?id=...     — update a reminder
// DELETE /api/reminders?id=...  — delete a reminder
import { getDb } from "./_lib/db.js";
import { verifyToken } from "./_lib/auth.js";
import { ObjectId } from "mongodb";

// Convert IST date+time string to UTC Date
function istToUtc(dateStr, timeStr) {
  // dateStr: "YYYY-MM-DD", timeStr: "HH:MM"
  // IST = UTC+5:30
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  // Create UTC date by subtracting 5h30m from IST
  return new Date(Date.UTC(year, month - 1, day, hours - 5, minutes - 30));
}

export default async function handler(req, res) {
  let decoded;
  try {
    decoded = verifyToken(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const userId = new ObjectId(decoded.userId);
  const db = await getDb();
  const col = db.collection("reminders");

  // ── GET ────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const reminders = await col
        .find({ userId })
        .sort({ scheduledDateTime: 1 })
        .toArray();
      return res.status(200).json(reminders.map(r => ({
        ...r,
        _id: r._id.toString(),
        userId: r.userId.toString(),
      })));
    } catch (err) {
      console.error("[REMINDERS] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch reminders." });
    }
  }

  // ── POST (create) ──────────────────────────────────────────
  if (req.method === "POST") {
    const { title, description, date, time, priority, dashboardNotification, pushNotification } =
      req.body || {};

    if (!title || !date || !time) {
      return res.status(400).json({ error: "Title, date, and time are required." });
    }

    try {
      const scheduledDateTime = istToUtc(date, time);
      const now = new Date();
      const doc = {
        userId,
        title: title.trim(),
        description: (description || "").trim(),
        date,
        time,
        scheduledDateTime,
        timezone: "Asia/Kolkata",
        priority: priority || "Medium",
        completed: false,
        dashboardNotification: dashboardNotification !== false,
        pushNotification: pushNotification !== false,
        dashboardSeenAt: null,
        pushSentAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await col.insertOne(doc);
      return res.status(201).json({ ...doc, _id: result.insertedId.toString(), userId: userId.toString() });
    } catch (err) {
      console.error("[REMINDERS] POST error:", err);
      return res.status(500).json({ error: "Failed to save reminder." });
    }
  }

  // ── PUT (update) ───────────────────────────────────────────
  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Reminder id is required." });

    try {
      const existing = await col.findOne({ _id: new ObjectId(id), userId });
      if (!existing) return res.status(404).json({ error: "Reminder not found." });

      const updates = { ...req.body, updatedAt: new Date() };
      delete updates._id;
      delete updates.userId;

      // Recompute scheduledDateTime if date/time changed
      const newDate = updates.date || existing.date;
      const newTime = updates.time || existing.time;
      if (updates.date || updates.time) {
        updates.scheduledDateTime = istToUtc(newDate, newTime);
        // If scheduled time changed, reset push/dashboard sent flags
        if (updates.date !== existing.date || updates.time !== existing.time) {
          updates.pushSentAt = null;
          updates.dashboardSeenAt = null;
        }
      }

      await col.updateOne({ _id: new ObjectId(id) }, { $set: updates });
      const updated = await col.findOne({ _id: new ObjectId(id) });
      return res.status(200).json({ ...updated, _id: updated._id.toString(), userId: updated.userId.toString() });
    } catch (err) {
      console.error("[REMINDERS] PUT error:", err);
      return res.status(500).json({ error: "Failed to update reminder." });
    }
  }

  // ── DELETE ─────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Reminder id is required." });

    try {
      await col.deleteOne({ _id: new ObjectId(id), userId });
      // Also delete related notifications
      await db.collection("notifications").deleteMany({ reminderId: new ObjectId(id) });
      return res.status(200).json({ message: "Reminder deleted." });
    } catch (err) {
      console.error("[REMINDERS] DELETE error:", err);
      return res.status(500).json({ error: "Failed to delete reminder." });
    }
  }

  return res.status(405).json({ error: "Method not allowed." });
}
