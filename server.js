// MD Shakil Live Stream - paid subscription + admin dashboard server.
// Node.js, zero external dependencies (built-in http/fs/path only).
// Run locally:  node server.js   (PORT env, default 3002, data in data/store.json)
// INTERNET VERSION, 2026-11-03: users are in separate locations, so
// deploy this same file to Render free (see README-INTERNET-SERVER.md,
// render.yaml, package.json). Service name must be
// "md-shakil-live-stream" so the app's built-in URL
// https://md-shakil-live-stream.onrender.com matches. Render sets
// PORT automatically; this file already uses process.env.PORT.
// WARNING: Render free disk is ephemeral - see the README before
// taking paid subscriptions at scale.
//
// DASHBOARD DATA IS REAL, NEVER MOCKED (2026-11-03):
// Total Users / Active Users / Pending Requests / Expired Users,
// the user list, and Recent Activities all come from this store.
// If no friend has registered yet, the dashboard shows 0, not an
// example number from a design picture. A design picture's 125 users
// and example names are NOT your users and are never shown here.
//
// LOGIN (2026-11-03, phone update):
// Friends sign in with a PHONE NUMBER or a Gmail - Gmail is no longer
// required. The stored identifier is called userId: a Gmail is stored
// lowercase, a phone is stored as digits starting with 0 (880... and
// +880... are normalised to 0...). Old Gmail accounts keep working:
// on load, any user/request without a userId gets userId = its gmail.
// Admin is Shakil only, by his Gmail OR by his phone number (the same
// number shown in the app as his bKash / WhatsApp contact).
//
// HONEST LIMITS (do not remove):
// - Phone/Gmail here is an ENTRY (name + phone/Gmail) in this version.
//   It is NOT verified OTP / Google OAuth Sign-In. Real verification
//   (SMS OTP or Google OAuth) needs a provider project and is a later
//   phase. The gate is admin approval: a friend cannot GO LIVE in THIS
//   app without an active grant from the server, but the server cannot
//   block YouTube directly or another app, and a typed phone number
//   alone does not prove who typed it - admin must check the bKash
//   sender name/number against the request before approving.
// - bKash is MANUAL only. A TrxID alone does NOT prove a payment.
//   Admin must check his own bKash account before approving. This
//   server never talks to bKash, never auto-verifies a payment, and
//   never processes cash.
// - Admin control gates THIS app only, not YouTube directly or other apps.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
const ADMIN_GMAIL = 'md2938540@gmail.com';
const ADMIN_PHONE = '01301640110';
const PRICE_PER_DAY = 50;
const MIN_DAYS = 7;
const MAX_DAYS = 30;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { return null; }
}
const DEFAULT_STORE = { users: [], requests: [], nextRequest: 1, activities: [] };
let store = Object.assign({}, DEFAULT_STORE, loadStore() || {});
if (!Array.isArray(store.users)) store.users = [];
if (!Array.isArray(store.requests)) store.requests = [];
if (!store.nextRequest) store.nextRequest = 1;
if (!Array.isArray(store.activities)) store.activities = [];
// Legacy migration: Gmail-only records get userId = gmail.
for (const u of store.users) { if (!u.userId) u.userId = u.gmail || ''; }
for (const r of store.requests) { if (!r.userId) r.userId = r.gmail || ''; }

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
// User ID normalisation: Gmail -> lowercase; phone -> digits, 880/+880 -> 0.
function normUserId(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();
  let d = s.replace(/[\s\-()]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('880') && d.length === 13) d = '0' + d.slice(3);
  return d;
}
function isPhoneId(id) { return /^\d{10,15}$/.test(id); }
function isValidUserId(id) {
  if (!id) return false;
  if (id.includes('@')) return id.includes('.') && id.length >= 6;
  return isPhoneId(id);
}
function isAdmin(id) {
  const n = normUserId(id);
  return n === ADMIN_GMAIL || n === ADMIN_PHONE;
}
function isActive(u, now) {
  return !!(u && u.grantExpiresAt && now < new Date(u.grantExpiresAt).getTime());
}
function logActivity(type, userId, detail) {
  store.activities.push({
    type, userId: userId || '', detail: detail || '',
    at: new Date().toISOString(),
  });
  if (store.activities.length > 50) store.activities = store.activities.slice(-50);
}
function publicUser(u, now) {
  const userId = u.userId || u.gmail || '';
  return {
    userId, gmail: userId.includes('@') ? userId : (u.gmail || null),
    name: u.name, createdAt: u.createdAt,
    isAdmin: isAdmin(userId),
    active: isActive(u, now),
    grantExpiresAt: u.grantExpiresAt || null,
    grantDays: u.grantDays || null,
  };
}
function publicRequest(r) {
  const userId = r.userId || r.gmail || '';
  return {
    id: r.id, userId, gmail: userId.includes('@') ? userId : (r.gmail || null),
    name: r.name, days: r.days, total: r.total,
    trxId: r.trxId, status: r.status, createdAt: r.createdAt,
    decidedAt: r.decidedAt || null, expiresAt: r.expiresAt || null,
  };
}
// Dashboard row for one user, computed server-side so the app
// only has to display it, not guess days-left or status.
function dashboardUser(u, now) {
  const userId = u.userId || u.gmail || '';
  const pending = store.requests.find(r => (r.userId || r.gmail) === userId && r.status === 'pending');
  const active = isActive(u, now);
  let status = 'No plan';
  if (active) status = 'Active';
  else if (pending) status = 'Pending';
  else if (u.grantExpiresAt) status = 'Expired';
  const daysLeft = active
    ? Math.max(1, Math.ceil((new Date(u.grantExpiresAt).getTime() - now) / (24 * 3600 * 1000)))
    : 0;
  const plan = u.grantDays
    ? u.grantDays + ' Days'
    : pending ? pending.days + ' Days (pending)' : '—';
  return {
    userId, name: u.name, plan, daysLeft, status,
    pendingId: pending ? pending.id : null,
    pendingDays: pending ? pending.days : null,
    pendingTotal: pending ? pending.total : null,
    pendingTrxId: pending ? pending.trxId : null,
    grantExpiresAt: u.grantExpiresAt || null,
  };
}
function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 200000) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (_) { resolve(null); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const body = (req.method === 'POST') ? await readBody(req) : {};
    if (body === null) return send(res, 400, { error: 'invalid_json' });
    const now = Date.now();

    if (req.method === 'GET' && p === '/api/health') {
      const active = store.users.filter(u => isActive(u, now)).length;
      return send(res, 200, { ok: true, adminGmail: ADMIN_GMAIL, pricePerDay: PRICE_PER_DAY, minDays: MIN_DAYS, maxDays: MAX_DAYS, users: store.users.length, activeUsers: active, pendingRequests: store.requests.filter(r => r.status === 'pending').length });
    }

    if (req.method === 'POST' && p === '/api/register') {
      const userId = normUserId(body.userId || body.gmail);
      const name = String(body.name || '').trim();
      if (!isValidUserId(userId)) return send(res, 400, { error: 'userId_invalid', note: 'Enter a valid phone number or Gmail.' });
      if (!name) return send(res, 400, { error: 'name_required' });
      let u = store.users.find(x => (x.userId || x.gmail) === userId);
      const isNew = !u;
      if (!u) {
        u = { userId, gmail: userId.includes('@') ? userId : null, name, createdAt: new Date().toISOString(), grantExpiresAt: null, grantDays: null };
        store.users.push(u);
        logActivity('registered', userId, 'New user registered: ' + name);
      } else {
        u.name = name;
        if (!u.userId) u.userId = userId;
      }
      save();
      return send(res, 200, { user: publicUser(u, now), isNew });
    }

    if (req.method === 'GET' && p === '/api/me') {
      const userId = normUserId(url.searchParams.get('userId') || url.searchParams.get('gmail'));
      const u = store.users.find(x => (x.userId || x.gmail) === userId);
      if (!u) return send(res, 404, { error: 'user_not_found' });
      const pending = store.requests.filter(r => (r.userId || r.gmail) === userId && r.status === 'pending').map(publicRequest);
      return send(res, 200, { user: publicUser(u, now), pendingRequests: pending });
    }

    if (req.method === 'POST' && p === '/api/subscribe') {
      const userId = normUserId(body.userId || body.gmail);
      const days = parseInt(body.days, 10);
      const trxId = String(body.trxId || body.trxid || '').trim();
      const u = store.users.find(x => (x.userId || x.gmail) === userId);
      if (!userId || !u) return send(res, 404, { error: 'user_not_found_register_first' });
      if (!days || days < MIN_DAYS || days > MAX_DAYS) return send(res, 400, { error: 'days_out_of_range', minDays: MIN_DAYS, maxDays: MAX_DAYS, pricePerDay: PRICE_PER_DAY });
      if (!trxId) return send(res, 400, { error: 'trxid_required' });
      const r = {
        id: 'req_' + (store.nextRequest++), userId,
        gmail: userId.includes('@') ? userId : null,
        name: u.name, days,
        total: days * PRICE_PER_DAY, trxId, status: 'pending',
        createdAt: new Date().toISOString(), decidedAt: null, expiresAt: null,
      };
      store.requests.push(r);
      logActivity('requested', userId, 'Plan requested: ' + days + ' Days (' + u.name + ')');
      save();
      return send(res, 201, { request: publicRequest(r), note: 'UNVERIFIED: TrxID alone does not prove a bKash payment. Admin must check his bKash account manually before approving.' });
    }

    // ---- Admin routes: server-side admin check, not just UI hiding ----
    if (p.startsWith('/api/admin')) {
      const adminId = normUserId(body.adminUserId || body.adminGmail || url.searchParams.get('adminUserId') || url.searchParams.get('adminGmail'));
      if (!isAdmin(adminId)) return send(res, 403, { error: 'admin_only' });

      if (req.method === 'GET' && p === '/api/admin/requests') {
        const pending = store.requests.filter(r => r.status === 'pending').map(publicRequest);
        const all = store.requests.map(publicRequest).slice().reverse();
        const users = store.users.map(u => publicUser(u, now));
        const activeUsers = users.filter(u => u.active);
        const allUsers = store.users.map(u => dashboardUser(u, now));
        const expiredUsers = allUsers.filter(u => u.status === 'Expired').length;
        const recentActivities = store.activities.slice().reverse().slice(0, 10);
        return send(res, 200, {
          pendingRequests: pending, allRequests: all, users, activeUsers,
          allUsers, recentActivities,
          counts: {
            totalUsers: store.users.length,
            activeUsers: activeUsers.length,
            pendingRequests: pending.length,
            expiredUsers,
          },
        });
      }
      if (req.method === 'POST' && p === '/api/admin/approve') {
        const r = store.requests.find(x => x.id === String(body.requestId || ''));
        if (!r) return send(res, 404, { error: 'request_not_found' });
        if (r.status !== 'pending') return send(res, 409, { error: 'already_decided', status: r.status });
        r.status = 'approved';
        r.decidedAt = new Date().toISOString();
        r.expiresAt = new Date(now + r.days * 24 * 3600 * 1000).toISOString();
        const u = store.users.find(x => (x.userId || x.gmail) === (r.userId || r.gmail));
        if (u) { u.grantExpiresAt = r.expiresAt; u.grantDays = r.days; }
        logActivity('approved', r.userId || r.gmail, 'Plan approved: ' + r.days + ' Days (' + r.name + ')');
        save();
        return send(res, 200, { request: publicRequest(r), user: u ? publicUser(u, now) : null });
      }
      if (req.method === 'POST' && p === '/api/admin/reject') {
        const r = store.requests.find(x => x.id === String(body.requestId || ''));
        if (!r) return send(res, 404, { error: 'request_not_found' });
        if (r.status !== 'pending') return send(res, 409, { error: 'already_decided', status: r.status });
        r.status = 'rejected';
        r.decidedAt = new Date().toISOString();
        logActivity('rejected', r.userId || r.gmail, 'Request rejected: ' + r.name);
        save();
        return send(res, 200, { request: publicRequest(r) });
      }
      if (req.method === 'POST' && p === '/api/admin/revoke') {
        const userId = normUserId(body.userId || body.gmail);
        const u = store.users.find(x => (x.userId || x.gmail) === userId);
        if (!u) return send(res, 404, { error: 'user_not_found' });
        u.grantExpiresAt = null;
        u.grantDays = null;
        logActivity('excluded', userId, 'User excluded: ' + u.name);
        save();
        return send(res, 200, { user: publicUser(u, now) });
      }
      return send(res, 404, { error: 'admin_route_not_found' });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server_error', detail: String(e.message || e) });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log('MD Shakil Live Stream admin server on http://localhost:' + PORT));
}
module.exports = { server, store, ADMIN_GMAIL, ADMIN_PHONE, PRICE_PER_DAY, MIN_DAYS, MAX_DAYS };
