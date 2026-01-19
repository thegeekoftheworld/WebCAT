import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import vm from 'vm';

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

function civBody(u8) {
  // Slice payload of CI-V frame (skip FE FE, radio, ctrl, and trailing FD)
  return u8.slice(4, u8.length - 1);
}

function decodeSignedLE16(lo, hi) {
  let val = (lo & 0xFF) | ((hi & 0xFF) << 8);
  if (val & 0x8000) val = val - 0x10000;
  return val;
}

function toHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

test.describe('IC-7300 Command Encoding', () => {
  test.beforeEach(async () => {
    // noop
  });

  test('cmdSetMode USB emits base mode + data off toggle', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    const frames = driver.cmdSetMode('USB');
    expect(Array.isArray(frames)).toBeTruthy();
    expect(frames.length).toBe(2);

    const body0 = civBody(frames[0]);
    const body1 = civBody(frames[1]);
    // Base mode set: 0x06 0x01
    expect(body0[0]).toBe(0x06);
    expect(body0[1]).toBe(0x01);
    // Data toggle: 0x1A 0x06 0x00 (off)
    expect(body1[0]).toBe(0x1A);
    expect(body1[1]).toBe(0x06);
    expect(body1[2]).toBe(0x00);
  });

  test('cmdSetMode USB-D emits base mode + data on toggle', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    const frames = driver.cmdSetMode('USB-D');
    expect(Array.isArray(frames)).toBeTruthy();
    expect(frames.length).toBe(2);

    const body0 = civBody(frames[0]);
    const body1 = civBody(frames[1]);
    expect(body0[0]).toBe(0x06);
    expect(body0[1]).toBe(0x01); // base USB
    expect(body1[0]).toBe(0x1A);
    expect(body1[1]).toBe(0x06);
    expect(body1[2]).toBe(0x01); // data mode ON
  });

  test('cmdSetSplitTxFreq encodes BCD digits with 0x0F prefix', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    const hz = 14076000;
    const frame = driver.cmdSetSplitTxFreq(hz);
    const body = civBody(frame);
    expect(body[0]).toBe(0x0F);

    // Verify BCD bytes decode back to original frequency
    const digits = [];
    for (let i = 1; i <= 5; i++) {
      const b = body[i];
      const lo = b & 0x0F;
      const hi = (b >> 4) & 0x0F;
      digits.push(lo, hi);
    }
    let decoded = 0;
    for (let pos = 0; pos < digits.length; pos++) decoded += digits[pos] * Math.pow(10, pos);
    expect(decoded).toBe(hz);
  });

  test('cmdSetRIT clamps to [-9999, 9999] and encodes LE16', async () => {
    const ctx = createSandbox();
    loadScriptIntoContext(path.resolve(__dirname, '..', 'webcat-base.js'), ctx);
    loadScriptIntoContext(path.resolve(__dirname, '..', 'drivers', 'webcat-icom-ic7300.js'), ctx);
    const WebCAT = ctx.window.WebCAT;
    const driver = WebCAT.createDriver('icom.ic7300', {});

    let frame = driver.cmdSetRIT(20000); // clamp down
    let body = civBody(frame);
    expect(body[0]).toBe(0x14);
    expect(body[1]).toBe(0x07);
    const val1 = decodeSignedLE16(body[2], body[3]);
    expect(val1).toBe(9999);

    frame = driver.cmdSetRIT(-20000); // clamp up
    body = civBody(frame);
    const val2 = decodeSignedLE16(body[2], body[3]);
    expect(val2).toBe(-9999);
  });
});
