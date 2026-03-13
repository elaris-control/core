const fs = require('fs');
const path = require('path');
const { profiles: jsProfiles } = require('./board_profiles');

const CATALOG_DIR = path.join(__dirname, 'catalog_profiles');

function stripFunctions(value) {
  return JSON.parse(JSON.stringify(value));
}

function deriveCapabilities(profile) {
  const items = Array.isArray(profile?.entityDefaults) ? profile.entityDefaults : [];
  const counts = new Map();
  for (const item of items) {
    const t = String(item?.type || '').toLowerCase();
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([capability_key, channel_count]) => ({
    capability_key,
    channel_count,
    meta: { source: 'entityDefaults' },
  }));
}

function buildSeedProfiles() {
  const base = [];
  for (const p of jsProfiles) {
    const profile = stripFunctions(p);
    base.push({
      id: profile.id,
      label: profile.label,
      platform: profile.platform,
      board: profile.board,
      framework_default: profile.frameworkDefault || null,
      supports: profile.supports || {},
      notes: profile.notes || [],
      source: 'bundled_js_seed',
      source_url: null,
      definition: profile,
      capabilities: deriveCapabilities(profile),
    });
  }

  if (fs.existsSync(CATALOG_DIR)) {
    for (const file of fs.readdirSync(CATALOG_DIR)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(CATALOG_DIR, file);
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!raw?.id || !raw?.definition) continue;
        const merged = {
          id: raw.id,
          label: raw.label || raw.definition?.label || raw.id,
          platform: raw.platform || raw.definition?.platform || null,
          board: raw.board || raw.definition?.board || null,
          framework_default: raw.framework_default || raw.definition?.frameworkDefault || null,
          supports: raw.supports || raw.definition?.supports || {},
          notes: raw.notes || raw.definition?.notes || [],
          source: raw.source || 'catalog_json',
          source_url: raw.source_url || null,
          definition: raw.definition,
          capabilities: Array.isArray(raw.capabilities) && raw.capabilities.length
            ? raw.capabilities
            : deriveCapabilities(raw.definition),
        };
        const idx = base.findIndex(x => x.id === merged.id);
        if (idx >= 0) base[idx] = merged;
        else base.push(merged);
      } catch (e) {
        // ignore malformed seed file
      }
    }
  }

  return base;
}

function ensureProfileCatalogTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS esphome_board_profiles (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      platform TEXT,
      board TEXT,
      framework_default TEXT,
      supports_json TEXT,
      notes_json TEXT,
      definition_json TEXT NOT NULL,
      source TEXT,
      source_url TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seeded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS esphome_profile_capabilities (
      profile_id TEXT NOT NULL,
      capability_key TEXT NOT NULL,
      channel_count INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT,
      PRIMARY KEY (profile_id, capability_key),
      FOREIGN KEY (profile_id) REFERENCES esphome_board_profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_esphome_board_profiles_enabled ON esphome_board_profiles(is_enabled);
    CREATE INDEX IF NOT EXISTS idx_esphome_profile_capabilities_key ON esphome_profile_capabilities(capability_key);
  `);
}

function seedProfileCatalog(db, seedProfiles = buildSeedProfiles()) {
  if (!db) return [];
  ensureProfileCatalogTables(db);
  const now = new Date().toISOString();
  const upsertProfile = db.prepare(`
    INSERT INTO esphome_board_profiles (
      id, label, platform, board, framework_default, supports_json, notes_json,
      definition_json, source, source_url, is_enabled, created_at, updated_at, last_seeded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label=excluded.label,
      platform=excluded.platform,
      board=excluded.board,
      framework_default=excluded.framework_default,
      supports_json=excluded.supports_json,
      notes_json=excluded.notes_json,
      definition_json=excluded.definition_json,
      source=excluded.source,
      source_url=excluded.source_url,
      updated_at=excluded.updated_at,
      last_seeded_at=excluded.last_seeded_at
  `);
  const deleteCaps = db.prepare(`DELETE FROM esphome_profile_capabilities WHERE profile_id=?`);
  const insertCap = db.prepare(`
    INSERT OR REPLACE INTO esphome_profile_capabilities(profile_id, capability_key, channel_count, meta_json)
    VALUES (?, ?, ?, ?)
  `);

  const tx = db.transaction((profiles) => {
    for (const p of profiles) {
      upsertProfile.run(
        p.id,
        p.label,
        p.platform,
        p.board,
        p.framework_default || null,
        JSON.stringify(p.supports || {}),
        JSON.stringify(p.notes || []),
        JSON.stringify(p.definition || {}),
        p.source || 'seed',
        p.source_url || null,
        now,
        now,
        now,
      );
      deleteCaps.run(p.id);
      for (const cap of (p.capabilities || [])) {
        insertCap.run(p.id, cap.capability_key, Number(cap.channel_count || 0), JSON.stringify(cap.meta || {}));
      }
    }
  });
  tx(seedProfiles);
  return seedProfiles;
}

function withRuntimeHelpers(def) {
  if (!def || typeof def !== 'object') return null;
  if (typeof def.resolveSource !== 'function') {
    def.resolveSource = function resolveSource(source) {
      const s = String(source || '').trim().toUpperCase();
      const defaults = Array.isArray(def.entityDefaults) ? def.entityDefaults : [];
      return defaults.find(e => String(e?.source || '').trim().toUpperCase() === s) || null;
    };
  }
  return def;
}

function getProfileCatalogRows(db) {
  if (!db) return [];
  ensureProfileCatalogTables(db);
  const rows = db.prepare(`
    SELECT id, label, platform, board, framework_default, supports_json, notes_json,
           definition_json, source, source_url, is_enabled, updated_at, last_seeded_at
    FROM esphome_board_profiles
    WHERE is_enabled=1
    ORDER BY label COLLATE NOCASE ASC
  `).all();
  const capsByProfile = new Map();
  const caps = db.prepare(`
    SELECT profile_id, capability_key, channel_count, meta_json
    FROM esphome_profile_capabilities
    ORDER BY profile_id, capability_key
  `).all();
  for (const c of caps) {
    if (!capsByProfile.has(c.profile_id)) capsByProfile.set(c.profile_id, []);
    capsByProfile.get(c.profile_id).push({
      key: c.capability_key,
      count: Number(c.channel_count || 0),
      meta: c.meta_json ? JSON.parse(c.meta_json) : {},
    });
  }
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    platform: r.platform,
    board: r.board,
    frameworkDefault: r.framework_default || null,
    supports: r.supports_json ? JSON.parse(r.supports_json) : {},
    notes: r.notes_json ? JSON.parse(r.notes_json) : [],
    source: r.source || null,
    source_url: r.source_url || null,
    definition: r.definition_json ? withRuntimeHelpers(JSON.parse(r.definition_json)) : null,
    capabilities: capsByProfile.get(r.id) || [],
    updated_at: r.updated_at,
    last_seeded_at: r.last_seeded_at,
  }));
}

function listCatalogSummaries(db) {
  return getProfileCatalogRows(db).map(r => ({
    id: r.id,
    label: r.label,
    board: r.board,
    platform: r.platform,
    frameworkDefault: r.frameworkDefault,
    supports: r.supports,
    notes: r.notes,
    source: r.source,
    source_url: r.source_url,
    capabilities: r.capabilities,
    defaults: (r.definition?.entityDefaults || []).map(e => ({
      type: e.type,
      name: e.name,
      key: e.key,
      source: e.source,
      pin: e.pin || e.source,
    })),
  }));
}

function getCatalogProfile(db, profileId) {
  const rows = getProfileCatalogRows(db);
  return rows.find(r => r.id === profileId)?.definition || null;
}

function upsertProfileFromObject(db, raw) {
  const entry = {
    id: raw.id,
    label: raw.label || raw.definition?.label || raw.id,
    platform: raw.platform || raw.definition?.platform || null,
    board: raw.board || raw.definition?.board || null,
    framework_default: raw.framework_default || raw.definition?.frameworkDefault || null,
    supports: raw.supports || raw.definition?.supports || {},
    notes: raw.notes || raw.definition?.notes || [],
    source: raw.source || 'yaml_import',
    source_url: raw.source_url || null,
    definition: raw.definition || raw,
    capabilities: deriveCapabilities(raw.definition || raw),
  };
  seedProfileCatalog(db, [entry]);
  return { id: entry.id, label: entry.label };
}

function upsertProfileFromFile(db, filepath) {
  const raw = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  const entry = {
    id: raw.id,
    label: raw.label || raw.definition?.label || raw.id,
    platform: raw.platform || raw.definition?.platform || null,
    board: raw.board || raw.definition?.board || null,
    framework_default: raw.framework_default || raw.definition?.frameworkDefault || null,
    supports: raw.supports || raw.definition?.supports || {},
    notes: raw.notes || raw.definition?.notes || [],
    source: raw.source || 'manual_import',
    source_url: raw.source_url || null,
    definition: raw.definition,
    capabilities: Array.isArray(raw.capabilities) && raw.capabilities.length ? raw.capabilities : deriveCapabilities(raw.definition),
  };
  seedProfileCatalog(db, [entry]);
  return entry;
}

module.exports = {
  CATALOG_DIR,
  buildSeedProfiles,
  ensureProfileCatalogTables,
  seedProfileCatalog,
  listCatalogSummaries,
  getCatalogProfile,
  upsertProfileFromFile,
  upsertProfileFromObject,
};
