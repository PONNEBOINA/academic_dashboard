// api/devices.js
// POST /api/devices   — register a push subscription for a device
// DELETE /api/devices — deregister (unsubscribe) a device
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

  const userId = new ObjectId(decoded.userId);
  const db = await getDb();
  const col = db.collection("devices");

  // ── POST (register) ────────────────────────────────────────
  if (req.method === "POST") {
    const { subscription, platform } = req.body || {};
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Invalid push subscription object." });
    }

    try {
      const existing = await col.findOne({ userId, endpoint: subscription.endpoint });
      if (existing) {
        // Update timestamp to keep it fresh
        await col.updateOne(
          { _id: existing._id },
          { $set: { updatedAt: new Date(), keys: subscription.keys } }
        );
        return res.status(200).json({ message: "Device subscription refreshed.", registered: true });
      }

      await col.insertOne({
        userId,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        platform: platform || "unknown",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return res.status(201).json({ message: "Device registered for push notifications.", registered: true });
    } catch (err) {
      console.error("[DEVICES] POST error:", err);
      return res.status(500).json({ error: "Failed to register device." });
    }
  }

  // ── DELETE (deregister) ────────────────────────────────────
  if (req.method === "DELETE") {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: "Endpoint required." });

    try {
      await col.deleteOne({ userId, endpoint });
      return res.status(200).json({ message: "Device unregistered." });
    } catch (err) {
      console.error("[DEVICES] DELETE error:", err);
      return res.status(500).json({ error: "Failed to unregister device." });
    }
  }

  return res.status(405).json({ error: "Method not allowed." });
}
