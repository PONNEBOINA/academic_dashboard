// scripts/seed-admin.js
// One-time script to create the HOD admin user in MongoDB Atlas.
// Run once locally before deploying: node scripts/seed-admin.js
//
// Set MONGODB_URI in your shell first:
//   $env:MONGODB_URI="mongodb+srv://..."   (PowerShell)
//   export MONGODB_URI="..."                (bash)

import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("ERROR: MONGODB_URI environment variable is not set.");
  process.exit(1);
}

// ── Default admin credentials ───────────────────────────────────────────
// You can change these before running the script.
const ADMIN_USERNAME = "vamshiyadav";
const ADMIN_PASSWORD = "Vamshiyadav123";
// ────────────────────────────────────────────────────────────────────────

async function seed() {
  console.log("Connecting to MongoDB Atlas...");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("academic_erp");

  const existingUser = await db.collection("users").findOne({ username: ADMIN_USERNAME });
  if (existingUser) {
    console.log(`User "${ADMIN_USERNAME}" already exists in MongoDB. Skipping seed.`);
    await client.close();
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await db.collection("users").insertOne({
    username: ADMIN_USERNAME,
    passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`SUCCESS: Admin user "${ADMIN_USERNAME}" created in MongoDB Atlas.`);
  console.log("You can now log in with these credentials.");
  await client.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
