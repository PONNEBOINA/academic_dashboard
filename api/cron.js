// api/cron.js
// Serverless Reminder Scheduler Endpoint
// Triggered by external cron service (cron-job.org) via secure HTTP header.
// Checks MongoDB for due reminders, sends Web Push to registered devices,
// creates dashboard notifications, and prevents duplicate deliveries.

import { getDb } from "./_lib/db.js";
import { getWebPush } from "./_lib/webpush.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // Allow GET and POST methods
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
  }

  // 1. Authenticate with CRON_SECRET via header
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers["authorization"] || "";
  const customHeader = req.headers["x-cron-secret"] || "";

  const isAuthorized =
    !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    customHeader === cronSecret;

  if (!isAuthorized) {
    return res.status(401).json({
      error: "Unauthorized cron access. Provide 'Authorization: Bearer <CRON_SECRET>' header.",
    });
  }

  try {
    const db = await getDb();
    const now = new Date();

    // 2. Query due reminders where notification has not been sent yet
    const dueReminders = await db
      .collection("reminders")
      .find({
        scheduledDateTime: { $lte: now },
        completed: false,
        $or: [
          { pushSentAt: null, pushNotification: true },
          { dashboardSeenAt: null, dashboardNotification: true },
        ],
      })
      .toArray();

    if (dueReminders.length === 0) {
      return res.status(200).json({
        success: true,
        processed: 0,
        message: "No pending reminders due at this time.",
        timestamp: now.toISOString(),
      });
    }

    let pushSentCount = 0;
    let notifCreatedCount = 0;
    let errors = 0;

    for (const reminder of dueReminders) {
      try {
        const updateFields = { updatedAt: now };

        // 3. Send Web Push to registered devices if enabled and not yet sent
        if (reminder.pushNotification && !reminder.pushSentAt) {
          const devices = await db
            .collection("devices")
            .find({ userId: reminder.userId, enabled: true })
            .toArray();

          const wp = getWebPush();
          if (wp && devices.length > 0) {
            const pushPayload = JSON.stringify({
              title: `🔔 ${reminder.title}`,
              body: reminder.description || "Your scheduled reminder is due now.",
              tag: `reminder-${reminder._id.toString()}`,
              url: "/",
            });

            await Promise.allSettled(
              devices.map(async (device) => {
                try {
                  await wp.sendNotification(
                    { endpoint: device.endpoint, keys: device.keys },
                    pushPayload
                  );
                } catch (pushErr) {
                  // Expired or revoked subscription (HTTP 410 / 404)
                  if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await db.collection("devices").deleteOne({ _id: device._id });
                  } else {
                    console.warn(`[CRON] Push error for device ${device._id}:`, pushErr.message);
                  }
                }
              })
            );
          }

          updateFields.pushSentAt = now;
          pushSentCount++;
        }

        // 4. Create in-app dashboard notification if enabled and not yet created
        if (reminder.dashboardNotification && !reminder.dashboardSeenAt) {
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

          updateFields.dashboardSeenAt = now;
          notifCreatedCount++;
        }

        // 5. Mark reminder in MongoDB to prevent duplicate processing
        await db.collection("reminders").updateOne(
          { _id: reminder._id },
          { $set: updateFields }
        );
      } catch (itemErr) {
        console.error(`[CRON] Error processing reminder ${reminder._id}:`, itemErr);
        errors++;
      }
    }

    return res.status(200).json({
      success: true,
      totalDue: dueReminders.length,
      pushDispatched: pushSentCount,
      dashboardAlertsCreated: notifCreatedCount,
      errors,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.error("[CRON] Scheduler execution error:", err);
    return res.status(500).json({ error: "Scheduler execution failed.", details: err.message });
  }
}
