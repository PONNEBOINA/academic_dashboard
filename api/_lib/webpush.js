// api/_lib/webpush.js
// Web Push VAPID configuration helper.
import webpush from "web-push";

let configured = false;

export function getWebPush() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_EMAIL) {
    console.warn("[WEBPUSH] VAPID keys not configured in environment variables.");
    return null;
  }
  if (!configured) {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
  return webpush;
}

export default webpush;
