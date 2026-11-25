import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, CATS, LANGS } from './data.js';
import { createDb, getFullState, getUser, seedDatabase } from './db.js';
import { generateIcs } from './ics.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../public');
const DEFAULT_DB_PATH = resolve(__dirname, '../data/common.db');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function parseUserId(req) {
  const h = req.headers['x-user-id'];
  if (typeof h === 'string' && /^[a-z0-9_-]{1,32}$/i.test(h)) return h;
  return 'me';
}

export function createApp(db) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const method = req.method || 'GET';
    const currentUserId = parseUserId(req);

    try {
      if (path === '/api/health' && method === 'GET') {
        return json(res, 200, { ok: true });
      }

      if (path === '/api/state' && method === 'GET') {
        return json(res, 200, getFullState(db, currentUserId));
      }

      if (path === '/api/me' && method === 'PATCH') {
        const body = await readBody(req);
        const existing = getUser(db, currentUserId);
        if (!existing) return json(res, 404, { error: 'User not found' });

        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : existing.name;
        const since = typeof body.since === 'string' && body.since.trim() ? body.since.trim().slice(0, 60) : existing.since;
        const intro = typeof body.intro === 'string' ? body.intro.trim().slice(0, 200) : existing.intro;
        const area = AREAS[body.area] ? body.area : existing.area;
        const languages = Array.isArray(body.languages) && body.languages.length
          ? body.languages.filter(l => LANGS.includes(l))
          : existing.languages;
        const interests = Array.isArray(body.interests)
          ? body.interests.map(i => String(i).trim()).filter(Boolean).slice(0, 12)
          : existing.interests;
        const availability = Array.isArray(body.availability)
          ? body.availability.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
          : existing.availability;
        const verified = typeof body.verified === 'boolean' ? (body.verified ? 1 : 0) : (existing.verified ? 1 : 0);
        const newHere = typeof body.newHere === 'boolean' ? (body.newHere ? 1 : 0) : (existing.newHere ? 1 : 0);

        db.prepare(`
          UPDATE users
          SET name = ?, since = ?, intro = ?, area = ?, languages = ?, interests = ?, availability = ?, verified = ?, new_here = ?
          WHERE id = ?
        `).run(name, since, intro, area, JSON.stringify(languages), JSON.stringify(interests), JSON.stringify(availability), verified, newHere, existing.id);

        return json(res, 200, getFullState(db, existing.id));
      }

      if (path === '/api/groups' && method === 'POST') {
        const body = await readBody(req);
        const name = String(body.name || '').trim().slice(0, 60);
        const place = String(body.place || '').trim().slice(0, 60);
        const cat = CATS[body.cat] ? body.cat : null;
        const date = String(body.date || '');
        const time = String(body.time || '');

        if (!name || !place || !cat || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
          return json(res, 400, { error: 'Please provide valid group name, category, date, time, and place.' });
        }

        const area = AREAS[body.area] ? body.area : 'Altstadt';
        const [aLat, aLng] = AREAS[area];
        const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const duration = [30, 45, 60, 90, 120].includes(Number(body.duration)) ? Number(body.duration) : 60;
        const weekly = body.weekly === false ? 0 : 1;
        const desc = String(body.desc || '').trim().slice(0, 200) || 'A small group, a shared interest and a reason to meet again.';
        const spot = String(body.spot || '').trim().slice(0, 90) || "I'll wave when you arrive";
        const lang = Array.isArray(body.lang) && body.lang.length ? body.lang.filter(l => LANGS.includes(l)) : ['English'];
        const cost = Number.isFinite(Number(body.cost)) ? Math.max(0, Math.min(50, Math.round(Number(body.cost)))) : 0;
        const size = Math.max(3, Math.min(12, Number(body.size) || 6));
        const friendsOnly = body.friendsOnly ? 1 : 0;
        const jitter = 0.0015;
        const clientLat = Number(body.lat);
        const clientLng = Number(body.lng);
        const lat = Number.isFinite(clientLat) && clientLat > 49.3 && clientLat < 49.5
          ? clientLat : aLat + (Math.random() - 0.5) * jitter;
        const lng = Number.isFinite(clientLng) && clientLng > 8.5 && clientLng < 8.9
          ? clientLng : aLng + (Math.random() - 0.5) * jitter;
        const now = Date.now();

        db.prepare(`
          INSERT INTO groups (id, name, cat, date, time, duration, weekly, desc, place, area, spot, lang, cost, size, host, friends_only, lat, lng, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, name, cat, date, time, duration, weekly, desc, place, area, spot, JSON.stringify(lang), cost, size, currentUserId, friendsOnly, lat, lng, now);

        db.prepare('INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES (?, ?, ?, ?)').run(id, currentUserId, 'going', now);
        db.prepare('INSERT INTO messages (group_id, user_id, sys, text, created_at) VALUES (?, ?, 1, ?, ?)').run(
          id, null, 'Group started. Say hello when the first person joins.', now
        );

        return json(res, 201, { id, state: getFullState(db, currentUserId) });
      }

      const groupMatch = path.match(/^\/api\/groups\/([a-z0-9_-]+)\/(join|leave|rsvp|messages|calendar\.ics|arrive)$/i);
      if (groupMatch) {
        const [, groupId, action] = groupMatch;
        const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
        if (!group) return json(res, 404, { error: 'Group not found' });

        if (action === 'calendar.ics' && method === 'GET') {
          const parsed = {
            ...group,
            weekly: Boolean(group.weekly),
            lang: JSON.parse(group.lang)
          };
          const ics = generateIcs(parsed);
          res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${group.id}-meetup.ics"`
          });
          return res.end(ics);
        }

        if (action === 'join' && method === 'POST') {
          const members = db.prepare('SELECT user_id FROM memberships WHERE group_id = ?').all(groupId).map(r => r.user_id);
          if (members.includes(currentUserId)) return json(res, 200, getFullState(db, currentUserId));
          if (members.length >= group.size) return json(res, 409, { error: 'This group is full' });

          db.prepare('INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES (?, ?, NULL, ?)').run(groupId, currentUserId, Date.now());
          return json(res, 200, getFullState(db, currentUserId));
        }

        if (action === 'leave' && method === 'POST') {
          if (group.host === currentUserId) return json(res, 400, { error: 'Hosts cannot leave their own group' });
          db.prepare('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(groupId, currentUserId);          db.prepare(`
            DELETE FROM plan_participants
            WHERE user_id = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)
          `).run(currentUserId, groupId);
          return json(res, 200, getFullState(db, currentUserId));
        }

        if (action === 'rsvp' && method === 'POST') {
          const body = await readBody(req);
          if (body.status !== 'going' && body.status !== 'skip') {
            return json(res, 400, { error: 'Invalid RSVP status' });
          }
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'Join the group before RSVPing' });

          db.prepare('UPDATE memberships SET rsvp = ? WHERE group_id = ? AND user_id = ?').run(body.status, groupId, currentUserId);
          return json(res, 200, getFullState(db, currentUserId));
        }

        if (action === 'arrive' && method === 'POST') {
          const membership = db.prepare('SELECT arrived_at FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'Join the group first' });

          const isArrived = Boolean(membership.arrived_at);
          db.prepare('UPDATE memberships SET arrived_at = ? WHERE group_id = ? AND user_id = ?').run(
            isArrived ? null : Date.now(), groupId, currentUserId
          );
          return json(res, 200, getFullState(db, currentUserId));
        }

        if (action === 'messages' && method === 'POST') {
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'Join the group to post in chat' });

          const body = await readBody(req);
          const now = Date.now();
          if (body.plan && typeof body.plan === 'object') {
            const what = String(body.plan.what || '').trim().slice(0, 80);
            const whenTxt = String(body.plan.when || '').trim().slice(0, 40);
            if (!what || !whenTxt) return json(res, 400, { error: 'Plan requires what and when' });

            const info = db.prepare('INSERT INTO messages (group_id, user_id, sys, plan_what, plan_when, created_at) VALUES (?, ?, 0, ?, ?, ?)').run(
              groupId, currentUserId, what, whenTxt, now
            );
            db.prepare('INSERT INTO plan_participants (message_id, user_id) VALUES (?, ?)').run(Number(info.lastInsertRowid), currentUserId);
            return json(res, 201, getFullState(db, currentUserId));
          }

          const text = String(body.text || '').trim().slice(0, 400);
          if (!text) return json(res, 400, { error: 'Message text is required' });
          db.prepare('INSERT INTO messages (group_id, user_id, sys, text, created_at) VALUES (?, ?, 0, ?, ?)').run(
            groupId, currentUserId, text, now
          );
          return json(res, 201, getFullState(db, currentUserId));
        }
      }

      const planMatch = path.match(/^\/api\/groups\/([a-z0-9_-]+)\/plans\/(\d+)\/toggle$/i);
      if (planMatch && method === 'POST') {
        const [, groupId, msgIdStr] = planMatch;
        const msgId = Number(msgIdStr);
        const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND group_id = ? AND plan_what IS NOT NULL').get(msgId, groupId);
        if (!msg) return json(res, 404, { error: 'Plan not found' });

        const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
        if (!membership) return json(res, 403, { error: 'Join the group first' });

        const existing = db.prepare('SELECT 1 FROM plan_participants WHERE message_id = ? AND user_id = ?').get(msgId, currentUserId);
        if (existing) {
          db.prepare('DELETE FROM plan_participants WHERE message_id = ? AND user_id = ?').run(msgId, currentUserId);
        } else {
          db.prepare('INSERT INTO plan_participants (message_id, user_id) VALUES (?, ?)').run(msgId, currentUserId);
        }
        return json(res, 200, getFullState(db, currentUserId));
      }

      const friendMatch = path.match(/^\/api\/friends\/([a-z0-9_-]+)\/toggle$/i);
      if (friendMatch && method === 'POST') {
        const targetId = friendMatch[1];
        if (targetId === currentUserId) return json(res, 400, { error: 'Cannot friend yourself' });
        const target = getUser(db, targetId);
        if (!target) return json(res, 404, { error: 'User not found' });

        const existing = db.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?').get(currentUserId, targetId);
        if (existing) {
          db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').run(currentUserId, targetId);
        } else {
          db.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(currentUserId, targetId, Date.now());
        }
        return json(res, 200, getFullState(db, currentUserId));
      }

      if (path === '/api/reset' && method === 'POST') {
        seedDatabase(db);
        return json(res, 200, getFullState(db, 'me'));
      }

      // Static files
      if (method === 'GET' && !path.startsWith('/api/')) {
        const cleanPath = path === '/' ? '/index.html' : path;
        const fullPath = resolve(PUBLIC_DIR, '.' + cleanPath);
        if (!fullPath.startsWith(PUBLIC_DIR)) {
          res.writeHead(403);
          return res.end('Forbidden');
        }
        try {
          const content = await readFile(fullPath);
          const ext = extname(fullPath);
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          return res.end(content);
        } catch {
          const fallback = await readFile(join(PUBLIC_DIR, 'index.html'));
          res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
          return res.end(fallback);
        }
      }

      return json(res, 404, { error: 'Not found' });
    } catch (err) {
      return json(res, 500, { error: err.message || 'Internal server error' });
    }
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3456;
  const db = createDb(process.env.COMMON_DB_PATH || DEFAULT_DB_PATH);
  const server = createServer(createApp(db));
  server.listen(port, '127.0.0.1', () => {
    console.log(`Common running at http://127.0.0.1:${port}`);
  });
}
