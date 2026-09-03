// api/cron.js
// Serverless Reminder Scheduler Endpoint
// Triggered by external cron service (cron-job.org) via secure HTTP header.
// Checks MongoDB for due reminders, sends Web Push to registered devices,
// creates dashboard notifications, and prevents duplicate deliveries.

import { getDb } from "./_lib/db.js";
import { getWebPush } from "./_lib/webpush.js";
import { ObjectId } from "mongodb";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // Allow GET and POST methods
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
  }

  // 1. Authenticate with CRON_SECRET
  const cronSecret = (process.env.CRON_SECRET || "").trim().replace(/^["']|["']$/g, "");
  const authHeader = (req.headers["authorization"] || "").trim();
  const customHeader = (req.headers["x-cron-secret"] || req.headers["cron-secret"] || "").trim();
  const queryKey = (req.query?.key || req.query?.secret || "").trim();

  // Extract token if 'Bearer ' prefix is present
  const tokenFromBearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : authHeader;

  const isAuthorized =
    !cronSecret ||
    tokenFromBearer === cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    customHeader === cronSecret ||
    queryKey === cronSecret;

  if (!isAuthorized) {
    return res.status(401).json({
      error: "Unauthorized cron access.",
      hint: "Set request header 'Authorization: Bearer <CRON_SECRET>' or URL parameter '?key=<CRON_SECRET>'",
    });
  }

  try {
    const db = await getDb();
    const now = new Date();

    // India Standard Time (Asia/Kolkata is UTC+5:30)
    const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const istDateStr = istTime.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const istTimeStr = istTime.toISOString().slice(11, 16); // "HH:MM"

    // 2. Query due reminders:
    // Matches if scheduledDateTime <= now OR if date/time in IST has arrived
    const dueReminders = await db
      .collection("reminders")
      .find({
        completed: false,
        $and: [
          {
            $or: [
              { pushNotification: true, pushSentAt: null },
              { dashboardNotification: true, dashboardSeenAt: null },
            ],
          },
          {
            $or: [
              { scheduledDateTime: { $lte: now } },
              { scheduledDateTime: { $lte: now.toISOString() } },
              { date: { $lt: istDateStr } },
              { date: istDateStr, time: { $lte: istTimeStr } },
            ],
          },
        ],
      })
      .toArray();

    if (dueReminders.length === 0) {
      return res.status(200).json({
        success: true,
        processed: 0,
        message: "No pending reminders due at this time.",
        istTime: `${istDateStr} ${istTimeStr}`,
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
          const userObjId = ObjectId.isValid(reminder.userId) ? new ObjectId(reminder.userId) : null;
          const userStr = reminder.userId ? reminder.userId.toString() : "";

          let devices = await db
            .collection("devices")
            .find({
              $or: [
                ...(userObjId ? [{ userId: userObjId }] : []),
                { userId: userStr },
              ],
              enabled: true,
            })
            .toArray();

          // Single-admin fallback: if no devices found with exact userId, check any enabled devices
          if (devices.length === 0) {
            devices = await db.collection("devices").find({ enabled: true }).toArray();
          }

          const wp = getWebPush();
          let anyPushSucceeded = false;

          if (wp && devices.length > 0) {
            const pushPayload = JSON.stringify({
              title: `🔔 ${reminder.title}`,
              body: reminder.description || "Your scheduled reminder is due now.",
              tag: `reminder-${reminder._id.toString()}`,
              url: "/",
            });

            const results = await Promise.allSettled(
              devices.map(async (device) => {
                try {
                  await wp.sendNotification(
                    { endpoint: device.endpoint, keys: device.keys },
                    pushPayload
                  );
                  return true;
                } catch (pushErr) {
                  // Expired or revoked subscription (HTTP 410 / 404)
                  if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await db.collection("devices").deleteOne({ _id: device._id });
                  } else {
                    console.warn(`[CRON] Push error for device ${device._id}:`, pushErr.message);
                  }
                  throw pushErr;
                }
              })
            );

            anyPushSucceeded = results.some((r) => r.status === "fulfilled");
          }

          updateFields.pushSentAt = now;
          if (anyPushSucceeded) pushSentCount++;
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
              priority: reminder.priority || "Medium",
              date: reminder.date || "",
              time: reminder.time || "",
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
      istTime: `${istDateStr} ${istTimeStr}`,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.error("[CRON] Scheduler execution error:", err);
    return res.status(500).json({ error: "Scheduler execution failed.", details: err.message });
  }
}
