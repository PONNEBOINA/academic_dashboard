// api/employee-auth.js
// Dedicated Authentication endpoint for Employees (Signup, Login, Me)
import bcrypt from "bcryptjs";
import { getDb } from "./_lib/db.js";
import { signToken, verifyToken } from "./_lib/auth.js";
import { ObjectId } from "mongodb";

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { action } = req.body || req.query || {};

  // ── 1. EMPLOYEE SIGNUP ─────────────────────────────────────────────────────
  if (req.method === "POST" && action === "signup") {
    const {
      fullName,
      email,
      password,
      confirmPassword,
      employeeId,
      role,
      subjects
    } = req.body || {};

    // Validate presence
    if (!fullName || !email || !password || !confirmPassword || !employeeId || !role || !subjects) {
      return res.status(400).json({ error: "All fields are required." });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.trim().toLowerCase();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    // Validate password match
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Password and Confirm Password do not match." });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const cleanEmployeeId = employeeId.trim().toUpperCase();

    try {
      const db = await getDb();
      const col = db.collection("employees");

      // Check for duplicate email
      const existingEmail = await col.findOne({ email: cleanEmail });
      if (existingEmail) {
        return res.status(409).json({ error: "An account with this email already exists." });
      }

      // Check for duplicate employee ID
      const existingEmpId = await col.findOne({ employeeId: cleanEmployeeId });
      if (existingEmpId) {
        return res.status(409).json({ error: "An account with this Employee ID already exists." });
      }

      // Hash password securely
      const passwordHash = await bcrypt.hash(password, 10);

      const newEmployee = {
        fullName: fullName.trim(),
        email: cleanEmail,
        passwordHash,
        employeeId: cleanEmployeeId,
        role: role.trim(),
        subjects: subjects.trim(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await col.insertOne(newEmployee);

      return res.status(201).json({
        success: true,
        message: "Account created successfully! You can now log in."
      });
    } catch (err) {
      console.error("[EMPLOYEE_AUTH] Signup error:", err);
      return res.status(500).json({ error: "Failed to create account. Please try again." });
    }
  }

  // ── 2. EMPLOYEE LOGIN ──────────────────────────────────────────────────────
  if (req.method === "POST" && action === "login") {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/Employee ID and password are required." });
    }

    const cleanIdentifier = identifier.trim();

    try {
      const db = await getDb();
      const col = db.collection("employees");

      // Search by email or employeeId (case-insensitive)
      const employee = await col.findOne({
        $or: [
          { email: cleanIdentifier.toLowerCase() },
          { employeeId: cleanIdentifier.toUpperCase() }
        ]
      });

      if (!employee) {
        return res.status(401).json({ error: "Invalid credentials. Please check your details and try again." });
      }

      const isMatch = await bcrypt.compare(password, employee.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials. Please check your password and try again." });
      }

      // Generate JWT valid for 7 days
      const token = signToken({
        userId: employee._id.toString(),
        employeeId: employee.employeeId,
        email: employee.email,
        fullName: employee.fullName,
        role: employee.role,
        subjects: employee.subjects,
        type: "employee"
      }, "7d");

      return res.status(200).json({
        success: true,
        token,
        employee: {
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          email: employee.email,
          role: employee.role,
          subjects: employee.subjects
        }
      });
    } catch (err) {
      console.error("[EMPLOYEE_AUTH] Login error:", err);
      return res.status(500).json({ error: "Authentication service unavailable. Please try again." });
    }
  }

  // ── 3. VERIFY SESSION / GET ME ─────────────────────────────────────────────
  if (req.method === "GET") {
    let decoded;
    try {
      decoded = verifyToken(req);
    } catch {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (decoded.type !== "employee") {
      return res.status(403).json({ error: "Forbidden: Not an employee account." });
    }

    try {
      const db = await getDb();
      const employee = await db.collection("employees").findOne({ _id: new ObjectId(decoded.userId) });
      if (!employee) {
        return res.status(404).json({ error: "Employee profile not found." });
      }

      return res.status(200).json({
        employee: {
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          email: employee.email,
          role: employee.role,
          subjects: employee.subjects
        }
      });
    } catch (err) {
      console.error("[EMPLOYEE_AUTH] Me error:", err);
      return res.status(500).json({ error: "Failed to retrieve employee profile." });
    }
  }

  return res.status(405).json({ error: "Method not allowed." });
}
