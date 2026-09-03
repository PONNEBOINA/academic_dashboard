// src/api.js
// Frontend API client — all communication with /api/* routes.
// JWT is stored in localStorage['hod_token'].

const API_BASE = "";

function getToken() {
  try {
    return localStorage.getItem("hod_token") || "";
  } catch {
    return "";
  }
}

function saveToken(token) {
  try {
    localStorage.setItem("hod_token", token);
  } catch {}
}

function clearToken() {
  try {
    localStorage.removeItem("hod_token");
  } catch {}
}

function authHeaders() {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `API error ${res.status}`);
  }
  return data;
}

// ── AUTH ──────────────────────────────────────────────────────────────────

export async function login(username, password) {
  const data = await request("/api/auth", {
    method: "POST",
    body: JSON.stringify({ action: "login", username, password }),
  });
  saveToken(data.token);
  return data;
}

export async function changePassword(oldPassword, newPassword) {
  return request("/api/auth", {
    method: "POST",
    body: JSON.stringify({ action: "change-password", oldPassword, newPassword }),
  });
}

export function logout() {
  clearToken();
}

export function hasToken() {
  return Boolean(getToken());
}

// ── REMINDERS ─────────────────────────────────────────────────────────────

export async function getReminders() {
  return request("/api/reminders");
}

export async function createReminder(data) {
  return request("/api/reminders", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateReminder(id, data) {
  return request(`/api/reminders?id=${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteReminder(id) {
  return request(`/api/reminders?id=${id}`, { method: "DELETE" });
}

// ── DEVICES (Push Subscriptions) ──────────────────────────────────────────

export async function registerDevice(subscription, platform) {
  return request("/api/devices", {
    method: "POST",
    body: JSON.stringify({ subscription, platform }),
  });
}

export async function unregisterDevice(endpoint) {
  return request("/api/devices", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

export async function sendTestPush() {
  return request("/api/devices", {
    method: "POST",
    body: JSON.stringify({ action: "test-push" }),
  });
}

// ── NOTIFICATIONS (Dashboard Bell) ───────────────────────────────────────

export async function getNotifications() {
  return request("/api/notifications");
}

export async function markNotificationsRead(ids) {
  return request("/api/notifications", {
    method: "POST",
    body: JSON.stringify({ action: "mark-read", ids }),
  });
}

// ── VAPID Public Key (for SW push subscription) ───────────────────────────

let cachedVapidKey = null;

export async function getVapidPublicKey() {
  if (cachedVapidKey) return cachedVapidKey;

  // 1. Check Vite env variable (if baked into build)
  const envKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (envKey && envKey.trim()) {
    cachedVapidKey = envKey.trim();
    return cachedVapidKey;
  }

  // 2. Fetch from backend /api/devices
  try {
    const res = await fetch("/api/devices");
    if (res.ok) {
      const data = await res.json();
      if (data && data.vapidPublicKey) {
        cachedVapidKey = data.vapidPublicKey.trim();
        return cachedVapidKey;
      }
    }
  } catch (err) {
    console.warn("[API] Could not fetch VAPID public key from /api/devices:", err);
  }

  return "";
}
