// public/js/modules/mod_custom.js

registerModule('custom', {
  hasAuto: true,
  updateCommissioningSummary(m) {},
  renderSummary(inst, s, live) { return ''; },
  async enrichCard(inst, settings, spEl) {
    const testMode = String(settings.test_mode || '0') === '1';
    spEl.innerHTML = `
      <div class="sp-panel">
        <div class="sp-title">⚡ Rule Builder</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${testMode ? renderBadge('TEST MODE', '#ffd978', 'rgba(255,201,71,.35)') : ''}</div>
        <button class="btn btn-sm btn-purple" style="width:100%" onclick="openRuleBuilder(${inst.id},'${inst.module_id}')">
          ✏️ Edit Rules
        </button>

        <button class="btn btn-sm" style="width:100%;margin-top:8px;border-color:${testMode ? 'rgba(255,201,71,.35)' : 'var(--line2)'};color:${testMode ? '#ffd978' : 'var(--muted2)'};background:${testMode ? 'rgba(255,201,71,.08)' : 'rgba(255,255,255,.03)'}" onclick="toggleModuleTestMode(${inst.id}, '${settings.test_mode || '0'}')">
          ${testMode ? '🧪 Disable Test Mode' : '🧪 Enable Test Mode'}
        </button>

        <button class="btn btn-sm btn-danger" style="width:100%;margin-top:8px" onclick="resetCustomAlarms(${inst.id})">
          🧯 Reset Alarms
        </button>

        <button class="btn btn-sm" style="width:100%;margin-top:8px" onclick="resetCustomLock(${inst.id})">
          🔓 Reset Lock (Engineer)
        </button>

        <div id="ruleCount_${inst.id}" style="font-size:11px;color:var(--muted);margin-top:6px;text-align:center"></div>
      </div>`;
    try {
      const rules = JSON.parse(settings.rules || "[]");
      const el = document.getElementById(`ruleCount_${inst.id}`);
      if (el) el.textContent = `${rules.filter(r=>r.enabled).length} active rule(s)`;
    } catch {}
  },
});
