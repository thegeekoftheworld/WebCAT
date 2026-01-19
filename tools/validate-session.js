#!/usr/bin/env node
/*
 * WebCAT session validator - verifies driver parsing against captured fixtures
 * Usage: node tools/validate-session.js data/sessions/ic7300-full.json
 */

const fs = require('fs');
const path = require('path');

// Load WebCAT + drivers
require('../webcat-base.js');
require('../drivers/webcat-icom-ic7300.js');
require('../drivers/webcat-icom-ic9700.js');
require('../drivers/webcat-yaesu-ft991a.js');
require('../drivers/webcat-yaesu-ft857d.js');

const WebCAT = global.WebCAT;

function hexToU8(hex) {
  const clean = String(hex || '').trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16) & 0xFF;
  }
  return out;
}

function validateSession(sessionPath) {
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const { driverId } = session.meta;
  
  console.log(`\n=== Validating ${path.basename(sessionPath)} ===`);
  console.log(`Driver: ${driverId}`);
  console.log(`Total frames: ${session.frames.length}`);
  console.log(`Duration: ${((session.meta.ended - session.meta.started) / 1000).toFixed(1)}s\n`);

  const driver = WebCAT.createDriver(driverId);
  const ctx = { lastFreqHz: null };
  const rxBuf = [];
  const events = [];
  const parseErrors = [];

  // Feed all inbound frames through driver parser
  const inFrames = session.frames.filter((f) => f.dir === 'in');
  console.log(`Processing ${inFrames.length} inbound frames...\n`);

  for (const frame of inFrames) {
    const u8 = hexToU8(frame.data);
    for (const b of u8) rxBuf.push(b);

    const extracted = driver.extractFrames(rxBuf, ctx);
    for (const f of extracted) {
      const bytes = (f instanceof Uint8Array) ? f : (f?.bytes instanceof Uint8Array ? f.bytes : null);
      if (!bytes) continue;

      try {
        const parsed = (driver.parseFrame.length >= 2)
          ? driver.parseFrame(f, ctx)
          : driver.parseFrame(bytes);

        if (Array.isArray(parsed)) {
          for (const ev of parsed) {
            if (ev && ev.type) events.push(ev);
          }
        }
      } catch (e) {
        parseErrors.push({ frame: frame.data, error: e.message });
      }
    }
  }

  // Summarize events by type
  const eventCounts = {};
  for (const ev of events) {
    eventCounts[ev.type] = (eventCounts[ev.type] || 0) + 1;
  }

  console.log('=== Event Summary ===');
  console.log(`Total events parsed: ${events.length}`);
  console.log('Event type counts:');
  Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

  if (parseErrors.length) {
    console.log(`\n⚠️  Parse errors: ${parseErrors.length}`);
    parseErrors.slice(0, 5).forEach((err) => {
      console.log(`  Frame ${err.frame}: ${err.error}`);
    });
    if (parseErrors.length > 5) {
      console.log(`  ... and ${parseErrors.length - 5} more`);
    }
  }

  // Sample of actual event data
  console.log('\n=== Sample Events ===');
  const samples = {
    freq: events.filter((e) => e.type === 'freq')[0],
    mode: events.filter((e) => e.type === 'mode')[0],
    ptt: events.filter((e) => e.type === 'ptt')[0],
    txpwr: events.filter((e) => e.type === 'txpwr')[0],
    compression: events.filter((e) => e.type === 'compression')[0],
    filterbw: events.filter((e) => e.type === 'filterbw')[0],
  };

  Object.entries(samples).forEach(([type, ev]) => {
    if (ev) {
      console.log(`${type}:`, JSON.stringify(ev, null, 2));
    }
  });

  // Coverage report
  console.log('\n=== Coverage Report ===');
  const expectedEvents = [
    'freq', 'mode', 'ptt', 'smeter', 'swr', 'po', 'rfpwr_setting',
    'vd', 'id', 'af', 'rf', 'sql', 'rit', 'xit',
    'txpwr', 'compression', 'filterbw', 'nb', 'autonotch',
    'preamp', 'agc', 'monitor', 'vfolock', 'tuningstep',
    'atu', 'metertype'
  ];

  const covered = expectedEvents.filter((e) => eventCounts[e] > 0);
  const missing = expectedEvents.filter((e) => !eventCounts[e]);

  console.log(`Coverage: ${covered.length}/${expectedEvents.length} event types`);
  if (missing.length) {
    console.log(`Missing: ${missing.join(', ')}`);
  } else {
    console.log('✓ All expected event types covered!');
  }

  console.log('\n=== Validation Complete ===\n');
  
  return {
    success: parseErrors.length === 0 && events.length > 0,
    stats: {
      frames: inFrames.length,
      events: events.length,
      errors: parseErrors.length,
      coverage: covered.length / expectedEvents.length,
    },
  };
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node tools/validate-session.js <session.json>');
    process.exit(1);
  }

  const sessionPath = path.resolve(args[0]);
  if (!fs.existsSync(sessionPath)) {
    console.error(`File not found: ${sessionPath}`);
    process.exit(1);
  }

  try {
    const result = validateSession(sessionPath);
    process.exit(result.success ? 0 : 1);
  } catch (e) {
    console.error('Validation failed:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

module.exports = { validateSession };
