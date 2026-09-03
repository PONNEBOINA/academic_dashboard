// api/devices.js
// GET /api/devices           — return VAPID public key
// POST /api/devices          — register push subscription or send test-push
// DELETE /api/devices        — deregister (unsubscribe) a device
import { getDb } from "./_lib/db.js";
import { verifyToken } from "./_lib/auth.js";
import { getWebPush } from "./_lib/webpush.js";
import { ObjectId } from "mongodb";

export default async function handler(req, res) {
  // ── GET (VAPID Public Key) ─────────────────────────────────
  if (req.method === "GET") {
    const rawKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || "";
    const vapidPublicKey = rawKey.trim().replace(/^["']|["']$/g, "");
    return res.status(200).json({ vapidPublicKey });
  }

  let decoded;
  try {
    decoded = verifyToken(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const userObjId = ObjectId.isValid(decoded.userId) ? new ObjectId(decoded.userId) : null;
  const userStr = decoded.userId ? decoded.userId.toString() : "";
  const db = await getDb();
  const col = db.collection("devices");

  // ── POST (register or test-push) ───────────────────────────
  if (req.method === "POST") {
    const { action, subscription, platform } = req.body || {};

    // Action: Test Web Push from Server
    if (action === "test-push") {
      try {
        const wp = getWebPush();
        if (!wp) {
          return res.status(500).json({
            error: "Web Push is not configured on server (VAPID keys missing).",
          });
        }

        const devices = await col
          .find({
            $or: [
              ...(userObjId ? [{ userId: userObjId }] : []),
              { userId: userStr },
            ],
            enabled: true,
          })
          .toArray();

        // Single-admin fallback: if no devices found with exact userId, check any enabled devices
        const targetDevices = devices.length > 0 ? devices : await col.find({ enabled: true }).toArray();

        if (targetDevices.length === 0) {
          return res.status(404).json({
            error: "No registered push devices found. Please click 'Enable Mobile Notifications' on this device first.",
          });
        }

        const testPayload = JSON.stringify({
          title: "🔔 Academic ERP Test Alert",
          body: "Web Push server notification is working perfectly on your device!",
          tag: `test-${Date.now()}`,
          url: "/",
        });

        let sentCount = 0;
        let errors = [];

        await Promise.allSettled(
          targetDevices.map(async (device) => {
            try {
              await wp.sendNotification(
                { endpoint: device.endpoint, keys: device.keys },
                testPayload
              );
              sentCount++;
            } catch (err) {
              if (err.statusCode === 410 || err.statusCode === 404) {
                await col.deleteOne({ _id: device._id });
              } else {
                errors.push(err.message);
              }
            }
          })
        );

        return res.status(200).json({
          success: true,
          message: `Test alert dispatched to ${sentCount} device(s).`,
          sentCount,
          totalDevices: targetDevices.length,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (testErr) {
        console.error("[DEVICES] Test push error:", testErr);
        return res.status(500).json({ error: "Failed to dispatch test alert.", details: testErr.message });
      }
    }

    // Standard Registration
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Invalid push subscription object." });
    }

    try {
      const existing = await col.findOne({ endpoint: subscription.endpoint });
      if (existing) {
        // Update timestamp & keys to keep it fresh
        await col.updateOne(
          { _id: existing._id },
          {
            $set: {
              userId: userObjId || userStr,
              updatedAt: new Date(),
              keys: subscription.keys,
              enabled: true,
              platform: platform || existing.platform || "unknown",
            },
          }
        );
        return res.status(200).json({ message: "Device subscription refreshed.", registered: true });
      }

      await col.insertOne({
        userId: userObjId || userStr,
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
      await col.deleteOne({ endpoint });
      return res.status(200).json({ message: "Device unregistered." });
    } catch (err) {
      console.error("[DEVICES] DELETE error:", err);
      return res.status(500).json({ error: "Failed to unregister device." });
    }
  }

  return res.status(405).json({ error: "Method not allowed." });
}
