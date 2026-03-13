
(function(){
  const SAFE = new Set(["GET","HEAD","OPTIONS"]);
  function readCookie(name) {
    const raw = document.cookie || "";
    const parts = raw.split(/;\s*/);
    for (const part of parts) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1));
    }
    return "";
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function(resource, init) {
    const cfg = init ? { ...init } : {};
    const method = String(cfg.method || (resource && resource.method) || "GET").toUpperCase();
    if (!SAFE.has(method)) {
      const headers = new Headers(cfg.headers || (resource && resource.headers) || {});
      const token = readCookie("elaris_csrf") || window.__ELARIS_CSRF_TOKEN || "";
      if (token && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", token);
      cfg.headers = headers;
      if (!cfg.credentials) cfg.credentials = "same-origin";
    }
    const res = await origFetch(resource, cfg);
    try {
      const token = readCookie("elaris_csrf");
      if (token) window.__ELARIS_CSRF_TOKEN = token;
    } catch(_){}
    return res;
  };
})();
