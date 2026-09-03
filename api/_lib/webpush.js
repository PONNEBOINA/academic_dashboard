// api/_lib/webpush.js
// Web Push VAPID configuration helper.
import webpush from "web-push";

let configured = false;

export function getWebPush() {
  const rawKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || "";
  const rawPriv = process.env.VAPID_PRIVATE_KEY || "";
  const rawEmail = process.env.VAPID_EMAIL || "";

  const publicKey = rawKey.trim().replace(/^["']|["']$/g, "");
  const privateKey = rawPriv.trim().replace(/^["']|["']$/g, "");
  let email = rawEmail.trim().replace(/^["']|["']$/g, "");

  if (!publicKey || !privateKey || !email) {
    console.warn("[WEBPUSH] VAPID keys not configured in environment variables.");
    return null;
  }

  if (!email.startsWith("mailto:") && !email.startsWith("http")) {
    email = `mailto:${email}`;
  }

  if (!configured) {
    webpush.setVapidDetails(email, publicKey, privateKey);
    configured = true;
  }
  return webpush;
}

export default webpush;
