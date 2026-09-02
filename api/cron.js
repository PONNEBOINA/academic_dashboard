// api/cron.js
// Vercel Cron Job — runs every 1 minute (configured in vercel.json)
// Checks for due reminders, sends Web Push to registered devices,
// creates dashboard notification records, and marks reminders as processed.
import { getDb } from "./_lib/db.js";
import webpush from "./_lib/webpush.js";
import { ObjectId } from "mongodb";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // Protect cron endpoint with a secret header
  const cronSecret = process.env.CRON_SECRET;
  const incoming = req.headers["x-cron-secret"] || req.headers["authorization"];
  if (cronSecret && incoming !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized cron access." });
  }

  try {
    const db = await getDb();
    const now = new Date();

    // Find all due, uncompleted reminders that have NOT had push sent yet
    const dueReminders = await db.collection("reminders").find({
      scheduledDateTime: { $lte: now },
      completed: false,
      pushSentAt: null,
      pushNotification: true,
    }).toArray();

    if (dueReminders.length === 0) {
      return res.status(200).json({ processed: 0, message: "No due reminders." });
    }

    let processed = 0;
    let errors = 0;

    for (const reminder of dueReminders) {
      try {
        // 1. Get all registered devices for this user
        const devices = await db.collection("devices").find({ userId: reminder.userId, enabled: true }).toArray();

        // 2. Send Web Push to each registered device
        const pushPromises = devices.map(async (device) => {
          const subscription = {
            endpoint: device.endpoint,
            keys: device.keys,
          };
          const payload = JSON.stringify({
            title: `🔔 ${reminder.title}`,
            body: reminder.description || "Your scheduled reminder is due now.",
            tag: `reminder-${reminder._id.toString()}`,
            url: "/",
          });
          try {
            await webpush.sendNotification(subscription, payload);
          } catch (pushErr) {
            // If the subscription has expired/invalid (410 Gone), remove it
            if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
              console.log(`[CRON] Removing expired device subscription: ${device.endpoint}`);
              await db.collection("devices").deleteOne({ _id: device._id });
            } else {
              console.warn(`[CRON] Push failed for device ${device._id}:`, pushErr.message);
            }
          }
        });

        await Promise.all(pushPromises);

        // 3. Create dashboard notification record (if dashboardNotification enabled)
        if (reminder.dashboardNotification) {
          const existingNotif = await db.collection("notifications").findOne({
            reminderId: reminder._id,
          });
          if (!existingNotif) {
            await db.collection("notifications").insertOne({
              userId: reminder.userId,
              reminderId: reminder._id,
              title: reminder.title,
              message: reminder.description || "Your scheduled reminder is due now.",
              read: false,
              createdAt: now,
            });
          }
        }

        // 4. Mark reminder pushSentAt to prevent duplicate sends
        await db.collection("reminders").updateOne(
          { _id: reminder._id },
          { $set: { pushSentAt: now, updatedAt: now } }
        );

        console.log(`[CRON] Processed reminder: "${reminder.title}" for user ${reminder.userId}`);
        processed++;
      } catch (err) {
        console.error(`[CRON] Error processing reminder ${reminder._id}:`, err);
        errors++;
      }
    }

    return res.status(200).json({ processed, errors, total: dueReminders.length });
  } catch (err) {
    console.error("[CRON] Fatal error:", err);
    return res.status(500).json({ error: "Cron job failed.", details: err.message });
  }
}
