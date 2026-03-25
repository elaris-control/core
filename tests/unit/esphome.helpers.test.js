import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import helpers from '../../src/esphome/helpers.js';

const { getEspHomeBin, checkEsphome } = helpers;

const tempDirs = [];

function makeTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elaris-esphome-'));
  tempDirs.push(dir);
  return dir;
}

function writeFakeEspHomeBin(dataDir) {
  // Mirror production getEspHomeBin path logic — single source of truth.
  const isWin = process.platform === 'win32';
  const binDir = isWin
    ? path.join(dataDir, 'esphome_venv', 'Scripts')
    : path.join(dataDir, 'esphome_venv', 'bin');
  const binName = isWin ? 'esphome.exe' : 'esphome';
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, binName);
  fs.writeFileSync(binPath, '', { mode: 0o755 });
  return binPath;
}

describe('ESPHome helper runtime detection', () => {
  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  it('prefers the local venv esphome binary when present', () => {
    const dataDir = makeTempDataDir();
    const binPath = writeFakeEspHomeBin(dataDir);

    const bin = getEspHomeBin(dataDir);
    expect(bin).toBe(binPath);
  });

  it('returns null when no esphome binary is available', () => {
    const dataDir = makeTempDataDir();
    const bin = getEspHomeBin(dataDir);
    expect(bin).toBe(null);
  });

  it('reports version details when checkEsphome succeeds via local venv binary', () => {
    const dataDir = makeTempDataDir();
    const binPath = writeFakeEspHomeBin(dataDir);
    // Fake binary is not executable on all platforms — inject execFn to avoid running it.
    const fakeExec = () => 'ESPHome 2026.3.0\n';

    const status = checkEsphome(dataDir, fakeExec);
    expect(status).toEqual({ ok: true, version: 'ESPHome 2026.3.0', bin: binPath });
  });
});
