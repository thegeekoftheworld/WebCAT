#!/usr/bin/env node
/*
 * WebCAT session recorder (Node)
 * Requires: npm install serialport minimist
 * Usage: node tools/record-session.js --port COM3 --driver icom.ic7300 --out data/sessions/ic7300-smoke.json
 */

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { SerialPort } = require('serialport');

// Load WebCAT globals + drivers (UMD style)
require('../webcat-base.js');
require('../drivers/webcat-icom-ic7300.js');
require('../drivers/webcat-icom-ic9700.js');
require('../drivers/webcat-yaesu-ft991a.js');
require('../drivers/webcat-yaesu-ft857d.js');

const WebCAT = global.WebCAT;
if (!WebCAT) throw new Error('WebCAT global not found');

const args = minimist(process.argv.slice(2));
const driverId = args.driver || 'icom.ic7300';
const portPath = args.port || 'COM3';
const meta = WebCAT.getDriverMeta(driverId) || {};
const baudRate = Number(args.baud) || meta.defaultBaud || 19200;
const outFile = args.out || path.join(__dirname, '..', 'data', 'sessions', `${driverId}-capture.json`);

const trace = {
  meta: {
    driverId,
    port: portPath,
    baudRate,
    started: Date.now(),
    notes: args.notes || ''
  },
  frames: []
};

const toHex = (u8) => Buffer.from(u8).toString('hex');
const record = (dir, data) => trace.frames.push({ dir, t: Date.now(), data: toHex(data) });

function makeReader(port) {
  const queue = [];
  const waiters = [];
  let canceled = false;

  port.on('data', (buf) => {
    record('in', buf);
    if (waiters.length) {
      const next = waiters.shift();
      next({ value: new Uint8Array(buf), done: false });
    } else {
      queue.push(buf);
    }
  });

  return {
    async read() {
      if (queue.length) return { value: new Uint8Array(queue.shift()), done: false };
      if (canceled) return { value: undefined, done: true };
      return new Promise((resolve) => waiters.push(resolve));
    },
    async cancel() {
      canceled = true;
      while (waiters.length) {
        const w = waiters.shift();
        w({ value: undefined, done: true });
      }
    },
    releaseLock() {}
  };
}

function bindNodeSerial(ctrl, port) {
  const reader = makeReader(port);

  const writer = {
    async write(u8) {
      record('out', u8);
      await new Promise((resolve, reject) => {
        port.write(Buffer.from(u8), (err) => (err ? reject(err) : resolve()));
      });
    },
    releaseLock() {}
  };

  ctrl.writer = writer;
  ctrl.reader = reader;
  ctrl.port = {
    readable: { getReader: () => reader },
    writable: { getWriter: () => writer },
    async close() { return new Promise((resolve, reject) => port.close((err) => (err ? reject(err) : resolve()))); },
    async setSignals() {},
    getInfo: () => ({ path: port.path, baudRate })
  };
  ctrl.state.connected = true;
  ctrl.running = true;
  ctrl._emit('connected', { driverId: ctrl.driverId, baudRate });
  ctrl._readLoop().catch((err) => ctrl._emit('error', err));
}

async function sendOptional(ctrl, cmd) {
  if (!cmd) return;
  if (Array.isArray(cmd)) {
    for (const c of cmd) await ctrl.sendCommand(c);
  } else {
    await ctrl.sendCommand(cmd);
  }
}

async function exercise(ctrl) {
  const d = ctrl.driver;
  const sleep = WebCAT.utils.sleep;

  console.log('=== Comprehensive Radio Exercise Started ===');
  
  // Full status baseline - query EVERYTHING the driver can read
  console.log('→ Reading all baseline status...');
  const allReads = [
    'cmdReadFreq', 'cmdReadMode', 'cmdReadRxTxStatus', 'cmdReadSmeter',
    'cmdReadSWR', 'cmdReadPoMeter', 'cmdReadRfPwrSetting', 'cmdReadVd', 'cmdReadId',
    'cmdReadAF', 'cmdReadRF', 'cmdReadSQL', 'cmdReadRIT', 'cmdReadXIT',
    'cmdReadCompression', 'cmdReadTXPower', 'cmdReadATUStatus', 'cmdReadFilterBW',
    'cmdReadNoiseBlanker', 'cmdReadAutoNotch', 'cmdReadManualNotch', 'cmdReadPreamp',
    'cmdReadAGC', 'cmdReadMonitor', 'cmdReadVFOLock', 'cmdReadTuningStep',
    'cmdReadSplitTxFreq', 'cmdReadMeterType', 'cmdReadDataMode'
  ];
  
  for (const cmd of allReads) {
    if (typeof d[cmd] === 'function') {
      await sendOptional(ctrl, d[cmd]());
      await sleep(30);
    }
  }
  await sleep(100);

  // Frequency sweep (3 different bands)
  console.log('→ Testing frequency changes...');
  const freqs = [7074000, 14074000, 21074000]; // 40m, 20m, 15m
  for (const f of freqs) {
    if (d.cmdSetFreqHz) {
      try { await ctrl.setFrequencyHz(f); await sleep(100); } catch {}
    }
  }

  // Mode sweep - cycle through ALL available modes
  console.log('→ Testing all modes...');
  const modes = (typeof d.availableModes === 'function') ? d.availableModes() : 
    ['LSB', 'USB', 'AM', 'CW', 'RTTY', 'FM', 'CW-R', 'RTTY-R', 'LSB-D', 'USB-D', 'AM-D', 'FM-D'];
  
  for (const mode of modes) {
    if (d.cmdSetMode) {
      try {
        console.log(`  → ${mode}`);
        await ctrl.setMode(mode);
        await sleep(200); // Let mode settle
        await sendOptional(ctrl, d.cmdReadMode?.());
        await sleep(50);
      } catch (e) {
        console.log(`  ⚠ ${mode} failed: ${e.message}`);
      }
    }
  }
  
  // Return to digital voice mode for remaining tests
  if (d.cmdSetMode) {
    try { await ctrl.setMode('USB-D'); await sleep(100); } catch {}
  }
  
  // PTT test at ZERO power for safety
  console.log('→ Testing PTT (0% power)...');
  if (d.cmdSetPTT) {
    if (d.cmdSetTxPower) await sendOptional(ctrl, d.cmdSetTxPower(0));
    await sleep(150);
    try { await ctrl.setPTT(true); await sleep(50); await ctrl.setPTT(false); await sleep(100); } catch {}
  }

  // Control range tests - exercise sliders/toggles
  console.log('→ Testing extended controls...');
  if (d.cmdSetTxPower) {
    await sendOptional(ctrl, d.cmdSetTxPower(25));  await sleep(80);
    await sendOptional(ctrl, d.cmdSetTxPower(75));  await sleep(80);
    await sendOptional(ctrl, d.cmdSetTxPower(Number(args.txpwr) || 50)); await sleep(80);
  }
  
  if (d.cmdSetCompression) {
    await sendOptional(ctrl, d.cmdSetCompression(0));   await sleep(80);
    await sendOptional(ctrl, d.cmdSetCompression(Number(args.comp) || 10)); await sleep(80);
  }
  
  if (d.cmdSetFilterBw) {
    const bws = [2400, 3000, 3600];
    for (const bw of bws) {
      await sendOptional(ctrl, d.cmdSetFilterBw(bw)); await sleep(80);
    }
  }
  
  // Toggle features on/off
  if (d.cmdToggleNoiseBlanker) {
    await sendOptional(ctrl, d.cmdToggleNoiseBlanker(true));  await sleep(80);
    await sendOptional(ctrl, d.cmdToggleNoiseBlanker(false)); await sleep(80);
  }
  
  if (d.cmdToggleAutoNotch) {
    await sendOptional(ctrl, d.cmdToggleAutoNotch(true));  await sleep(80);
    await sendOptional(ctrl, d.cmdToggleAutoNotch(false)); await sleep(80);
  }
  
  if (d.cmdSetPreamp) {
    await sendOptional(ctrl, d.cmdSetPreamp(0)); await sleep(80);
    await sendOptional(ctrl, d.cmdSetPreamp(1)); await sleep(80);
  }
  
  if (d.cmdSetAGC) {
    const agcModes = ['FAST', 'MID', 'SLOW'];
    for (const agc of agcModes) {
      await sendOptional(ctrl, d.cmdSetAGC(agc)); await sleep(80);
    }
  }

  // Final poll loop - capture steady state with all features configured
  console.log('→ Running poll sequence...');
  for (let i = 0; i < (Number(args.polls) || 5); i++) {
    const seq = (typeof d.pollSequence === 'function') ? d.pollSequence(ctrl.ctx) : [];
    for (const cmd of seq) await sendOptional(ctrl, cmd);
    await sleep(Number(args.pollDelay) || 200);
  }
  
  console.log('=== Exercise Complete ===');
}

async function main() {
  const port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));

  const ctrl = new WebCAT.RadioController({ driverId, verbose: !!args.verbose });
  ctrl.on('log', (m) => { if (args.verbose) console.log('[LOG]', m); });
  ctrl.on('error', (e) => console.error('[ERR]', e.message));

  bindNodeSerial(ctrl, port);
  await exercise(ctrl);

  trace.meta.ended = Date.now();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(trace, null, 2));
  console.log('Saved', path.relative(process.cwd(), outFile));

  await ctrl.disconnect().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error('Recorder failed:', err.message);
  process.exit(1);
});
