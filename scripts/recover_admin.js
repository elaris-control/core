#!/usr/bin/env node
const { initDB } = require("../src/db");
const { initUsers } = require("../src/users");
const { getDBPath } = require("../src/paths");

const dbApi = initDB();
const users = initUsers(dbApi.db);

function usage() {
  console.log(`
ELARIS recovery tool

Usage:
  node scripts/recover_admin.js list-users
  node scripts/recover_admin.js create-admin <email> <password> [name]
  node scripts/recover_admin.js reset-password <email> <newPassword>
  node scripts/recover_admin.js promote <email> <USER|ENGINEER|ADMIN>

DB: ${getDBPath()}
`);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || ["-h", "--help", "help"].includes(cmd)) {
  usage();
  process.exit(0);
}

function findUserByEmail(email) {
  email = String(email || "").trim().toLowerCase();
  return users.listUsers.all().find(u => String(u.email || "").toLowerCase() === email) || null;
}

try {
  if (cmd === "list-users") {
    const rows = users.listUsers.all();
    if (!rows.length) {
      console.log("No users found.");
      process.exit(0);
    }
    for (const u of rows) {
      console.log(`${u.id}	${u.email}	${u.role}	active=${u.active ? 1 : 0}`);
    }
    process.exit(0);
  }

  if (cmd === "create-admin") {
    const [email, password, ...nameParts] = args;
    if (!email || !password) {
      usage();
      process.exit(1);
    }
    const existing = findUserByEmail(email);
    if (existing) throw new Error("email_taken");
    const user = users.createUser({
      email,
      password,
      name: nameParts.join(" ").trim() || undefined,
      role: "ADMIN",
    });
    console.log(`Created ADMIN user: ${user.email} (id=${user.id})`);
    process.exit(0);
  }

  if (cmd === "promote") {
    const [email, role] = args;
    if (!email || !role) {
      usage();
      process.exit(1);
    }
    const user = findUserByEmail(email);
    if (!user) throw new Error("user_not_found");
    users.setRole(user.id, String(role).toUpperCase());
    console.log(`Updated role: ${user.email} -> ${String(role).toUpperCase()}`);
    process.exit(0);
  }

  if (cmd === "reset-password") {
    const [email, newPassword] = args;
    if (!email || !newPassword) {
      usage();
      process.exit(1);
    }
    const user = findUserByEmail(email);
    if (!user) throw new Error("user_not_found");
    if (String(newPassword).length < 8) throw new Error("password_too_short");
    const crypto = require("crypto");
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.createHmac("sha256", salt).update(String(newPassword)).digest("hex");
    dbApi.db.prepare(`UPDATE users SET password_hash=?, password_salt=? WHERE id=?`).run(hash, salt, user.id);
    console.log(`Password reset for ${user.email}`);
    process.exit(0);
  }

  throw new Error("unknown_command");
} catch (err) {
  console.error("[recover_admin]", err.message || String(err));
  process.exit(1);
}
