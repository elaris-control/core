const WebSocket = require("ws");

function initWS(server) {
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

  wss.on("connection", (ws) => {
    ws._clientId = null;
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
      } catch {}
    });

    ws.on("close", () => {
      logSubs.delete(ws);
    });
  });

  return { wss, broadcast, sendToClient, broadcastLog };
}

module.exports = { initWS };
