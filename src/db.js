import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AREAS,
  CATS,
  SEED_FRIENDS,
  SEED_GROUPS,
  SEED_PEOPLE,
  nextDay,
  ymd
} from './data.js';
import {
  getMondayTs,
  isInRatingWindow,
  lastSessionDate,
  nextSessionDate
} from '../public/schedule.js';

function ensureColumn(db, table, colName, colDef) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(colName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef};`);
  }
}

export function createDb(dbPath = ':memory:') {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      since TEXT NOT NULL,
      new_here INTEGER NOT NULL DEFAULT 1,
      verified INTEGER NOT NULL DEFAULT 0,
      city TEXT NOT NULL DEFAULT 'Heidelberg',
      area TEXT NOT NULL DEFAULT 'Bergheim',
      home_lat REAL NOT NULL DEFAULT 49.4055,
      home_lng REAL NOT NULL DEFAULT 8.6900,
      languages TEXT NOT NULL DEFAULT '["English"]',
      interests TEXT NOT NULL DEFAULT '[]',
      availability TEXT NOT NULL DEFAULT '[]',
      intro TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cat TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      weekly INTEGER NOT NULL DEFAULT 1,
      desc TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL,
      area TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT 'Heidelberg',
      spot TEXT NOT NULL DEFAULT '',
      tips TEXT NOT NULL DEFAULT '',
      icebreaker TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT '["English"]',
      lang_level TEXT NOT NULL DEFAULT 'all',
      cost INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 6,
      host TEXT NOT NULL,
      co_host TEXT,
      friends_only INTEGER NOT NULL DEFAULT 0,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      paused_until TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rsvp TEXT,
      joined_at INTEGER NOT NULL,
      arrived_at INTEGER,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_attendance (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_date TEXT NOT NULL,
      rsvp TEXT,
      arrived_at INTEGER,
      arrival_note TEXT NOT NULL DEFAULT '',
      welcome_buddy INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, user_id, session_date),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      user_id TEXT,
      sys INTEGER NOT NULL DEFAULT 0,
      text TEXT,
      plan_what TEXT,
      plan_when TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plan_participants (
      message_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meetup_ratings (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      week_ts INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id, week_ts),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wishlist (
      user_id TEXT NOT NULL,
      cat TEXT NOT NULL,
      area TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, cat, area),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      group_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT NOT NULL DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Safe migrations for existing databases
  ensureColumn(db, 'users', 'city', "TEXT NOT NULL DEFAULT 'Heidelberg'");
  ensureColumn(db, 'users', 'home_lat', 'REAL NOT NULL DEFAULT 49.4055');
  ensureColumn(db, 'users', 'home_lng', 'REAL NOT NULL DEFAULT 8.6900');

  ensureColumn(db, 'groups', 'city', "TEXT NOT NULL DEFAULT 'Heidelberg'");
  ensureColumn(db, 'groups', 'tips', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'groups', 'icebreaker', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'groups', 'lang_level', "TEXT NOT NULL DEFAULT 'all'");
  ensureColumn(db, 'groups', 'co_host', 'TEXT');
  ensureColumn(db, 'groups', 'paused_until', 'TEXT');

  ensureColumn(db, 'memberships', 'arrived_at', 'INTEGER');

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    seedDatabase(db);
  } else {
    // Backfill session_attendance from legacy memberships if empty
    const attCount = db.prepare('SELECT COUNT(*) AS c FROM session_attendance').get().c;
    if (attCount === 0) {
      const grpMap = new Map(
        db.prepare('SELECT id, date, time, duration, weekly, paused_until FROM groups').all().map(g => [
          g.id,
          { ...g, weekly: Boolean(g.weekly), pausedUntil: g.paused_until }
        ])
      );
      const memRows = db.prepare('SELECT group_id, user_id, rsvp, arrived_at FROM memberships WHERE rsvp IS NOT NULL OR arrived_at IS NOT NULL').all();
      const ins = db.prepare(`
        INSERT OR IGNORE INTO session_attendance (group_id, user_id, session_date, rsvp, arrived_at, arrival_note, welcome_buddy)
        VALUES (?, ?, ?, ?, ?, '', 0)
      `);
      for (const m of memRows) {
        const g = grpMap.get(m.group_id);
        if (!g) continue;
        const sDate = ymd(nextSessionDate(g));
        ins.run(m.group_id, m.user_id, sDate, m.rsvp, m.arrived_at);
      }
    }
  }

  return db;
}

export function seedDatabase(db) {
  db.exec(`
    DELETE FROM notifications;
    DELETE FROM session_attendance;
    DELETE FROM waitlist;
    DELETE FROM meetup_ratings;
    DELETE FROM wishlist;
    DELETE FROM plan_participants;
    DELETE FROM messages;
    DELETE FROM memberships;
    DELETE FROM friendships;
    DELETE FROM groups;
    DELETE FROM users;
  `);

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, since, new_here, verified, city, area, home_lat, home_lng, languages, interests, availability, intro)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of SEED_PEOPLE) {
    const [dLat, dLng] = AREAS[p.area] || AREAS.Bergheim;
    insertUser.run(
      p.id,
      p.name,
      p.since,
      p.newHere ? 1 : 0,
      p.verified ? 1 : 0,
      p.city || 'Heidelberg',
      p.area,
      p.homeLat ?? dLat,
      p.homeLng ?? dLng,
      JSON.stringify(p.languages),
      JSON.stringify(p.interests),
      JSON.stringify(p.availability),
      p.intro || ''
    );
  }

  const now = Date.now();
  const insertFriend = db.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)');
  for (const fid of SEED_FRIENDS) {
    insertFriend.run('me', fid, now);
  }

  const insertGroup = db.prepare(`
    INSERT INTO groups (id, name, cat, date, time, duration, weekly, desc, place, area, city, spot, tips, icebreaker, lang, lang_level, cost, size, host, co_host, friends_only, lat, lng, paused_until, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare('INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES (?, ?, ?, ?)');
  const insertAtt = db.prepare(`
    INSERT INTO session_attendance (group_id, user_id, session_date, rsvp, arrived_at, arrival_note, welcome_buddy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWait = db.prepare('INSERT INTO waitlist (group_id, user_id, joined_at) VALUES (?, ?, ?)');
  const insertMsg = db.prepare('INSERT INTO messages (group_id, user_id, sys, text, plan_what, plan_when, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertPlanIn = db.prepare('INSERT INTO plan_participants (message_id, user_id) VALUES (?, ?)');

  SEED_GROUPS.forEach((g, idx) => {
    const date = nextDay(g.dow, g.time);
    insertGroup.run(
      g.id, g.name, g.cat, date, g.time, g.duration, g.weekly ? 1 : 0,
      g.desc, g.place, g.area, g.city || 'Heidelberg', g.spot, g.tips || '', g.icebreaker || '',
      JSON.stringify(g.lang), g.langLevel || 'all', g.cost, g.size,
      g.host, g.coHost || null, g.friendsOnly ? 1 : 0, g.lat, g.lng, null, now + idx
    );

    const oldestWeek = Array.isArray(g.pastWeeks) && g.pastWeeks.length
      ? Math.max(...g.pastWeeks.map(w => w.weeksAgo))
      : 1;

    g.members.forEach((uid, mIdx) => {
      const joinedAt = now - oldestWeek * 7 * 86400000 - (g.members.length - mIdx) * 3600000;
      insertMember.run(g.id, uid, g.rsvp[uid] || null, joinedAt);
      if (g.rsvp[uid] || g.welcomeBuddy === uid) {
        insertAtt.run(g.id, uid, date, g.rsvp[uid] || null, null, '', g.welcomeBuddy === uid ? 1 : 0);
      }
    });

    if (Array.isArray(g.pastWeeks)) {
      for (const pw of g.pastWeeks) {
        const d = new Date(`${date}T${g.time}:00`);
        d.setDate(d.getDate() - pw.weeksAgo * 7);
        const pastDate = ymd(d);
        for (const uid of pw.attendees) {
          insertAtt.run(g.id, uid, pastDate, 'going', d.getTime(), '', g.welcomeBuddy === uid ? 1 : 0);
        }
      }
    }

    if (Array.isArray(g.waitlist)) {
      g.waitlist.forEach((uid, wIdx) => {
        insertWait.run(g.id, uid, now + wIdx);
      });
    }

    g.chat.forEach((m, cIdx) => {
      const res = insertMsg.run(
        g.id,
        m.from || null,
        m.sys ? 1 : 0,
        m.text || null,
        m.plan ? m.plan.what : null,
        m.plan ? m.plan.when : null,
        now + cIdx
      );
      if (m.plan && Array.isArray(m.ins)) {
        for (const uid of m.ins) {
          insertPlanIn.run(Number(res.lastInsertRowid), uid);
        }
      }
    });
  });
}

function mapUserRow(row) {
  if (!row) return null;
  const [dLat, dLng] = AREAS[row.area] || AREAS.Bergheim;
  return {
    id: row.id,
    name: row.name,
    since: row.since,
    newHere: Boolean(row.new_here),
    verified: Boolean(row.verified),
    city: row.city || 'Heidelberg',
    area: row.area,
    homeLat: Number.isFinite(row.home_lat) ? row.home_lat : dLat,
    homeLng: Number.isFinite(row.home_lng) ? row.home_lng : dLng,
    languages: JSON.parse(row.languages),
    interests: JSON.parse(row.interests),
    availability: JSON.parse(row.availability),
    intro: row.intro
  };
}

export function getUser(db, userId = 'me') {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return mapUserRow(row);
}

export function createNotification(db, { userId, type, groupId = null, title, body, link = '' }) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, group_id, title, body, link, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(userId, type, groupId, title, body, link, Date.now());
}

export function computeDistanceKm(userOrArea, gLat, gLng) {
  let uLat;
  let uLng;
  if (typeof userOrArea === 'string') {
    [uLat, uLng] = AREAS[userOrArea] || AREAS.Bergheim;
  } else if (userOrArea && Number.isFinite(userOrArea.homeLat) && Number.isFinite(userOrArea.homeLng)) {
    uLat = userOrArea.homeLat;
    uLng = userOrArea.homeLng;
  } else {
    [uLat, uLng] = AREAS[userOrArea?.area] || AREAS.Bergheim;
  }

  const R = 6371;
  const dLat = (gLat - uLat) * Math.PI / 180;
  const dLng = (gLng - uLng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(uLat * Math.PI / 180) * Math.cos(gLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeSuggestion(group, me, friendIds) {
  const reasons = [];
  let score = 0;

  const catLabel = CATS[group.cat]?.label || group.cat;
  const matchedInterestCount = me.interests.filter(
    i => i.toLowerCase() === catLabel.toLowerCase() || group.name.toLowerCase().includes(i.toLowerCase())
  ).length;
  if (matchedInterestCount > 0) {
    score += 40;
    reasons.push(`Matches ${catLabel}`);
  }

  const dow = new Date(group.date + 'T12:00:00').getDay();
  if (me.availability.includes(dow)) {
    score += 25;
    const dayName = new Date(group.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
    reasons.push(`Fits your ${dayName} availability`);
  }

  const langMatch = group.lang.some(l => me.languages.includes(l));
  if (langMatch) {
    score += 15;
  } else {
    score -= 20;
  }

  const dist = computeDistanceKm(me, group.lat, group.lng);
  if (dist <= 1.2) {
    score += 20;
    reasons.push(`${dist.toFixed(1)} km from ${me.area}`);
  } else if (dist <= 2.5) {
    score += 10;
  }

  const friendsInGroup = group.members.filter(id => friendIds.has(id));
  if (friendsInGroup.length > 0) {
    score += 25;
    reasons.push(`${friendsInGroup.length} familiar ${friendsInGroup.length === 1 ? 'face' : 'faces'}`);
  }

  return { score, reasons: reasons.slice(0, 2), matchedInterestCount };
}

export function getFullState(db, currentUserId = 'me', nowTs = Date.now()) {
  const peopleRows = db.prepare('SELECT * FROM users').all();
  const people = {};
  for (const r of peopleRows) {
    people[r.id] = mapUserRow(r);
  }

  const me = people[currentUserId] || getUser(db, 'me');
  const friendRows = db.prepare('SELECT friend_id FROM friendships WHERE user_id = ?').all(me.id);
  const friends = friendRows.map(r => r.friend_id);
  const friendSet = new Set(friends);

  const allFriendRows = db.prepare('SELECT user_id, friend_id FROM friendships').all();
  const friendsOf = {};
  for (const { user_id, friend_id } of allFriendRows) {
    if (!friendsOf[user_id]) friendsOf[user_id] = new Set();
    friendsOf[user_id].add(friend_id);
  }

  const groupRows = db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all();
  const memberRows = db.prepare('SELECT group_id, user_id, joined_at FROM memberships ORDER BY joined_at ASC').all();
  const attRows = db.prepare('SELECT * FROM session_attendance').all();
  const msgRows = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
  const planRows = db.prepare('SELECT message_id, user_id FROM plan_participants').all();
  const waitlistRows = db.prepare('SELECT group_id, user_id, joined_at FROM waitlist ORDER BY joined_at ASC').all();
  const ratingRows = db.prepare('SELECT group_id, user_id, week_ts, rating FROM meetup_ratings').all();
  const wishRows = db.prepare('SELECT cat, area FROM wishlist WHERE user_id = ?').all(me.id);
  const allWishRows = db.prepare('SELECT cat, area FROM wishlist').all();
  const notifRows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(me.id);

  // Co-attendance: sessions where both me and another user attended ('going' or arrived_at)
  const myAttendedSessions = new Set();
  const userAttendedSessions = {};
  const distinctMySessions = new Set();

  for (const a of attRows) {
    if (a.rsvp === 'going' || a.arrived_at) {
      const key = `${a.group_id}:${a.session_date}`;
      if (a.user_id === me.id) {
        myAttendedSessions.add(key);
        distinctMySessions.add(key);
      } else {
        if (!userAttendedSessions[a.user_id]) userAttendedSessions[a.user_id] = new Set();
        userAttendedSessions[a.user_id].add(key);
      }
    }
  }
  me.meetupsAttended = distinctMySessions.size;

  for (const p of Object.values(people)) {
    const theirFriends = friendsOf[p.id] || new Set();
    let mutual = 0;
    for (const fid of friendSet) {
      if (theirFriends.has(fid)) mutual++;
    }
    p.mutualFriendCount = mutual;

    const theirSess = userAttendedSessions[p.id] || new Set();
    let metCount = 0;
    for (const sk of theirSess) {
      if (myAttendedSessions.has(sk)) metCount++;
    }
    p.metCount = metCount;
  }

  const wishCounts = {};
  for (const w of allWishRows) {
    wishCounts[w.cat] = (wishCounts[w.cat] || 0) + 1;
  }

  const planMap = new Map();
  for (const p of planRows) {
    if (!planMap.has(p.message_id)) planMap.set(p.message_id, []);
    planMap.get(p.message_id).push(p.user_id);
  }

  const dynamicReminders = [];

  const groups = groupRows.map(g => {
    const gMembers = memberRows.filter(m => m.group_id === g.id);
    const members = gMembers.map(m => m.user_id);

    const parsedBase = {
      id: g.id,
      name: g.name,
      cat: g.cat,
      date: g.date,
      time: g.time,
      duration: g.duration,
      weekly: Boolean(g.weekly),
      desc: g.desc,
      place: g.place,
      area: g.area,
      city: g.city || 'Heidelberg',
      spot: g.spot,
      tips: g.tips || '',
      icebreaker: g.icebreaker || '',
      lang: JSON.parse(g.lang),
      langLevel: g.lang_level || 'all',
      cost: g.cost,
      size: g.size,
      host: g.host,
      coHost: g.co_host || null,
      friendsOnly: Boolean(g.friends_only),
      lat: g.lat,
      lng: g.lng,
      pausedUntil: g.paused_until || null
    };

    const nextSess = nextSessionDate(parsedBase, nowTs, false);
    const currentSessionDate = ymd(nextSess);
    const lastSess = lastSessionDate(parsedBase, nowTs);
    const lastSessionYmd = lastSess ? ymd(lastSess) : null;

    const gAtt = attRows.filter(a => a.group_id === g.id);
    const curAtt = gAtt.filter(a => a.session_date === currentSessionDate);

    const rsvp = {};
    const arrived = {};
    const arrivalNotes = {};
    const welcomeBuddies = [];
    for (const a of curAtt) {
      if (a.rsvp) rsvp[a.user_id] = a.rsvp;
      if (a.arrived_at) arrived[a.user_id] = a.arrived_at;
      if (a.arrival_note) arrivalNotes[a.user_id] = a.arrival_note;
      if (a.welcome_buddy) welcomeBuddies.push(a.user_id);
    }

    const joinedAt = {};
    for (const m of gMembers) joinedAt[m.user_id] = m.joined_at;

    // Last session attendees for post-meetup "Who did you click with?"
    const lastSessionAttendees = lastSessionYmd
      ? gAtt
          .filter(a => a.session_date === lastSessionYmd && (a.rsvp === 'going' || a.arrived_at))
          .map(a => a.user_id)
      : [];

    // Rating lookup keyed by the week of the most recent ended session (or current week)
    const ratingRefTs = lastSess ? lastSess.getTime() + g.duration * 60000 : nowTs;
    const ratingWeekTs = getMondayTs(ratingRefTs);
    const myRatingRow = ratingRows.find(
      r => r.group_id === g.id && r.user_id === currentUserId && r.week_ts === ratingWeekTs
    );

    const chat = msgRows
      .filter(m => m.group_id === g.id)
      .map(m => {
        if (m.sys) return { id: m.id, sys: true, text: m.text, ts: m.created_at };
        if (m.plan_what) {
          return {
            id: m.id,
            from: m.user_id,
            plan: { what: m.plan_what, when: m.plan_when },
            ins: planMap.get(m.id) || [],
            ts: m.created_at
          };
        }
        return { id: m.id, from: m.user_id, text: m.text, ts: m.created_at };
      });

    const isCurrentMember = members.includes(currentUserId);
    const previewChat = isCurrentMember ? null : chat
      .filter(m => !m.sys && m.text)
      .slice(-2)
      .map(m => ({ from: m.from, text: m.text }));

    const gWaitlist = waitlistRows.filter(w => w.group_id === g.id).map(w => w.user_id);
    const waitlistPosIdx = gWaitlist.indexOf(currentUserId);
    const waitlistPos = waitlistPosIdx >= 0 ? waitlistPosIdx + 1 : 0;

    // Member attendance count & inactivity detection
    const pastDates = [...new Set(gAtt.filter(a => a.session_date < currentSessionDate).map(a => a.session_date))].sort().reverse();
    const membersMeta = gMembers.map(m => {
      const attendedCount = gAtt.filter(a => a.user_id === m.user_id && (a.rsvp === 'going' || a.arrived_at)).length;
      const recentAtt = pastDates.slice(0, 3);
      const activeRecently = recentAtt.length < 3 || recentAtt.some(d =>
        gAtt.some(a => a.user_id === m.user_id && a.session_date === d && (a.rsvp === 'going' || a.arrived_at))
      ) || rsvp[m.user_id] === 'going';
      const theirFriends = friendsOf[m.user_id] || new Set();
      let mutualFriends = 0;
      for (const fid of friendSet) {
        if (theirFriends.has(fid)) mutualFriends++;
      }
      return {
        userId: m.user_id,
        weeksIn: Math.max(attendedCount, Math.floor((nowTs - m.joined_at) / (7 * 86400000))),
        attendedCount,
        inactive: !activeRecently && m.user_id !== g.host && m.user_id !== g.co_host,
        mutualFriends
      };
    });

    // Dynamic 24h unanswered RSVP reminder for current user
    const hoursUntil = (nextSess.getTime() - nowTs) / 3600000;
    if (isCurrentMember && !rsvp[currentUserId] && hoursUntil > 0 && hoursUntil <= 24) {
      dynamicReminders.push({
        id: `rem-${g.id}-${currentSessionDate}`,
        type: 'rsvp_reminder',
        groupId: g.id,
        title: `Tomorrow: ${g.name}`,
        body: `Starts ${g.time} at ${g.place}. Let the group know if you are Going or Skipping.`,
        link: `#group-${g.id}`,
        read: false,
        createdAt: nowTs,
        actionable: true
      });
    }

    // Skipped dates for user's calendar
    const skippedDates = gAtt
      .filter(a => a.user_id === currentUserId && a.rsvp === 'skip')
      .map(a => a.session_date);

    const fullGroup = {
      ...parsedBase,
      currentSessionDate,
      lastSessionYmd,
      inRatingWindow: isInRatingWindow(parsedBase, nowTs),
      lastSessionAttendees,
      members,
      rsvp,
      arrived,
      arrivalNotes,
      welcomeBuddies,
      joinedAt,
      skippedDates,
      chat,
      previewChat,
      waitlist: gWaitlist,
      waitlistPos,
      myRating: myRatingRow ? myRatingRow.rating : null,
      membersMeta
    };

    const suggestion = computeSuggestion(fullGroup, me, friendSet);
    const distKm = computeDistanceKm(me, g.lat, g.lng);
    return {
      ...fullGroup,
      distKm: Number(distKm.toFixed(2)),
      matchScore: suggestion.score,
      matchReasons: suggestion.reasons,
      matchedInterestCount: suggestion.matchedInterestCount
    };
  });

  const visibleGroups = groups.filter(
    g => !g.friendsOnly || g.host === me.id || g.coHost === me.id || g.members.includes(me.id) || friendSet.has(g.host)
  );

  const storedNotifs = notifRows.map(n => ({
    id: n.id,
    type: n.type,
    groupId: n.group_id,
    title: n.title,
    body: n.body,
    link: n.link,
    read: Boolean(n.read),
    createdAt: n.created_at,
    actionable: false
  }));

  const notifications = [...dynamicReminders, ...storedNotifs];

  return {
    me,
    people,
    friends,
    groups: visibleGroups,
    wishes: wishRows,
    wishCounts,
    notifications
  };
}
