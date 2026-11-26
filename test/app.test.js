import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDb } from '../src/db.js';
import { createApp } from '../src/server.js';
import { generateIcs, generateUserCalendarIcs } from '../src/ics.js';
import {
  isInRatingWindow,
  lastSessionDate,
  nextSessionDate,
  ymd
} from '../public/schedule.js';

function createMockReq({ method = 'GET', url = '/', headers = {}, body = null }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', ...headers };

  req[Symbol.asyncIterator] = async function* () {
    if (body !== null && body !== undefined) {
      const str = typeof body === 'string' ? body : JSON.stringify(body);
      yield Buffer.from(str, 'utf8');
    }
  };
  return req;
}

function invokeApp(app, { method = 'GET', url = '/', headers = {}, body = null, userId = 'me' } = {}) {
  return new Promise((resolve, reject) => {
    const req = createMockReq({
      method,
      url,
      headers: { 'content-type': 'application/json', 'x-user-id': userId, ...headers },
      body
    });
    const chunks = [];
    let statusCode = 200;
    let resHeaders = {};
    const res = {
      writeHead(code, hdrs = {}) {
        statusCode = code;
        resHeaders = { ...resHeaders, ...hdrs };
      },
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
      },
      end(chunk) {
        if (chunk) this.write(chunk);
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if ((resHeaders['Content-Type'] || '').includes('application/json')) {
          try { json = JSON.parse(text); } catch {}
        }
        resolve({ status: statusCode, headers: resHeaders, text, data: json });
      }
    };
    Promise.resolve(app(req, res)).catch(reject);
  });
}

test('schedule helpers: weekly rating window opens for 6h after session ends', () => {
  const g = { date: '2026-11-24', time: '18:30', duration: 60, weekly: true, pausedUntil: null };
  const during = new Date('2026-11-24T19:00:00').getTime();
  assert.equal(isInRatingWindow(g, during), false);

  const twoHoursAfter = new Date('2026-11-24T21:30:00').getTime();
  assert.equal(isInRatingWindow(g, twoHoursAfter), true);
  assert.equal(ymd(lastSessionDate(g, twoHoursAfter)), '2026-11-24');
  assert.equal(ymd(nextSessionDate(g, twoHoursAfter)), '2026-12-01');

  const sevenHoursAfter = new Date('2026-11-25T02:31:00').getTime();
  assert.equal(isInRatingWindow(g, sevenHoursAfter), false);
});

test('schedule helpers: nextSessionDate skips paused dates when requested', () => {
  const g = { date: '2026-11-24', time: '18:30', duration: 60, weekly: true, pausedUntil: '2026-12-02' };
  const now = new Date('2026-11-23T10:00:00').getTime();
  assert.equal(ymd(nextSessionDate(g, now, false)), '2026-11-24');
  assert.equal(ymd(nextSessionDate(g, now, true)), '2026-12-08');
});

test('database migration backfills legacy common.db schemas safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'common-mig-'));
  const dbPath = join(dir, 'legacy.db');
  try {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, since TEXT NOT NULL, new_here INTEGER NOT NULL DEFAULT 1, verified INTEGER NOT NULL DEFAULT 0, area TEXT NOT NULL DEFAULT 'Bergheim', languages TEXT NOT NULL DEFAULT '["English"]', interests TEXT NOT NULL DEFAULT '[]', availability TEXT NOT NULL DEFAULT '[]', intro TEXT NOT NULL DEFAULT '');
      CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, cat TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, duration INTEGER NOT NULL, weekly INTEGER NOT NULL DEFAULT 1, desc TEXT NOT NULL DEFAULT '', place TEXT NOT NULL, area TEXT NOT NULL, spot TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '["English"]', cost INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 6, host TEXT NOT NULL, friends_only INTEGER NOT NULL DEFAULT 0, lat REAL NOT NULL, lng REAL NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE memberships (group_id TEXT NOT NULL, user_id TEXT NOT NULL, rsvp TEXT, joined_at INTEGER NOT NULL, PRIMARY KEY (group_id, user_id));
      INSERT INTO users (id, name, since) VALUES ('me', 'Alex', '2 weeks ago');
      INSERT INTO groups (id, name, cat, date, time, duration, place, area, host, lat, lng, created_at) VALUES ('g1', 'Test Run', 'running', '2026-12-01', '18:00', 45, 'Park', 'Bergheim', 'me', 49.4, 8.69, 1000);
      INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES ('g1', 'me', 'going', 1000);
    `);
    legacy.close();

    const migrated = createDb(dbPath);
    const att = migrated.prepare("SELECT * FROM session_attendance WHERE group_id = 'g1' AND user_id = 'me'").get();
    assert.ok(att);
    assert.equal(att.rsvp, 'going');
    migrated.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API lifecycle: join, RSVP, arrival note, welcome buddy, chat, co-host, waitlist promotion & spin-off', async () => {
  const db = createDb(':memory:');
  const app = createApp(db);
  try {
    // 1. Join 'run' and RSVP going
    const joinRes = await invokeApp(app, { method: 'POST', url: '/api/groups/run/join', userId: 'me' });
    assert.equal(joinRes.status, 200);
    assert.equal(joinRes.data.showIntro, true);

    const rsvpRes = await invokeApp(app, { method: 'POST', url: '/api/groups/run/rsvp', body: { status: 'going' }, userId: 'me' });
    assert.equal(rsvpRes.status, 200);
    const runGroup = rsvpRes.data.groups.find(g => g.id === 'run');
    assert.equal(runGroup.rsvp.me, 'going');
    assert.ok(rsvpRes.data.me.meetupsAttended >= 1);

    // 2. Arrival check-in with note & noteOnly update
    const arr1 = await invokeApp(app, {
      method: 'POST',
      url: '/api/groups/run/arrive',
      body: { note: 'Blue jacket by bridge' },
      userId: 'me'
    });
    assert.equal(arr1.status, 200);
    let gRun = arr1.data.groups.find(g => g.id === 'run');
    assert.ok(gRun.arrived.me);
    assert.equal(gRun.arrivalNotes.me, 'Blue jacket by bridge');

    const arr2 = await invokeApp(app, {
      method: 'POST',
      url: '/api/groups/run/arrive',
      body: { noteOnly: true, note: 'Red cap under the tree' },
      userId: 'me'
    });
    gRun = arr2.data.groups.find(g => g.id === 'run');
    assert.equal(gRun.arrivalNotes.me, 'Red cap under the tree');

    // 3. Welcome buddy toggle
    const buddyRes = await invokeApp(app, { method: 'POST', url: '/api/groups/run/welcome-buddy', userId: 'me' });
    gRun = buddyRes.data.groups.find(g => g.id === 'run');
    assert.ok(gRun.welcomeBuddies.includes('me'));

    // 4. Host edits icebreaker, tips & sets co-host
    const patchRes = await invokeApp(app, {
      method: 'PATCH',
      url: '/api/groups/run',
      body: { icebreaker: 'Favourite trail?', tips: 'Bring headlamp', coHost: 'me' },
      userId: 'lena'
    });
    assert.equal(patchRes.status, 200);
    gRun = patchRes.data.groups.find(g => g.id === 'run');
    assert.equal(gRun.icebreaker, 'Favourite trail?');
    assert.equal(gRun.tips, 'Bring headlamp');
    assert.equal(gRun.coHost, 'me');

    // 5. Waitlist auto-promotion & notification on 'cook' (seeded full with mei, david waiting)
    const leaveRes = await invokeApp(app, { method: 'POST', url: '/api/groups/cook/leave', userId: 'amir' });
    assert.equal(leaveRes.status, 200);
    const meiState = await invokeApp(app, { url: '/api/state', userId: 'mei' });
    const cookAsMei = meiState.data.groups.find(g => g.id === 'cook');
    assert.ok(cookAsMei.members.includes('mei'));
    assert.ok(meiState.data.notifications.some(n => n.type === 'waitlist_promoted' && n.groupId === 'cook'));

    // 6. Spin-off group invites remaining waitlisted peer ('david')
    const spinoffRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/groups',
      userId: 'me',
      body: {
        name: 'Cook & Share (Table 2)',
        cat: 'cooking',
        date: '2026-12-04',
        time: '19:00',
        place: 'Bergheim Kitchen',
        city: 'Heidelberg',
        spinoffFrom: 'cook'
      }
    });
    assert.equal(spinoffRes.status, 201);
    const davidState = await invokeApp(app, { url: '/api/state', userId: 'david' });
    assert.ok(davidState.data.notifications.some(n => n.type === 'spinoff_invite'));

    // 7. Create user in another city (Munich) globally
    const newUserRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/users',
      body: { name: 'Sam', city: 'Munich', area: 'Schwabing', homeLat: 48.165, homeLng: 11.586 }
    });
    assert.equal(newUserRes.status, 201);
    assert.equal(newUserRes.data.state.me.city, 'Munich');

    const munichGroup = await invokeApp(app, {
      method: 'POST',
      url: '/api/groups',
      userId: newUserRes.data.userId,
      body: {
        name: 'Englischer Garten Run',
        cat: 'running',
        date: '2026-12-03',
        time: '18:00',
        place: 'Monopteros',
        city: 'Munich',
        area: 'Schwabing',
        lat: 48.159,
        lng: 11.592,
        langLevel: 'beginner'
      }
    });
    assert.equal(munichGroup.status, 201);
    const created = munichGroup.data.state.groups.find(g => g.id === munichGroup.data.id);
    assert.equal(created.city, 'Munich');
    assert.equal(created.langLevel, 'beginner');
    assert.ok(created.distKm < 2);
  } finally {
    app.closeSse();
    db.close();
  }
});

test('post-meetup rating API works within 6h after weekly session ends', async () => {
  const db = createDb(':memory:');
  const runRow = db.prepare("SELECT * FROM groups WHERE id = 'run'").get();
  const sessEnd = new Date(`${runRow.date}T${runRow.time}:00`).getTime() + runRow.duration * 60000;
  let fakeNow = sessEnd + 2 * 3600000;

  const app = createApp(db, { now: () => fakeNow });
  try {
    const stateRes = await invokeApp(app, { url: '/api/state', userId: 'lena' });
    const run = stateRes.data.groups.find(g => g.id === 'run');
    assert.equal(run.inRatingWindow, true);
    assert.ok(run.lastSessionAttendees.includes('kofi'));

    const rateRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/groups/run/rate',
      userId: 'lena',
      body: { rating: 1 }
    });
    assert.equal(rateRes.status, 200);
    assert.equal(rateRes.data.groups.find(g => g.id === 'run').myRating, 1);

    fakeNow = sessEnd + 7 * 3600000;
    const lateRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/groups/run/rate',
      userId: 'kofi',
      body: { rating: 1 }
    });
    assert.equal(lateRes.status, 400);
  } finally {
    app.closeSse();
    db.close();
  }
});

test('ICS calendar feeds include RRULE and EXDATE for skipped/paused weeks', async () => {
  const db = createDb(':memory:');
  const app = createApp(db);
  try {
    await invokeApp(app, { method: 'POST', url: '/api/groups/run/join', userId: 'me' });
    await invokeApp(app, { method: 'POST', url: '/api/groups/run/rsvp', body: { status: 'skip' }, userId: 'me' });
    await invokeApp(app, { method: 'POST', url: '/api/groups/focus/join', userId: 'me' });
    await invokeApp(app, { method: 'POST', url: '/api/groups/focus/pause', userId: 'priya' });

    const singleRes = await invokeApp(app, { url: '/api/groups/run/calendar.ics?user=me' });
    assert.equal(singleRes.status, 200);
    assert.match(singleRes.text, /RRULE:FREQ=WEEKLY/);
    assert.match(singleRes.text, /EXDATE;TZID=Europe\/Berlin:/);

    const userRes = await invokeApp(app, { url: '/api/users/me/calendar.ics' });
    assert.equal(userRes.status, 200);
    assert.match(userRes.text, /SUMMARY:Easy Tuesday Run/);
    assert.match(userRes.text, /SUMMARY:Focus & Coffee/);
    assert.match(userRes.text, /EXDATE;TZID=Europe\/Berlin:/);

    const sample = {
      id: 'x', name: 'Test', desc: 'Desc', place: 'Cafe', area: 'Altstadt',
      date: '2026-12-01', time: '18:00', duration: 60, weekly: true,
      pausedUntil: '2026-12-10', skippedDates: ['2026-12-15']
    };
    const raw = generateIcs(sample, { nowTs: new Date('2026-11-30T10:00:00').getTime() });
    assert.match(raw, /EXDATE;TZID=Europe\/Berlin:20261201T180000,20261208T180000,20261215T180000/);
    const combined = generateUserCalendarIcs({ name: 'Alex' }, [sample], { nowTs: new Date('2026-11-30T10:00:00').getTime() });
    assert.match(combined, /X-WR-CALNAME:Common Meetups \(Alex\)/);
  } finally {
    app.closeSse();
    db.close();
  }
});

test('SSE /api/events broadcasts state_changed on chat message', async () => {
  const db = createDb(':memory:');
  const app = createApp(db);
  try {
    const req = createMockReq({ method: 'GET', url: '/api/events?user=me' });
    const stream = new PassThrough();
    let status = 0;
    const chunks = [];
    stream.on('data', d => chunks.push(d.toString('utf8')));
    const res = {
      writeHead(code) { status = code; },
      write(chunk) { stream.write(chunk); },
      end(chunk) { stream.end(chunk); }
    };

    await app(req, res);
    assert.equal(status, 200);
    assert.match(chunks.join(''), /"type":"connected"/);

    await invokeApp(app, {
      method: 'POST',
      url: '/api/groups/run/messages',
      userId: 'lena',
      body: { text: 'Live update test!' }
    });

    const combined = chunks.join('');
    assert.match(combined, /"type":"state_changed"/);
    assert.match(combined, /"groupId":"run"/);

    req.emit('close');
  } finally {
    app.closeSse();
    db.close();
  }
});
