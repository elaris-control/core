'use strict';
// src/api/esphome/catalog_routes.js — board catalog, YAML import, validate

const { listCatalogSummaries, getCatalogProfile, seedProfileCatalog, upsertProfileFromObject } = require('../../esphome/profile_registry');
const { normalizeProfileDefinition } = require('../../esphome/profile_editor');
const { safeName, parseGpio, toGpioLabel } = require('../../esphome/schema');
const { addPeripheralToYaml } = require('../../esphome/generator');
const { parseEsphomeYaml } = require('../../esphome/yaml_importer');
const { checkEsphome, listPorts, fetchUrl, resolveConfig, validatePeripheralEntity } = require('../../esphome/helpers');

function mountCatalogRoutes({ app, db, dataDir, requireLogin, requireEngineerAccess }) {

  app.get('/api/esphome/check', requireLogin, (req, res) => {
    res.json({
      ...checkEsphome(dataDir),
      ports: listPorts(),
      boards: listCatalogSummaries(db),
      presets: Object.fromEntries(listCatalogSummaries(db).map(b => [b.id, { entities: b.defaults || [] }])),
    });
  });

  app.get('/api/esphome/boards', requireLogin, (req, res) => {
    res.json({ boards: listCatalogSummaries(db) });
  });

  app.get('/api/esphome/profile/:id', requireLogin, (req, res) => {
    const profile = getCatalogProfile(db, req.params.id);
    if (!profile) return res.status(404).json({ error: 'profile_not_found' });
    res.json({ profile: listCatalogSummaries(db).find(b => b.id === profile.id) });
  });

  app.get('/api/esphome/ports', requireLogin, (req, res) => {
    const ports = listPorts();
    console.log('[ESPHOME] ports:', ports);
    res.json({ ports });
  });

  app.get('/api/esphome/catalog', requireLogin, (req, res) => {
    res.json({ boards: listCatalogSummaries(db) });
  });

  app.get('/api/esphome/catalog/export/:id', requireLogin, (req, res) => {
    const rows = listCatalogSummaries(db);
    const row = rows.find(b => b.id === req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'profile_not_found' });
    const profile = getCatalogProfile(db, req.params.id);
    if (!profile) return res.status(404).json({ ok: false, error: 'profile_not_found' });
    res.json({
      ok: true,
      profile: {
        id: row.id,
        label: row.label,
        platform: row.platform,
        board: row.board,
        frameworkDefault: row.frameworkDefault,
        supports: row.supports,
        notes: row.notes,
        source: row.source,
        source_url: row.source_url,
        capabilities: row.capabilities,
        definition: profile,
      },
    });
  });

  app.post('/api/esphome/catalog/reseed', requireEngineerAccess, (req, res) => {
    try {
      const seeded = seedProfileCatalog(db);
      res.json({ ok: true, count: seeded.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/esphome/catalog/:boardId/inject-pending', requireEngineerAccess, (req, res) => {
    try {
      const profile = getCatalogProfile(db, req.params.boardId);
      if (!profile) return res.status(404).json({ ok: false, error: 'profile_not_found' });
      const { device_name, site_id } = req.body || {};
      if (!device_name || !String(device_name).trim())
        return res.status(400).json({ ok: false, error: 'device_name required' });
      const deviceId = String(device_name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const entities = profile.entityDefaults || [];
      if (!entities.length) return res.status(400).json({ ok: false, error: 'profile_has_no_entities' });
      const now = Date.now();
      const upsert = db.prepare(`INSERT INTO pending_io(device_id, group_name, key, first_seen, last_seen, last_value, site_id) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(device_id, group_name, key) DO UPDATE SET last_seen=excluded.last_seen`);
      const isBlocked = db.prepare(`SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=?`);
      const isApproved = db.prepare(`SELECT 1 FROM io WHERE device_id=? AND key=?`);
      let injected = 0, skipped = 0;
      db.transaction(() => {
        for (const e of entities) {
          if (!e?.key) continue;
          const group = e.type === 'relay' ? 'state' : 'tele';
          if (isBlocked.get(deviceId, group, e.key)) { skipped++; continue; }
          if (isApproved.get(deviceId, e.key)) { skipped++; continue; }
          upsert.run(deviceId, group, e.key, now, now, null, site_id || null);
          injected++;
        }
      })();
      res.json({ ok: true, device_id: deviceId, injected, skipped, total: entities.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/esphome/catalog/parse-yaml', requireEngineerAccess, async (req, res) => {
    try {
      let yamlText = req.body?.yaml || '';
      const url = req.body?.url || '';
      if (!yamlText && url) yamlText = await fetchUrl(url);
      if (!yamlText) return res.status(400).json({ ok: false, error: 'yaml_or_url_required' });
      const parsed = parseEsphomeYaml(yamlText);
      res.json({ ok: true, parsed });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/esphome/add-peripheral-to-draft', requireEngineerAccess, (req, res) => {
    try {
      const yamlText = String(req.body?.yaml_text || '').trim();
      const rawEntity = req.body?.entity || {};
      if (!yamlText) return res.status(400).json({ ok: false, error: 'yaml_text_required' });
      let parsed;
      try { parsed = parseEsphomeYaml(yamlText); }
      catch (e) { return res.status(400).json({ ok: false, error: 'invalid_yaml: ' + String(e?.message || e) }); }
      const deviceSafeName = parsed.id || safeName(parsed.label || 'device') || 'device';
      const eType = String(rawEntity.type || '').trim().toLowerCase();
      const eName = String(rawEntity.name || '').trim();
      const ePinRaw = String(rawEntity.pin || '').trim();
      const ePinNum = parseGpio(ePinRaw);
      const ePin = ePinNum !== null ? toGpioLabel(ePinNum) : null;
      const eSdaRaw = String(rawEntity.sda || '').trim();
      const eSclRaw = String(rawEntity.scl || '').trim();
      const eAddress = String(rawEntity.address || '').trim().toLowerCase();
      const eKey = String(rawEntity.key || '').trim().replace(/[^a-z0-9_]/g, '_').replace(/^_|_$/g, '') || safeName(eName) || 'sensor_1';
      const eScale = String(rawEntity.scale || 'none').trim();
      const eScaleFactor = Number(rawEntity.scale_factor) || 1;
      // Resolve frontend type aliases → base type (mirrors AP_LIBRARY.baseType in peripheral.js)
      const TYPE_ALIASES = {
        soil_moisture: 'analog', ntc: 'analog', mq2: 'analog', mq7: 'analog', mq135: 'analog', ct_clamp: 'analog',
        anemometer: 'pulse_counter', yfs201: 'pulse_counter',
        rain_digital: 'di', pir: 'di', door_contact: 'di', vibration: 'di', water_leak: 'di', float_switch: 'di',
      };
      const resolvedType = TYPE_ALIASES[eType] || eType;
      const ALLOWED_TYPES = ['ds18b20', 'dht11', 'dht', 'analog', 'pulse_counter', 'bh1750', 'sht3x', 'di'];
      if (!ALLOWED_TYPES.includes(resolvedType)) return res.status(400).json({ ok: false, error: 'unsupported_entity_type: ' + eType });
      if (!eName) return res.status(400).json({ ok: false, error: 'entity_name_required' });
      const isI2c = resolvedType === 'bh1750' || resolvedType === 'sht3x';
      if (isI2c) { if (!eSdaRaw || !eSclRaw || !eAddress) return res.status(400).json({ ok: false, error: 'i2c_fields_required' }); }
      else if (!ePin) return res.status(400).json({ ok: false, error: 'invalid_pin_format' });
      const validation = validatePeripheralEntity({ profile: parsed, yamlText, entity: isI2c ? { type: resolvedType, sda: eSdaRaw, scl: eSclRaw, address: eAddress } : { type: resolvedType, pin: ePin } });
      if (!validation.ok) return res.status(400).json({ ok: false, error: validation.errors.join(' · '), warnings: validation.warnings || [] });
      const updatedYaml = addPeripheralToYaml(yamlText, deviceSafeName, {
        type: resolvedType, name: eName, key: eKey, pin: validation.pin || ePin, sda: validation.sda || eSdaRaw, scl: validation.scl || eSclRaw, address: validation.address || eAddress,
        pin_mode: validation.pinMode, scale: eScale, scale_factor: eScaleFactor,
      }, { deviceName: parsed.label || deviceSafeName, boardLabel: parsed.label || 'ELARIS', boardProfileId: parsed.id || null });
      res.json({ ok: true, yaml: updatedYaml, validation: { ok: true, warnings: validation.warnings || [] } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/esphome/catalog/save-parsed', requireEngineerAccess, (req, res) => {
    try {
      const { profile } = req.body || {};
      if (!profile || !profile.id || !profile.label)
        return res.status(400).json({ ok: false, error: 'profile id and label required' });
      const fileObj = {
        id: profile.id, label: profile.label, platform: profile.platform || 'esp32',
        board: profile.board || 'esp32dev', framework_default: profile.frameworkDefault || 'arduino',
        source: 'yaml_import', source_url: req.body.source_url || null,
        notes: profile.notes || [], definition: profile,
      };
      const saved = upsertProfileFromObject(db, fileObj);
      res.json({ ok: true, id: saved.id, label: saved.label });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/esphome/catalog/save-profile', requireEngineerAccess, (req, res) => {
    try {
      const rows = listCatalogSummaries(db);
      const incoming = req.body?.profile || {};
      const normalized = normalizeProfileDefinition(incoming);
      const existing = rows.find(r => r.id === normalized.id);
      const allowOverride = !!req.body?.allow_override;
      if (existing && existing.source === 'bundled_js_seed' && !allowOverride) {
        return res.status(400).json({ ok: false, error: 'bundled_profile_read_only', hint: 'Clone the bundled profile to a new ID before saving.' });
      }
      const saved = upsertProfileFromObject(db, {
        id: normalized.id,
        label: normalized.label,
        platform: normalized.platform,
        board: normalized.board,
        framework_default: normalized.frameworkDefault,
        source: existing && existing.source === 'bundled_js_seed' ? 'bundled_override' : 'profile_editor',
        source_url: req.body?.source_url || null,
        notes: normalized.notes || [],
        definition: normalized,
      });
      res.json({ ok: true, id: saved.id, label: saved.label });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete('/api/esphome/catalog/:id', requireEngineerAccess, (req, res) => {
    try {
      const rows = listCatalogSummaries(db);
      const existing = rows.find(r => r.id === req.params.id);
      if (!existing) return res.status(404).json({ ok: false, error: 'profile_not_found' });
      if (existing.source === 'bundled_js_seed') return res.status(400).json({ ok: false, error: 'bundled_profile_read_only' });
      db.prepare('DELETE FROM esphome_profile_capabilities WHERE profile_id = ?').run(req.params.id);
      db.prepare('DELETE FROM esphome_board_profiles WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/esphome/validate', requireEngineerAccess, (req, res) => {
    const { payload, profile, validation, yaml } = resolveConfig(db, req.body);
    if (!profile) return res.status(400).json({ ok: false, error: 'unknown_board_profile', validation });
    res.json({ ok: validation.ok, validation, yaml, profile: { id: profile.id, label: profile.label } });
  });
}

module.exports = { mountCatalogRoutes };
