import { CATS, svg } from './icons.js';
import { AREAS, initDiscoverMap, initMiniMap, initLocationPicker } from './map.js';

const FAV = ['running', 'games', 'creative', 'cooking'];
const LANGS = ['English', 'German', 'Spanish', 'French', 'Turkish', 'Arabic'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AV_HUES = ['#2F80ED', '#E8590C', '#0CA678', '#D6336C', '#F08C00', '#1098AD', '#2B8A3E', '#9C6B3F'];

let state = { me: null, people: {}, friends: [], groups: [], wishes: [], wishCounts: {} };
const ui = {
  cat: 'all',
  lang: 'any',
  dist: 'any',
  sort: 'suggested',
  friendsOnly: false,
  newHereOnly: false,
  view: 'list',
  pin: null,
  leave: false,
  plan: false,
  toChat: false,
  startCat: null,
  sheetQuery: '',
  query: '',
  startLat: null,
  startLng: null,
  editLat: null,
  editLng: null,
  deleteConfirm: false,
  kickConfirm: null,
  onboarding: null
};

/* Helpers */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (d, o) => d.toLocaleDateString('en-GB', o);

function nextSession(g) {
  const d = new Date(`${g.date}T${g.time}:00`);
  const now = Date.now();
  if (g.weekly) {
    while (d.getTime() + g.duration * 60000 < now) d.setDate(d.getDate() + 7);
  }
  return d;
}

const weekdayOf = g => fmt(new Date(`${g.date}T12:00:00`), { weekday: 'long' });
const when = g => (g.weekly ? `Every ${weekdayOf(g)}` : fmt(new Date(`${g.date}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })) + ` · ${g.time}`;
const byId = id => state.groups.find(g => g.id === id);
const person = id => state.people[id] || state.me;
const isMember = g => state.me && g.members.includes(state.me.id);
const isFriend = id => state.friends.includes(id);
const langs = g => (g.lang.length > 1 ? g.lang.slice(0, -1).join(', ') + ' & ' + g.lang[g.lang.length - 1] : g.lang[0] || 'English');
const cost = g => (g.cost ? `€${g.cost} per meetup` : 'Free');
const newCount = g => g.members.filter(id => id !== state.me?.id && person(id)?.newHere).length;
const friendCount = g => g.members.filter(id => isFriend(id)).length;
const countRsvp = (g, v) => Object.entries(g.rsvp || {}).filter(([id, r]) => r === v && g.members.includes(id)).length;
const joinedGroups = () => state.groups.filter(isMember).sort((a, b) => nextSession(a) - nextSession(b));
const isPaused = g => g.pausedUntil && new Date(g.pausedUntil) > new Date();
const isOnWaitlist = g => Array.isArray(g.waitlist) && g.waitlist.includes(state.me?.id);
const getMemberMeta = (g, uid) => (g.membersMeta || []).find(m => m.userId === uid) || { weeksIn: 0, mutualFriends: 0 };

// show how long ago a message was sent, like "2m ago" or "Mon 3 Nov"
function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 7 * 86400000) return fmt(new Date(ts), { weekday: 'short' });
  return fmt(new Date(ts), { day: 'numeric', month: 'short' });
}

// --- unread tracking ---
// we just store the last seen message id per group in localStorage
function getLastSeen(groupId) {
  return parseInt(localStorage.getItem('seen-' + groupId) || '0', 10);
}
function markSeen(groupId) {
  const g = byId(groupId);
  if (!g || !g.chat.length) return;
  const lastId = g.chat[g.chat.length - 1].id;
  if (lastId > getLastSeen(groupId)) {
    localStorage.setItem('seen-' + groupId, String(lastId));
  }
}
function unreadCount(g) {
  if (!isMember(g)) return 0;
  const seen = getLastSeen(g.id);
  // only count non-system messages the current user didn't send
  return g.chat.filter(m => !m.sys && m.from !== state.me?.id && m.id > seen).length;
}

function isInRatingWindow(g) {
  const s = nextSession(g);
  const endTs = s.getTime() + g.duration * 60000;
  const now = Date.now();
  return now > endTs && (now - endTs) <= 6 * 3600000;
}

function avatar(id, cls = '') {
  const p = person(id);
  if (!p) return '';
  if (state.me && id === state.me.id) return `<span class="av me ${cls}" aria-hidden="true">You</span>`;
  const hue = AV_HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_HUES.length];
  return `<span class="av ${cls}" style="--av:${hue}" aria-hidden="true">${esc(p.name[0])}</span>`;
}

function dateBlock(d) {
  return `<span class="date-block" aria-hidden="true"><span>${fmt(d, { weekday: 'short' })}</span><strong>${d.getDate()}</strong><span>${fmt(d, { month: 'short' })}</span></span>`;
}

function calLinks(g) {
  const s = nextSession(g);
  const e = new Date(s.getTime() + g.duration * 60000);
  const f = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const iso = d => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  const loc = `${g.place}, ${g.area}, Heidelberg`;
  const details = `${g.desc}\nMeeting spot: ${g.spot}`;
  const gp = new URLSearchParams({ action: 'TEMPLATE', text: g.name, dates: `${f(s)}/${f(e)}`, ctz: 'Europe/Berlin', details, location: loc });
  if (g.weekly) gp.set('recur', 'RRULE:FREQ=WEEKLY');
  const op = new URLSearchParams({ subject: g.name, startdt: iso(s), enddt: iso(e), location: loc, body: details });
  return {
    ics: `/api/groups/${encodeURIComponent(g.id)}/calendar.ics`,
    google: 'https://calendar.google.com/calendar/render?' + gp,
    outlook: 'https://outlook.live.com/calendar/0/deeplink/compose?' + op
  };
}

/* API */
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function mergeState(res) {
  state = {
    me: res.me,
    people: res.people,
    friends: res.friends,
    groups: res.groups,
    wishes: res.wishes || [],
    wishCounts: res.wishCounts || {}
  };
}

async function loadState() {
  const res = await api('/api/state');
  mergeState(res);
  if (state.me && state.me.interests.length === 0 && state.me.availability.length === 0) {
    ui.onboarding = 1;
    renderOnboarding();
  }
  render();
}

/* Toast */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
  toastEl.textContent = msg;
  requestAnimationFrame(() => {
    toastEl.hidden = false;
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
  });
}

/* Onboarding */
const obDialog = document.getElementById('onboarding');

function renderOnboarding() {
  if (!ui.onboarding || !obDialog) return;
  const step = ui.onboarding;
  const me = state.me;
  const allInterestLabels = Object.values(CATS).map(c => c.label);

  // Update progress dots
  const dotsEl = document.getElementById('ob-dots');
  if (dotsEl) {
    dotsEl.innerHTML = [1, 2, 3].map(i => `<span class="ob-step${i <= step ? ' done' : ''}"></span>`).join('');
  }

  const titleEl = document.getElementById('ob-title');
  const bodyEl = document.getElementById('ob-body');
  const footerEl = document.getElementById('ob-footer');
  if (!titleEl || !bodyEl || !footerEl) return;

  if (step === 1) {
    titleEl.textContent = 'Welcome to Common';
    bodyEl.innerHTML = `<p class="lead" style="margin:0">Let's personalise your groups. First, where in Heidelberg are you?</p>
      <div class="field"><label for="ob-area">Your neighbourhood</label>
        <select class="input" id="ob-area">${Object.keys(AREAS).map(a => `<option${a === me.area ? ' selected' : ''}>${a}</option>`).join('')}</select>
      </div>`;
    footerEl.innerHTML = `<button type="button" class="btn btn-primary" data-act="ob-next" data-step="1">Next</button>
      <button type="button" class="btn-link" data-act="ob-skip">Skip for now</button>`;
  } else if (step === 2) {
    titleEl.textContent = 'What are you into?';
    bodyEl.innerHTML = `<p class="lead" style="margin:0">Pick anything that appeals. This helps us suggest the right groups.</p>
      <div class="toggles">${allInterestLabels.map(lbl => `<label class="toggle"><input type="checkbox" name="interests" value="${esc(lbl)}"${me.interests.includes(lbl) ? ' checked' : ''}><span>${esc(lbl)}</span></label>`).join('')}</div>`;
    footerEl.innerHTML = `<button type="button" class="btn btn-primary" data-act="ob-next" data-step="2">Next</button>
      <button type="button" class="btn-link" data-act="ob-skip">Skip for now</button>`;
  } else {
    titleEl.textContent = 'When are you free?';
    bodyEl.innerHTML = `<p class="lead" style="margin:0">Which days can you usually make it to a meetup?</p>
      <div class="toggles">${DAYS.map((d, idx) => `<label class="toggle"><input type="checkbox" name="availability" value="${idx}"${me.availability.includes(idx) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div>`;
    footerEl.innerHTML = `<button type="button" class="btn btn-primary" data-act="ob-next" data-step="3">Show me groups</button>`;
  }

  if (!obDialog.open) obDialog.showModal();
}

/* Views */
function cardHTML(g, preview = false) {
  const c = CATS[g.cat];
  const nn = newCount(g);
  const fc = friendCount(g);
  const tag = preview ? 'div' : 'a';
  const status = isMember(g) ? `<span class="joined">${svg('check', 14)}${g.host === state.me?.id ? 'Hosting' : 'Joined'}</span>` : '';
  const topBadge = g.friendsOnly
    ? `<span class="badge-friend">${svg('heart', 12)}Friends only</span>`
    : fc > 0
      ? `<span class="badge-friend">${fc} ${fc === 1 ? 'friend' : 'friends'}</span>`
      : nn ? `<span class="badge-new">${nn} new here</span>` : '';

  let matchLabel = '';
  if (g.matchedInterestCount > 1) {
    matchLabel = `${g.matchedInterestCount} interests match`;
  } else if (g.matchReasons?.length) {
    matchLabel = g.matchReasons[0];
  }
  const reasonLine = !preview && matchLabel
    ? `<div class="tags"><span class="match-tag">${svg('spark', 12)}${esc(matchLabel)}</span></div>`
    : '';

  return `<${tag} class="card"${preview ? '' : ` href="#group-${g.id}"`} style="--cat:${c.hue}">
    <div class="gc-top"><span class="cat-tile">${svg(g.cat, 20)}</span><span class="gc-cat"><span>${c.label}</span><span class="muted">${g.distKm.toFixed(1)} km away</span></span>${topBadge}</div>
    <h3>${esc(g.name)}</h3>
    ${reasonLine}
    <ul class="facts-mini"><li>${svg('clock', 16)}${esc(when(g))}</li><li>${svg('pin', 16)}${esc(g.place)}, ${esc(g.area)}</li></ul>
    <div class="tags"><span class="tag">${svg('globe', 14)}${esc(langs(g))}</span><span class="tag">${esc(cost(g))}</span></div>
    <div class="gc-foot"><span class="stack">${g.members.slice(0, 4).map(id => avatar(id)).join('')}</span><span class="muted">${g.members.length} of ${g.size} places taken</span>${status}</div>
  </${tag}>`;
}

function filtered() {
  const q = ui.query.trim().toLowerCase();
  const list = state.groups.filter(g =>
    (ui.cat === 'all' || g.cat === ui.cat) &&
    (ui.lang === 'any' || g.lang.includes(ui.lang)) &&
    (ui.dist === 'any' || g.distKm <= Number(ui.dist)) &&
    (!ui.friendsOnly || g.friendsOnly || friendCount(g) > 0) &&
    (!ui.newHereOnly || newCount(g) > 0) &&
    (!q || g.name.toLowerCase().includes(q) || g.place.toLowerCase().includes(q) || g.desc.toLowerCase().includes(q))
  );
  if (ui.sort === 'suggested') {
    return list.sort((a, b) => (b.matchScore - a.matchScore) || (a.distKm - b.distKm));
  }
  return list.sort((a, b) => a.distKm - b.distKm);
}

function chip(val, label, icon) {
  return `<button type="button" class="chip" data-act="cat" data-val="${val}" data-key="cat-${val}" aria-pressed="${ui.cat === val}">${icon ? svg(icon, 16) : ''}${label}</button>`;
}

function discoverView() {
  const list = filtered();
  const mine = joinedGroups();
  const extra = ui.cat !== 'all' && !FAV.includes(ui.cat) ? chip(ui.cat, CATS[ui.cat].label, ui.cat) : '';
  const opts = (arr, cur) => arr.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');

  const toolbar = `<div class="toolbar">
    <div class="chips" role="group" aria-label="Activity">
      ${chip('all', 'All')}
      ${FAV.map(k => chip(k, CATS[k].label, k)).join('')}
      ${extra}
      <button type="button" class="chip" data-act="more" data-key="more" aria-haspopup="dialog">${svg('grid', 16)}More activities</button>
      <button type="button" class="chip" data-act="toggle-friends" data-key="f-friends" aria-pressed="${ui.friendsOnly}">${svg('heart', 15)}Friends</button>
      <button type="button" class="chip" data-act="toggle-new-here" data-key="f-new-here" aria-pressed="${ui.newHereOnly}">${svg('spark', 15)}New here</button>
    </div>
    <div class="tools">
      <label class="search-wrap sr-only-label"><span class="sr-only">Search groups</span><input type="search" id="f-search" class="input search-input" placeholder="Search groups…" value="${esc(ui.query)}" data-key="f-search" autocomplete="off"></label>
      <label class="select"><span class="sr-only">Sort</span><select id="f-sort" data-filter="sort" data-key="f-sort">${opts([['suggested', 'Suggested for you'], ['closest', 'Closest first']], ui.sort)}</select></label>
      <label class="select"><span class="sr-only">Language</span><select id="f-lang" data-filter="lang" data-key="f-lang">${opts([['any', 'Any language'], ...LANGS.map(l => [l, l])], ui.lang)}</select></label>
      <label class="select"><span class="sr-only">Distance</span><select id="f-dist" data-filter="dist" data-key="f-dist">${opts([['any', 'Any distance'], ['1', 'Within 1 km'], ['2', 'Within 2 km'], ['3', 'Within 3 km']], ui.dist)}</select></label>
      <div class="seg" role="group" aria-label="Show as"><button type="button" data-act="view" data-val="list" data-key="v-list" aria-pressed="${ui.view === 'list'}">${svg('list', 16)}List</button><button type="button" data-act="view" data-val="map" data-key="v-map" aria-pressed="${ui.view === 'map'}">${svg('map', 16)}Map</button></div>
    </div>
  </div>`;

  const line = `<div class="result-line"><span>${list.length} ${list.length === 1 ? 'group' : 'groups'}${ui.cat !== 'all' ? ' for ' + CATS[ui.cat].label.toLowerCase() : ''} · ${ui.sort === 'suggested' ? 'ranked by your interests & availability' : 'closest to ' + esc(state.me.area)}</span></div>`;

  const wishKey = ui.cat;
  const wishCount = ui.cat !== 'all' ? (state.wishCounts?.[wishKey] || 0) : 0;
  const myWish = ui.cat !== 'all' && state.wishes?.some(w => w.cat === wishKey && w.area === 'any');
  const wishBtn = ui.cat !== 'all'
    ? `<button type="button" class="btn ${myWish ? 'btn-going' : 'btn-secondary'}" data-act="wish" data-cat="${ui.cat}" data-area="any">${svg('heart', 16)}${myWish ? 'Wished for' : 'Wish for this'}${wishCount > 0 ? ` · ${wishCount}` : ''}</button>`
    : '';

  const empty = `<div class="panel empty"><h2>No groups match yet</h2><p class="muted">Try another language, turn off the friends filter, or widen the distance. Or start the group you were looking for.</p><div class="actions"><button type="button" class="btn btn-secondary" data-act="clear">Clear filters</button><a class="btn btn-primary" href="#start-group" data-act="start-with">${svg('plus', 16)}Start a group</a>${wishBtn}</div></div>`;

  let body;
  const youCoords = AREAS[state.me?.area] || AREAS.Bergheim;
  if (ui.view === 'map') {
    if (!list.some(g => g.id === ui.pin)) ui.pin = list[0] ? list[0].id : null;
    body = `${line}<div class="map-layout">
      <div id="leaflet-map" class="leaflet-container-wrap" style="height:480px;border-radius:var(--r-lg);border:1px solid var(--line);overflow:hidden;"></div>
      <div class="map-list">${list.length ? list.map(g => `<button type="button" class="row-btn" data-act="pin" data-id="${g.id}" data-key="row-${g.id}" aria-pressed="${g.id === ui.pin}" style="--cat:${CATS[g.cat].hue}"><span class="cat-tile">${svg(g.cat, 20)}</span><span class="rb-text"><strong>${esc(g.name)}</strong><span class="muted">${esc(when(g))} · ${g.distKm.toFixed(1)} km</span></span></button>`).join('') : empty}</div></div>`;
  } else {
    const next = mine[0];
    const side = next
      ? `<section class="panel next-card" aria-labelledby="next-h"><h2 id="next-h">Coming up</h2><p class="when">${esc(fmt(nextSession(next), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${next.time}</p><p>${esc(next.name)}<br><span class="muted">${esc(next.place)}, ${esc(next.area)}</span></p><a class="btn btn-secondary" href="#my-groups">See your week</a></section>`
      : `<section class="panel" aria-labelledby="how-h"><h2 id="how-h">How it works</h2><ol class="steps"><li>Find a small group near you that meets every week.</li><li>Join and say hello in the group chat.</li><li>Each week, tap Going or Skip. Skipping keeps your place.</li><li>Add familiar faces as friends and keep showing up.</li></ol></section>`;
    const profileCard = `<section class="panel next-card" aria-labelledby="prof-h"><h2 id="prof-h">Your suggestions</h2><p class="muted">Tailored for <strong>${esc(state.me.name)}</strong> in ${esc(state.me.area)} (${state.me.interests.slice(0, 3).map(esc).join(', ') || 'all interests'}).</p><a class="btn btn-secondary btn-sm" href="#profile">Edit interests &amp; availability</a></section>`;
    body = `<div class="discover"><div>${line}${list.length ? `<div class="results">${list.map(g => cardHTML(g)).join('')}</div>` : empty}</div><aside class="side">${side}${profileCard}</aside></div>`;
  }

  return `<div class="page-head"><h1 tabindex="-1">Find your people in Heidelberg</h1><p class="lead">Small groups that meet every week, so new faces become familiar ones.</p></div>${toolbar}${body}`;
}

function msgHTML(m, g) {
  if (m.sys) return `<li class="msg-sys">${esc(m.text)}</li>`;
  const p = person(m.from);
  if (!p) return '';
  const me = m.from === state.me.id;
  const timeStr = m.ts ? `<span class="msg-time">${relTime(m.ts)}</span>` : '';
  const who = me ? '' : `<div class="msg-name">${esc(p.name)}${m.from === g.host ? ' · host' : ''}</div>`;
  if (m.plan) {
    const ins = Array.isArray(m.ins) ? m.ins.filter(id => g.members.includes(id)) : [];
    const mine = ins.includes(state.me.id);
    return `<li class="msg${me ? ' msg-me' : ''}">${me ? '' : avatar(m.from)}<div>${who}<div class="plan"><span class="plan-k">${svg('spark', 14)}Extra plan</span><strong>${esc(m.plan.what)}</strong><span class="muted">${esc(m.plan.when)}</span>
      <div class="plan-foot"><span class="stack">${ins.map(id => avatar(id)).join('')}</span><span class="muted">${ins.length} in</span><button type="button" class="btn btn-sm ${mine ? 'btn-going' : 'btn-secondary'}" data-act="plan-in" data-id="${g.id}" data-mid="${m.id}" data-key="plan-${m.id}" aria-pressed="${mine}">${mine ? svg('check', 14) : ''}I'm in</button></div></div>${timeStr}</div></li>`;
  }
  return `<li class="msg${me ? ' msg-me' : ''}">${me ? '' : avatar(m.from)}<div>${who}<div class="bubble">${esc(m.text)}</div>${timeStr}</div></li>`;
}

function isNearMeetup(g) {
  const s = nextSession(g);
  const now = Date.now();
  const diff = s.getTime() - now;
  return diff <= 2 * 3600 * 1000 && diff >= -3 * 3600 * 1000;
}

function groupView(g) {
  const c = CATS[g.cat];
  const member = isMember(g);
  const host = person(g.host);
  const full = g.members.length >= g.size;
  const nn = newCount(g);
  const s = nextSession(g);
  const my = g.rsvp[state.me.id];
  const going = countRsvp(g, 'going');
  const skip = countRsvp(g, 'skip');
  const youCoords = AREAS[state.me?.area] || AREAS.Bergheim;
  const onWl = isOnWaitlist(g);

  const pauseBanner = isPaused(g)
    ? `<div class="pause-banner" role="alert"><strong>Group on pause until ${esc(fmt(new Date(g.pausedUntil), { weekday: 'long', day: 'numeric', month: 'long' }))}</strong><span class="muted">The host has paused this group for 2 weeks.</span></div>`
    : '';

  const head = `<section class="panel g-head" style="--cat:${c.hue}">
    <div class="g-title"><span class="cat-tile lg">${svg(g.cat, 28)}</span><div><p class="g-kicker">${c.label} · ${g.distKm.toFixed(1)} km from you</p><h1 tabindex="-1">${esc(g.name)}</h1></div></div>
    <p class="g-desc">${esc(g.desc)}</p>
    <div class="tags"><span class="tag">${svg('clock', 14)}${esc(when(g))}</span><span class="tag">${svg('globe', 14)}${esc(langs(g))}</span><span class="tag">${svg('euro', 14)}${esc(cost(g))}</span>${g.friendsOnly ? `<span class="badge-friend">${svg('heart', 12)}Friends only</span>` : ''}${nn ? `<span class="badge-new">${nn} new here</span>` : ''}</div>
  </section>`;

  const links = calLinks(g);
  const nearMeetup = isNearMeetup(g);
  const arrivedIds = Object.keys(g.arrived || {}).filter(id => g.members.includes(id));
  const iAmHere = arrivedIds.includes(state.me.id);

  const arrivalBlock = nearMeetup
    ? `<div class="arrival-block" aria-live="polite">
        <div class="h-row" style="margin-bottom:10px"><h3 style="font-size:15px">Who's at the spot?</h3></div>
        <div class="arrival-row">
          <button type="button" class="btn ${iAmHere ? 'btn-going' : 'btn-primary'} btn-sm" data-act="arrive" data-id="${g.id}" data-key="arrive-btn">
            ${svg('pin', 16)}${iAmHere ? 'You\'re here' : 'I\'m here'}
          </button>
          ${arrivedIds.length > 0
            ? `<span class="arrival-who"><span class="stack">${arrivedIds.map(id => avatar(id)).join('')}</span><span class="muted">${arrivedIds.length === 1 ? person(arrivedIds[0])?.name + ' is here' : arrivedIds.length + ' people are here'}</span></span>`
            : '<span class="muted" style="font-size:14px">No one has checked in yet</span>'}
        </div>
        <p class="note">Tap when you arrive so others can spot you.</p>
      </div>`
    : `<div class="arrival-block arrival-upcoming">
        <div class="h-row" style="margin-bottom:6px"><h3 style="font-size:15px">Who's at the spot?</h3><span class="muted" style="font-size:13px">Shows on the day</span></div>
        <p class="note">When it's time to meet, tap here so others can spot you at ${esc(g.spot.split(',')[0])}.</p>
      </div>`;

  // Post-meetup rating block
  const ratingBlock = (() => {
    if (!member) return '';
    const inWindow = isInRatingWindow(g);
    if (!inWindow && g.myRating === null) return '';
    if (g.myRating !== null) {
      return `<div class="rating-block"><div class="rating-recorded"><span>You rated this meetup</span><span class="rating-emoji">${g.myRating === 1 ? '👍' : '👎'}</span></div></div>`;
    }
    return `<div class="rating-block" aria-labelledby="rate-q">
      <p class="q" id="rate-q">How was it?</p>
      <div class="rating-btns">
        <button type="button" class="btn btn-secondary" data-act="rate" data-id="${g.id}" data-val="1" data-key="rate-up">${svg('check', 16)} Great</button>
        <button type="button" class="btn btn-secondary" data-act="rate" data-id="${g.id}" data-val="-1" data-key="rate-down">Could be better</button>
      </div>
    </div>`;
  })();

  const act = member
    ? `<section class="panel g-act" aria-labelledby="act-h">
        <div class="act-head"><div><h2 id="act-h">Next meetup</h2><p class="big-date">${esc(fmt(s, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${g.time}</p><p class="muted">${g.duration} min · ${esc(g.place)}, ${esc(g.area)}</p></div>${g.host === state.me.id ? "<span class=\"pill pill-going\">You're hosting</span>" : ''}</div>
        <div class="spot">${svg('pin', 18)}<span><strong>Meeting spot</strong><br>${esc(g.spot)}</span></div>
        <p class="q" id="rsvp-q">Are you coming this week?</p>
        <div class="seg seg-rsvp" role="group" aria-labelledby="rsvp-q"><button type="button" data-act="rsvp" data-id="${g.id}" data-val="going" data-key="rsvp-going" aria-pressed="${my === 'going'}">${svg('check', 16)}Going</button><button type="button" data-act="rsvp" data-id="${g.id}" data-val="skip" data-key="rsvp-skip" aria-pressed="${my === 'skip'}">Skip this week</button></div>
        <p class="note">${going} going${skip ? ` · ${skip} skipping` : ''}. Skipping keeps your place in the group.</p>
        <div class="cal-links"><span>Add recurring invite:</span><a class="btn btn-secondary btn-sm" href="${links.ics}" download>${svg('download', 14)}Download .ics</a><a href="${links.google}" target="_blank" rel="noopener">Google Calendar</a><a href="${links.outlook}" target="_blank" rel="noopener">Outlook</a></div>
        ${arrivalBlock}
        ${ratingBlock}
        ${g.host === state.me.id ? `<div class="host-actions">
          <a class="btn btn-secondary btn-sm" href="#edit-group-${g.id}">${svg('check', 14)}Edit group</a>
          <button type="button" class="btn btn-secondary btn-sm" data-act="pause" data-id="${g.id}" data-key="pause-btn">${svg('clock', 14)}${isPaused(g) ? 'Resume group' : 'Pause for 2 weeks'}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="transfer" data-id="${g.id}" data-key="transfer-btn">${svg('users', 14)}Transfer hosting</button>
        </div>` : ''}
      </section>`
    : `<section class="panel g-act" aria-labelledby="act-h">
        <h2 id="act-h">${full ? (onWl ? 'On the waitlist' : 'This group is full') : 'Join this group'}</h2>
        <div class="places"><span class="stack">${g.members.map(id => avatar(id)).join('')}</span><span><strong>${g.members.length} of ${g.size}</strong> places taken</span>${nn ? `<span class="badge-new">${nn} new here</span>` : ''}</div>
        ${(() => {
          const goingNewcomers = g.members.filter(id => g.rsvp[id] === 'going' && id !== state.me?.id && person(id)?.newHere);
          return goingNewcomers.length > 0
            ? `<p class="note" style="margin-top:10px">${svg('spark', 13)} ${goingNewcomers.length === 1 ? person(goingNewcomers[0]).name + ' is new here too and coming this week.' : goingNewcomers.length + ' people new here are coming this week.'}</p>`
            : '';
        })()}
        ${full
          ? `<div class="join-row"><button type="button" class="btn ${onWl ? 'btn-going' : 'btn-secondary'}" data-act="waitlist" data-id="${g.id}" data-key="waitlist-btn">${onWl ? svg('check', 16) + `On waitlist (position ${g.waitlistPos})` : svg('users', 16) + `Join waitlist${g.waitlist?.length > 0 ? ` · ${g.waitlist.length} waiting` : ''}`}</button><span class="note" style="margin:0">We'll notify you when a spot opens up.</span></div>`
          : `<div class="join-row"><button type="button" class="btn btn-primary" data-act="join" data-id="${g.id}" data-key="join">Join group</button><span class="note" style="margin:0">You can skip any week without leaving.</span></div>`
        }
      </section>`;

  const mini = `<div id="leaflet-mini-${g.id}" style="height:200px;border-radius:var(--r-md);border:1px solid var(--line);overflow:hidden;margin-top:16px;"></div>`;
  const side = `<aside class="g-side">
    <section class="panel" aria-labelledby="det-h"><h2 id="det-h">Details</h2>
      <dl class="facts">
        <dt>${svg('clock', 16)}When</dt><dd>${esc(when(g))}<small>${g.duration} minutes${g.weekly ? ', every week' : ''}</small></dd>
        <dt>${svg('pin', 16)}Where</dt><dd>${esc(g.place)}<small>${esc(g.area)} · ${g.distKm.toFixed(1)} km from you</small></dd>
        <dt>${svg('globe', 16)}Language</dt><dd>${esc(langs(g))}</dd>
        <dt>${svg('euro', 16)}Cost</dt><dd>${esc(cost(g))}${g.cost ? '<small>Paid to the host on the day</small>' : ''}</dd>
        <dt>${svg('users', 16)}Size</dt><dd>Up to ${g.size} people</dd>
      </dl>${mini}
    </section>
    <section class="panel" aria-labelledby="host-h"><h2 id="host-h">Host</h2>
      <div class="host">${avatar(g.host, 'lg')}<div><p><strong>${esc(host.name)}</strong> ${host.verified ? `<span class="badge-verified">${svg('shield', 12)}Verified</span>` : ''}<br><span class="muted">${esc(host.since)}</span></p>${host.intro ? `<p>${esc(host.intro)}</p>` : ''}</div></div>
    </section>
    <section class="panel" aria-labelledby="mem-h"><div class="h-row"><h2 id="mem-h">Members</h2><span class="muted">${g.members.length} of ${g.size}</span></div>
      <ul class="members">${g.members.map(id => {
        const p = person(id);
        if (!p) return '';
        const r = g.rsvp[id];
        const meta = getMemberMeta(g, id);
        const isHostViewing = g.host === state.me.id;
        const canKick = isHostViewing && id !== state.me.id;
        const streakLabel = meta.weeksIn >= 2 ? `<span class="streak-label">Wk ${meta.weeksIn}</span>` : '';
        const kickBtn = canKick && ui.kickConfirm !== id
          ? `<button type="button" class="btn btn-secondary btn-sm" data-act="kick" data-id="${g.id}" data-uid="${id}" data-key="kick-${id}">Remove</button>`
          : '';
        const kickConfirmUI = canKick && ui.kickConfirm === id
          ? `<span class="kick-confirm"><button type="button" class="btn btn-secondary btn-sm" data-act="kick-cancel" data-key="kick-cancel-${id}">Keep</button><button type="button" class="btn btn-primary btn-sm" data-act="kick-confirm" data-id="${g.id}" data-uid="${id}" data-key="kick-yes-${id}">Remove</button></span>`
          : '';
        return `<li class="member"><button type="button" class="member-btn" data-act="profile" data-uid="${id}">${avatar(id)}<span class="member-text"><strong>${esc(p.name)}${p.verified ? `<span class="badge-verified">${svg('shield', 11)}Verified</span>` : ''}${isFriend(id) ? '<span class="badge-friend">Friend</span>' : ''}${id === g.host ? '<span class="muted" style="font-weight:500;font-size:13px">· Host</span>' : ''}</strong><span>${esc(p.since)}${p.interests.length ? ' · ' + esc(p.interests.join(', ')) : ''}</span></span>${streakLabel}</button>${p.newHere && id !== state.me.id ? '<span class="badge-new">New here</span>' : ''}${member && r === 'going' ? `<span class="pill pill-going">${svg('check', 12)}Going</span>` : ''}${kickBtn}${kickConfirmUI}</li>`;
      }).join('')}</ul>
    </section>
  </aside>`;

  // Preview chat for non-members
  const previewChatHtml = !member && g.previewChat?.length
    ? `<div class="chat-preview-wrap" aria-hidden="true"><div class="chat-preview">${g.previewChat.map(m => {
        const p = person(m.from);
        return `<div class="preview-msg"><span class="pm-name">${esc(p?.name || '...')}</span><span class="pm-text">${esc(m.text)}</span></div>`;
      }).join('')}</div></div>`
    : '';

  const chat = member
    ? `<section class="panel g-chat" id="chat" aria-labelledby="chat-h">
        <div class="h-row"><h2 id="chat-h">Group chat</h2><span class="muted">Members only</span></div>
        <ol class="chat-list" id="chat-list" aria-label="Messages">${g.chat.map(m => msgHTML(m, g)).join('')}</ol>
        <form class="composer" id="chat-form" data-id="${g.id}" autocomplete="off"><label class="sr-only" for="chat-input">Message</label><input type="text" id="chat-input" name="text" maxlength="400" placeholder="Say hello or ask a question" data-key="chat-input" required><button class="btn btn-primary" type="submit" aria-label="Send message">${svg('send', 18)}</button></form>
        ${ui.plan
          ? `<form class="plan-form" id="plan-form" data-id="${g.id}" autocomplete="off"><div class="field"><label for="plan-what">What do you want to do?</label><input type="text" id="plan-what" name="what" maxlength="80" placeholder="Christmas market after the run" data-key="plan-what" required></div><div class="field"><label for="plan-when">When?</label><input type="text" id="plan-when" name="when" maxlength="40" placeholder="Saturday, 16:00" data-key="plan-when" required></div><div class="pf-actions"><button class="btn btn-primary btn-sm" type="submit">Share plan</button><button class="btn btn-secondary btn-sm" type="button" data-act="plan-toggle">Cancel</button></div></form>`
          : `<div class="chat-tools"><span class="note" style="margin:0">Want to meet outside the weekly slot?</span><button type="button" class="btn btn-secondary btn-sm" data-act="plan-toggle" data-key="plan-open">${svg('spark', 16)}Suggest an extra plan</button></div>`}
      </section>`
    : `<section class="panel g-chat" id="chat" aria-labelledby="chat-h"><h2 id="chat-h">Group chat</h2>${previewChatHtml}<div class="locked">${svg('lock', 20)}<span>Join to read the chat, see the exact meeting spot and say hello before your first meetup.</span></div></section>`;

  let leave = '';
  if (member && g.host !== state.me.id) {
    leave = ui.leave
      ? `<div class="g-leave"><div class="confirm" role="group" aria-labelledby="leave-q"><p id="leave-q">Leave ${esc(g.name)}? You can join again later if there is a free place.</p><button type="button" class="btn btn-primary btn-sm" data-act="leave-confirm" data-id="${g.id}" data-key="leave-yes">Leave group</button><button type="button" class="btn btn-secondary btn-sm" data-act="leave-cancel" data-key="leave-no">Stay</button></div></div>`
      : `<div class="g-leave"><button type="button" class="btn-link" data-act="leave" data-key="leave">Leave group</button></div>`;
  }

  const deleteSection = g.host === state.me.id
    ? (ui.deleteConfirm
      ? `<div class="g-leave"><div class="confirm" role="group" aria-labelledby="del-q"><p id="del-q">Delete <strong>${esc(g.name)}</strong>? This cannot be undone — all members will lose access.</p><button type="button" class="btn btn-primary btn-sm" data-act="delete-confirm" data-id="${g.id}" data-key="delete-yes">Delete group</button><button type="button" class="btn btn-secondary btn-sm" data-act="delete-cancel" data-key="delete-no">Cancel</button></div></div>`
      : `<div class="g-leave"><button type="button" class="btn-link" data-act="delete-group" data-id="${g.id}" data-key="delete-group">Delete group</button></div>`)
    : '';

  return `<a class="back" href="#discover">${svg('back', 18)}All groups</a>${pauseBanner}<div class="group-layout">${head}${act}${side}${chat}${leave}${deleteSection}</div>`;
}

function rsvpSeg(g, small) {
  const my = g.rsvp[state.me.id];
  return `<div class="seg seg-rsvp${small ? ' seg-sm' : ''}" role="group" aria-label="Are you coming to ${esc(g.name)}?"><button type="button" data-act="rsvp" data-id="${g.id}" data-val="going" data-key="h-${g.id}-going" aria-pressed="${my === 'going'}">${svg('check', 14)}Going</button><button type="button" data-act="rsvp" data-id="${g.id}" data-val="skip" data-key="h-${g.id}-skip" aria-pressed="${my === 'skip'}">Skip this week</button></div>`;
}

const emptyMine = `<div class="panel empty" style="margin-top:24px"><h2>You haven't joined a group yet</h2><p class="muted">Join one that fits your week. Your meetups and who's coming will show up here.</p><div class="actions"><a class="btn btn-primary" href="#discover">Find a group</a><a class="btn btn-secondary" href="#start-group">Start a group</a></div></div>`;

function myGroupsView() {
  const mine = joinedGroups();
  const cards = mine.map(g => {
    const s = nextSession(g);
    const goers = g.members.filter(id => g.rsvp[id] === 'going');
    const host = person(g.host);
    const unread = unreadCount(g);
    return `<article class="panel hub-card" style="--cat:${CATS[g.cat].hue}">
      ${dateBlock(s)}
      <div class="hub-main">
        <h2><a href="#group-${g.id}">${esc(g.name)}</a></h2>
        <p class="muted">${fmt(s, { weekday: 'long' })} · ${g.time} · ${esc(g.place)}, ${esc(g.area)}</p>
        <div class="spot">${svg('pin', 18)}<span>${esc(g.spot)}<br><span class="muted">${g.host === state.me.id ? 'Your note for members' : esc(host.name) + ', host'}</span></span></div>
        <div class="hub-row">${rsvpSeg(g, true)}<span class="going-line"><span class="stack">${goers.slice(0, 5).map(id => avatar(id)).join('')}</span>${goers.length} going</span></div>
      </div>
      <div class="hub-actions"><a class="btn btn-secondary btn-sm" href="#group-${g.id}" data-act="open-chat">${svg('chat', 16)}${unread ? `<span class="unread-dot">${unread}</span>` : ''}Chat</a><a class="btn btn-secondary btn-sm" href="#group-${g.id}">Group page</a></div>
    </article>`;
  }).join('');

  // Waitlisted groups
  const waitlisted = state.groups.filter(g => !isMember(g) && isOnWaitlist(g));
  const waitlistSection = waitlisted.length
    ? `<section class="panel waitlist-section" aria-labelledby="wl-h">
        <div class="h-row"><h2 id="wl-h">On the waitlist</h2><span class="muted">${waitlisted.length} group${waitlisted.length > 1 ? 's' : ''}</span></div>
        <ul class="members">${waitlisted.map(g => {
          const pos = g.waitlistPos;
          return `<li class="member"><a href="#group-${g.id}" class="member-btn" style="--cat:${CATS[g.cat].hue}"><span class="cat-tile">${svg(g.cat, 20)}</span><span class="member-text"><strong>${esc(g.name)}</strong><span class="muted waitlist-pos">${esc(when(g))} · Position ${pos} of ${g.waitlist.length}</span></span></a><button type="button" class="btn btn-secondary btn-sm" data-act="waitlist" data-id="${g.id}">Leave</button></li>`;
        }).join('')}</ul>
      </section>`
    : '';

  return `<div class="page-head"><h1 tabindex="-1">Your week</h1><p class="lead">Who's coming to your next meetups, and where to find them.</p></div>${mine.length ? `<div class="hub">${cards}</div>` : emptyMine}${waitlistSection}`;
}

function calendarView() {
  const mine = joinedGroups();
  const horizon = Date.now() + 21 * 864e5;
  const rows = [];
  mine.forEach(g => {
    const d = nextSession(g);
    let i = 0;
    do {
      rows.push({ g, d: new Date(d), first: i === 0 });
      d.setDate(d.getDate() + 7);
      i++;
    } while (g.weekly && d.getTime() < horizon);
  });
  rows.sort((a, b) => a.d - b.d);

  const status = (g, first) => {
    if (!first) return '';
    const r = g.rsvp[state.me.id];
    return r === 'going' ? `<span class="pill pill-going">${svg('check', 12)}Going</span>` : r === 'skip' ? '<span class="pill pill-skip">Skipping</span>' : '<span class="pill pill-open">Not answered</span>';
  };

  const list = rows.map(({ g, d, first }) => {
    const links = calLinks(g);
    return `<div class="agenda-row">${dateBlock(d)}<span class="agenda-text"><a href="#group-${g.id}">${esc(g.name)}</a>${g.time} · ${g.duration} min · ${esc(g.place)}</span><span class="agenda-end">${status(g, first)}${first ? `<span class="cal-links" style="margin-top:0"><a href="${links.ics}" download>Download .ics</a><a href="${links.google}" target="_blank" rel="noopener">Google</a></span>` : ''}</span></div>`;
  }).join('');

  return `<div class="page-head"><h1 tabindex="-1">Calendar</h1><p class="lead">The next three weeks with your groups. Download a weekly .ics invite or add to Google Calendar.</p></div>${mine.length ? `<div class="panel agenda">${list}</div>` : emptyMine}`;
}

function startView() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const cat = ui.startCat || 'coffee';
  ui.startCat = null;
  return `<div class="page-head"><h1 tabindex="-1">Start a group</h1><p class="lead">Pick something you'd enjoy every week. Keep it small so names stick.</p></div>
  <div class="form-layout">
    <form id="start-form" novalidate>
      <fieldset><legend>What you'll do</legend>
        <div class="field"><label for="s-name">Group name</label><input type="text" id="s-name" name="name" maxlength="60" placeholder="Friday coffee and a walk" required></div>
        <div class="field"><label for="s-cat">Activity</label><select class="input" id="s-cat" name="cat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${c.label}</option>`).join('')}</select></div>
        <div class="field"><label for="s-desc">A line about it <span class="hint">(optional)</span></label><textarea id="s-desc" name="desc" maxlength="200" placeholder="What will you do together? Help a newcomer picture it."></textarea></div>
      </fieldset>
      <fieldset><legend>When</legend>
        <div class="row2"><div class="field"><label for="s-date">First meetup</label><input type="date" id="s-date" name="date" min="${ymd(new Date())}" value="${ymd(t)}" required></div><div class="field"><label for="s-time">Start time</label><input type="time" id="s-time" name="time" value="18:00" required></div></div>
        <div class="row2"><div class="field"><label for="s-dur">How long</label><select class="input" id="s-dur" name="duration">${[30, 45, 60, 90, 120].map(m => `<option value="${m}"${m === 60 ? ' selected' : ''}>${m} minutes</option>`).join('')}</select></div>
        <div class="field"><span class="label">Repeat</span><label class="check-row" for="s-weekly"><input type="checkbox" id="s-weekly" name="weekly" checked>Every week, same time</label></div></div>
      </fieldset>
      <fieldset><legend>Where</legend>
        <div class="field"><label for="s-place">Meeting place name</label><input type="text" id="s-place" name="place" maxlength="60" placeholder="Café Central" required autocomplete="off"></div>
        <div class="loc-search-row"><input type="text" id="s-loc-search" class="input" placeholder="Search for the address or place…" autocomplete="off"><button type="button" id="s-loc-btn" class="btn btn-secondary">Search</button></div>
        <ul id="s-loc-results" class="loc-results" hidden></ul>
        <div id="s-loc-map" style="height:240px;border-radius:var(--r-md);border:1px solid var(--line);overflow:hidden;margin:8px 0 4px;"></div>
        <p class="hint">Type an address or click the map to pin the exact spot.</p>
        <input type="hidden" id="s-lat" name="lat">
        <input type="hidden" id="s-lng" name="lng">
        <div class="field"><label for="s-spot">How will people find you? <span class="hint">(optional)</span></label><input type="text" id="s-spot" name="spot" maxlength="90" placeholder="At the wooden table by the entrance"><span class="hint">Members see this after they join.</span></div>
      </fieldset>
      <fieldset><legend>Who it's for</legend>
        <div class="field"><span class="label" id="lang-l">Languages spoken</span><div class="toggles" role="group" aria-labelledby="lang-l">${LANGS.map(l => `<label class="toggle"><input type="checkbox" name="lang" value="${l}"${l === 'English' ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <div class="row2"><div class="field"><span class="label" id="cost-l">Cost</span><div class="toggles" role="radiogroup" aria-labelledby="cost-l"><label class="toggle"><input type="radio" name="cost" value="free" checked><span>Free</span></label><label class="toggle"><input type="radio" name="cost" value="paid"><span>Small cost</span></label></div></div>
        <div class="field" id="amount-wrap" hidden><label for="s-amount">Euros per meetup</label><input type="number" id="s-amount" name="amount" min="1" max="50" step="1" value="5"></div></div>
        <div class="field"><label for="s-size">Group size, including you</label><select class="input" id="s-size" name="size">${[3, 4, 5, 6, 7, 8].map(n => `<option value="${n}"${n === 6 ? ' selected' : ''}>${n} people</option>`).join('')}</select><span class="hint">Enough for a conversation, small enough to remember names.</span></div>
        <div class="field"><label class="check-row" for="s-friends-only"><input type="checkbox" id="s-friends-only" name="friendsOnly">Friends-only (only visible to people you've connected with)</label></div>
      </fieldset>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${svg('plus', 16)}Start group</button><a class="btn btn-secondary" href="#discover">Cancel</a></div>
    </form>
    <div class="preview-col"><span class="label">Preview</span><div id="preview"></div><p class="hint">This is how your group shows up in Discover.</p></div>
  </div>`;
}

function profileView() {
  const me = state.me;
  const allInterestLabels = Object.values(CATS).map(c => c.label);
  const friendList = state.friends.map(id => person(id)).filter(Boolean);

  return `<div class="page-head"><h1 tabindex="-1">Your profile</h1><p class="lead">Used to personalise group suggestions and help others get to know you before you meet.</p></div>
  <div class="profile-layout">
    <form id="profile-form">
      <fieldset><legend>About you</legend>
        <div class="row2">
          <div class="field"><label for="p-name">Display name</label><input type="text" id="p-name" name="name" maxlength="40" value="${esc(me.name)}" required></div>
          <div class="field"><label for="p-since">When did you arrive?</label><input type="text" id="p-since" name="since" maxlength="60" value="${esc(me.since)}" required></div>
        </div>
        <div class="row2">
          <div class="field"><label for="p-area">Your neighbourhood</label><select class="input" id="p-area" name="area">${Object.keys(AREAS).map(a => `<option${a === me.area ? ' selected' : ''}>${a}</option>`).join('')}</select></div>
          <div class="field"><span class="label">Status</span><label class="check-row" for="p-verified"><input type="checkbox" id="p-verified" name="verified"${me.verified ? ' checked' : ''}>Verified profile badge</label></div>
        </div>
        <div class="field"><label for="p-intro">Short intro</label><textarea id="p-intro" name="intro" maxlength="200">${esc(me.intro)}</textarea></div>
      </fieldset>
      <fieldset><legend>Interests, languages &amp; availability</legend>
        <div class="field"><span class="label">Interests</span><div class="toggles">${allInterestLabels.map(lbl => `<label class="toggle"><input type="checkbox" name="interests" value="${esc(lbl)}"${me.interests.includes(lbl) ? ' checked' : ''}><span>${esc(lbl)}</span></label>`).join('')}</div></div>
        <div class="field"><span class="label">Languages</span><div class="toggles">${LANGS.map(l => `<label class="toggle"><input type="checkbox" name="languages" value="${l}"${me.languages.includes(l) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <div class="field"><span class="label">Days you're usually free</span><div class="toggles">${DAYS.map((d, idx) => `<label class="toggle"><input type="checkbox" name="availability" value="${idx}"${me.availability.includes(idx) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
      </fieldset>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save profile</button></div>
    </form>
    <section class="panel"><div class="h-row"><h2>Familiar faces (${friendList.length})</h2><span class="muted">People you've connected with</span></div>
      ${friendList.length
        ? `<ul class="members">${friendList.map(f => `<li class="member"><button type="button" class="member-btn" data-act="profile" data-uid="${f.id}">${avatar(f.id)}<span class="member-text"><strong>${esc(f.name)}${f.verified ? `<span class="badge-verified">${svg('shield', 11)}Verified</span>` : ''}</strong><span>${esc(f.since)} · ${esc(f.area)}</span></span></button><button type="button" class="btn btn-secondary btn-sm" data-act="toggle-friend" data-uid="${f.id}">Remove</button></li>`).join('')}</ul>`
        : '<p class="note">Click any member or host on a group page to add them as a familiar face.</p>'}
    </section>
  </div>`;
}

function formGroup() {
  const f = document.getElementById('start-form');
  if (!f) return null;
  const fd = new FormData(f);
  const paid = fd.get('cost') === 'paid';
  const date = fd.get('date') || ymd(new Date());
  const langsPicked = fd.getAll('lang');
  const lat = ui.startLat || null;
  const lng = ui.startLng || null;
  let area = 'Altstadt';
  if (lat && lng) {
    let best = Infinity;
    for (const [name, [aLat, aLng]] of Object.entries(AREAS)) {
      const d = (lat - aLat) ** 2 + (lng - aLng) ** 2;
      if (d < best) { best = d; area = name; }
    }
  }
  return {
    id: 'preview',
    name: String(fd.get('name') || '').trim() || 'Your new weekly group',
    cat: fd.get('cat'),
    desc: String(fd.get('desc') || '').trim() || 'A small group, a shared interest and a reason to meet again.',
    date,
    time: fd.get('time') || '18:00',
    duration: Number(fd.get('duration')),
    weekly: fd.get('weekly') === 'on',
    place: String(fd.get('place') || '').trim() || 'Your meeting place',
    area,
    lat,
    lng,
    spot: String(fd.get('spot') || '').trim() || "I'll wave when you arrive",
    lang: langsPicked.length ? langsPicked : ['English'],
    cost: paid ? Math.max(1, Math.min(50, Number(fd.get('amount')) || 5)) : 0,
    size: Number(fd.get('size')),
    friendsOnly: fd.get('friendsOnly') === 'on',
    host: state.me.id,
    members: [state.me.id],
    rsvp: { [state.me.id]: 'going' },
    distKm: 0.4,
    matchedInterestCount: 0,
    chat: []
  };
}

function updatePreview() {
  const p = document.getElementById('preview');
  const g = formGroup();
  if (p && g) p.innerHTML = cardHTML(g, true);
}

function formEditGroup(g) {
  const f = document.getElementById('edit-form');
  if (!f) return null;
  const fd = new FormData(f);
  const paid = fd.get('cost') === 'paid';
  const langsPicked = fd.getAll('lang');
  const lat = ui.editLat || g.lat;
  const lng = ui.editLng || g.lng;
  let area = g.area;
  let bestD = Infinity;
  for (const [name, [aLat, aLng]] of Object.entries(AREAS)) {
    const d = (lat - aLat) ** 2 + (lng - aLng) ** 2;
    if (d < bestD) { bestD = d; area = name; }
  }
  return {
    id: 'preview',
    name: String(fd.get('name') || '').trim() || g.name,
    cat: g.cat,
    desc: String(fd.get('desc') || '').trim() || g.desc,
    date: fd.get('date') || g.date,
    time: fd.get('time') || g.time,
    duration: Number(fd.get('duration')) || g.duration,
    weekly: fd.get('weekly') === 'on',
    place: String(fd.get('place') || '').trim() || g.place,
    area, lat, lng,
    spot: String(fd.get('spot') || '').trim() || g.spot,
    lang: langsPicked.length ? langsPicked : g.lang,
    cost: paid ? Math.max(1, Math.min(50, Number(fd.get('amount')) || 5)) : 0,
    size: Number(fd.get('size')) || g.size,
    friendsOnly: fd.get('friendsOnly') === 'on',
    host: state.me.id,
    members: g.members,
    rsvp: g.rsvp,
    distKm: g.distKm,
    matchedInterestCount: g.matchedInterestCount,
    chat: g.chat
  };
}

function updateEditPreview() {
  const p = document.getElementById('e-preview');
  const r = route();
  if (r.name !== 'edit-group' || !r.g) return;
  const g = formEditGroup(r.g);
  if (p && g) p.innerHTML = cardHTML(g, true);
}

function editGroupView(g) {
  return `<a class="back" href="#group-${g.id}">${svg('back', 18)}Back to group</a>
  <div class="page-head"><h1 tabindex="-1">Edit group</h1><p class="lead">Changes are visible to all members immediately.</p></div>
  <div class="form-layout">
    <form id="edit-form" data-id="${g.id}" novalidate>
      <fieldset><legend>What you'll do</legend>
        <div class="field"><label for="e-name">Group name</label><input type="text" id="e-name" name="name" maxlength="60" value="${esc(g.name)}" required></div>
        <div class="field"><label for="e-desc">A line about it <span class="hint">(optional)</span></label><textarea id="e-desc" name="desc" maxlength="200">${esc(g.desc)}</textarea></div>
      </fieldset>
      <fieldset><legend>When</legend>
        <div class="row2"><div class="field"><label for="e-date">Next meetup date</label><input type="date" id="e-date" name="date" min="${ymd(new Date())}" value="${g.date}" required></div><div class="field"><label for="e-time">Start time</label><input type="time" id="e-time" name="time" value="${g.time}" required></div></div>
        <div class="row2"><div class="field"><label for="e-dur">Duration</label><select class="input" id="e-dur" name="duration">${[30, 45, 60, 90, 120].map(m => `<option value="${m}"${m === g.duration ? ' selected' : ''}>${m} minutes</option>`).join('')}</select></div>
        <div class="field"><span class="label">Repeat</span><label class="check-row" for="e-weekly"><input type="checkbox" id="e-weekly" name="weekly"${g.weekly ? ' checked' : ''}>Every week, same time</label></div></div>
      </fieldset>
      <fieldset><legend>Where</legend>
        <div class="field"><label for="e-place">Meeting place name</label><input type="text" id="e-place" name="place" maxlength="60" value="${esc(g.place)}" required autocomplete="off"></div>
        <div class="loc-search-row"><input type="text" id="e-loc-search" class="input" placeholder="Search for the address or place…" autocomplete="off"><button type="button" id="e-loc-btn" class="btn btn-secondary">Search</button></div>
        <ul id="e-loc-results" class="loc-results" hidden></ul>
        <div id="e-loc-map" style="height:240px;border-radius:var(--r-md);border:1px solid var(--line);overflow:hidden;margin:8px 0 4px;"></div>
        <p class="hint">Click the map to change the meeting spot.</p>
        <input type="hidden" id="e-lat" name="lat" value="${g.lat}">
        <input type="hidden" id="e-lng" name="lng" value="${g.lng}">
        <div class="field"><label for="e-spot">How will people find you? <span class="hint">(optional)</span></label><input type="text" id="e-spot" name="spot" maxlength="90" value="${esc(g.spot)}"><span class="hint">Members see this after they join.</span></div>
      </fieldset>
      <fieldset><legend>Who it's for</legend>
        <div class="field"><span class="label" id="e-lang-l">Languages spoken</span><div class="toggles" role="group" aria-labelledby="e-lang-l">${LANGS.map(l => `<label class="toggle"><input type="checkbox" name="lang" value="${l}"${g.lang.includes(l) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <div class="row2"><div class="field"><span class="label" id="e-cost-l">Cost</span><div class="toggles" role="radiogroup" aria-labelledby="e-cost-l"><label class="toggle"><input type="radio" name="cost" value="free"${g.cost === 0 ? ' checked' : ''}><span>Free</span></label><label class="toggle"><input type="radio" name="cost" value="paid"${g.cost > 0 ? ' checked' : ''}><span>Small cost</span></label></div></div>
        <div class="field" id="e-amount-wrap"${g.cost === 0 ? ' hidden' : ''}><label for="e-amount">Euros per meetup</label><input type="number" id="e-amount" name="amount" min="1" max="50" step="1" value="${g.cost > 0 ? g.cost : 5}"></div></div>
        <div class="field"><label for="e-size">Group size, including you</label><select class="input" id="e-size" name="size">${[3, 4, 5, 6, 7, 8].map(n => `<option value="${n}"${n === g.size ? ' selected' : ''}>${n} people</option>`).join('')}</select><span class="hint">Can't go below current member count (${g.members.length}).</span></div>
        <div class="field"><label class="check-row" for="e-friends-only"><input type="checkbox" id="e-friends-only" name="friendsOnly"${g.friendsOnly ? ' checked' : ''}>Friends-only (only visible to people you've connected with)</label></div>
      </fieldset>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${svg('check', 16)}Save changes</button><a class="btn btn-secondary" href="#group-${g.id}">Cancel</a></div>
    </form>
    <div class="preview-col"><span class="label">Preview</span><div id="e-preview"></div><p class="hint">This is how your group shows up in Discover.</p></div>
  </div>`;
}

/* Router & Render */
const NAV = [
  ['discover', 'compass', 'Discover', 'Discover'],
  ['my-groups', 'users', 'My groups', 'My groups'],
  ['calendar', 'calendar', 'Calendar', 'Calendar'],
  ['profile', 'user', 'Profile', 'Profile'],
  ['start-group', 'plus', 'Start a group', 'Start']
];

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('group-')) {
    const g = byId(h.slice(6));
    if (g) return { name: 'group', g };
  }
  if (h.startsWith('edit-group-')) {
    const g = byId(h.slice(11));
    if (g && g.host === state.me?.id) return { name: 'edit-group', g };
    return { name: 'discover' };
  }
  return { name: ['my-groups', 'calendar', 'profile', 'start-group'].includes(h) ? h : 'discover' };
}

const main = document.getElementById('main');
let lastKey = '';
let pollTimer = null;

function stopPoll() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function doPoll() {
  mergeState(await api('/api/state'));
  const r = route();
  if (r.name === 'group' && isMember(r.g)) markSeen(r.g.id);
}

function render() {
  if (!state.me) return;
  const r = route();
  const key = r.name + (r.g ? r.g.id : '');
  const changed = key !== lastKey;
  if (changed) {
    ui.leave = false; ui.plan = false; ui.deleteConfirm = false; ui.kickConfirm = null;
    // start polling chat when inside a group, stop when leaving
    if (r.name === 'group' && isMember(r.g)) {
      stopPoll();
      pollTimer = setInterval(doPoll, 10000);
    } else {
      stopPoll();
    }
  }

  const active = document.activeElement;
  const focusKey = !changed && active && active.dataset ? active.dataset.key : null;
  const n = joinedGroups().length;
  const totalUnread = joinedGroups().reduce((sum, g) => sum + unreadCount(g), 0);
  const navTab = r.name === 'group' ? 'discover' : r.name;

  document.getElementById('nav').innerHTML = NAV.map(([id, icon, long, short]) =>
    `<a href="#${id}" class="${id === 'start-group' ? 'nav-start' : ''}"${id === navTab ? ' aria-current="page"' : ''}>${svg(icon, 18)}<span class="lbl-long">${long}</span><span class="lbl-short">${short}</span>${id === 'my-groups' ? (totalUnread ? `<span class="nav-count" aria-label="${totalUnread} unread messages">${totalUnread}</span>` : n ? `<span class="nav-count" aria-label="${n} groups">${n}</span>` : '') : ''}</a>`
  ).join('');

  main.innerHTML = r.name === 'group' ? groupView(r.g)
    : r.name === 'edit-group' ? editGroupView(r.g)
    : r.name === 'my-groups' ? myGroupsView()
    : r.name === 'calendar' ? calendarView()
    : r.name === 'profile' ? profileView()
    : r.name === 'start-group' ? startView()
    : discoverView();

  document.title = r.name === 'group' ? `${r.g.name} · Common` : 'Common';
  if (r.name === 'start-group' && changed) updatePreview();
  if (r.name === 'edit-group' && changed) updateEditPreview();

  const chatList = document.getElementById('chat-list');
  if (chatList) chatList.scrollTop = chatList.scrollHeight;
  if (r.name === 'group' && isMember(r.g)) markSeen(r.g.id);

  if (changed) {
    main.classList.remove('view-enter');
    void main.offsetWidth;
    main.classList.add('view-enter');
    if (ui.toChat && document.getElementById('chat')) document.getElementById('chat').scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
    const h1 = main.querySelector('h1');
    if (h1 && lastKey) h1.focus({ preventScroll: true });
    ui.toChat = false;
  } else if (focusKey) {
    const el = main.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  lastKey = key;

  // Initialise Leaflet maps after DOM is ready
  const youCoords = AREAS[state.me?.area] || AREAS.Bergheim;
  if (r.name === 'discover' && ui.view === 'map') {
    const list = filtered();
    initDiscoverMap(list, {
      sel: ui.pin,
      ring: ui.dist === 'any' ? 0 : Number(ui.dist),
      youCoords,
      esc,
      when,
      onSelect: id => { ui.pin = id; render(); }
    });
  } else if (r.name === 'group' && r.g) {
    initMiniMap(r.g, youCoords);
  } else if (r.name === 'start-group' && changed) {
    ui.startLat = null;
    ui.startLng = null;
    initLocationPicker('s-loc-map', {
      onLocation: (lat, lng) => {
        ui.startLat = lat;
        ui.startLng = lng;
        document.getElementById('s-lat').value = lat;
        document.getElementById('s-lng').value = lng;
      }
    });
  } else if (r.name === 'edit-group' && changed) {
    ui.editLat = r.g.lat;
    ui.editLng = r.g.lng;
    initLocationPicker('e-loc-map', {
      lat: r.g.lat,
      lng: r.g.lng,
      searchPrefix: 'e',
      onLocation: (lat, lng) => {
        ui.editLat = lat;
        ui.editLng = lng;
        document.getElementById('e-lat').value = lat;
        document.getElementById('e-lng').value = lng;
        updateEditPreview();
      }
    });
  }
}

/* Sheet (More activities & Member Profile) */
const sheet = document.getElementById('sheet');
sheet.querySelector('[data-act="close-sheet"]').innerHTML = svg('x', 20);
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });

function renderActivitySheet() {
  document.getElementById('sheet-title').textContent = 'All activities';
  const q = ui.sheetQuery.trim().toLowerCase();
  const entries = Object.entries(CATS).filter(([, c]) => !q || c.label.toLowerCase().includes(q));
  document.getElementById('sheet-body').innerHTML = `
    <div class="sheet-search"><label class="sr-only" for="act-search">Search activities</label><input type="search" id="act-search" placeholder="Search activities..." value="${esc(ui.sheetQuery)}"></div>
    <div class="sheet-grid">${entries.map(([k, c]) => {
      const n = state.groups.filter(g => g.cat === k).length;
      const wc = state.wishCounts?.[k] || 0;
      const isWished = state.wishes?.some(w => w.cat === k && w.area === 'any');
      return `<button type="button" class="sheet-item" data-act="cat-sheet" data-val="${k}" aria-pressed="${ui.cat === k}" style="--cat:${c.hue}"><span class="cat-tile">${svg(k, 20)}</span><span><strong>${c.label}</strong><span>${n ? `${n} ${n === 1 ? 'group' : 'groups'}` : 'No groups yet'}</span>${wc > 0 ? `<span class="wish-count">${wc} wishing</span>` : ''}</span>${n === 0 ? `<span class="wish-btn${isWished ? ' wished' : ''}" data-act="wish" data-cat="${k}" data-area="any" role="button" aria-label="${isWished ? 'Remove wish' : 'Wish for this category'}" style="pointer-events:auto">${svg('heart', 13)}${isWished ? 'Wished' : 'Wish for this'}</span>` : ''}</button>`;
    }).join('')}</div>`;
  const inp = document.getElementById('act-search');
  if (inp) {
    inp.addEventListener('input', e => {
      ui.sheetQuery = e.target.value;
      renderActivitySheet();
      const el = document.getElementById('act-search');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }
}

function openActivitySheet() {
  ui.sheetQuery = '';
  renderActivitySheet();
  sheet.showModal();
}

function openProfileSheet(uid) {
  const p = person(uid);
  if (!p) return;
  const isMe = uid === state.me.id;
  const friended = isFriend(uid);

  // Mutual friends: use mutualFriendCount from people object (computed server-side)
  const mutualCount = p.mutualFriendCount || 0;
  const mutualLine = !isMe && mutualCount > 0
    ? `<p class="note">${svg('heart', 14)} ${mutualCount} mutual familiar ${mutualCount === 1 ? 'face' : 'faces'}</p>`
    : '';

  document.getElementById('sheet-title').textContent = 'Member profile';
  document.getElementById('sheet-body').innerHTML = `<div class="profile-modal">
    <div class="pm-head">${avatar(uid, 'lg')}<div><h3>${esc(p.name)} ${p.verified ? `<span class="badge-verified">${svg('shield', 12)}Verified</span>` : ''}</h3><p class="muted">${esc(p.since)} · ${esc(p.area)}</p></div></div>
    ${p.intro ? `<p>${esc(p.intro)}</p>` : ''}
    ${mutualLine}
    <div class="tags">${p.languages.map(l => `<span class="tag">${svg('globe', 13)}${esc(l)}</span>`).join('')}${p.interests.map(i => `<span class="tag">${esc(i)}</span>`).join('')}</div>
    ${isMe ? `<a class="btn btn-secondary" href="#profile" data-act="close-sheet">Edit your profile</a>` : `<button type="button" class="btn ${friended ? 'btn-going' : 'btn-primary'}" data-act="toggle-friend" data-uid="${uid}">${svg('heart', 16)}${friended ? 'Familiar face (Friends)' : 'Add as familiar face'}</button>`}
  </div>`;
  if (!sheet.open) sheet.showModal();
}

/* Events */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const g = t.dataset.id ? byId(t.dataset.id) : null;

  try {
    switch (act) {
      case 'skip': e.preventDefault(); main.focus(); break;
      case 'cat': ui.cat = t.dataset.val; ui.pin = null; render(); break;
      case 'more': openActivitySheet(); break;
      case 'cat-sheet': ui.cat = t.dataset.val; ui.pin = null; sheet.close(); render(); break;
      case 'close-sheet': sheet.close(); break;
      case 'view': ui.view = t.dataset.val; render(); break;
      case 'pin': ui.pin = t.dataset.id; render(); break;
      case 'toggle-friends': ui.friendsOnly = !ui.friendsOnly; ui.pin = null; render(); break;
      case 'toggle-new-here': ui.newHereOnly = !ui.newHereOnly; ui.pin = null; render(); break;
      case 'clear': ui.cat = 'all'; ui.lang = 'any'; ui.dist = 'any'; ui.friendsOnly = false; ui.newHereOnly = false; ui.query = ''; render(); break;
      case 'start-with': ui.startCat = ui.cat !== 'all' ? ui.cat : null; break;
      case 'open-chat': ui.toChat = true; break;
      case 'profile': openProfileSheet(t.dataset.uid); break;

      case 'ob-next': {
        const step = Number(t.dataset.step);
        const ob = document.getElementById('onboarding');
        const patch = {};
        if (step === 1) {
          patch.area = ob?.querySelector('#ob-area')?.value;
        } else if (step === 2) {
          patch.interests = [...(ob?.querySelectorAll('input[name="interests"]:checked') || [])].map(el => el.value);
        } else if (step === 3) {
          patch.availability = [...(ob?.querySelectorAll('input[name="availability"]:checked') || [])].map(el => Number(el.value));
          mergeState(await api('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }));
          ui.onboarding = null;
          obDialog?.close();
          render();
          toast('Welcome! Here are groups near you.');
          break;
        }
        mergeState(await api('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }));
        ui.onboarding = step + 1;
        renderOnboarding();
        break;
      }
      case 'ob-skip':
        ui.onboarding = null;
        obDialog?.close();
        break;

      case 'toggle-friend': {
        const uid = t.dataset.uid;
        mergeState(await api(`/api/friends/${encodeURIComponent(uid)}/toggle`, { method: 'POST' }));
        if (sheet.open) openProfileSheet(uid);
        render();
        toast(isFriend(uid) ? `Added ${person(uid).name} as a familiar face.` : `Removed ${person(uid).name} from friends.`);
        break;
      }

      case 'join':
        if (!g) break; {
          const res = await api(`/api/groups/${encodeURIComponent(g.id)}/join`, { method: 'POST' });
          const showIntro = res.showIntro;
          mergeState(res);
          render();
          if (showIntro) {
            document.getElementById('sheet-title').textContent = 'Say hello 👋';
            document.getElementById('sheet-body').innerHTML = `<div class="intro-form-wrap">
              <p>Introduce yourself to the group. Others will see this in the chat.</p>
              <form id="intro-form" data-id="${g.id}">
                <div class="intro-row">
                  <input type="text" id="intro-text" maxlength="200" placeholder="Hi, I'm ${esc(state.me.name)} — just moved here from…" required>
                  <button class="btn btn-primary btn-sm" type="submit">Post</button>
                </div>
              </form>
              <button type="button" class="btn-link" data-act="close-sheet">Skip for now</button>
            </div>`;
            sheet.showModal();
            document.getElementById('intro-text')?.focus();
          } else {
            toast(`You joined ${g.name}. Say hello in the chat.`);
          }
          break;
        }

      case 'rsvp':
        if (!g) break; {
          const res = await api(`/api/groups/${encodeURIComponent(g.id)}/rsvp`, { method: 'POST', body: JSON.stringify({ status: t.dataset.val }) });
          const milestone = res.milestone;
          mergeState(res);
          render();
          if (milestone) {
            toast(`${milestone} meetup${milestone > 1 ? 's' : ''} in total — you're becoming a regular!`);
          } else {
            toast(t.dataset.val === 'going' ? `See you ${fmt(nextSession(g), { weekday: 'long' })}.` : "Skipping this week. You're still in the group.");
          }
          break;
        }

      case 'leave':
        ui.leave = true; render();
        main.querySelector('[data-key="leave-yes"]')?.focus();
        break;
      case 'leave-cancel':
        ui.leave = false; render();
        main.querySelector('[data-key="leave"]')?.focus();
        break;
      case 'leave-confirm':
        if (!g) break;
        mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/leave`, { method: 'POST' }));
        ui.leave = false; render();
        toast(`You left ${g.name}.`);
        break;

      case 'plan-toggle':
        ui.plan = !ui.plan; render();
        main.querySelector(ui.plan ? '#plan-what' : '[data-key="plan-open"]')?.focus();
        break;
      case 'plan-in':
        if (!g) break;
        mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/plans/${encodeURIComponent(t.dataset.mid)}/toggle`, { method: 'POST' }));
        render();
        break;

      case 'arrive':
        if (!g) break;
        mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/arrive`, { method: 'POST' }));
        render();
        toast(state.groups.find(x => x.id === g.id)?.arrived[state.me.id] ? 'Checked in — others can see you\'re here.' : 'Check-in removed.');
        break;

      case 'waitlist':
        if (!g) break; {
          mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/waitlist`, { method: 'POST' }));
          render();
          const updated = byId(g.id);
          toast(isOnWaitlist(updated) ? `On the waitlist — you're position ${updated?.waitlistPos}.` : 'Removed from the waitlist.');
          break;
        }

      case 'rate':
        if (!g) break; {
          const rating = Number(t.dataset.val);
          mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/rate`, { method: 'POST', body: JSON.stringify({ rating }) }));
          render();
          toast(rating === 1 ? 'Thanks — glad you enjoyed it!' : 'Thanks for the feedback.');
          break;
        }

      case 'pause':
        if (!g) break; {
          mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/pause`, { method: 'POST' }));
          render();
          const updatedG = byId(g.id);
          toast(isPaused(updatedG) ? 'Group paused for 2 weeks.' : 'Group resumed.');
          break;
        }

      case 'kick':
        ui.kickConfirm = t.dataset.uid; render();
        main.querySelector(`[data-key="kick-yes-${t.dataset.uid}"]`)?.focus();
        break;
      case 'kick-cancel':
        ui.kickConfirm = null; render();
        break;
      case 'kick-confirm':
        if (!g) break; {
          const uid = t.dataset.uid;
          const kicked = person(uid);
          mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/kick`, { method: 'POST', body: JSON.stringify({ userId: uid }) }));
          ui.kickConfirm = null;
          render();
          toast(`${kicked?.name || 'Member'} has been removed.`);
          break;
        }

      case 'delete-group':
        ui.deleteConfirm = true; render();
        main.querySelector('[data-key="delete-yes"]')?.focus();
        break;
      case 'delete-cancel':
        ui.deleteConfirm = false; render();
        main.querySelector('[data-key="delete-group"]')?.focus();
        break;
      case 'delete-confirm':
        if (!g) break; {
          const name = g.name;
          mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/delete`, { method: 'POST' }));
          ui.deleteConfirm = false;
          location.hash = 'discover';
          toast(`${name} has been deleted.`);
          break;
        }

      case 'transfer':
        if (!g) break; {
          const nonHostMembers = g.members.filter(id => id !== state.me.id);
          document.getElementById('sheet-title').textContent = 'Transfer hosting';
          document.getElementById('sheet-body').innerHTML = `<div class="profile-modal">
            <p class="muted" style="margin-bottom:16px">Pick a member to become the new host. This cannot be undone.</p>
            <ul class="members">${nonHostMembers.map(id => {
              const p = person(id);
              return `<li class="member"><button type="button" class="member-btn" data-act="transfer-confirm" data-id="${g.id}" data-uid="${id}">${avatar(id)}<span class="member-text"><strong>${esc(p?.name)}</strong><span>${esc(p?.since)}</span></span></button></li>`;
            }).join('')}</ul>
          </div>`;
          sheet.showModal();
          break;
        }

      case 'transfer-confirm': {
        const gid = t.dataset.id;
        const uid = t.dataset.uid;
        const target = person(uid);
        sheet.close();
        mergeState(await api(`/api/groups/${encodeURIComponent(gid)}/transfer`, { method: 'POST', body: JSON.stringify({ newHost: uid }) }));
        render();
        toast(`${target?.name} is now hosting the group.`);
        break;
      }

      case 'wish': {
        const cat = t.dataset.cat;
        const area = t.dataset.area;
        mergeState(await api('/api/wishlist', { method: 'POST', body: JSON.stringify({ cat, area }) }));
        if (sheet.open) renderActivitySheet();
        else render();
        const isWished = state.wishes?.some(w => w.cat === cat && w.area === area);
        toast(isWished ? 'Wish added — others can see demand is here.' : 'Wish removed.');
        break;
      }

      case 'reset':
        mergeState(await api('/api/reset', { method: 'POST' }));
        Object.assign(ui, { cat: 'all', lang: 'any', dist: 'any', sort: 'suggested', friendsOnly: false, newHereOnly: false, view: 'list', pin: null, leave: false, plan: false });
        lastKey = '';
        render();
        toast('Demo data reset.');
        break;
    }
  } catch (err) {
    toast(err.message);
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset?.filter) {
    ui[t.dataset.filter] = t.value;
    ui.pin = null;
    render();
    return;
  }
  if (t.closest('#start-form')) {
    if (t.name === 'cost') document.getElementById('amount-wrap').hidden = t.value !== 'paid';
    updatePreview();
  }
  if (t.closest('#edit-form')) {
    if (t.name === 'cost') document.getElementById('e-amount-wrap').hidden = t.value !== 'paid';
    updateEditPreview();
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'f-search') {
    ui.query = e.target.value;
    ui.pin = null;
    render();
    document.getElementById('f-search')?.focus();
    return;
  }
  if (e.target.closest('#start-form')) {
    if (e.target.setCustomValidity) e.target.setCustomValidity('');
    updatePreview();
  }
  if (e.target.closest('#edit-form')) {
    if (e.target.setCustomValidity) e.target.setCustomValidity('');
    updateEditPreview();
  }
});

document.addEventListener('submit', async e => {
  const f = e.target;
  e.preventDefault();
  try {
    if (f.id === 'chat-form') {
      const text = f.elements.text.value.trim();
      if (!text) return;
      mergeState(await api(`/api/groups/${encodeURIComponent(f.dataset.id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }));
      render();
      document.getElementById('chat-input')?.focus({ preventScroll: true });
    } else if (f.id === 'intro-form') {
      const textEl = document.getElementById('intro-text');
      const text = textEl?.value.trim();
      if (!text) return;
      mergeState(await api(`/api/groups/${encodeURIComponent(f.dataset.id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }));
      sheet.close();
      render();
      toast(`Said hello to the group!`);
    } else if (f.id === 'plan-form') {
      const what = f.elements.what.value.trim();
      const whenTxt = f.elements.when.value.trim();
      if (!what) { f.elements.what.reportValidity(); return; }
      if (!whenTxt) { f.elements.when.reportValidity(); return; }
      mergeState(await api(`/api/groups/${encodeURIComponent(f.dataset.id)}/messages`, { method: 'POST', body: JSON.stringify({ plan: { what, when: whenTxt } }) }));
      ui.plan = false;
      render();
      toast('Plan shared with the group.');
    } else if (f.id === 'start-form') {
      for (const id of ['s-name', 's-place']) {
        const el = document.getElementById(id);
        if (!el.value.trim()) { el.setCustomValidity('Please fill this in.'); el.reportValidity(); return; }
      }
      const g = formGroup();
      const start = new Date(`${g.date}T${g.time}:00`);
      if (!(start > new Date())) {
        const d = document.getElementById('s-date');
        d.setCustomValidity('Pick a date and time in the future.');
        d.reportValidity();
        return;
      }
      const res = await api('/api/groups', { method: 'POST', body: JSON.stringify(g) });
      mergeState(res.state);
      location.hash = 'group-' + res.id;
      toast("Group started. You're the host.");
    } else if (f.id === 'profile-form') {
      const fd = new FormData(f);
      mergeState(await api('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: fd.get('name'),
          since: fd.get('since'),
          area: fd.get('area'),
          intro: fd.get('intro'),
          verified: fd.get('verified') === 'on',
          interests: fd.getAll('interests'),
          languages: fd.getAll('languages'),
          availability: fd.getAll('availability').map(Number)
        })
      }));
      render();
      toast('Profile updated. Suggestions refreshed.');
    } else if (f.id === 'edit-form') {
      for (const id of ['e-name', 'e-place']) {
        const el = document.getElementById(id);
        if (!el.value.trim()) { el.setCustomValidity('Please fill this in.'); el.reportValidity(); return; }
      }
      const gid = f.dataset.id;
      const g = byId(gid);
      if (!g) return;
      const fd = new FormData(f);
      const paid = fd.get('cost') === 'paid';
      const langsPicked = fd.getAll('lang');
      const lat = ui.editLat || g.lat;
      const lng = ui.editLng || g.lng;
      let area = g.area;
      let bestD = Infinity;
      for (const [aName, [aLat, aLng]] of Object.entries(AREAS)) {
        const d = (lat - aLat) ** 2 + (lng - aLng) ** 2;
        if (d < bestD) { bestD = d; area = aName; }
      }
      mergeState(await api(`/api/groups/${encodeURIComponent(gid)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: fd.get('name'),
          desc: fd.get('desc'),
          place: fd.get('place'),
          area,
          spot: fd.get('spot'),
          date: fd.get('date'),
          time: fd.get('time'),
          duration: Number(fd.get('duration')),
          weekly: fd.get('weekly') === 'on',
          lang: langsPicked.length ? langsPicked : g.lang,
          cost: paid ? Math.max(1, Math.min(50, Number(fd.get('amount')) || 5)) : 0,
          size: Number(fd.get('size')),
          friendsOnly: fd.get('friendsOnly') === 'on',
          lat,
          lng
        })
      }));
      location.hash = 'group-' + gid;
      toast('Group updated.');
    }
  } catch (err) {
    toast(err.message);
  }
});

window.addEventListener('hashchange', render);
loadState().catch(err => toast(err.message));
