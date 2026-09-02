// api/auth.js
// POST /api/auth — login and change-password actions.
import bcrypt from "bcryptjs";
import { getDb } from "./_lib/db.js";
import { signToken, verifyToken } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { action } = req.body || {};

  // ── LOGIN ──────────────────────────────────────────────────
  if (action === "login") {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    try {
      const db = await getDb();
      const user = await db.collection("users").findOne({ username: username.trim() });
      if (!user) {
        return res.status(401).json({ error: "Invalid username or password." });
      }

      const passwordMatch = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatch) {
        return res.status(401).json({ error: "Invalid username or password." });
      }

      const token = signToken({ userId: user._id.toString(), username: user.username }, "24h");
      return res.status(200).json({ token, username: user.username });
    } catch (err) {
      console.error("[AUTH] Login error:", err);
      return res.status(500).json({ error: "Authentication service unavailable. Please try again." });
    }
  }

  // ── CHANGE PASSWORD ────────────────────────────────────────
  if (action === "change-password") {
    let decoded;
    try {
      decoded = verifyToken(req);
    } catch {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Old and new passwords are required." });
    }

    // Password complexity check
    const complexOk =
      newPassword.length >= 8 &&
      /[A-Z]/.test(newPassword) &&
      /[a-z]/.test(newPassword) &&
      /[0-9]/.test(newPassword);
    if (!complexOk) {
      return res.status(400).json({
        error: "New password must be at least 8 characters with uppercase, lowercase, and a number.",
      });
    }

    try {
      const db = await getDb();
      const { ObjectId } = await import("mongodb");
      const user = await db.collection("users").findOne({ _id: new ObjectId(decoded.userId) });
      if (!user) return res.status(404).json({ error: "User not found." });

      const match = await bcrypt.compare(oldPassword, user.passwordHash);
      if (!match) return res.status(401).json({ error: "Current password is incorrect." });

      const newHash = await bcrypt.hash(newPassword, 12);
      await db.collection("users").updateOne(
        { _id: user._id },
        { $set: { passwordHash: newHash, updatedAt: new Date() } }
      );

      return res.status(200).json({ message: "Password updated successfully." });
    } catch (err) {
      console.error("[AUTH] Change password error:", err);
      return res.status(500).json({ error: "Failed to update password." });
    }
  }

  return res.status(400).json({ error: "Unknown action." });
}
