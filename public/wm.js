// wm.js — ELARIS Window Manager
// Floating, resizable, minimizable windows on a canvas dashboard

const WM = (() => {
  const STORAGE_KEY = "elaris_wm_layout_v2";
  const MIN_W = 280, MIN_H = 120;
  const TASKBAR_H = 48;

  let windows    = {};   // id → { el, state }
  let taskbar    = null;
  let canvas     = null;
  let zTop       = 100;
  let dragging   = null; // { id, offX, offY }
  let resizing   = null; // { id, startX, startY, startW, startH, startL, startT, edge }

  // ── Default layout (first boot) ──────────────────────────────────────
  const DEFAULTS = {
    "weather":   { x:   8, y:  8, w: 380, h: 280, title:"🌤️ Weather",       minimized:false },
    "solar":     { x:   8, y:300, w: 380, h: 380, title:"☀️ Solar System",   minimized:false },
    "temp":      { x: 400, y:  8, w: 420, h: 180, title:"🌡️ Temperature",    minimized:false },
    "io":        { x: 400, y:200, w: 420, h: 440, title:"📋 Inputs / Status", minimized:false },
    "engineer":  { x: 400, y:655, w: 420, h: 120, title:"🔧 Engineer",        minimized:false },
  };

  // ── Load / Save layout ────────────────────────────────────────────────
  function loadLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved || structuredClone(DEFAULTS);
    } catch { return structuredClone(DEFAULTS); }
  }

  function saveLayout() {
    const layout = {};
    for (const [id, win] of Object.entries(windows)) {
      const r = win.el.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      layout[id] = {
        x:         win.el.offsetLeft,
        y:         win.el.offsetTop,
        w:         win.el.offsetWidth,
        h:         win.el.offsetHeight,
        title:     win.title,
        minimized: win.minimized,
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }

  // ── Create window ─────────────────────────────────────────────────────
  function createWindow(id, contentEl, opts = {}) {
    const layout = loadLayout();
    const pos    = layout[id] || DEFAULTS[id] || { x:60, y:60, w:380, h:300, title:id, minimized:false };

    const win = document.createElement("div");
    win.className   = "wm-window";
    win.id          = "wmw-" + id;
    win.style.cssText = `
      left:${pos.x}px; top:${pos.y}px;
      width:${pos.w}px; height:${pos.h}px;
      z-index:${++zTop};
    `;

    win.innerHTML = `
      <div class="wm-titlebar" data-id="${id}">
        <span class="wm-title">${pos.title || opts.title || id}</span>
        <div class="wm-controls">
          <button class="wm-btn wm-min"  title="Minimize">─</button>
          <button class="wm-btn wm-close" title="Close">✕</button>
        </div>
      </div>
      <div class="wm-body"></div>
      <div class="wm-resize-handle"></div>
    `;

    win.querySelector(".wm-body").appendChild(contentEl);
    canvas.appendChild(win);

    const winState = { el: win, minimized: false, title: pos.title || opts.title || id };
    windows[id] = winState;

    // Titlebar drag
    const titlebar = win.querySelector(".wm-titlebar");
    titlebar.addEventListener("mousedown", e => {
      if (e.target.closest(".wm-controls")) return;
      e.preventDefault();
      bringToFront(id);
      dragging = { id, offX: e.clientX - win.offsetLeft, offY: e.clientY - win.offsetTop };
    });

    // Touch drag
    titlebar.addEventListener("touchstart", e => {
      if (e.target.closest(".wm-controls")) return;
      const t = e.touches[0];
      bringToFront(id);
      dragging = { id, offX: t.clientX - win.offsetLeft, offY: t.clientY - win.offsetTop };
    }, { passive: true });

    // Resize handle (bottom-right corner)
    const rh = win.querySelector(".wm-resize-handle");
    rh.addEventListener("mousedown", e => {
      e.preventDefault();
      bringToFront(id);
      resizing = {
        id,
        startX: e.clientX, startY: e.clientY,
        startW: win.offsetWidth, startH: win.offsetHeight,
      };
    });

    // Minimize
    win.querySelector(".wm-min").addEventListener("click", () => toggleMinimize(id));

    // Close
    win.querySelector(".wm-close").addEventListener("click", () => hideWindow(id));

    // Click to bring to front
    win.addEventListener("mousedown", () => bringToFront(id));

    // Restore minimized state
    if (pos.minimized) toggleMinimize(id, true);

    addTaskbarItem(id, pos.title || opts.title || id);
    return win;
  }

  // ── Window operations ─────────────────────────────────────────────────
  function bringToFront(id) {
    const win = windows[id];
    if (!win) return;
    win.el.style.zIndex = ++zTop;
  }

  function toggleMinimize(id, force) {
    const win = windows[id];
    if (!win) return;
    const doMin = force !== undefined ? force : !win.minimized;
    win.minimized = doMin;
    win.el.classList.toggle("wm-minimized", doMin);
    const btn = win.el.querySelector(".wm-min");
    if (btn) btn.textContent = doMin ? "□" : "─";
    updateTaskbarItem(id, doMin);
    saveLayout();
  }

  function hideWindow(id) {
    const win = windows[id];
    if (!win) return;
    win.el.style.display = "none";
    updateTaskbarItem(id, false, true);
    saveLayout();
  }

  function showWindow(id) {
    const win = windows[id];
    if (!win) return;
    win.el.style.display = "";
    win.minimized = false;
    win.el.classList.remove("wm-minimized");
    bringToFront(id);
    updateTaskbarItem(id, false, false);
    saveLayout();
  }

  // ── Taskbar ───────────────────────────────────────────────────────────
  function addTaskbarItem(id, title) {
    if (!taskbar) return;
    const existing = taskbar.querySelector(`[data-wid="${id}"]`);
    if (existing) return;
    const btn = document.createElement("button");
    btn.className = "wm-taskbtn";
    btn.dataset.wid = id;
    btn.textContent = title;
    btn.addEventListener("click", () => {
      const win = windows[id];
      if (!win) return;
      if (win.el.style.display === "none") {
        showWindow(id);
      } else if (win.minimized) {
        toggleMinimize(id, false);
        bringToFront(id);
      } else {
        toggleMinimize(id, true);
      }
    });
    taskbar.appendChild(btn);
  }

  function updateTaskbarItem(id, minimized, hidden) {
    if (!taskbar) return;
    const btn = taskbar.querySelector(`[data-wid="${id}"]`);
    if (!btn) return;
    btn.classList.toggle("minimized", !!minimized);
    btn.classList.toggle("hidden-win", !!hidden);
  }

  // ── Add Widget button ─────────────────────────────────────────────────
  function createAddMenu(items) {
    const btn = document.createElement("button");
    btn.className   = "wm-add-btn";
    btn.textContent = "+ Widget";
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const existing = document.getElementById("wmAddMenu");
      if (existing) { existing.remove(); return; }

      const menu = document.createElement("div");
      menu.id = "wmAddMenu";
      menu.className = "wm-add-menu";
      menu.innerHTML = items.map(item =>
        `<div class="wm-add-item" data-id="${item.id}">${item.icon} ${item.label}</div>`
      ).join("");
      menu.querySelectorAll(".wm-add-item").forEach(el => {
        el.addEventListener("click", () => {
          showWindow(el.dataset.id);
          menu.remove();
        });
      });
      btn.parentElement.appendChild(menu);
      setTimeout(() => document.addEventListener("click", () => menu.remove(), { once:true }), 10);
    });
    return btn;
  }

  // ── Global mouse/touch move ───────────────────────────────────────────
  document.addEventListener("mousemove", e => {
    if (dragging) {
      const win = windows[dragging.id]?.el;
      if (!win) return;
      const cx = canvas.getBoundingClientRect();
      let nx = e.clientX - dragging.offX;
      let ny = e.clientY - dragging.offY;
      // Constrain to canvas
      nx = Math.max(0, Math.min(nx, canvas.offsetWidth  - win.offsetWidth));
      ny = Math.max(0, Math.min(ny, canvas.offsetHeight - 60));
      win.style.left = nx + "px";
      win.style.top  = ny + "px";
    }
    if (resizing) {
      const win = windows[resizing.id]?.el;
      if (!win) return;
      const dw = e.clientX - resizing.startX;
      const dh = e.clientY - resizing.startY;
      win.style.width  = Math.max(MIN_W, resizing.startW + dw) + "px";
      win.style.height = Math.max(MIN_H, resizing.startH + dh) + "px";
    }
  });

  document.addEventListener("touchmove", e => {
    if (!dragging) return;
    const t = e.touches[0];
    const win = windows[dragging.id]?.el;
    if (!win) return;
    let nx = t.clientX - dragging.offX;
    let ny = t.clientY - dragging.offY;
    nx = Math.max(0, Math.min(nx, canvas.offsetWidth - win.offsetWidth));
    ny = Math.max(0, Math.min(ny, canvas.offsetHeight - 60));
    win.style.left = nx + "px";
    win.style.top  = ny + "px";
  }, { passive: true });

  const stopDrag = () => {
    if (dragging || resizing) saveLayout();
    dragging = resizing = null;
  };
  document.addEventListener("mouseup",  stopDrag);
  document.addEventListener("touchend", stopDrag);

  // ── Public API ────────────────────────────────────────────────────────
  return {
    init(canvasEl, taskbarEl) {
      canvas  = canvasEl;
      taskbar = taskbarEl;
    },
    createWindow,
    showWindow,
    hideWindow,
    addTaskbarItem,
    createAddMenu,
    bringToFront,
    get windows() { return windows; },
  };
})();
