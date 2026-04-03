const WebSocket = require("ws");
const { spawn }  = require("child_process");

function initWS(server, { db, access, getRole } = {}) {
  const wss = new WebSocket.Server({ server });

  const logSubs = new Set();
  const logBuffer = [];
  const LOG_BUF_MAX = 200;

  // Heartbeat to detect silently-dropped connections (network drops, browser crashes, etc.)
  const HEARTBEAT_INTERVAL = 30_000;
  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        logSubs.delete(client);
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => clearInterval(heartbeatTimer));

  function hasScope(client) {
    return !!((client._siteIds && client._siteIds.size) || (client._deviceIds && client._deviceIds.size));
  }

  function clientMatchesScope(client, obj = {}) {
    const rawSiteId = obj.siteId ?? obj.site_id ?? null;
    const siteId = rawSiteId != null && rawSiteId !== "" ? Number(rawSiteId) : null;
    const deviceId = obj.deviceId != null ? String(obj.deviceId) : (obj.device_id != null ? String(obj.device_id) : null);
    if (siteId == null && !deviceId) return true;
    if (!hasScope(client)) return false;
    if (siteId != null && client._siteIds && client._siteIds.has(siteId)) return true;
    if (deviceId && client._deviceIds && client._deviceIds.has(deviceId)) return true;
    return false;
  }

  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (!client._role) continue;
      if (!clientMatchesScope(client, obj)) continue;
      client.send(msg);
    }
  }

  function sendToClient(clientId, obj) {
    if (!clientId) return broadcast(obj);
    const msg = JSON.stringify(obj);
    let sent = 0;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (!client._role) continue; // never send to unauthenticated connections
      if (client._clientId === clientId) { client.send(msg); sent++; }
    }
    if (sent === 0 && obj.type && obj.type.startsWith('esphome')) {
      console.warn(`[WS] sendToClient(${clientId}): no matching client found (type=${obj.type}, total_clients=${wss.clients.size})`);
    }
  }

  function broadcastLog(entry) {
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUF_MAX) logBuffer.shift();

    if (!logSubs.size) return;
    const msg = JSON.stringify({ type: "log", ...entry });
    for (const client of [...logSubs]) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
      else logSubs.delete(client);
    }
  }

  // Site/device access check using the already-resolved WS role.
  // WS upgrade requests don't pass through Express session middleware,
  // so we rely on ws._isEngineer (resolved at connection time from the cookie)
  // rather than req.user, which is not populated on the upgrade request.
  function wsCanAccessRef(wsConn, ref) {
    if (!ref) return false;
    if (ref.site_id == null || !ref.is_private) return true; // public or unassigned
    return wsConn._isEngineer; // private site requires engineer/admin
  }

  wss.on("connection", (ws, req) => {
    ws._clientId = null;
    ws._siteIds = new Set();
    ws._deviceIds = new Set();
    const role = typeof getRole === "function" ? getRole(req) : null;
    ws._role      = role;                                          // null = unauthenticated
    ws._isEngineer = role === "ENGINEER" || role === "ADMIN";
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: "hello", ts: Date.now() }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "register_client") {
          ws._clientId = String(msg.clientId || "").trim() || null;

          // Validate each claimed siteId against the access layer.
          // Silently drop any site the client has no permission to subscribe to.
          const nextSiteIds = new Set();
          const rawSiteIds = Array.isArray(msg.siteIds) ? msg.siteIds : [msg.siteId];
          for (const raw of rawSiteIds) {
            const siteId = Number(raw);
            if (!Number.isFinite(siteId) || siteId <= 0) continue;
            if (!access) { nextSiteIds.add(siteId); continue; } // no access layer (dev)
            const ref = access.getSiteRef(siteId);
            if (!ref) continue;                            // site doesn't exist
            if (!wsCanAccessRef(ws, ref)) continue;        // private, no permission
            nextSiteIds.add(siteId);
          }
          ws._siteIds = nextSiteIds;

          // Validate each claimed deviceId: device must belong to an accessible site.
          const nextDeviceIds = new Set();
          const rawDeviceIds = Array.isArray(msg.deviceIds) ? msg.deviceIds : [msg.deviceId];
          for (const raw of rawDeviceIds) {
            const deviceId = String(raw || "").trim();
            if (!deviceId) continue;
            if (!access) { nextDeviceIds.add(deviceId); continue; } // dev mode
            const ref = access.getDeviceSiteRef(deviceId);
            if (!ref) {
              // Device not yet assigned — only engineers can subscribe to unassigned devices
              if (ws._isEngineer) nextDeviceIds.add(deviceId);
              continue;
            }
            if (!wsCanAccessRef(ws, ref)) continue;        // private site, no permission
            nextDeviceIds.add(deviceId);
          }
          ws._deviceIds = nextDeviceIds;
        }

        if (msg.type === "subscribe_logs") {
          if (!ws._isEngineer) {
            ws.send(JSON.stringify({ type: "error", text: "Engineer or admin access required." }));
            return;
          }
          logSubs.add(ws);
          for (const entry of logBuffer) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "log", ...entry }));
            }
          }
        }

        if (msg.type === "unsubscribe_logs") {
          logSubs.delete(ws);
        }

        if (msg.type === "exec_command") {
          const shellEnabled = process.env.ENABLE_SHELL_CONSOLE === "1";
          const isAdmin = ws._role === "ADMIN";
          const deny = (reason) => {
            ws.send(JSON.stringify({ type: "exec_result", stream: "err", text: reason, cmdId: msg.cmdId }));
            ws.send(JSON.stringify({ type: "exec_done", code: 1, cmdId: msg.cmdId }));
          };
          if (!shellEnabled) return deny("Shell console is disabled. Set ENABLE_SHELL_CONSOLE=1 to enable.");
          if (!isAdmin)      return deny("Permission denied — admin access required.");

          const rawCmd = String(msg.command || "").trim();
          if (!rawCmd) return;

          // Reject shell metacharacters and dangerous patterns
          const dangerousChars = /[;&|`$(){}<>!\\]/;
          const dangerousPatterns = /^(cd|rm|curl|wget|chmod|chown|sudo|mkfs|dd|fdisk|parted|mount|umount|kill|killall|shutdown|reboot|halt|poweroff|init|systemctl|iptables|nc|ncat|netcat|socat|python|python3|perl|ruby|php|node|bash|sh|zsh|fish|exec|eval|source|export|alias|unalias)\b/i;
          if (dangerousChars.test(rawCmd)) return deny("Command contains disallowed characters. Use simple commands only.");
          if (dangerousPatterns.test(rawCmd)) return deny("Command is not allowed.");

          // Only allow alphanumeric, spaces, dots, dashes, underscores, slashes, quotes
          const safePattern = /^[a-zA-Z0-9\s.\-_\/'"=]+$/;
          if (!safePattern.test(rawCmd)) return deny("Command contains disallowed characters.");

          const cmdId = msg.cmdId || String(Date.now());
          const send = (stream, text) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "exec_result", stream, text, cmdId }));
          };

          console.log(`[SHELL] admin exec: ${JSON.stringify(rawCmd)}`);

          const proc = spawn("bash", ["-c", rawCmd], { cwd: process.env.HOME || "/", env: process.env, shell: false });
          const TIMEOUT_MS = 30_000;
          const killer = setTimeout(() => { proc.kill(); send("err", "[killed: 30s timeout]"); }, TIMEOUT_MS);

          proc.stdout.on("data", d => String(d).split("\n").filter(Boolean).forEach(l => send("out", l)));
          proc.stderr.on("data", d => String(d).split("\n").filter(Boolean).forEach(l => send("err", l)));
          proc.on("close", code => {
            clearTimeout(killer);
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "exec_done", code, cmdId }));
          });
          proc.on("error", e => { clearTimeout(killer); send("err", e.message); });
        }
      } catch {}
    });

    ws.on("close", () => {
      logSubs.delete(ws);
    });
  });

  return { wss, broadcast, sendToClient, broadcastLog };
}

module.exports = { initWS };
