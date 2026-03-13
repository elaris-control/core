// src/oauth.js
// Google + GitHub OAuth 2.0 — callback-based, no passport dependency
const https = require("https");

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { "User-Agent": "ELARIS/1.0", ...headers } }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on("error", reject);
  });
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const payload = typeof body === "string" ? body : new URLSearchParams(body).toString();
    const req = https.request({
      method: "POST",
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload),
        "Accept": "application/json",
        "User-Agent": "ELARIS/1.0",
        ...headers,
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── Google ────────────────────────────────────────────────────────────────
function makeGoogleOAuth({ clientId, clientSecret, redirectUri }) {
  function getAuthUrl(state) {
    const p = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         "openid email profile",
      access_type:   "online",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  async function exchangeCode(code) {
    const data = await post("https://oauth2.googleapis.com/token", {
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    });
    if (data.error) throw new Error(`Google token error: ${data.error}`);

    // Decode id_token (we just need the payload — signature verified by Google via HTTPS)
    const [, payload] = data.id_token.split(".");
    const info = JSON.parse(Buffer.from(payload + "==", "base64").toString());
    return { provider_id: info.sub, email: info.email, name: info.name || info.email };
  }

  return { getAuthUrl, exchangeCode };
}

// ── GitHub ────────────────────────────────────────────────────────────────
function makeGithubOAuth({ clientId, clientSecret, redirectUri }) {
  function getAuthUrl(state) {
    const p = new URLSearchParams({
      client_id:    clientId,
      redirect_uri: redirectUri,
      scope:        "read:user user:email",
      state,
    });
    return `https://github.com/login/oauth/authorize?${p}`;
  }

  async function exchangeCode(code) {
    const data = await post("https://github.com/login/oauth/access_token", {
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      code,
    });
    if (data.error) throw new Error(`GitHub token error: ${data.error}`);

    const userInfo  = await get("https://api.github.com/user", { Authorization: `Bearer ${data.access_token}` });
    const emailList = await get("https://api.github.com/user/emails", { Authorization: `Bearer ${data.access_token}` });
    const primary   = (Array.isArray(emailList) ? emailList : []).find(e => e.primary)?.email || userInfo.email;

    return { provider_id: String(userInfo.id), email: primary, name: userInfo.name || userInfo.login };
  }

  return { getAuthUrl, exchangeCode };
}

module.exports = { makeGoogleOAuth, makeGithubOAuth };
