import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, CATS, LANGS, LANG_LEVELS, ymd } from './data.js';
import { createDb, createNotification, getFullState, getUser, seedDatabase } from './db.js';
import { generateIcs, generateUserCalendarIcs } from './ics.js';
import {
  getMondayTs,
  isInRatingWindow,
  lastSessionDate,
  nextSessionDate
} from '../public/schedule.js';

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

function parseUserId(req, url) {
  const q = url?.searchParams?.get('user');
  if (typeof q === 'string' && /^[a-z0-9_-]{1,32}$/i.test(q)) return q;
  const h = req.headers['x-user-id'];
  if (typeof h === 'string' && /^[a-z0-9_-]{1,32}$/i.test(h)) return h;
  return 'me';
}

function parseGroupRow(g) {
  return {
    ...g,
    weekly: Boolean(g.weekly),
    friendsOnly: Boolean(g.friends_only),
    lang: JSON.parse(g.lang),
    langLevel: g.lang_level || 'all',
    coHost: g.co_host || null,
    pausedUntil: g.paused_until || null
  };
}

export function createApp(db, opts = {}) {
  const getNow = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const sseClients = new Set();

  function broadcast(payload) {
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const method = req.method || 'GET';
    const currentUserId = parseUserId(req, url);
    const nowTs = getNow();

    try {
      if (path === '/api/health' && method === 'GET') {
        return json(res, 200, { ok: true });
      }

      if (path === '/api/events' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', userId: currentUserId })}\n\n`);
        sseClients.add(res);
        const keepAlive = setInterval(() => {
          try { res.write(': keepalive\n\n'); } catch { clearInterval(keepAlive); }
        }, 25000);
        keepAlive.unref();
        req.on('close', () => {
          clearInterval(keepAlive);
          sseClients.delete(res);
        });
        return;
      }

      if (path === '/api/state' && method === 'GET') {
        return json(res, 200, getFullState(db, currentUserId, nowTs));
      }

      if (path === '/api/users' && method === 'POST') {
        const body = await readBody(req);
        const name = String(body.name || '').trim().slice(0, 40);
        if (!name) return json(res, 400, { error: 'Name is required' });

        const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const since = String(body.since || '').trim().slice(0, 60) || 'Just arrived';
        const city = String(body.city || '').trim().slice(0, 60) || 'Heidelberg';
        const area = String(body.area || '').trim().slice(0, 60) || 'Bergheim';
        const [dLat, dLng] = AREAS[area] || AREAS.Bergheim;
        const homeLat = Number.isFinite(Number(body.homeLat)) ? Number(body.homeLat) : dLat;
        const homeLng = Number.isFinite(Number(body.homeLng)) ? Number(body.homeLng) : dLng;
        const languages = Array.isArray(body.languages) && body.languages.length
          ? body.languages.filter(l => LANGS.includes(l))
          : ['English'];

        db.prepare(`
          INSERT INTO users (id, name, since, new_here, verified, city, area, home_lat, home_lng, languages, interests, availability, intro)
          VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, '[]', '[]', ?)
        `).run(id, name, since, city, area, homeLat, homeLng, JSON.stringify(languages), String(body.intro || '').trim().slice(0, 200));

        broadcast({ type: 'state_changed' });
        return json(res, 201, { userId: id, state: getFullState(db, id, nowTs) });
      }

      if (path === '/api/me' && method === 'PATCH') {
        const body = await readBody(req);
        const existing = getUser(db, currentUserId);
        if (!existing) return json(res, 404, { error: 'User not found' });

        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : existing.name;
        const since = typeof body.since === 'string' && body.since.trim() ? body.since.trim().slice(0, 60) : existing.since;
        const intro = typeof body.intro === 'string' ? body.intro.trim().slice(0, 200) : existing.intro;
        const city = typeof body.city === 'string' && body.city.trim() ? body.city.trim().slice(0, 60) : existing.city;
        const area = typeof body.area === 'string' && body.area.trim() ? body.area.trim().slice(0, 60) : existing.area;
        const preset = AREAS[area];
        const homeLat = Number.isFinite(Number(body.homeLat)) && Math.abs(Number(body.homeLat)) <= 90
          ? Number(body.homeLat)
          : (body.area && body.area !== existing.area && preset ? preset[0] : existing.homeLat);
        const homeLng = Number.isFinite(Number(body.homeLng)) && Math.abs(Number(body.homeLng)) <= 180
          ? Number(body.homeLng)
          : (body.area && body.area !== existing.area && preset ? preset[1] : existing.homeLng);

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
          SET name = ?, since = ?, intro = ?, city = ?, area = ?, home_lat = ?, home_lng = ?, languages = ?, interests = ?, availability = ?, verified = ?, new_here = ?
          WHERE id = ?
        `).run(
          name, since, intro, city, area, homeLat, homeLng,
          JSON.stringify(languages), JSON.stringify(interests), JSON.stringify(availability),
          verified, newHere, existing.id
        );

        broadcast({ type: 'state_changed' });
        return json(res, 200, getFullState(db, existing.id, nowTs));
      }

      if (path === '/api/notifications/read' && method === 'POST') {
        db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(currentUserId);
        return json(res, 200, getFullState(db, currentUserId, nowTs));
      }

      // Personal calendar subscription feed (.ics)
      const userCalMatch = path.match(/^\/api\/users\/([a-z0-9_-]+)\/calendar\.ics$/i);
      if ((userCalMatch || path === '/api/calendar.ics') && method === 'GET') {
        const uid = userCalMatch ? userCalMatch[1] : currentUserId;
        const user = getUser(db, uid);
        if (!user) return json(res, 404, { error: 'User not found' });

        const full = getFullState(db, uid, nowTs);
        const joined = full.groups.filter(g => g.members.includes(uid));
        const ics = generateUserCalendarIcs(user, joined, { nowTs });
        res.writeHead(200, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': `attachment; filename="common-${uid}-schedule.ics"`
        });
        return res.end(ics);
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

        const me = getUser(db, currentUserId);
        const area = String(body.area || '').trim().slice(0, 60) || me?.area || 'Altstadt';
        const city = String(body.city || '').trim().slice(0, 60) || me?.city || 'Heidelberg';
        const [aLat, aLng] = AREAS[area] || [me?.homeLat || 49.4093, me?.homeLng || 8.7100];
        const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const duration = [30, 45, 60, 90, 120].includes(Number(body.duration)) ? Number(body.duration) : 60;
        const weekly = body.weekly === false ? 0 : 1;
        const desc = String(body.desc || '').trim().slice(0, 200) || 'A small group, a shared interest and a reason to meet again.';
        const spot = String(body.spot || '').trim().slice(0, 90) || "I'll wave when you arrive";
        const tips = String(body.tips || '').trim().slice(0, 200);
        const icebreaker = String(body.icebreaker || '').trim().slice(0, 140);
        const lang = Array.isArray(body.lang) && body.lang.length ? body.lang.filter(l => LANGS.includes(l)) : ['English'];
        const langLevel = LANG_LEVELS[body.langLevel] ? body.langLevel : 'all';
        const cost = Number.isFinite(Number(body.cost)) ? Math.max(0, Math.min(50, Math.round(Number(body.cost)))) : 0;
        const size = Math.max(3, Math.min(12, Number(body.size) || 6));
        const friendsOnly = body.friendsOnly ? 1 : 0;
        const jitter = 0.0015;
        const clientLat = Number(body.lat);
        const clientLng = Number(body.lng);
        const lat = Number.isFinite(clientLat) && clientLat >= -90 && clientLat <= 90
          ? clientLat : aLat + (Math.random() - 0.5) * jitter;
        const lng = Number.isFinite(clientLng) && clientLng >= -180 && clientLng <= 180
          ? clientLng : aLng + (Math.random() - 0.5) * jitter;

        db.prepare(`
          INSERT INTO groups (id, name, cat, date, time, duration, weekly, desc, place, area, city, spot, tips, icebreaker, lang, lang_level, cost, size, host, co_host, friends_only, lat, lng, paused_until, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)
        `).run(id, name, cat, date, time, duration, weekly, desc, place, area, city, spot, tips, icebreaker, JSON.stringify(lang), langLevel, cost, size, currentUserId, friendsOnly, lat, lng, nowTs);

        db.prepare('INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES (?, ?, ?, ?)').run(id, currentUserId, 'going', nowTs);
        db.prepare(`
          INSERT INTO session_attendance (group_id, user_id, session_date, rsvp, arrived_at, arrival_note, welcome_buddy)
          VALUES (?, ?, ?, 'going', NULL, '', 1)
        `).run(id, currentUserId, date);
        db.prepare('INSERT INTO messages (group_id, user_id, sys, text, created_at) VALUES (?, ?, 1, ?, ?)').run(
          id, null, 'Group started. Say hello when the first person joins.', nowTs
        );

        // If spun off from a full group's waitlist, invite the other waitlisted people
        if (typeof body.spinoffFrom === 'string' && body.spinoffFrom.trim()) {
          const sourceId = body.spinoffFrom.trim();
          const sourceGroup = db.prepare('SELECT name FROM groups WHERE id = ?').get(sourceId);
          const peers = db.prepare('SELECT user_id FROM waitlist WHERE group_id = ? AND user_id != ?').all(sourceId, currentUserId);
          for (const peer of peers) {
            createNotification(db, {
              userId: peer.user_id,
              type: 'spinoff_invite',
              groupId: id,
              title: `New spin-off: ${name}`,
              body: `${me?.name || 'Someone'} from the ${sourceGroup?.name || 'group'} waitlist started a second table on ${date} at ${time}.`,
              link: `#group-${id}`
            });
          }
        }

        broadcast({ type: 'state_changed', groupId: id });
        return json(res, 201, { id, state: getFullState(db, currentUserId, nowTs) });
      }

      if (path === '/api/wishlist' && method === 'POST') {
        const body = await readBody(req);
        const cat = String(body.cat || '').trim();
        const area = String(body.area || '').trim() || 'any';
        if (!CATS[cat]) return json(res, 400, { error: 'Invalid category' });

        const existing = db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND cat = ? AND area = ?').get(currentUserId, cat, area);
        if (existing) {
          db.prepare('DELETE FROM wishlist WHERE user_id = ? AND cat = ? AND area = ?').run(currentUserId, cat, area);
        } else {
          db.prepare('INSERT INTO wishlist (user_id, cat, area, created_at) VALUES (?, ?, ?, ?)').run(currentUserId, cat, area, nowTs);
        }
        broadcast({ type: 'state_changed' });
        return json(res, 200, getFullState(db, currentUserId, nowTs));
      }

      // Host/Co-host group details patch
      const groupPatchMatch = path.match(/^\/api\/groups\/([a-z0-9_-]+)$/i);
      if (groupPatchMatch && method === 'PATCH') {
        const groupId = groupPatchMatch[1];
        const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
        if (!group) return json(res, 404, { error: 'Group not found' });
        if (group.host !== currentUserId && group.co_host !== currentUserId) {
          return json(res, 403, { error: 'Only host or co-host can update group details' });
        }

        const body = await readBody(req);

        // Operational fields (host + co-host)
        const icebreaker = typeof body.icebreaker === 'string' ? body.icebreaker.trim().slice(0, 140) : group.icebreaker;
        const tips = typeof body.tips === 'string' ? body.tips.trim().slice(0, 200) : group.tips;
        const spot = typeof body.spot === 'string' && body.spot.trim() ? body.spot.trim().slice(0, 90) : group.spot;
        let coHost = group.co_host;
        if (body.coHost === null || body.coHost === '') {
          coHost = null;
        } else if (typeof body.coHost === 'string' && body.coHost !== group.host) {
          const isMem = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, body.coHost);
          if (!isMem) return json(res, 400, { error: 'Co-host must be a current member' });
          coHost = body.coHost;
        }

        // Full group edit fields (host only)
        let name = group.name, desc = group.desc, place = group.place, area = group.area, city = group.city;
        let date = group.date, time = group.time, duration = group.duration, weekly = group.weekly;
        let lang = group.lang, langLevel = group.lang_level, cost = group.cost, size = group.size;
        let friendsOnly = group.friends_only, lat = group.lat, lng = group.lng;

        if (group.host === currentUserId && body.name !== undefined) {
          const memberCount = db.prepare('SELECT COUNT(*) AS c FROM memberships WHERE group_id = ?').get(groupId).c;
          if (typeof body.name === 'string' && body.name.trim()) name = body.name.trim().slice(0, 60);
          if (typeof body.desc === 'string') desc = body.desc.trim().slice(0, 200);
          if (typeof body.place === 'string' && body.place.trim()) place = body.place.trim().slice(0, 60);
          if (typeof body.area === 'string' && body.area.trim()) area = body.area.trim();
          if (typeof body.city === 'string' && body.city.trim()) city = body.city.trim().slice(0, 60);
          if (typeof body.date === 'string' && body.date.trim()) date = body.date.trim();
          if (typeof body.time === 'string' && body.time.trim()) time = body.time.trim();
          if (typeof body.duration === 'number') duration = Math.max(15, Math.min(360, body.duration));
          if (typeof body.weekly === 'boolean') weekly = body.weekly ? 1 : 0;
          if (Array.isArray(body.lang) && body.lang.length) lang = JSON.stringify(body.lang);
          if (typeof body.langLevel === 'string') langLevel = body.langLevel;
          if (typeof body.cost === 'number') cost = Math.max(0, Math.min(50, body.cost));
          if (typeof body.size === 'number') size = Math.max(memberCount, Math.min(20, body.size));
          if (typeof body.friendsOnly === 'boolean') friendsOnly = body.friendsOnly ? 1 : 0;
          if (typeof body.lat === 'number' && typeof body.lng === 'number') { lat = body.lat; lng = body.lng; }
        }

        db.prepare(`UPDATE groups SET
          name=?, desc=?, place=?, area=?, city=?, date=?, time=?, duration=?, weekly=?,
          lang=?, lang_level=?, cost=?, size=?, friends_only=?, lat=?, lng=?,
          icebreaker=?, tips=?, spot=?, co_host=? WHERE id=?`)
          .run(name, desc, place, area, city, date, time, duration, weekly,
               lang, langLevel, cost, size, friendsOnly, lat, lng,
               icebreaker, tips, spot, coHost, groupId);
        broadcast({ type: 'state_changed', groupId });
        return json(res, 200, getFullState(db, currentUserId, nowTs));
      }

      const groupMatch = path.match(/^\/api\/groups\/([a-z0-9_-]+)\/(join|leave|rsvp|messages|calendar\.ics|arrive|welcome-buddy|waitlist|rate|pause|transfer)$/i);
      if (groupMatch) {
        const [, groupId, action] = groupMatch;
        const groupRow = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
        if (!groupRow) return json(res, 404, { error: 'Group not found' });
        const group = parseGroupRow(groupRow);
        const sessDate = ymd(nextSessionDate(group, nowTs, false));

        if (action === 'calendar.ics' && method === 'GET') {
          const skippedRows = db.prepare(`
            SELECT session_date FROM session_attendance
            WHERE group_id = ? AND user_id = ? AND rsvp = 'skip'
          `).all(groupId, currentUserId);
          const ics = generateIcs(group, {
            nowTs,
            skippedDates: skippedRows.map(r => r.session_date)
          });
          res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${group.id}-meetup.ics"`
          });
          return res.end(ics);
        }

        if (action === 'join' && method === 'POST') {
          const members = db.prepare('SELECT user_id FROM memberships WHERE group_id = ?').all(groupId).map(r => r.user_id);
          if (members.includes(currentUserId)) return json(res, 200, getFullState(db, currentUserId, nowTs));
          if (members.length >= group.size) return json(res, 409, { error: 'This group is full' });

          db.prepare('INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES (?, ?, NULL, ?)').run(groupId, currentUserId, nowTs);
          db.prepare('DELETE FROM waitlist WHERE group_id = ? AND user_id = ?').run(groupId, currentUserId);
          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, { ...getFullState(db, currentUserId, nowTs), showIntro: true });
        }

        if (action === 'leave' && method === 'POST') {
          if (group.host === currentUserId) return json(res, 400, { error: 'Hosts cannot leave their own group' });
          db.prepare('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(groupId, currentUserId);
          db.prepare('DELETE FROM session_attendance WHERE group_id = ? AND user_id = ? AND session_date >= ?').run(groupId, currentUserId, sessDate);
          if (group.coHost === currentUserId) {
            db.prepare('UPDATE groups SET co_host = NULL WHERE id = ?').run(groupId);
          }
          db.prepare(`
            DELETE FROM plan_participants
            WHERE user_id = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)
          `).run(currentUserId, groupId);

          // Auto-promote first waitlister & notify them
          const next = db.prepare('SELECT user_id FROM waitlist WHERE group_id = ? ORDER BY joined_at ASC LIMIT 1').get(groupId);
          if (next) {
            db.prepare('INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES (?, ?, NULL, ?)').run(groupId, next.user_id, nowTs);
            db.prepare('DELETE FROM waitlist WHERE group_id = ? AND user_id = ?').run(groupId, next.user_id);
            const promotedUser = db.prepare('SELECT name FROM users WHERE id = ?').get(next.user_id);
            db.prepare('INSERT INTO messages (group_id, user_id, sys, text, created_at) VALUES (?, ?, 1, ?, ?)').run(
              groupId, null, `${promotedUser?.name || 'Someone'} joined from the waitlist.`, nowTs
            );
            createNotification(db, {
              userId: next.user_id,
              type: 'waitlist_promoted',
              groupId,
              title: `Spot opened in ${group.name}!`,
              body: `You moved off the waitlist and are now in the group. Tap Going or Skip for ${sessDate}.`,
              link: `#group-${groupId}`
            });
          }

          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'rsvp' && method === 'POST') {
          const body = await readBody(req);
          if (body.status !== 'going' && body.status !== 'skip') {
            return json(res, 400, { error: 'Invalid RSVP status' });
          }
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'Join the group before RSVPing' });

          db.prepare('UPDATE memberships SET rsvp = ? WHERE group_id = ? AND user_id = ?').run(body.status, groupId, currentUserId);
          db.prepare(`
            INSERT INTO session_attendance (group_id, user_id, session_date, rsvp, arrived_at, arrival_note, welcome_buddy)
            VALUES (?, ?, ?, ?, NULL, '', 0)
            ON CONFLICT(group_id, user_id, session_date) DO UPDATE SET rsvp = excluded.rsvp
          `).run(groupId, currentUserId, sessDate, body.status);

          let milestone = null;
          if (body.status === 'going') {
            const distinctAtt = db.prepare(`
              SELECT COUNT(DISTINCT group_id || ':' || session_date) AS c
              FROM session_attendance
              WHERE user_id = ? AND (rsvp = 'going' OR arrived_at IS NOT NULL)
            `).get(currentUserId).c;
            if ([4, 10, 20, 50].includes(distinctAtt)) milestone = distinctAtt;
          }

          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, { ...getFullState(db, currentUserId, nowTs), milestone });
        }

        if (action === 'arrive' && method === 'POST') {
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'Join the group first' });

          const body = await readBody(req);
          const noteProvided = typeof body.note === 'string';
          const cleanNote = noteProvided ? body.note.trim().slice(0, 80) : null;
          const existing = db.prepare(`
            SELECT arrived_at, arrival_note FROM session_attendance
            WHERE group_id = ? AND user_id = ? AND session_date = ?
          `).get(groupId, currentUserId, sessDate);

          const isArrived = Boolean(existing?.arrived_at);
          if (body.noteOnly && isArrived) {
            db.prepare(`
              UPDATE session_attendance SET arrival_note = ?
              WHERE group_id = ? AND user_id = ? AND session_date = ?
            `).run(cleanNote || '', groupId, currentUserId, sessDate);
          } else {
            const nextArrivedAt = isArrived ? null : nowTs;
            const nextNote = nextArrivedAt ? (cleanNote ?? existing?.arrival_note ?? '') : '';
            db.prepare(`
              INSERT INTO session_attendance (group_id, user_id, session_date, rsvp, arrived_at, arrival_note, welcome_buddy)
              VALUES (?, ?, ?, 'going', ?, ?, 0)
              ON CONFLICT(group_id, user_id, session_date) DO UPDATE SET
                arrived_at = excluded.arrived_at,
                arrival_note = excluded.arrival_note,
                rsvp = COALESCE(session_attendance.rsvp, 'going')
            `).run(groupId, currentUserId, sessDate, nextArrivedAt, nextNote);
          }

          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'welcome-buddy' && method === 'POST') {
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'Join the group first' });

          const existing = db.prepare(`
            SELECT welcome_buddy FROM session_attendance
            WHERE group_id = ? AND user_id = ? AND session_date = ?
          `).get(groupId, currentUserId, sessDate);

          const nextBuddy = existing?.welcome_buddy ? 0 : 1;
          db.prepare(`
            INSERT INTO session_attendance (group_id, user_id, session_date, rsvp, arrived_at, arrival_note, welcome_buddy)
            VALUES (?, ?, ?, 'going', NULL, '', ?)
            ON CONFLICT(group_id, user_id, session_date) DO UPDATE SET welcome_buddy = excluded.welcome_buddy
          `).run(groupId, currentUserId, sessDate, nextBuddy);

          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'messages' && method === 'POST') {
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'Join the group to post in chat' });

          const body = await readBody(req);
          if (body.plan && typeof body.plan === 'object') {
            const what = String(body.plan.what || '').trim().slice(0, 80);
            const whenTxt = String(body.plan.when || '').trim().slice(0, 40);
            if (!what || !whenTxt) return json(res, 400, { error: 'Plan requires what and when' });

            const info = db.prepare('INSERT INTO messages (group_id, user_id, sys, plan_what, plan_when, created_at) VALUES (?, ?, 0, ?, ?, ?)').run(
              groupId, currentUserId, what, whenTxt, nowTs
            );
            db.prepare('INSERT INTO plan_participants (message_id, user_id) VALUES (?, ?)').run(Number(info.lastInsertRowid), currentUserId);
            broadcast({ type: 'state_changed', groupId });
            return json(res, 201, getFullState(db, currentUserId, nowTs));
          }

          const text = String(body.text || '').trim().slice(0, 400);
          if (!text) return json(res, 400, { error: 'Message text is required' });
          db.prepare('INSERT INTO messages (group_id, user_id, sys, text, created_at) VALUES (?, ?, 0, ?, ?)').run(
            groupId, currentUserId, text, nowTs
          );
          broadcast({ type: 'state_changed', groupId });
          return json(res, 201, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'waitlist' && method === 'POST') {
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (membership) return json(res, 400, { error: 'You are already a member of this group' });

          const existing = db.prepare('SELECT 1 FROM waitlist WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (existing) {
            db.prepare('DELETE FROM waitlist WHERE group_id = ? AND user_id = ?').run(groupId, currentUserId);
          } else {
            const memberCount = db.prepare('SELECT COUNT(*) AS c FROM memberships WHERE group_id = ?').get(groupId).c;
            if (memberCount < group.size) return json(res, 400, { error: 'Group is not full — you can join directly' });
            db.prepare('INSERT INTO waitlist (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(groupId, currentUserId, nowTs);
          }
          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'rate' && method === 'POST') {
          const membership = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, currentUserId);
          if (!membership) return json(res, 403, { error: 'You are not a member of this group' });

          const body = await readBody(req);
          if (body.rating !== 1 && body.rating !== -1) return json(res, 400, { error: 'Rating must be 1 or -1' });

          if (!isInRatingWindow(group, nowTs)) {
            return json(res, 400, { error: 'Rating only allowed within 6 hours after the meetup ends' });
          }

          const lastSess = lastSessionDate(group, nowTs);
          const endTs = lastSess.getTime() + group.duration * 60000;
          const weekTs = getMondayTs(endTs);
          db.prepare(`
            INSERT INTO meetup_ratings (group_id, user_id, week_ts, rating)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(group_id, user_id, week_ts) DO UPDATE SET rating = excluded.rating
          `).run(groupId, currentUserId, weekTs, body.rating);

          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'pause' && method === 'POST') {
          if (group.host !== currentUserId && group.coHost !== currentUserId) {
            return json(res, 403, { error: 'Only the host can pause the group' });
          }
          const isPaused = group.pausedUntil && new Date(group.pausedUntil) > new Date(nowTs);
          if (isPaused) {
            db.prepare('UPDATE groups SET paused_until = NULL WHERE id = ?').run(groupId);
          } else {
            const twoWeeks = new Date(nowTs);
            twoWeeks.setDate(twoWeeks.getDate() + 14);
            db.prepare('UPDATE groups SET paused_until = ? WHERE id = ?').run(ymd(twoWeeks), groupId);
          }
          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'transfer' && method === 'POST') {
          if (group.host !== currentUserId) return json(res, 403, { error: 'Only the host can transfer hosting' });
          const body = await readBody(req);
          const newHostId = String(body.newHost || '').trim();
          if (!newHostId) return json(res, 400, { error: 'newHost is required' });
          const isMemberCheck = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, newHostId);
          if (!isMemberCheck) return json(res, 400, { error: 'New host must be a current member' });
          const targetUser = db.prepare('SELECT name FROM users WHERE id = ?').get(newHostId);
          if (!targetUser) return json(res, 404, { error: 'User not found' });

          db.prepare('UPDATE groups SET host = ?, co_host = CASE WHEN co_host = ? THEN NULL ELSE co_host END WHERE id = ?')
            .run(newHostId, newHostId, groupId);
          db.prepare('INSERT INTO messages (group_id, user_id, sys, text, created_at) VALUES (?, ?, 1, ?, ?)').run(
            groupId, null, `${targetUser.name} is now hosting the group.`, nowTs
          );
          broadcast({ type: 'state_changed', groupId });
          return json(res, 200, getFullState(db, currentUserId, nowTs));
        }

        if (action === 'kick' && method === 'POST') {
          if (group.host !== currentUserId) return json(res, 403, { error: 'Only the host can remove members' });
          const body = await readBody(req);
          const targetId = String(body.userId || '').trim();
          if (!targetId) return json(res, 400, { error: 'userId is required' });
          if (targetId === group.host) return json(res, 400, { error: 'Cannot remove the host' });
          const isMemberCheck = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, targetId);
          if (!isMemberCheck) return json(res, 400, { error: 'User is not a member' });

          db.prepare('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(groupId, targetId);
          db.prepare(`
            DELETE FROM plan_participants
            WHERE user_id = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)
          `).run(targetId, groupId);
          const kicked = db.prepare('SELECT name FROM users WHERE id = ?').get(targetId);
          db.prepare('INSERT INTO messages (group_id, user_id, sys, text, created_at) VALUES (?, ?, 1, ?, ?)').run(
            groupId, null, `${kicked?.name || 'A member'} left the group.`, Date.now()
          );
          return json(res, 200, getFullState(db, currentUserId));
        }

        if (action === 'delete' && method === 'POST') {
          if (group.host !== currentUserId) return json(res, 403, { error: 'Only the host can delete the group' });
          db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
          return json(res, 200, getFullState(db, currentUserId));
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
        broadcast({ type: 'state_changed', groupId });
        return json(res, 200, getFullState(db, currentUserId, nowTs));
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
          db.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(currentUserId, targetId, nowTs);
          const me = getUser(db, currentUserId);
          createNotification(db, {
            userId: targetId,
            type: 'friend_added',
            title: `${me?.name || 'Someone'} added you as a familiar face`,
            body: 'You can now join each other’s friends-only meetups.',
            link: '#profile'
          });
        }
        broadcast({ type: 'state_changed' });
        return json(res, 200, getFullState(db, currentUserId, nowTs));
      }

      if (path === '/api/reset' && method === 'POST') {
        seedDatabase(db);
        broadcast({ type: 'state_changed' });
        return json(res, 200, getFullState(db, 'me', nowTs));
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
  }

  handler.closeSse = () => {
    for (const client of sseClients) {
      try { client.end(); } catch {}
    }
    sseClients.clear();
  };

  return handler;
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
