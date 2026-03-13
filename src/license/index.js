// src/license/index.js
const fs = require("fs");
const path = require("path");

const LICENSE_PATH = path.resolve(process.cwd(), "license.json");

let license = null;

let features = {
  multi_site: false,
  dashboard_builder: false,
  automations: false,
  engineer_tools: false,
  remote_access: false,
};

function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_PATH)) {
      console.warn("[LICENSE] license.json not found → running WITHOUT license");
      license = null;
      return false;
    }
    const raw = fs.readFileSync(LICENSE_PATH, "utf8");
    const obj = JSON.parse(raw);

    // DEV MODE: αν δεν υπάρχει signature, το δεχόμαστε
    if (!obj.signature) {
      console.warn("[LICENSE] DEV MODE (no signature) → accepted");
      license = obj;
      features = { ...features, ...(obj.features || {}) };
      return true;
    }

    // PROD: εδώ θα βάλεις verifySignature/controllerFingerprint αν θέλεις.
    // Για τώρα κρατάμε απλά reject αν υπάρχει signature αλλά δεν κάνουμε verify.
    console.warn("[LICENSE] signature present but verify not implemented → rejected");
    license = null;
    return false;
  } catch (e) {
    console.warn("[LICENSE] load error:", e?.message || e);
    license = null;
    return false;
  }
}

function hasFeature(k) {
  return !!features[k];
}

function getLicense() {
  return license;
}

module.exports = { loadLicense, hasFeature, getLicense };
