// Node.js Backend Server & Background Scheduler for Reminders (Asia/Kolkata Timezone)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, 'reminders_db.json');

// Helper to read database file
function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    return { reminders: [], subscriptions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return { reminders: [], subscriptions: [] };
  }
}

// Helper to write database file
function writeDb(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save reminders database:", e);
  }
}

// Get current date and time string in Asia/Kolkata timezone
function getKolkataNow() {
  const now = new Date();
  const optionsDate = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const optionsTime = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false };

  const dateParts = new Intl.DateTimeFormat('en-CA', optionsDate).format(now).split('-'); // YYYY-MM-DD
  const timeStr = new Intl.DateTimeFormat('en-GB', optionsTime).format(now); // HH:MM

  return {
    date: dateParts.join('-'),
    time: timeStr,
    full: now
  };
}

// Background Scheduler Task running every 30 seconds
function runSchedulerTask() {
  const db = readDb();
  const nowInfo = getKolkataNow();
  let updated = false;

  db.reminders.forEach(r => {
    if (r.completed) return;

    // Check if scheduled date/time has arrived or passed
    const isDue = (r.date < nowInfo.date) || (r.date === nowInfo.date && r.time <= nowInfo.time);

    if (isDue) {
      // 1. Dashboard Notification
      if (r.dashboardNotification && !r.dashboardSeenAt) {
        r.dashboardSeenAt = new Date().toISOString();
        updated = true;
        console.log(`[SCHEDULER] Dashboard Notification Due: "${r.title}" for ${r.date} ${r.time}`);
      }

      // 2. Mobile Push Notification
      if (r.pushNotification && !r.pushSentAt) {
        r.pushSentAt = new Date().toISOString();
        updated = true;
        console.log(`[SCHEDULER] Mobile Push Notification Triggered: "${r.title}" targeting ${db.subscriptions.length} registered device(s)`);
      }
    }
  });

  if (updated) {
    writeDb(db);
  }
}

// Start Scheduler Loop (every 30 seconds)
setInterval(runSchedulerTask, 30000);

// HTTP API Server
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/reminders' && req.method === 'GET') {
    const db = readDb();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.reminders));
    return;
  }

  if (url.pathname === '/api/reminders' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const db = readDb();
        db.reminders = payload;
        writeDb(db);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: db.reminders.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/subscribe' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const sub = JSON.parse(body);
        const db = readDb();
        if (!db.subscriptions.some(s => JSON.stringify(s) === JSON.stringify(sub))) {
          db.subscriptions.push({
            subscription: sub,
            subscribedAt: new Date().toISOString()
          });
          writeDb(db);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Push subscription saved securely.' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    const db = readDb();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      timezone: 'Asia/Kolkata',
      kolkataTime: getKolkataNow(),
      registeredPushDevices: db.subscriptions.length
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`[SERVER] HOD Reminders Backend & Scheduler running on http://localhost:${PORT}`);
});
