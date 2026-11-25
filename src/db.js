import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AREAS, CATS, KM_PER_UNIT, SEED_FRIENDS, SEED_GROUPS, SEED_PEOPLE, nextDay } from './data.js';

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
      area TEXT NOT NULL DEFAULT 'Bergheim',
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
      spot TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT '["English"]',
      cost INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 6,
      host TEXT NOT NULL,
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
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    seedDatabase(db);
  }

  // Migrate: add arrived_at if missing
  const cols = db.prepare("PRAGMA table_info(memberships)").all().map(c => c.name);
  if (!cols.includes('arrived_at')) {
    db.exec('ALTER TABLE memberships ADD COLUMN arrived_at INTEGER;');
  }

  // Migrate: add paused_until if missing (for existing DBs created before this column)
  const gcols = db.prepare("PRAGMA table_info(groups)").all().map(c => c.name);
  if (!gcols.includes('paused_until')) {
    db.exec('ALTER TABLE groups ADD COLUMN paused_until TEXT;');
  }

  return db;
}

export function seedDatabase(db) {
  db.exec(`
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
    INSERT INTO users (id, name, since, new_here, verified, area, languages, interests, availability, intro)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of SEED_PEOPLE) {
    insertUser.run(
      p.id,
      p.name,
      p.since,
      p.newHere ? 1 : 0,
      p.verified ? 1 : 0,
      p.area,
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
    INSERT INTO groups (id, name, cat, date, time, duration, weekly, desc, place, area, spot, lang, cost, size, host, friends_only, lat, lng, paused_until, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare('INSERT INTO memberships (group_id, user_id, rsvp, joined_at) VALUES (?, ?, ?, ?)');
  const insertMsg = db.prepare('INSERT INTO messages (group_id, user_id, sys, text, plan_what, plan_when, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertPlanIn = db.prepare('INSERT INTO plan_participants (message_id, user_id) VALUES (?, ?)');

  SEED_GROUPS.forEach((g, idx) => {
    const date = nextDay(g.dow, g.time);
    insertGroup.run(
      g.id, g.name, g.cat, date, g.time, g.duration, g.weekly ? 1 : 0,
      g.desc, g.place, g.area, g.spot, JSON.stringify(g.lang), g.cost, g.size,
      g.host, g.friendsOnly ? 1 : 0, g.lat, g.lng, null, now + idx
    );
    g.members.forEach((uid, mIdx) => {
      insertMember.run(g.id, uid, g.rsvp[uid] || null, now + mIdx);
    });
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

export function getUser(db, userId = 'me') {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    since: row.since,
    newHere: Boolean(row.new_here),
    verified: Boolean(row.verified),
    area: row.area,
    languages: JSON.parse(row.languages),
    interests: JSON.parse(row.interests),
    availability: JSON.parse(row.availability),
    intro: row.intro
  };
}

export function computeDistanceKm(userArea, gLat, gLng) {
  const [uLat, uLng] = AREAS[userArea] || AREAS.Bergheim;
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

  const dist = computeDistanceKm(me.area, group.lat, group.lng);
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

function getMondayTs(ts) {
  const d = new Date(ts);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function getFullState(db, currentUserId = 'me') {
  const peopleRows = db.prepare('SELECT * FROM users').all();
  const people = {};
  for (const r of peopleRows) {
    people[r.id] = {
      id: r.id,
      name: r.name,
      since: r.since,
      newHere: Boolean(r.new_here),
      verified: Boolean(r.verified),
      area: r.area,
      languages: JSON.parse(r.languages),
      interests: JSON.parse(r.interests),
      availability: JSON.parse(r.availability),
      intro: r.intro
    };
  }

  const me = people[currentUserId] || getUser(db, 'me');
  const friendRows = db.prepare('SELECT friend_id FROM friendships WHERE user_id = ?').all(me.id);
  const friends = friendRows.map(r => r.friend_id);
  const friendSet = new Set(friends);

  // Build friendsOf map for mutual friend computation
  const allFriendRows = db.prepare('SELECT user_id, friend_id FROM friendships').all();
  const friendsOf = {};
  for (const { user_id, friend_id } of allFriendRows) {
    if (!friendsOf[user_id]) friendsOf[user_id] = new Set();
    friendsOf[user_id].add(friend_id);
  }

  // Add mutualFriendCount to each person
  for (const p of Object.values(people)) {
    const theirFriends = friendsOf[p.id] || new Set();
    let count = 0;
    for (const fid of friendSet) {
      if (theirFriends.has(fid)) count++;
    }
    p.mutualFriendCount = count;
  }

  const groupRows = db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all();
  const memberRows = db.prepare('SELECT group_id, user_id, rsvp, arrived_at, joined_at FROM memberships ORDER BY joined_at ASC').all();
  const msgRows = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
  const planRows = db.prepare('SELECT message_id, user_id FROM plan_participants').all();
  const waitlistRows = db.prepare('SELECT group_id, user_id, joined_at FROM waitlist ORDER BY joined_at ASC').all();
  const ratingRows = db.prepare('SELECT group_id, user_id, week_ts, rating FROM meetup_ratings').all();
  const wishRows = db.prepare('SELECT cat, area FROM wishlist WHERE user_id = ?').all(me.id);
  const allWishRows = db.prepare('SELECT cat, area FROM wishlist').all();

  // Current week's Monday for rating lookup
  const thisWeekMonday = getMondayTs(Date.now());

  // Build ratings map for this week
  const ratingsMap = {};
  for (const r of ratingRows) {
    if (r.user_id === currentUserId && r.week_ts === thisWeekMonday) {
      ratingsMap[r.group_id] = r.rating;
    }
  }

  // Build wish counts per cat
  const wishCounts = {};
  for (const w of allWishRows) {
    wishCounts[w.cat] = (wishCounts[w.cat] || 0) + 1;
  }

  const planMap = new Map();
  for (const p of planRows) {
    if (!planMap.has(p.message_id)) planMap.set(p.message_id, []);
    planMap.get(p.message_id).push(p.user_id);
  }

  const nowTs = Date.now();

  const groups = groupRows.map(g => {
    const gMembers = memberRows.filter(m => m.group_id === g.id);
    const members = gMembers.map(m => m.user_id);
    const rsvp = {};
    const arrived = {};
    const joinedAt = {};
    for (const m of gMembers) {
      if (m.rsvp) rsvp[m.user_id] = m.rsvp;
      if (m.arrived_at) arrived[m.user_id] = m.arrived_at;
      joinedAt[m.user_id] = m.joined_at;
    }

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

    // Preview chat for non-members: last 2 non-system text messages
    const isCurrentMember = members.includes(currentUserId);
    const previewChat = isCurrentMember ? null : chat
      .filter(m => !m.sys && m.text)
      .slice(-2)
      .map(m => ({ from: m.from, text: m.text }));

    // Waitlist for this group
    const gWaitlist = waitlistRows.filter(w => w.group_id === g.id).map(w => w.user_id);
    const waitlistPosIdx = gWaitlist.indexOf(currentUserId);
    const waitlistPos = waitlistPosIdx >= 0 ? waitlistPosIdx + 1 : 0;

    // Tenure per member (weeks since joined)
    const membersMeta = gMembers.map(m => ({
      userId: m.user_id,
      weeksIn: Math.floor((nowTs - m.joined_at) / (7 * 86400000)),
      mutualFriends: (() => {
        const theirFriends = friendsOf[m.user_id] || new Set();
        let count = 0;
        for (const fid of friendSet) {
          if (theirFriends.has(fid)) count++;
        }
        return count;
      })()
    }));

    const parsed = {
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
      spot: g.spot,
      lang: JSON.parse(g.lang),
      cost: g.cost,
      size: g.size,
      host: g.host,
      friendsOnly: Boolean(g.friends_only),
      lat: g.lat,
      lng: g.lng,
      pausedUntil: g.paused_until || null,
      members,
      rsvp,
      arrived,
      joinedAt,
      chat,
      previewChat,
      waitlist: gWaitlist,
      waitlistPos,
      myRating: ratingsMap[g.id] ?? null,
      membersMeta
    };

    const suggestion = computeSuggestion(parsed, me, friendSet);
    const distKm = computeDistanceKm(me.area, g.lat, g.lng);
    return {
      ...parsed,
      distKm: Number(distKm.toFixed(2)),
      matchScore: suggestion.score,
      matchReasons: suggestion.reasons,
      matchedInterestCount: suggestion.matchedInterestCount
    };
  });

  // Hide friends-only groups from Discover unless user is host, member, or friend of host
  const visibleGroups = groups.filter(
    g => !g.friendsOnly || g.host === me.id || g.members.includes(me.id) || friendSet.has(g.host)
  );

  return {
    me,
    people,
    friends,
    groups: visibleGroups,
    wishes: wishRows,
    wishCounts
  };
}
