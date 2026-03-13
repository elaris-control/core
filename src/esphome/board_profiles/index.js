const a4 = require('./kincony_a4');
const a8 = require('./kincony_a8');
const a16 = require('./kincony_a16');
const a32 = require('./kincony_a32');
const e16s = require('./kincony_e16s');
const genericEsp32 = require('./generic_esp32dev');
const wt32 = require('./wt32_eth01');

const profiles = [a4, a8, a16, a32, e16s, wt32, genericEsp32];
const byId = new Map(profiles.map(p => [p.id, p]));

function listBoardSummaries() {
  return profiles.map(p => ({
    id: p.id,
    label: p.label,
    board: p.board,
    platform: p.platform,
    variant: p.variant || null,
    frameworkDefault: p.frameworkDefault || null,
    supports: p.supports || {},
    notes: p.notes || [],
    defaults: (p.entityDefaults || []).map(e => ({
      type: e.type,
      name: e.name,
      key: e.key,
      source: e.source,
      pin: e.pin || e.source,
    })),
  }));
}

function getProfile(profileId) {
  return byId.get(String(profileId || '').trim()) || null;
}

module.exports = {
  profiles,
  listBoardSummaries,
  getProfile,
};
