// src/notifications.js
// Notification engine — Email (SMTP) + Webhook (ntfy/Pushover/custom)
//
// Channels are stored in DB table `notification_channels`
// Each channel: { id, name, type:"email"|"webhook", config_json, enabled }
//
// Cooldown: per (channel_id, tag) — won't re-send same tag within cooldown_s

const nodemailer = require("nodemailer");
const { normalizeEmailAddress } = require("./email_utils");


function sanitizeName(name) {
  const out = String(name || "").trim();
  if (!out) throw new Error("invalid_name");
  if (out.length > 120) throw new Error("invalid_name");
  return out;
}

function sanitizePort(port) {
  const n = Number(port || 587);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error("invalid_port");
  return n;
}

function sanitizeEmailConfig(config = {}, previousConfig = null) {
  const host = String(config.host || "").trim().toLowerCase();
  if (!host) throw new Error("invalid_smtp_host");
  if (host.length > 255) throw new Error("invalid_smtp_host");
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) throw new Error("invalid_smtp_host");

  const port = sanitizePort(config.port);
  let user, to;
  try { user = normalizeEmailAddress(config.user); } catch { throw new Error('invalid_smtp_user'); }
  try { to = normalizeEmailAddress(config.to); } catch { throw new Error('invalid_recipient_email'); }

  let pass = typeof config.pass === "string" ? config.pass : "";
  pass = pass.trim();
  if (!pass && previousConfig?.pass) pass = String(previousConfig.pass);
  if (!pass) throw new Error("missing_smtp_password");

  const out = { host, port, user, pass, to };
  if (config.from) {
    try { out.from = normalizeEmailAddress(config.from); } catch { throw new Error('invalid_from_email'); }
  }
  return out;
}

function sanitizeWebhookConfig(config = {}) {
  const rawUrl = String(config.url || "").trim();
  if (!rawUrl) throw new Error("invalid_webhook_url");
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid_webhook_url");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid_webhook_url");
  const method = String(config.method || "POST").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH"].includes(method)) throw new Error("invalid_webhook_method");
  return { url: parsed.toString(), method };
}

function sanitizeChannelInput({ name, type, config }, previousConfig = null) {
  const safeName = sanitizeName(name);
  const safeType = String(type || "").trim();
  if (!["email", "webhook"].includes(safeType)) throw new Error("invalid_channel_type");
  const safeConfig = safeType === "email"
    ? sanitizeEmailConfig(config, previousConfig)
    : sanitizeWebhookConfig(config);
  return { name: safeName, type: safeType, config: safeConfig };
}

// ── Webhook sender ─────────────────────────────────────────────────────────
async function sendWebhook(cfg, { title, body, level }) {
  const https = require("https");
  const http  = require("http");

  const url     = cfg.url;
  const method  = (cfg.method || "POST").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };

  // ntfy.sh support: if url is ntfy-style, add title/priority headers
  if (url.includes("ntfy.sh") || cfg.ntfy) {
    headers["Title"]    = title;
    headers["Priority"] = level === "critical" ? "urgent" : level === "warning" ? "default" : "low";
    headers["Tags"]     = level === "critical" ? "rotating_light" : level === "warning" ? "warning" : "white_check_mark";
  }

  const payload = cfg.body_template
    ? cfg.body_template
        .replace("{{title}}", title)
        .replace("{{body}}",  body)
        .replace("{{level}}", level)
    : JSON.stringify({ title, body, level, ts: Date.now() });

  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const isHttps  = parsed.protocol === "https:";
    const lib      = isHttps ? https : http;
    const reqData  = method === "GET" ? "" : payload;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers:  method !== "GET" ? { ...headers, "Content-Length": Buffer.byteLength(reqData) } : headers,
    };

    const req = lib.request(options, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode });
      else reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on("error", reject);
    if (reqData) req.write(reqData);
    req.end();
  });
}

// ── Email sender ───────────────────────────────────────────────────────────
async function sendEmail(cfg, { title, body, level }) {
  const allowSelfSigned = process.env.SMTP_ALLOW_SELF_SIGNED === "1" && process.env.NODE_ENV !== "production";
  const transporter = nodemailer.createTransport({
    host:   cfg.host,
    port:   Number(cfg.port || 587),
    secure: Number(cfg.port) === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    ...(allowSelfSigned ? { tls: { rejectUnauthorized: false } } : {}),
  });

  const emoji = level === "critical" ? "🚨" : level === "warning" ? "⚠️" : "ℹ️";

  await transporter.sendMail({
    from:    cfg.from || cfg.user,
    to:      cfg.to,
    subject: `${emoji} ELARIS: ${title}`,
    text:    `${title}\n\n${body}\n\n---\nElaris Home Automation`,
    html:    `<h2>${emoji} ${title}</h2><p>${body.replace(/\n/g,"<br>")}</p><hr><small>Elaris Home Automation</small>`,
  });

  return { ok: true };
}

// ── Main send function ─────────────────────────────────────────────────────
async function sendNotification(channel, notification) {
  const cfg = typeof channel.config_json === "string"
    ? JSON.parse(channel.config_json)
    : channel.config_json;

  try {
    if (channel.type === "webhook") {
      return await sendWebhook(cfg, notification);
    } else if (channel.type === "email") {
      return await sendEmail(cfg, notification);
    }
    throw new Error(`Unknown channel type: ${channel.type}`);
  } catch (e) {
    console.error(`[NOTIFY] Failed to send via ${channel.type} (${channel.name}):`, e.message);
    throw e;
  }
}

// ── DB helpers (called from index.js with db) ──────────────────────────────
function initNotifications(db) {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_channels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      config_json TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_ts  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  INTEGER,
      tag         TEXT,
      title       TEXT,
      body        TEXT,
      level       TEXT,
      ok          INTEGER,
      error       TEXT,
      ts          INTEGER NOT NULL
    );
  `);

  const listChannelsStmt  = db.prepare(`SELECT * FROM notification_channels ORDER BY id ASC`);
  const getChannelStmt    = db.prepare(`SELECT * FROM notification_channels WHERE id = ?`);
  const insertChannelStmt = db.prepare(`INSERT INTO notification_channels(name,type,config_json,enabled,created_ts) VALUES(?,?,?,1,?)`);
  const updateChannelStmt = db.prepare(`UPDATE notification_channels SET name=?,type=?,config_json=?,enabled=? WHERE id=?`);
  const deleteChannelStmt = db.prepare(`DELETE FROM notification_channels WHERE id=?`);
  const insertLog         = db.prepare(`INSERT INTO notification_log(channel_id,tag,title,body,level,ok,error,ts) VALUES(?,?,?,?,?,?,?,?)`);
  const listLog           = db.prepare(`SELECT * FROM notification_log ORDER BY ts DESC LIMIT 100`);
  const getLastSentStmt   = db.prepare(`SELECT ts FROM notification_log WHERE channel_id = ? AND tag = ? AND ok = 1 ORDER BY ts DESC LIMIT 1`);

  function isCooledDown(channelId, tag, cooldownMs) {
    if (!cooldownMs) return true;
    const row = getLastSentStmt.get(channelId, tag || "");
    if (!row) return true;
    return Date.now() - row.ts >= cooldownMs;
  }

  function listChannels() {
    return listChannelsStmt.all();
  }

  function getChannel(id) {
    return getChannelStmt.get(id);
  }

  async function deliverChannel(ch, { title, body, level = "info", tag = "" }) {
    try {
      await sendNotification(ch, { title, body, level });
      insertLog.run(ch.id, tag, title, body, level, 1, null, Date.now());
      console.log(`[NOTIFY] Sent "${title}" via ${ch.type}:${ch.name}`);
      return {
        channel_id: ch.id,
        channel_name: ch.name,
        channel_type: ch.type,
        ok: true,
      };
    } catch (e) {
      insertLog.run(ch.id, tag, title, body, level, 0, e.message, Date.now());
      return {
        channel_id: ch.id,
        channel_name: ch.name,
        channel_type: ch.type,
        ok: false,
        error: e.message,
      };
    }
  }

  // Send to all enabled channels with cooldown
  async function notify({ title, body, level = "info", tag = "", cooldown_s = 300 }) {
    const channels = listChannels().filter(c => c.enabled);
    const results = [];
    for (const ch of channels) {
      if (!isCooledDown(ch.id, tag || title, cooldown_s * 1000)) {
        console.log(`[NOTIFY] Cooldown active for channel ${ch.id} tag "${tag}"`);
        results.push({
          channel_id: ch.id,
          channel_name: ch.name,
          channel_type: ch.type,
          ok: false,
          skipped: true,
          error: "cooldown_active",
        });
        continue;
      }
      results.push(await deliverChannel(ch, { title, body, level, tag }));
    }
    return results;
  }

  async function notifyOne(channelId, { title, body, level = "info", tag = "" }) {
    const ch = getChannel(channelId);
    if (!ch) throw new Error("not_found");
    return await deliverChannel(ch, { title, body, level, tag });
  }

  function createChannel(name, type, config) {
    const safe = sanitizeChannelInput({ name, type, config });
    const r = insertChannelStmt.run(safe.name, safe.type, JSON.stringify(safe.config), Date.now());
    return r.lastInsertRowid;
  }

  function updateChannel(id, name, type, config, enabled) {
    const prev = getChannel(id);
    if (!prev) throw new Error("not_found");
    const prevCfg = typeof prev.config_json === "string" ? JSON.parse(prev.config_json) : prev.config_json;
    const safe = sanitizeChannelInput({ name, type, config }, prevCfg);
    updateChannelStmt.run(safe.name, safe.type, JSON.stringify(safe.config), enabled ? 1 : 0, id);
  }

  function deleteChannel(id) {
    return deleteChannelStmt.run(id);
  }

  return {
    notify,
    notifyOne,
    listChannels,
    getChannel,
    createChannel,
    updateChannel,
    deleteChannel,
    listLog: () => listLog.all(),
  };
}

module.exports = { initNotifications };
