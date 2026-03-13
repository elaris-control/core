const os = require("os");
const crypto = require("crypto");

function controllerFingerprint() {
  const nets = os.networkInterfaces();
  const macs = [];

  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n && n.mac && n.mac !== "00:00:00:00:00:00") macs.push(n.mac);
    }
  }

  macs.sort();
  const base = `${os.hostname()}|${macs.join(",")}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

module.exports = { controllerFingerprint };
