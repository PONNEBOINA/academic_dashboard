// src/leaveApi.js
// Dedicated API client for Employee Authentication & Leave Management System.
// Completely isolated from the existing HOD reminder/attendance API client.

const API_BASE = "";

// ── TOKEN & SESSION STORAGE HELPERS ──────────────────────────────────────────

export function getEmployeeToken() {
  try {
    return localStorage.getItem("employee_token") || "";
  } catch {
    return "";
  }
}

export function saveEmployeeSession(token, employee) {
  try {
    localStorage.setItem("employee_token", token);
    if (employee) {
      localStorage.setItem("employee_user", JSON.stringify(employee));
    }
  } catch {}
}

export function clearEmployeeSession() {
  try {
    localStorage.removeItem("employee_token");
    localStorage.removeItem("employee_user");
  } catch {}
}

export function getStoredEmployee() {
  try {
    const raw = localStorage.getItem("employee_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasEmployeeToken() {
  return Boolean(getEmployeeToken());
}

function getHodToken() {
  try {
    return localStorage.getItem("hod_token") || "";
  } catch {
    return "";
  }
}

// ── GENERIC REQUEST HELPERS ──────────────────────────────────────────────────

async function employeeRequest(path, options = {}) {
  const token = getEmployeeToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `API error ${res.status}`);
  }
  return data;
}

async function hodRequest(path, options = {}) {
  const token = getHodToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `API error ${res.status}`);
  }
  return data;
}

// ── EMPLOYEE AUTHENTICATION ──────────────────────────────────────────────────

export async function employeeSignup(signupData) {
  return employeeRequest("/api/employee-auth", {
    method: "POST",
    body: JSON.stringify({ action: "signup", ...signupData })
  });
}

export async function employeeLogin(identifier, password) {
  const data = await employeeRequest("/api/employee-auth", {
    method: "POST",
    body: JSON.stringify({ action: "login", identifier, password })
  });
  if (data.token) {
    saveEmployeeSession(data.token, data.employee);
  }
  return data;
}

export async function getEmployeeProfile() {
  return employeeRequest("/api/employee-auth", { method: "GET" });
}

export function employeeLogout() {
  clearEmployeeSession();
}

// ── LEAVE REQUESTS (EMPLOYEE OPERATIONS) ─────────────────────────────────────

export async function submitLeaveRequest(leaveData) {
  return employeeRequest("/api/leave-requests", {
    method: "POST",
    body: JSON.stringify(leaveData)
  });
}

export async function getMyLeaveRequests() {
  return employeeRequest("/api/leave-requests", { method: "GET" });
}

// ── LEAVE REQUESTS (HOD ADMINISTRATOR OPERATIONS) ────────────────────────────

export async function getHodLeaveRequests(statusFilter = "") {
  const url = statusFilter ? `/api/leave-requests?status=${statusFilter}` : "/api/leave-requests";
  return hodRequest(url, { method: "GET" });
}

export async function approveLeaveRequest(id) {
  return hodRequest("/api/leave-requests", {
    method: "PATCH",
    body: JSON.stringify({ id, action: "approve" })
  });
}

export async function rejectLeaveRequest(id, rejectionReason) {
  return hodRequest("/api/leave-requests", {
    method: "PATCH",
    body: JSON.stringify({ id, action: "reject", rejectionReason })
  });
}
