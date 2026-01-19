import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

function hexToU8(hex) {
  const clean = hex.replace(/\s+/g, '');
  const u8 = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    u8[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return u8;
}

function loadScriptIntoContext(absPath, context) {
  const code = fs.readFileSync(absPath, 'utf8');
  vm.runInContext(code, context, { filename: absPath });
}

function createSandbox() {
  const sandbox = {
    window: {},
    globalThis: {},
    console,
    setTimeout,
    clearTimeout,
    Uint8Array,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Math,
  };
  sandbox.globalThis = sandbox.window; // make globalThis === window for scripts
  return vm.createContext(sandbox);
}

test.describe('Icom IC-7300 Driver Unit Tests', () => {
  test('driver loads and exposes required API', async () => {
    const ctx = createSandbox();
    const basePath = path.resolve(__dirname, '..', 'webcat-base.js');
    const drvPath = path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js');

    loadScriptIntoContext(basePath, ctx);
    loadScriptIntoContext(drvPath, ctx);

    const WebCAT = ctx.window.WebCAT;
    expect(WebCAT).toBeTruthy();
    const meta = WebCAT.getDriverMeta('icom.ic7300');
    expect(meta).toBeTruthy();

    const driver = WebCAT.createDriver('icom.ic7300', {});
    expect(driver).toBeTruthy();
    expect(typeof driver.parseFrame).toBe('function');
    expect(typeof driver.controlsSchema).toBe('function');
    expect(typeof driver.cmdReadFreq).toBe('function');
    expect(typeof driver.cmdSetFreqHz).toBe('function');
    expect(typeof driver.availableModes).toBe('function');
  });

  test('availableModes contains common SSB modes', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});
    const modes = driver.availableModes();
    expect(Array.isArray(modes)).toBeTruthy();
    expect(modes).toEqual(expect.arrayContaining(['USB', 'LSB']));
  });

  test('cmdSetFreqHz generates bytes', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});
    const bytes = driver.cmdSetFreqHz(14074000);
    expect(bytes instanceof Uint8Array).toBeTruthy();
    expect(bytes.length).toBeGreaterThan(0);
  });

  test('controlsSchema returns array of control definitions', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});
    const schema = driver.controlsSchema();
    expect(Array.isArray(schema)).toBeTruthy();
  });

  test('parseFrame handles sample inbound frame from fixture', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    const fixturePath = path.resolve(__dirname, '..', 'data', 'sessions', 'ic7300-full.json');
    const session = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const inbound = session.frames.find(f => f.dir === 'in');
    expect(inbound).toBeTruthy();

    const bytes = hexToU8(inbound.data);
    const events = driver.parseFrame(bytes);
    expect(Array.isArray(events)).toBeTruthy();
  });

  test('fixture contains at least one freq event in human HF range', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    const fixturePath = path.resolve(__dirname, '..', 'data', 'sessions', 'ic7300-full.json');
    const session = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const inboundFrames = session.frames.filter(f => f.dir === 'in');
    let found = false;
    for (const f of inboundFrames) {
      const evs = driver.parseFrame(hexToU8(f.data));
      for (const ev of evs) {
        if (ev.type === 'freq' && ev.hz > 1000000 && ev.hz < 30000000) { found = true; break; }
      }
      if (found) break;
    }
    expect(found).toBeTruthy();
  });

  test('fixture contains at least one mode event from available modes', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});
    const modes = driver.availableModes();

    const fixturePath = path.resolve(__dirname, '..', 'data', 'sessions', 'ic7300-full.json');
    const session = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const inboundFrames = session.frames.filter(f => f.dir === 'in');
    let found = false;
    for (const f of inboundFrames) {
      const evs = driver.parseFrame(hexToU8(f.data));
      for (const ev of evs) {
        if (ev.type === 'mode' && modes.includes(ev.modeText)) { found = true; break; }
      }
      if (found) break;
    }
    expect(found).toBeTruthy();
  });

  test('fixture contains at least one SWR event with numeric mapping', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    const fixturePath = path.resolve(__dirname, '..', 'data', 'sessions', 'ic7300-full.json');
    const session = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const inboundFrames = session.frames.filter(f => f.dir === 'in');
    let found = false;
    for (const f of inboundFrames) {
      const evs = driver.parseFrame(hexToU8(f.data));
      for (const ev of evs) {
        if (ev.type === 'swr' && typeof ev.swr === 'number' && ev.swr >= 1.0 && ev.swr <= 10.0) { found = true; break; }
      }
      if (found) break;
    }
    expect(found).toBeTruthy();
  });

  test('fixture contains a PTT event (rx/tx status)', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    const fixturePath = path.resolve(__dirname, '..', 'data', 'sessions', 'ic7300-full.json');
    const session = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const inboundFrames = session.frames.filter(f => f.dir === 'in');
    let found = false;
    for (const f of inboundFrames) {
      const evs = driver.parseFrame(hexToU8(f.data));
      for (const ev of evs) {
        if (ev.type === 'ptt' && typeof ev.isTx === 'boolean') { found = true; break; }
      }
      if (found) break;
    }
    expect(found).toBeTruthy();
  });
});
