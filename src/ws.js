const WebSocket = require("ws");
const { spawn }  = require("child_process");

function initWS(server, { db, getRole } = {}) {
  const wss = new WebSocket.Server({ server });

  const logSubs = new Set();
  const logBuffer = [];
  const LOG_BUF_MAX = 200;

  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  function sendToClient(clientId, obj) {
    if (!clientId) return broadcast(obj);
    const msg = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client._clientId === clientId) client.send(msg);
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

  wss.on("connection", (ws, req) => {
    ws._clientId = null;
    ws._isEngineer = typeof getRole === "function" && getRole(req) === "ENGINEER";
    ws.send(JSON.stringify({ type: "hello", ts: Date.now() }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "register_client") {
          ws._clientId = String(msg.clientId || "").trim() || null;
        }

        if (msg.type === "subscribe_logs") {
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
          if (!ws._isEngineer) {
            ws.send(JSON.stringify({ type: "exec_result", stream: "err", text: "Permission denied — engineer access required.", cmdId: msg.cmdId }));
            ws.send(JSON.stringify({ type: "exec_done", code: 1, cmdId: msg.cmdId }));
            return;
          }
          const cmd = String(msg.command || "").trim();
          if (!cmd) return;

          const cmdId = msg.cmdId || String(Date.now());
          const send = (stream, text) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "exec_result", stream, text, cmdId }));
          };

          const proc = spawn("bash", ["-c", cmd], { cwd: process.env.HOME || "/", env: process.env });
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
