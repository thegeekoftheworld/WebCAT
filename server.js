// Minimal local server with static hosting and MQTT-over-WebSocket
// Runs Express for static files and an Aedes broker on WS path /mqtt

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const aedes = require('aedes')();
const initSqlJs = require('sql.js');

const ROOT = __dirname;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const STATION_ID = process.env.STATION_ID || require('os').hostname();

// Basic logging to a file (JSONL) and console
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'webcat.log');
const DB_FILE = path.join(LOG_DIR, 'webcat.db');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Initialize sql.js database
let db = null;
let dbReady = initSqlJs().then(SQL => {
  let dbData;
  try {
    dbData = fs.readFileSync(DB_FILE);
  } catch {
    dbData = null;
  }
  db = new SQL.Database(dbData);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS qsos (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      call TEXT NOT NULL,
      freq INTEGER,
      mode TEXT,
      rst_sent TEXT,
      rst_rcvd TEXT,
      operator TEXT,
      station_id TEXT,
      event_type TEXT,
      event_data TEXT,
      notes TEXT,
      synced INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_qsos_call ON qsos(call);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_qsos_timestamp ON qsos(timestamp);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_qsos_event ON qsos(event_type);`);
  
  // Persist changes every 5 seconds
  setInterval(() => {
    try {
      const data = db.export();
      fs.writeFileSync(DB_FILE, data);
    } catch (e) {
      console.error('DB save failed:', e);
    }
  }, 5000);
  
  return true;
});

process.on('exit', () => {
  if (db) {
    try {
      const data = db.export();
      fs.writeFileSync(DB_FILE, data);
    } catch {}
  }
});

function appendLog(obj) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Ingest logs from clients and fan out via MQTT
app.post('/api/logs', (req, res) => {
  const entry = req.body || {};
  appendLog({ source: 'http', ...entry });
  try {
    aedes.publish({ topic: 'webcat/logs', payload: Buffer.from(JSON.stringify(entry)) });
  } catch (e) {
    // ignore
  }
  res.json({ ok: true });
});

// QSO endpoints
app.post('/api/qsos', async (req, res) => {
  await dbReady;
  const qso = req.body || {};
  const id = qso.id || require('crypto').randomUUID();
  try {
    db.run(`INSERT OR REPLACE INTO qsos 
      (id, timestamp, call, freq, mode, rst_sent, rst_rcvd, operator, station_id, event_type, event_data, notes, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, qso.timestamp || new Date().toISOString(), qso.call || '', qso.freq || null, qso.mode || null,
       qso.rst_sent || '599', qso.rst_rcvd || '599', qso.operator || '', qso.station_id || STATION_ID,
       qso.event_type || 'general', qso.event_data ? JSON.stringify(qso.event_data) : null,
       qso.notes || '', qso.synced ? 1 : 0]);
    const savedQSO = { ...qso, id, station_id: qso.station_id || STATION_ID };
    appendLog({ type: 'qso', qso: savedQSO });
    try {
      const eventType = qso.event_type || 'general';
      aedes.publish({ topic: `webcat/${eventType}/qsos`, payload: Buffer.from(JSON.stringify(savedQSO)) });
    } catch (e) { /* ignore */ }
    res.json({ ok: true, id, qso: savedQSO });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/qsos', async (req, res) => {
  await dbReady;
  const limit = parseInt(req.query.limit || '100', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const eventType = req.query.event;
  try {
    const stmt = eventType
      ? db.prepare('SELECT * FROM qsos WHERE event_type = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?')
      : db.prepare('SELECT * FROM qsos ORDER BY timestamp DESC LIMIT ? OFFSET ?');
    const params = eventType ? [eventType, limit, offset] : [limit, offset];
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM qsos');
    countStmt.step();
    const total = countStmt.getAsObject().count;
    countStmt.free();
    res.json({ ok: true, qsos: rows, total });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/qsos/dupe/:call', async (req, res) => {
  await dbReady;
  const { call } = req.params;
  const eventType = req.query.event || 'general';
  try {
    const stmt = db.prepare('SELECT * FROM qsos WHERE call = ? AND event_type = ? LIMIT 1');
    stmt.bind([call.toUpperCase(), eventType]);
    const dupe = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    res.json({ ok: true, dupe: !!dupe, qso: dupe || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Station discovery
app.get('/api/stations', (req, res) => {
  const clients = [];
  aedes.clients.forEach((client) => {
    if (client.id) clients.push({ id: client.id, connected: true });
  });
  res.json({ ok: true, station_id: STATION_ID, stations: clients });
});

// Serve static files from project root so demo.html works as-is
app.use(express.static(ROOT, { extensions: ['html'] }));

const server = http.createServer(app);

// Attach WebSocket server at /mqtt and hand connections to Aedes
const wss = new WebSocket.Server({ server, path: '/mqtt' });
wss.on('connection', (ws) => {
  const stream = WebSocket.createWebSocketStream(ws, { encoding: 'binary' });
  aedes.handle(stream);
});

// Mirror MQTT messages to JSONL for auditing
aedes.on('publish', (packet, client) => {
  if (!packet || !packet.topic) return;
  // Avoid logging broker $SYS topics
  if (packet.topic.startsWith('$SYS/')) return;
  appendLog({ source: 'mqtt', client: client?.id, topic: packet.topic, payload: packet.payload?.toString() });
});

server.listen(PORT, () => {
  console.log(`WebCAT server on http://localhost:${PORT}`);
  console.log(`MQTT over WebSocket at ws://localhost:${PORT}/mqtt`);
});
