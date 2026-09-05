// api/leave-requests.js
// API routes for Leave Requests:
// - GET: Employees fetch their own requests; HOD fetches all requests.
// - POST: Employee submits a new leave request.
// - PATCH: HOD approves or rejects a leave request.

import { getDb } from "./_lib/db.js";
import { verifyToken } from "./_lib/auth.js";
import { ObjectId } from "mongodb";

// Helper: Format YYYY-MM-DD to DD/MM/YYYY
function formatToDDMMYYYY(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// Helper: Calculate inclusive days between two YYYY-MM-DD strings
function calculateDays(startStr, endStr) {
  if (!startStr) return 1;
  const s = new Date(`${startStr}T00:00:00Z`);
  const e = endStr ? new Date(`${endStr}T00:00:00Z`) : s;
  const diffTime = e.getTime() - s.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays > 0 ? diffDays : 1;
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Verify JWT Authentication
  let decoded;
  try {
    decoded = verifyToken(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized. Valid token required." });
  }

  const db = await getDb();
  const col = db.collection("leaveRequests");

  // ── 1. GET LEAVE REQUESTS ──────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const isEmployee = decoded.type === "employee";

      let query = {};
      if (isEmployee) {
        // Strict scope: Employees can ONLY view their own leave requests
        query = { employeeId: decoded.employeeId };
      } else {
        // HOD / Admin: can filter by status if requested
        const { status } = req.query || {};
        if (status && ["Pending", "Approved", "Rejected"].includes(status)) {
          query = { status };
        }
      }

      const requests = await col
        .find(query)
        .sort({ appliedAt: -1 })
        .toArray();

      const mapped = requests.map(r => ({
        ...r,
        _id: r._id.toString()
      }));

      return res.status(200).json(mapped);
    } catch (err) {
      console.error("[LEAVE_REQUESTS] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch leave requests." });
    }
  }

  // ── 2. POST (APPLY FOR LEAVE) ──────────────────────────────────────────────
  if (req.method === "POST") {
    if (decoded.type !== "employee") {
      return res.status(403).json({ error: "Only registered employees can submit leave requests." });
    }

    const {
      leaveType,
      isDateRange,
      startDate,
      endDate,
      reason
    } = req.body || {};

    if (!leaveType || !["Sick Leave", "Casual Leave"].includes(leaveType)) {
      return res.status(400).json({ error: "Please select a valid leave type (Sick Leave or Casual Leave)." });
    }

    if (!startDate) {
      return res.status(400).json({ error: "Please select a leave date." });
    }

    const finalEndDate = isDateRange && endDate ? endDate : startDate;
    if (finalEndDate < startDate) {
      return res.status(400).json({ error: "End date cannot be earlier than start date." });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Please provide a reason for the leave request." });
    }

    const numDays = calculateDays(startDate, finalEndDate);
    const startFormatted = formatToDDMMYYYY(startDate);
    const endFormatted = formatToDDMMYYYY(finalEndDate);
    const formattedDate = (isDateRange && startDate !== finalEndDate)
      ? `${startFormatted} - ${endFormatted}`
      : startFormatted;

    try {
      const newRequest = {
        employeeId: decoded.employeeId,
        employeeName: decoded.fullName,
        role: decoded.role,
        subjects: decoded.subjects,
        leaveType,
        isDateRange: Boolean(isDateRange && startDate !== finalEndDate),
        startDate,
        endDate: finalEndDate,
        formattedDate,
        numberOfDays: numDays,
        reason: reason.trim(),
        status: "Pending",
        appliedAt: new Date(),
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null
      };

      const result = await col.insertOne(newRequest);

      return res.status(201).json({
        success: true,
        message: "Your leave request has been submitted successfully.",
        request: {
          ...newRequest,
          _id: result.insertedId.toString()
        }
      });
    } catch (err) {
      console.error("[LEAVE_REQUESTS] POST error:", err);
      return res.status(500).json({ error: "Failed to submit leave request. Please try again." });
    }
  }

  // ── 3. PATCH (HOD APPROVE / REJECT) ────────────────────────────────────────
  if (req.method === "PATCH") {
    // Only HOD/admin can approve or reject
    if (decoded.type === "employee") {
      return res.status(403).json({ error: "Access denied. Only administrators can process leave requests." });
    }

    const { id, action, rejectionReason } = req.body || {};
    const requestId = id || req.query.id;

    if (!requestId) {
      return res.status(400).json({ error: "Leave request ID is required." });
    }

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "Action must be 'approve' or 'reject'." });
    }

    try {
      let objectId;
      try {
        objectId = new ObjectId(requestId);
      } catch {
        return res.status(400).json({ error: "Invalid leave request ID." });
      }

      const existing = await col.findOne({ _id: objectId });
      if (!existing) {
        return res.status(404).json({ error: "Leave request not found." });
      }

      let updateDoc = {};
      if (action === "approve") {
        updateDoc = {
          $set: {
            status: "Approved",
            approvedAt: new Date(),
            rejectedAt: null,
            rejectionReason: null,
            updatedAt: new Date()
          }
        };
      } else if (action === "reject") {
        if (!rejectionReason || !rejectionReason.trim()) {
          return res.status(400).json({ error: "Please enter a reason for rejecting this leave request." });
        }
        updateDoc = {
          $set: {
            status: "Rejected",
            rejectedAt: new Date(),
            approvedAt: null,
            rejectionReason: rejectionReason.trim(),
            updatedAt: new Date()
          }
        };
      }

      await col.updateOne({ _id: objectId }, updateDoc);
      const updated = await col.findOne({ _id: objectId });

      return res.status(200).json({
        success: true,
        message: action === "approve" ? "Leave request approved successfully." : "Leave request rejected.",
        request: {
          ...updated,
          _id: updated._id.toString()
        }
      });
    } catch (err) {
      console.error("[LEAVE_REQUESTS] PATCH error:", err);
      return res.status(500).json({ error: "Failed to update leave request." });
    }
  }

  return res.status(405).json({ error: "Method not allowed." });
}
