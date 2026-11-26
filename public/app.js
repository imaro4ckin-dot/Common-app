import { CATS, svg } from './icons.js';
import { AREAS, initDiscoverMap, initMiniMap, initLocationPicker } from './map.js';
import {
  isDatePaused,
  isInRatingWindow,
  isNearMeetup,
  nextSessionDate,
  pad,
  ymd
} from './schedule.js';

const FAV = ['running', 'games', 'creative', 'cooking'];
const LANGS = ['English', 'German', 'Spanish', 'French', 'Turkish', 'Arabic'];
const LANG_LEVELS = {
  all: 'All levels welcome',
  beginner: 'Beginner-friendly (A2+)',
  conversational: 'Conversational (B1+)',
  fluent: 'Fluent / Native'
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AV_HUES = ['#2F80ED', '#E8590C', '#0CA678', '#D6336C', '#F08C00', '#1098AD', '#2B8A3E', '#9C6B3F'];
const USER_STORAGE_KEY = 'common-user-id';

function getUserId() {
  try { return localStorage.getItem(USER_STORAGE_KEY) || 'me'; } catch { return 'me'; }
}

function setUserId(uid) {
  try { localStorage.setItem(USER_STORAGE_KEY, uid); } catch {}
}

let state = { me: null, people: {}, friends: [], groups: [], wishes: [], wishCounts: {}, notifications: [] };
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
  editHostNotes: false,
  toChat: false,
  startCat: null,
  spinoffFrom: null,
  sheetQuery: '',
  startLat: null,
  startLng: null,
  profileLat: null,
  profileLng: null,
  onboarding: null
};

/* Helpers */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d, o) => d.toLocaleDateString('en-GB', o);
const nextSession = g => nextSessionDate(g);
const weekdayOf = g => fmt(new Date(`${g.date}T12:00:00`), { weekday: 'long' });
const when = g => (g.weekly ? `Every ${weekdayOf(g)}` : fmt(new Date(`${g.date}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })) + ` · ${g.time}`;
const byId = id => state.groups.find(g => g.id === id);
const person = id => state.people[id] || state.me;
const isMember = g => state.me && g.members.includes(state.me.id);
const isHostOrCoHost = g => state.me && (g.host === state.me.id || g.coHost === state.me.id);
const isFriend = id => state.friends.includes(id);
const langs = g => (g.lang.length > 1 ? g.lang.slice(0, -1).join(', ') + ' & ' + g.lang[g.lang.length - 1] : g.lang[0] || 'English');
const cost = g => (g.cost ? `€${g.cost} per meetup` : 'Free');
const newCount = g => g.members.filter(id => id !== state.me?.id && person(id)?.newHere).length;
const friendCount = g => g.members.filter(id => isFriend(id)).length;
const countRsvp = (g, v) => Object.entries(g.rsvp || {}).filter(([id, r]) => r === v && g.members.includes(id)).length;
const joinedGroups = () => state.groups.filter(isMember).sort((a, b) => nextSession(a) - nextSession(b));
const isPaused = g => g.pausedUntil && new Date(g.pausedUntil) > new Date();
const isOnWaitlist = g => Array.isArray(g.waitlist) && g.waitlist.includes(state.me?.id);
const getMemberMeta = (g, uid) => (g.membersMeta || []).find(m => m.userId === uid) || { weeksIn: 0, attendedCount: 0, inactive: false, mutualFriends: 0 };

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
  const loc = `${g.place}, ${g.area}, ${g.city || 'Heidelberg'}`;
  const details = `${g.desc}\nMeeting spot: ${g.spot}`;
  const gp = new URLSearchParams({ action: 'TEMPLATE', text: g.name, dates: `${f(s)}/${f(e)}`, ctz: 'Europe/Berlin', details, location: loc });
  if (g.weekly) gp.set('recur', 'RRULE:FREQ=WEEKLY');
  const op = new URLSearchParams({ subject: g.name, startdt: iso(s), enddt: iso(e), location: loc, body: details });
  return {
    ics: `/api/groups/${encodeURIComponent(g.id)}/calendar.ics?user=${encodeURIComponent(getUserId())}`,
    google: 'https://calendar.google.com/calendar/render?' + gp,
    outlook: 'https://outlook.live.com/calendar/0/deeplink/compose?' + op
  };
}

function personalCalUrls() {
  const uid = encodeURIComponent(getUserId());
  const httpPath = `/api/users/${uid}/calendar.ics`;
  const fullHttp = `${location.origin}${httpPath}`;
  const webcalUrl = fullHttp.replace(/^https?:/, 'webcal:');
  return { httpPath, fullHttp, webcalUrl };
}

/* API */
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': getUserId(),
      ...(opts.headers || {})
    },
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
    wishCounts: res.wishCounts || {},
    notifications: res.notifications || []
  };
}

/* Live SSE */
let eventSource = null;
let sseRefreshTimer = null;

function connectEvents() {
  if (eventSource) { eventSource.close(); eventSource = null; }
  if (typeof EventSource === 'undefined') return;

  eventSource = new EventSource(`/api/events?user=${encodeURIComponent(getUserId())}`);
  eventSource.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state_changed') {
        clearTimeout(sseRefreshTimer);
        sseRefreshTimer = setTimeout(async () => {
          const active = document.activeElement;
          // Don't interrupt user typing in multi-field forms
          if (active && active.closest && (active.closest('#start-form') || active.closest('#profile-form'))) return;
          const savedVal = active && (active.id === 'chat-input' || active.id === 'arrival-note-input') ? active.value : null;
          const savedId = active?.id || null;
          try {
            const res = await api('/api/state');
            mergeState(res);
            render();
            if (savedId && savedVal !== null) {
              const el = document.getElementById(savedId);
              if (el) {
                el.value = savedVal;
                el.focus({ preventScroll: true });
              }
            }
          } catch {}
        }, 180);
      }
    } catch {}
  };
}

async function loadState() {
  const res = await api('/api/state');
  mergeState(res);
  connectEvents();
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
    bodyEl.innerHTML = `<p class="lead" style="margin:0">Let's personalise your groups. Where are you based?</p>
      <div class="row2">
        <div class="field"><label for="ob-city">City</label><input type="text" id="ob-city" value="${esc(me.city || 'Heidelberg')}"></div>
        <div class="field"><label for="ob-area">Neighbourhood</label><input type="text" id="ob-area" value="${esc(me.area || 'Bergheim')}" list="hd-areas"><datalist id="hd-areas">${Object.keys(AREAS).map(a => `<option value="${a}">`).join('')}</datalist></div>
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
  const status = isMember(g) ? `<span class="joined">${svg('check', 14)}${g.host === state.me?.id ? 'Hosting' : g.coHost === state.me?.id ? 'Co-host' : 'Joined'}</span>` : '';
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

  const langTag = `${langs(g)}${g.langLevel && g.langLevel !== 'all' ? ` · ${LANG_LEVELS[g.langLevel].split(' ')[0]}` : ''}`;

  return `<${tag} class="card"${preview ? '' : ` href="#group-${g.id}"`} style="--cat:${c.hue}">
    <div class="gc-top"><span class="cat-tile">${svg(g.cat, 20)}</span><span class="gc-cat"><span>${c.label}</span><span class="muted">${g.distKm.toFixed(1)} km away</span></span>${topBadge}</div>
    <h3>${esc(g.name)}</h3>
    ${reasonLine}
    <ul class="facts-mini"><li>${svg('clock', 16)}${esc(when(g))}</li><li>${svg('pin', 16)}${esc(g.place)}, ${esc(g.area)}</li></ul>
    <div class="tags"><span class="tag">${svg('globe', 14)}${esc(langTag)}</span><span class="tag">${esc(cost(g))}</span></div>
    <div class="gc-foot"><span class="stack">${g.members.slice(0, 4).map(id => avatar(id)).join('')}</span><span class="muted">${g.members.length} of ${g.size} places taken</span>${status}</div>
  </${tag}>`;
}

function filtered() {
  const list = state.groups.filter(g =>
    (ui.cat === 'all' || g.cat === ui.cat) &&
    (ui.lang === 'any' || g.lang.includes(ui.lang)) &&
    (ui.dist === 'any' || g.distKm <= Number(ui.dist)) &&
    (!ui.friendsOnly || g.friendsOnly || friendCount(g) > 0) &&
    (!ui.newHereOnly || newCount(g) > 0)
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
      <label class="select"><span class="sr-only">Sort</span><select id="f-sort" data-filter="sort" data-key="f-sort">${opts([['suggested', 'Suggested for you'], ['closest', 'Closest first']], ui.sort)}</select></label>
      <label class="select"><span class="sr-only">Language</span><select id="f-lang" data-filter="lang" data-key="f-lang">${opts([['any', 'Any language'], ...LANGS.map(l => [l, l])], ui.lang)}</select></label>
      <label class="select"><span class="sr-only">Distance</span><select id="f-dist" data-filter="dist" data-key="f-dist">${opts([['any', 'Any distance'], ['1', 'Within 1 km'], ['2', 'Within 2 km'], ['3', 'Within 3 km'], ['10', 'Within 10 km']], ui.dist)}</select></label>
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
    const profileCard = `<section class="panel next-card" aria-labelledby="prof-h"><h2 id="prof-h">Your suggestions</h2><p class="muted">Tailored for <strong>${esc(state.me.name)}</strong> in ${esc(state.me.area)}, ${esc(state.me.city || 'Heidelberg')} (${state.me.interests.slice(0, 3).map(esc).join(', ') || 'all interests'}).</p><a class="btn btn-secondary btn-sm" href="#profile">Edit location &amp; interests</a></section>`;
    body = `<div class="discover"><div>${line}${list.length ? `<div class="results">${list.map(g => cardHTML(g)).join('')}</div>` : empty}</div><aside class="side">${side}${profileCard}</aside></div>`;
  }

  return `<div class="page-head"><h1 tabindex="-1">Find your people in ${esc(state.me.city || 'Heidelberg')}</h1><p class="lead">Small groups that meet every week, so new faces become familiar ones.</p></div>${toolbar}${body}`;
}

function msgHTML(m, g) {
  if (m.sys) return `<li class="msg-sys">${esc(m.text)}</li>`;
  const p = person(m.from);
  if (!p) return '';
  const me = m.from === state.me.id;
  const roleLabel = m.from === g.host ? ' · host' : m.from === g.coHost ? ' · co-host' : '';
  const who = me ? '' : `<div class="msg-name">${esc(p.name)}${roleLabel}</div>`;
  if (m.plan) {
    const ins = Array.isArray(m.ins) ? m.ins.filter(id => g.members.includes(id)) : [];
    const mine = ins.includes(state.me.id);
    return `<li class="msg${me ? ' msg-me' : ''}">${me ? '' : avatar(m.from)}<div>${who}<div class="plan"><span class="plan-k">${svg('spark', 14)}Extra plan</span><strong>${esc(m.plan.what)}</strong><span class="muted">${esc(m.plan.when)}</span>
      <div class="plan-foot"><span class="stack">${ins.map(id => avatar(id)).join('')}</span><span class="muted">${ins.length} in</span><button type="button" class="btn btn-sm ${mine ? 'btn-going' : 'btn-secondary'}" data-act="plan-in" data-id="${g.id}" data-mid="${m.id}" data-key="plan-${m.id}" aria-pressed="${mine}">${mine ? svg('check', 14) : ''}I'm in</button></div></div></div></li>`;
  }
  return `<li class="msg${me ? ' msg-me' : ''}">${me ? '' : avatar(m.from)}<div>${who}<div class="bubble">${esc(m.text)}</div></div></li>`;
}

function groupView(g) {
  const c = CATS[g.cat];
  const member = isMember(g);
  const host = person(g.host);
  const coHost = g.coHost ? person(g.coHost) : null;
  const full = g.members.length >= g.size;
  const nn = newCount(g);
  const s = nextSession(g);
  const my = g.rsvp[state.me.id];
  const going = countRsvp(g, 'going');
  const skip = countRsvp(g, 'skip');
  const onWl = isOnWaitlist(g);
  const buddies = (g.welcomeBuddies || []).filter(id => g.members.includes(id));
  const iAmBuddy = buddies.includes(state.me.id);

  const pauseBanner = isPaused(g)
    ? `<div class="pause-banner" role="alert"><strong>Group on pause until ${esc(fmt(new Date(g.pausedUntil), { weekday: 'long', day: 'numeric', month: 'long' }))}</strong><span class="muted">The host has paused this group for 2 weeks.</span></div>`
    : '';

  const langBadge = `${langs(g)}${g.langLevel && g.langLevel !== 'all' ? ` · ${LANG_LEVELS[g.langLevel]}` : ''}`;

  const head = `<section class="panel g-head" style="--cat:${c.hue}">
    <div class="g-title"><span class="cat-tile lg">${svg(g.cat, 28)}</span><div><p class="g-kicker">${c.label} · ${g.distKm.toFixed(1)} km from you</p><h1 tabindex="-1">${esc(g.name)}</h1></div></div>
    <p class="g-desc">${esc(g.desc)}</p>
    <div class="tags"><span class="tag">${svg('clock', 14)}${esc(when(g))}</span><span class="tag">${svg('globe', 14)}${esc(langBadge)}</span><span class="tag">${svg('euro', 14)}${esc(cost(g))}</span>${g.friendsOnly ? `<span class="badge-friend">${svg('heart', 12)}Friends only</span>` : ''}${nn ? `<span class="badge-new">${nn} new here</span>` : ''}</div>
  </section>`;

  const links = calLinks(g);
  const nearMeetup = isNearMeetup(g);
  const arrivedIds = Object.keys(g.arrived || {}).filter(id => g.members.includes(id));
  const iAmHere = arrivedIds.includes(state.me.id);
  const myArrivalNote = (g.arrivalNotes && g.arrivalNotes[state.me.id]) || '';

  const arrivalBlock = nearMeetup
    ? `<div class="arrival-block" aria-live="polite">
        <div class="h-row" style="margin-bottom:10px"><h3 style="font-size:15px">Who's at the spot?</h3></div>
        <div class="arrival-row">
          <button type="button" class="btn ${iAmHere ? 'btn-going' : 'btn-primary'} btn-sm" data-act="arrive" data-id="${g.id}" data-key="arrive-btn">
            ${svg('pin', 16)}${iAmHere ? "You're here" : "I'm here"}
          </button>
          ${arrivedIds.length > 0
            ? `<span class="arrival-who"><span class="stack">${arrivedIds.map(id => avatar(id)).join('')}</span><span class="muted">${arrivedIds.length === 1 ? person(arrivedIds[0])?.name + ' is here' : arrivedIds.length + ' people are here'}</span></span>`
            : '<span class="muted" style="font-size:14px">No one has checked in yet</span>'}
        </div>
        <div class="arrival-note-row">
          <label class="sr-only" for="arrival-note-input">How to spot you</label>
          <input type="text" id="arrival-note-input" maxlength="80" value="${esc(myArrivalNote)}" placeholder="How to spot you (e.g. Blue jacket, corner table)">
          ${iAmHere ? `<button type="button" class="btn btn-secondary btn-sm" data-act="arrive-note" data-id="${g.id}">Update note</button>` : ''}
        </div>
        ${arrivedIds.length > 0 ? `<ul class="arrival-list">${arrivedIds.map(id => {
          const note = g.arrivalNotes?.[id];
          return `<li>${avatar(id)}<strong>${esc(person(id)?.name)}</strong>${note ? `<span class="arrival-note-pill">${esc(note)}</span>` : '<span class="muted">at the spot</span>'}</li>`;
        }).join('')}</ul>` : ''}
      </div>`
    : `<div class="arrival-block arrival-upcoming">
        <div class="h-row" style="margin-bottom:6px"><h3 style="font-size:15px">Who's at the spot?</h3><span class="muted" style="font-size:13px">Shows on the day</span></div>
        <p class="note">When it's time to meet, tap here and share what you're wearing so strangers can spot you at ${esc(g.spot.split(',')[0])}.</p>
      </div>`;

  // Post-meetup rating + "Who did you click with?" block
  const ratingBlock = (() => {
    if (!member) return '';
    const inWindow = g.inRatingWindow;
    if (!inWindow && g.myRating === null) return '';

    const coAttendees = (g.lastSessionAttendees || []).filter(id => id !== state.me.id && person(id));
    const clickHtml = coAttendees.length > 0
      ? `<div class="click-list">
          <p class="q" style="margin:6px 0 4px">Who did you click with?</p>
          ${coAttendees.map(id => {
            const p = person(id);
            const friended = isFriend(id);
            return `<div class="click-row">
              <span class="click-who">${avatar(id)}<span>${esc(p.name)}</span></span>
              <span class="click-btns">
                <button type="button" class="btn btn-sm ${friended ? 'btn-going' : 'btn-secondary'}" data-act="toggle-friend" data-uid="${id}">${svg('heart', 13)}${friended ? 'Familiar face' : 'Add friend'}</button>
                <button type="button" class="btn btn-sm btn-secondary" data-act="suggest-coffee" data-id="${g.id}" data-uid="${id}">Suggest coffee</button>
              </span>
            </div>`;
          }).join('')}
        </div>`
      : '';

    const rateHtml = g.myRating !== null
      ? `<div class="rating-recorded"><span>You rated this meetup</span><span class="rating-emoji">${g.myRating === 1 ? '👍' : '👎'}</span></div>`
      : `<p class="q" id="rate-q" style="margin-top:0">How was it?</p>
         <div class="rating-btns">
           <button type="button" class="btn btn-secondary" data-act="rate" data-id="${g.id}" data-val="1" data-key="rate-up">${svg('check', 16)} Great</button>
           <button type="button" class="btn btn-secondary" data-act="rate" data-id="${g.id}" data-val="-1" data-key="rate-down">Could be better</button>
         </div>`;

    return `<div class="rating-block" aria-labelledby="rate-q">${rateHtml}${clickHtml}</div>`;
  })();

  const buddyRow = `<div class="buddy-row">
    <span><strong>Welcome buddy this week:</strong> ${buddies.length ? buddies.map(id => esc(person(id)?.name)).join(', ') : 'No one claimed yet'} <span class="muted">(arrives 5 min early for newcomers)</span></span>
    <button type="button" class="btn btn-sm ${iAmBuddy ? 'btn-going' : 'btn-secondary'}" data-act="welcome-buddy" data-id="${g.id}" data-key="buddy-btn">${iAmBuddy ? svg('check', 14) + "I'm greeting newcomers" : 'Volunteer as buddy'}</button>
  </div>`;

  const hostEditForm = isHostOrCoHost(g) && ui.editHostNotes
    ? `<form class="plan-form" id="host-notes-form" data-id="${g.id}" style="margin-top:14px">
        <div class="field" style="grid-column:1/-1"><label for="hn-ice">Weekly icebreaker question</label><input type="text" id="hn-ice" name="icebreaker" maxlength="140" value="${esc(g.icebreaker || '')}" placeholder="e.g. What local spot surprised you most?"></div>
        <div class="field" style="grid-column:1/-1"><label for="hn-tips">Good to know for newcomers</label><input type="text" id="hn-tips" name="tips" maxlength="200" value="${esc(g.tips || '')}" placeholder="e.g. No special gear needed"></div>
        <div class="pf-actions"><button class="btn btn-primary btn-sm" type="submit">Save</button><button class="btn btn-secondary btn-sm" type="button" data-act="toggle-host-notes">Cancel</button></div>
      </form>`
    : '';

  const spinoffBanner = !member && full && (g.waitlist?.length || 0) >= 2
    ? `<div class="spinoff-banner">
        <strong>${g.waitlist.length} people are waiting for a spot</strong>
        <span>Want to start a second small ${esc(c.label.toLowerCase())} table on another day and invite the waitlist?</span>
        <div><button type="button" class="btn btn-primary btn-sm" data-act="spinoff" data-id="${g.id}">${svg('plus', 14)}Start a spin-off group</button></div>
      </div>`
    : '';

  const act = member
    ? `<section class="panel g-act" aria-labelledby="act-h">
        <div class="act-head"><div><h2 id="act-h">Next meetup</h2><p class="big-date">${esc(fmt(s, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${g.time}</p><p class="muted">${g.duration} min · ${esc(g.place)}, ${esc(g.area)}</p></div>${g.host === state.me.id ? "<span class=\"pill pill-going\">You're hosting</span>" : g.coHost === state.me.id ? "<span class=\"pill pill-going\">Co-host</span>" : ''}</div>
        <div class="spot">${svg('pin', 18)}<span><strong>Meeting spot</strong><br>${esc(g.spot)}</span></div>
        <p class="q" id="rsvp-q">Are you coming this week?</p>
        <div class="seg seg-rsvp" role="group" aria-labelledby="rsvp-q"><button type="button" data-act="rsvp" data-id="${g.id}" data-val="going" data-key="rsvp-going" aria-pressed="${my === 'going'}">${svg('check', 16)}Going</button><button type="button" data-act="rsvp" data-id="${g.id}" data-val="skip" data-key="rsvp-skip" aria-pressed="${my === 'skip'}">Skip this week</button></div>
        <p class="note">${going} going${skip ? ` · ${skip} skipping` : ''}. Skipping keeps your place in the group.</p>
        <div class="cal-links"><span>Add recurring invite:</span><a class="btn btn-secondary btn-sm" href="${links.ics}" download>${svg('download', 14)}Download .ics</a><a href="${links.google}" target="_blank" rel="noopener">Google Calendar</a><a href="${links.outlook}" target="_blank" rel="noopener">Outlook</a></div>
        ${buddyRow}
        ${arrivalBlock}
        ${ratingBlock}
        ${isHostOrCoHost(g) ? `<div class="host-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-act="pause" data-id="${g.id}" data-key="pause-btn">${svg('clock', 14)}${isPaused(g) ? 'Resume group' : 'Pause for 2 weeks'}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="toggle-host-notes" data-id="${g.id}">Edit icebreaker &amp; tips</button>
          ${g.host === state.me.id ? `<button type="button" class="btn btn-secondary btn-sm" data-act="cohost" data-id="${g.id}">Set co-host</button><button type="button" class="btn btn-secondary btn-sm" data-act="transfer" data-id="${g.id}" data-key="transfer-btn">${svg('users', 14)}Transfer hosting</button>` : ''}
        </div>${hostEditForm}` : ''}
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
        ${spinoffBanner}
      </section>`;

  const mini = `<div id="leaflet-mini-${g.id}" style="height:200px;border-radius:var(--r-md);border:1px solid var(--line);overflow:hidden;margin-top:16px;"></div>`;
  const side = `<aside class="g-side">
    <section class="panel" aria-labelledby="det-h"><h2 id="det-h">Details</h2>
      <dl class="facts">
        <dt>${svg('clock', 16)}When</dt><dd>${esc(when(g))}<small>${g.duration} minutes${g.weekly ? ', every week' : ''}</small></dd>
        <dt>${svg('pin', 16)}Where</dt><dd>${esc(g.place)}<small>${esc(g.area)}, ${esc(g.city || 'Heidelberg')} · ${g.distKm.toFixed(1)} km from you</small></dd>
        <dt>${svg('globe', 16)}Language</dt><dd>${esc(langs(g))}<small>${esc(LANG_LEVELS[g.langLevel || 'all'])}</small></dd>
        <dt>${svg('euro', 16)}Cost</dt><dd>${esc(cost(g))}${g.cost ? '<small>Paid to the host on the day</small>' : ''}</dd>
        <dt>${svg('users', 16)}Size</dt><dd>Up to ${g.size} people</dd>
        ${g.tips ? `<dt>${svg('info', 16)}Tips</dt><dd>${esc(g.tips)}</dd>` : ''}
      </dl>${mini}
    </section>
    <section class="panel" aria-labelledby="host-h"><h2 id="host-h">Host${coHost ? ' & Co-host' : ''}</h2>
      <div class="host">${avatar(g.host, 'lg')}<div><p><strong>${esc(host.name)}</strong> ${host.verified ? `<span class="badge-verified">${svg('shield', 12)}Verified</span>` : ''}<br><span class="muted">${esc(host.since)}</span></p>${host.intro ? `<p>${esc(host.intro)}</p>` : ''}</div></div>
      ${coHost ? `<div class="host" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">${avatar(coHost.id, 'lg')}<div><p><strong>${esc(coHost.name)}</strong> <span class="muted" style="font-size:13px">· Co-host</span><br><span class="muted">${esc(coHost.since)}</span></p></div></div>` : ''}
    </section>
    <section class="panel" aria-labelledby="mem-h"><div class="h-row"><h2 id="mem-h">Members</h2><span class="muted">${g.members.length} of ${g.size}</span></div>
      <ul class="members">${g.members.map(id => {
        const p = person(id);
        if (!p) return '';
        const r = g.rsvp[id];
        const meta = getMemberMeta(g, id);
        const streakLabel = meta.weeksIn >= 2 ? `<span class="streak-label">Wk ${meta.weeksIn}</span>` : '';
        const metLabel = id !== state.me.id && p.metCount > 0 ? `<span class="met-tag">Met ${p.metCount}×</span>` : '';
        const inactiveLabel = meta.inactive ? `<span class="inactive-tag">Away 3+ wks</span>` : '';
        const isBuddy = buddies.includes(id);
        return `<li class="member"><button type="button" class="member-btn" data-act="profile" data-uid="${id}">${avatar(id)}<span class="member-text"><strong>${esc(p.name)}${p.verified ? `<span class="badge-verified">${svg('shield', 11)}Verified</span>` : ''}${isFriend(id) ? '<span class="badge-friend">Friend</span>' : ''}${id === g.host ? '<span class="muted" style="font-weight:500;font-size:13px">· Host</span>' : id === g.coHost ? '<span class="muted" style="font-weight:500;font-size:13px">· Co-host</span>' : ''}${isBuddy ? '<span class="badge-new">Buddy</span>' : ''}</strong><span>${esc(p.since)}${p.interests.length ? ' · ' + esc(p.interests.join(', ')) : ''}</span></span>${metLabel}${streakLabel}${inactiveLabel}</button>${p.newHere && id !== state.me.id ? '<span class="badge-new">New here</span>' : ''}${member && r === 'going' ? `<span class="pill pill-going">${svg('check', 12)}Going</span>` : ''}</li>`;
      }).join('')}</ul>
    </section>
  </aside>`;

  const previewChatHtml = !member && g.previewChat?.length
    ? `<div class="chat-preview-wrap" aria-hidden="true"><div class="chat-preview">${g.previewChat.map(m => {
        const p = person(m.from);
        return `<div class="preview-msg"><span class="pm-name">${esc(p?.name || '...')}</span><span class="pm-text">${esc(m.text)}</span></div>`;
      }).join('')}</div></div>`
    : '';

  const icebreakerHtml = member && g.icebreaker
    ? `<div class="icebreaker-card"><div><strong>This week's icebreaker</strong><span>${esc(g.icebreaker)}</span></div><button type="button" class="btn btn-secondary btn-sm" data-act="answer-icebreaker" data-q="${esc(g.icebreaker)}">Answer in chat</button></div>`
    : '';

  const chat = member
    ? `<section class="panel g-chat" id="chat" aria-labelledby="chat-h">
        <div class="h-row"><h2 id="chat-h">Group chat</h2><span class="muted">Members only · live</span></div>
        ${icebreakerHtml}
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

  return `<a class="back" href="#discover">${svg('back', 18)}All groups</a>${pauseBanner}<div class="group-layout">${head}${act}${side}${chat}${leave}</div>`;
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
    return `<article class="panel hub-card" style="--cat:${CATS[g.cat].hue}">
      ${dateBlock(s)}
      <div class="hub-main">
        <h2><a href="#group-${g.id}">${esc(g.name)}</a></h2>
        <p class="muted">${fmt(s, { weekday: 'long' })} · ${g.time} · ${esc(g.place)}, ${esc(g.area)}</p>
        <div class="spot">${svg('pin', 18)}<span>${esc(g.spot)}<br><span class="muted">${g.host === state.me.id ? 'Your note for members' : esc(host.name) + ', host'}</span></span></div>
        <div class="hub-row">${rsvpSeg(g, true)}<span class="going-line"><span class="stack">${goers.slice(0, 5).map(id => avatar(id)).join('')}</span>${goers.length} going</span></div>
      </div>
      <div class="hub-actions"><a class="btn btn-secondary btn-sm" href="#group-${g.id}" data-act="open-chat">${svg('chat', 16)}Open chat</a><a class="btn btn-secondary btn-sm" href="#group-${g.id}">Group page</a></div>
    </article>`;
  }).join('');

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
      if (!isDatePaused(g.pausedUntil, d)) {
        rows.push({ g, d: new Date(d), first: i === 0, occYmd: ymd(d) });
      }
      d.setDate(d.getDate() + 7);
      i++;
    } while (g.weekly && d.getTime() < horizon);
  });
  rows.sort((a, b) => a.d - b.d);

  const status = (g, first, occYmd) => {
    if (g.skippedDates?.includes(occYmd)) return '<span class="pill pill-skip">Skipping</span>';
    if (!first) return '';
    const r = g.rsvp[state.me.id];
    return r === 'going' ? `<span class="pill pill-going">${svg('check', 12)}Going</span>` : r === 'skip' ? '<span class="pill pill-skip">Skipping</span>' : '<span class="pill pill-open">Not answered</span>';
  };

  const calUrls = personalCalUrls();
  const subCard = mine.length
    ? `<section class="panel cal-sub-card">
        <div><h2 style="font-size:17px">Live calendar subscription</h2><p class="muted" style="font-size:14px">Syncs all your groups automatically and excludes skipped or paused weeks.</p></div>
        <div class="cal-sub-actions">
          <a class="btn btn-primary btn-sm" href="${calUrls.webcalUrl}">${svg('calendar', 15)}Subscribe (webcal)</a>
          <a class="btn btn-secondary btn-sm" href="${calUrls.httpPath}" download>${svg('download', 15)}Download all .ics</a>
          <button type="button" class="btn btn-secondary btn-sm" data-act="copy-cal">${svg('copy', 15)}Copy feed URL</button>
        </div>
      </section>`
    : '';

  const list = rows.map(({ g, d, first, occYmd }) => {
    const links = calLinks(g);
    return `<div class="agenda-row">${dateBlock(d)}<span class="agenda-text"><a href="#group-${g.id}">${esc(g.name)}</a>${g.time} · ${g.duration} min · ${esc(g.place)}</span><span class="agenda-end">${status(g, first, occYmd)}${first ? `<span class="cal-links" style="margin-top:0"><a href="${links.ics}" download>Download .ics</a><a href="${links.google}" target="_blank" rel="noopener">Google</a></span>` : ''}</span></div>`;
  }).join('');

  return `<div class="page-head"><h1 tabindex="-1">Calendar</h1><p class="lead">The next three weeks with your groups. Paused and skipped sessions are automatically excluded.</p></div>${subCard}${mine.length ? `<div class="panel agenda">${list}</div>` : emptyMine}`;
}

function startView() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const src = ui.spinoffFrom ? byId(ui.spinoffFrom) : null;
  const cat = src ? src.cat : (ui.startCat || 'coffee');
  ui.startCat = null;
  const defaultName = src ? `${src.name} (Table 2)` : '';
  const defaultDesc = src ? src.desc : '';
  const defaultTips = src ? src.tips || '' : '';
  const defaultIce = src ? src.icebreaker || '' : '';
  const defaultPlace = src ? src.place : '';
  const defaultCity = src ? (src.city || state.me.city) : (state.me.city || 'Heidelberg');

  return `<div class="page-head"><h1 tabindex="-1">${src ? 'Start a spin-off group' : 'Start a group'}</h1><p class="lead">${src ? `Starting a second table for ${esc(src.name)} — waitlisted peers will be invited.` : "Pick something you'd enjoy every week. Keep it small so names stick."}</p></div>
  <div class="form-layout">
    <form id="start-form" novalidate>
      <input type="hidden" id="s-spinoff" name="spinoffFrom" value="${esc(src?.id || '')}">
      <fieldset><legend>What you'll do</legend>
        <div class="field"><label for="s-name">Group name</label><input type="text" id="s-name" name="name" maxlength="60" value="${esc(defaultName)}" placeholder="Friday coffee and a walk" required></div>
        <div class="field"><label for="s-cat">Activity</label><select class="input" id="s-cat" name="cat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${c.label}</option>`).join('')}</select></div>
        <div class="field"><label for="s-desc">A line about it <span class="hint">(optional)</span></label><textarea id="s-desc" name="desc" maxlength="200" placeholder="What will you do together? Help a newcomer picture it.">${esc(defaultDesc)}</textarea></div>
        <div class="field"><label for="s-tips">Good to know before your first time <span class="hint">(optional)</span></label><input type="text" id="s-tips" name="tips" maxlength="200" value="${esc(defaultTips)}" placeholder="e.g. No special gear needed; slow conversational pace"></div>
        <div class="field"><label for="s-ice">Weekly icebreaker question <span class="hint">(optional)</span></label><input type="text" id="s-ice" name="icebreaker" maxlength="140" value="${esc(defaultIce)}" placeholder="e.g. What local spot surprised you most?"></div>
      </fieldset>
      <fieldset><legend>When</legend>
        <div class="row2"><div class="field"><label for="s-date">First meetup</label><input type="date" id="s-date" name="date" min="${ymd(new Date())}" value="${ymd(t)}" required></div><div class="field"><label for="s-time">Start time</label><input type="time" id="s-time" name="time" value="18:00" required></div></div>
        <div class="row2"><div class="field"><label for="s-dur">How long</label><select class="input" id="s-dur" name="duration">${[30, 45, 60, 90, 120].map(m => `<option value="${m}"${m === 60 ? ' selected' : ''}>${m} minutes</option>`).join('')}</select></div>
        <div class="field"><span class="label">Repeat</span><label class="check-row" for="s-weekly"><input type="checkbox" id="s-weekly" name="weekly" checked>Every week, same time</label></div></div>
      </fieldset>
      <fieldset><legend>Where</legend>
        <div class="row2">
          <div class="field"><label for="s-place">Meeting place name</label><input type="text" id="s-place" name="place" maxlength="60" value="${esc(defaultPlace)}" placeholder="Café Central" required autocomplete="off"></div>
          <div class="field"><label for="s-city">City</label><input type="text" id="s-city" name="city" maxlength="60" value="${esc(defaultCity)}"></div>
        </div>
        <div class="loc-search-row"><input type="text" id="s-loc-search" class="input" placeholder="Search address or venue anywhere…" autocomplete="off"><button type="button" id="s-loc-btn" class="btn btn-secondary">Search</button></div>
        <ul id="s-loc-results" class="loc-results" hidden></ul>
        <div id="s-loc-map" style="height:240px;border-radius:var(--r-md);border:1px solid var(--line);overflow:hidden;margin:8px 0 4px;"></div>
        <p class="hint">Type an address or click the map to pin the exact spot.</p>
        <input type="hidden" id="s-lat" name="lat" value="${src?.lat || ''}">
        <input type="hidden" id="s-lng" name="lng" value="${src?.lng || ''}">
        <div class="field"><label for="s-spot">How will people find you? <span class="hint">(optional)</span></label><input type="text" id="s-spot" name="spot" maxlength="90" placeholder="At the wooden table by the entrance"><span class="hint">Members see this after they join.</span></div>
      </fieldset>
      <fieldset><legend>Who it's for</legend>
        <div class="row2">
          <div class="field"><span class="label" id="lang-l">Languages spoken</span><div class="toggles" role="group" aria-labelledby="lang-l">${LANGS.map(l => `<label class="toggle"><input type="checkbox" name="lang" value="${l}"${(src ? src.lang.includes(l) : l === 'English') ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
          <div class="field"><label for="s-lang-lvl">Language comfort level</label><select class="input" id="s-lang-lvl" name="langLevel">${Object.entries(LANG_LEVELS).map(([k, v]) => `<option value="${k}"${(src?.langLevel || 'all') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
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
          <div class="field"><label for="p-city">City</label><input type="text" id="p-city" name="city" maxlength="60" value="${esc(me.city || 'Heidelberg')}" required></div>
          <div class="field"><label for="p-area">Neighbourhood</label><input type="text" id="p-area" name="area" maxlength="60" value="${esc(me.area)}" list="p-hd-areas" required><datalist id="p-hd-areas">${Object.keys(AREAS).map(a => `<option value="${a}">`).join('')}</datalist></div>
        </div>
        <div class="field"><span class="label">Pin your home neighbourhood (any city)</span>
          <div class="loc-search-row"><input type="text" id="p-loc-search" class="input" placeholder="Search city or neighbourhood…" autocomplete="off"><button type="button" id="p-loc-btn" class="btn btn-secondary">Search</button></div>
          <ul id="p-loc-results" class="loc-results" hidden></ul>
          <div id="p-loc-map" style="height:200px;border-radius:var(--r-md);border:1px solid var(--line);overflow:hidden;"></div>
        </div>
        <div class="field"><label class="check-row" for="p-verified"><input type="checkbox" id="p-verified" name="verified"${me.verified ? ' checked' : ''}>Verified profile badge</label></div>
        <div class="field"><label for="p-intro">Short intro</label><textarea id="p-intro" name="intro" maxlength="200">${esc(me.intro)}</textarea></div>
      </fieldset>
      <fieldset><legend>Interests, languages &amp; availability</legend>
        <div class="field"><span class="label">Interests</span><div class="toggles">${allInterestLabels.map(lbl => `<label class="toggle"><input type="checkbox" name="interests" value="${esc(lbl)}"${me.interests.includes(lbl) ? ' checked' : ''}><span>${esc(lbl)}</span></label>`).join('')}</div></div>
        <div class="field"><span class="label">Languages</span><div class="toggles">${LANGS.map(l => `<label class="toggle"><input type="checkbox" name="languages" value="${l}"${me.languages.includes(l) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <div class="field"><span class="label">Days you're usually free</span><div class="toggles">${DAYS.map((d, idx) => `<label class="toggle"><input type="checkbox" name="availability" value="${idx}"${me.availability.includes(idx) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
      </fieldset>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save profile</button></div>
    </form>
    <section class="panel"><div class="h-row"><h2>Familiar faces (${friendList.length})</h2><span class="muted">${me.meetupsAttended || 0} meetups attended</span></div>
      ${friendList.length
        ? `<ul class="members">${friendList.map(f => `<li class="member"><button type="button" class="member-btn" data-act="profile" data-uid="${f.id}">${avatar(f.id)}<span class="member-text"><strong>${esc(f.name)}${f.verified ? `<span class="badge-verified">${svg('shield', 11)}Verified</span>` : ''}</strong><span>${esc(f.since)} · ${esc(f.area)}${f.metCount ? ` · Met ${f.metCount}×` : ''}</span></span></button><button type="button" class="btn btn-secondary btn-sm" data-act="toggle-friend" data-uid="${f.id}">Remove</button></li>`).join('')}</ul>`
        : '<p class="note">Click any member or host on a group page to add them as a familiar face.</p>'}
    </section>
    <section class="panel">
      <div class="h-row"><h2>Switch persona or create account</h2><span class="muted">Test multi-user chat, waitlists &amp; friends-only groups</span></div>
      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn btn-secondary btn-sm" data-act="switch-user">${svg('users', 15)}Switch person (${esc(me.name)})</button>
      </div>
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
  const lat = ui.startLat || Number(fd.get('lat')) || null;
  const lng = ui.startLng || Number(fd.get('lng')) || null;
  let area = state.me?.area || 'Altstadt';
  if (lat && lng) {
    let best = Infinity;
    for (const [name, [aLat, aLng]] of Object.entries(AREAS)) {
      const d = (lat - aLat) ** 2 + (lng - aLng) ** 2;
      if (d < best) { best = d; if (d < 0.01) area = name; }
    }
  }
  return {
    id: 'preview',
    name: String(fd.get('name') || '').trim() || 'Your new weekly group',
    cat: fd.get('cat'),
    desc: String(fd.get('desc') || '').trim() || 'A small group, a shared interest and a reason to meet again.',
    tips: String(fd.get('tips') || '').trim(),
    icebreaker: String(fd.get('icebreaker') || '').trim(),
    date,
    time: fd.get('time') || '18:00',
    duration: Number(fd.get('duration')),
    weekly: fd.get('weekly') === 'on',
    place: String(fd.get('place') || '').trim() || 'Your meeting place',
    city: String(fd.get('city') || '').trim() || state.me?.city || 'Heidelberg',
    area,
    lat,
    lng,
    spot: String(fd.get('spot') || '').trim() || "I'll wave when you arrive",
    lang: langsPicked.length ? langsPicked : ['English'],
    langLevel: fd.get('langLevel') || 'all',
    cost: paid ? Math.max(1, Math.min(50, Number(fd.get('amount')) || 5)) : 0,
    size: Number(fd.get('size')),
    friendsOnly: fd.get('friendsOnly') === 'on',
    spinoffFrom: String(fd.get('spinoffFrom') || '').trim() || null,
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
  return { name: ['my-groups', 'calendar', 'profile', 'start-group'].includes(h) ? h : 'discover' };
}

const main = document.getElementById('main');
let lastKey = '';

function renderTopUtils() {
  const el = document.getElementById('top-utils');
  if (!el || !state.me) return;
  const unread = (state.notifications || []).filter(n => !n.read).length;
  el.innerHTML = `
    <button type="button" class="notif-btn" data-act="notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">
      ${svg('bell', 18)}${unread ? `<span class="notif-badge">${unread}</span>` : ''}
    </button>
    <button type="button" class="account-pill" data-act="switch-user" aria-label="Active profile: ${esc(state.me.name)}">
      ${avatar(state.me.id)}<span>${esc(state.me.name)}</span>
    </button>`;
}

function render() {
  if (!state.me) return;
  const r = route();
  const key = r.name + (r.g ? r.g.id : '');
  const changed = key !== lastKey;
  if (changed) { ui.leave = false; ui.plan = false; ui.editHostNotes = false; }

  const active = document.activeElement;
  const focusKey = !changed && active && active.dataset ? active.dataset.key : null;
  const n = joinedGroups().length;
  const navTab = r.name === 'group' ? 'discover' : r.name;

  document.getElementById('nav').innerHTML = NAV.map(([id, icon, long, short]) =>
    `<a href="#${id}" class="${id === 'start-group' ? 'nav-start' : ''}"${id === navTab ? ' aria-current="page"' : ''}>${svg(icon, 18)}<span class="lbl-long">${long}</span><span class="lbl-short">${short}</span>${id === 'my-groups' && n ? `<span class="nav-count" aria-label="${n} joined">${n}</span>` : ''}</a>`
  ).join('');
  renderTopUtils();

  main.innerHTML = r.name === 'group' ? groupView(r.g)
    : r.name === 'my-groups' ? myGroupsView()
    : r.name === 'calendar' ? calendarView()
    : r.name === 'profile' ? profileView()
    : r.name === 'start-group' ? startView()
    : discoverView();

  document.title = r.name === 'group' ? `${r.g.name} · Common` : 'Common';
  if (r.name === 'start-group' && changed) updatePreview();

  const chatList = document.getElementById('chat-list');
  if (chatList) chatList.scrollTop = chatList.scrollHeight;

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

  const youCoords = [state.me.homeLat || AREAS.Bergheim[0], state.me.homeLng || AREAS.Bergheim[1]];
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
    const src = ui.spinoffFrom ? byId(ui.spinoffFrom) : null;
    ui.startLat = src?.lat || null;
    ui.startLng = src?.lng || null;
    ui.spinoffFrom = null;
    initLocationPicker('s-loc-map', {
      lat: ui.startLat || youCoords[0],
      lng: ui.startLng || youCoords[1],
      globalSearch: true,
      onLocation: (lat, lng, _name, city) => {
        ui.startLat = lat;
        ui.startLng = lng;
        const latEl = document.getElementById('s-lat');
        const lngEl = document.getElementById('s-lng');
        const cityEl = document.getElementById('s-city');
        if (latEl) latEl.value = lat;
        if (lngEl) lngEl.value = lng;
        if (city && cityEl) cityEl.value = city;
      }
    });
  } else if (r.name === 'profile' && changed) {
    ui.profileLat = youCoords[0];
    ui.profileLng = youCoords[1];
    initLocationPicker('p-loc-map', {
      lat: youCoords[0],
      lng: youCoords[1],
      globalSearch: true,
      searchInputId: 'p-loc-search',
      searchBtnId: 'p-loc-btn',
      resultsListId: 'p-loc-results',
      onLocation: (lat, lng, name, city) => {
        ui.profileLat = lat;
        ui.profileLng = lng;
        const cityEl = document.getElementById('p-city');
        const areaEl = document.getElementById('p-area');
        if (city && cityEl) cityEl.value = city;
        if (name && areaEl) areaEl.value = name;
      }
    });
  }
}

/* Sheets */
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
      return `<div class="sheet-item-wrap">
        <button type="button" class="sheet-item" data-act="cat-sheet" data-val="${k}" aria-pressed="${ui.cat === k}" style="--cat:${c.hue}">
          <span class="cat-tile">${svg(k, 20)}</span>
          <span><strong>${c.label}</strong><span>${n ? `${n} ${n === 1 ? 'group' : 'groups'}` : 'No groups yet'}</span>${wc > 0 ? `<span class="wish-count">${wc} wishing</span>` : ''}</span>
        </button>
        ${n === 0 ? `<button type="button" class="wish-btn${isWished ? ' wished' : ''}" data-act="wish" data-cat="${k}" data-area="any" aria-pressed="${Boolean(isWished)}">${svg('heart', 13)}${isWished ? 'Wished' : 'Wish for this'}</button>` : ''}
      </div>`;
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
  const mutualCount = p.mutualFriendCount || 0;
  const metCount = p.metCount || 0;
  const mutualLine = !isMe && (mutualCount > 0 || metCount > 0)
    ? `<p class="note">${metCount > 0 ? `Met ${metCount}× at meetups` : ''}${metCount > 0 && mutualCount > 0 ? ' · ' : ''}${mutualCount > 0 ? `${mutualCount} mutual familiar ${mutualCount === 1 ? 'face' : 'faces'}` : ''}</p>`
    : '';

  document.getElementById('sheet-title').textContent = 'Member profile';
  document.getElementById('sheet-body').innerHTML = `<div class="profile-modal">
    <div class="pm-head">${avatar(uid, 'lg')}<div><h3>${esc(p.name)} ${p.verified ? `<span class="badge-verified">${svg('shield', 12)}Verified</span>` : ''}</h3><p class="muted">${esc(p.since)} · ${esc(p.area)}, ${esc(p.city || 'Heidelberg')}</p></div></div>
    ${p.intro ? `<p>${esc(p.intro)}</p>` : ''}
    ${mutualLine}
    <div class="tags">${p.languages.map(l => `<span class="tag">${svg('globe', 13)}${esc(l)}</span>`).join('')}${p.interests.map(i => `<span class="tag">${esc(i)}</span>`).join('')}</div>
    ${isMe ? `<a class="btn btn-secondary" href="#profile" data-act="close-sheet">Edit your profile</a>` : `<button type="button" class="btn ${friended ? 'btn-going' : 'btn-primary'}" data-act="toggle-friend" data-uid="${uid}">${svg('heart', 16)}${friended ? 'Familiar face (Friends)' : 'Add as familiar face'}</button>`}
  </div>`;
  if (!sheet.open) sheet.showModal();
}

async function openNotificationsSheet() {
  document.getElementById('sheet-title').textContent = 'Notifications';
  const items = state.notifications || [];
  document.getElementById('sheet-body').innerHTML = items.length
    ? `<ul class="notif-list">${items.map(n => `
        <li class="notif-item${n.read ? '' : ' unread'}">
          <div class="notif-item-head"><strong>${esc(n.title)}</strong></div>
          <p class="muted">${esc(n.body)}</p>
          <div class="notif-actions">
            ${n.actionable && n.groupId ? `<button type="button" class="btn btn-going btn-sm" data-act="rsvp" data-id="${n.groupId}" data-val="going">${svg('check', 13)}Going</button><button type="button" class="btn btn-secondary btn-sm" data-act="rsvp" data-id="${n.groupId}" data-val="skip">Skip</button>` : ''}
            ${n.link ? `<a class="btn btn-secondary btn-sm" href="${esc(n.link)}" data-act="close-sheet">Open</a>` : ''}
          </div>
        </li>`).join('')}</ul>`
    : `<div class="profile-modal"><p class="muted">You're all caught up! Reminders and waitlist spots will appear here.</p></div>`;
  sheet.showModal();
  try {
    const res = await api('/api/notifications/read', { method: 'POST' });
    mergeState(res);
    renderTopUtils();
  } catch {}
}

function openSwitchUserSheet() {
  document.getElementById('sheet-title').textContent = 'Switch persona or create account';
  const allPeople = Object.values(state.people || {});
  document.getElementById('sheet-body').innerHTML = `<div class="profile-modal">
    <p class="muted">Switch between profiles to test multi-user chat, arrival check-ins, waitlists, and friends-only groups.</p>
    <ul class="members">${allPeople.map(p => `
      <li class="member">
        <button type="button" class="member-btn" data-act="select-user" data-uid="${p.id}">
          ${avatar(p.id)}<span class="member-text"><strong>${esc(p.name)}${p.id === state.me.id ? ' (active)' : ''}</strong><span>${esc(p.area)}, ${esc(p.city || 'Heidelberg')}</span></span>
        </button>
      </li>`).join('')}
    </ul>
    <form id="new-user-form" style="padding-top:12px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px">
      <strong style="font-size:15px">Create a brand-new newcomer account</strong>
      <div class="row2">
        <input type="text" name="name" maxlength="40" placeholder="Your name" required>
        <input type="text" name="city" maxlength="60" value="${esc(state.me?.city || 'Heidelberg')}" placeholder="City">
      </div>
      <button type="submit" class="btn btn-primary btn-sm">Create &amp; start onboarding</button>
    </form>
  </div>`;
  sheet.showModal();
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
      case 'clear': ui.cat = 'all'; ui.lang = 'any'; ui.dist = 'any'; ui.friendsOnly = false; ui.newHereOnly = false; render(); break;
      case 'start-with': ui.startCat = ui.cat !== 'all' ? ui.cat : null; break;
      case 'open-chat': ui.toChat = true; break;
      case 'profile': openProfileSheet(t.dataset.uid); break;
      case 'notifications': await openNotificationsSheet(); break;
      case 'switch-user': openSwitchUserSheet(); break;

      case 'select-user': {
        const uid = t.dataset.uid;
        setUserId(uid);
        sheet.close();
        await loadState();
        toast(`Switched to ${state.me.name}.`);
        break;
      }

      case 'copy-cal': {
        const { fullHttp } = personalCalUrls();
        await navigator.clipboard?.writeText(fullHttp).catch(() => {});
        toast('Calendar feed URL copied.');
        break;
      }

      case 'spinoff': {
        ui.spinoffFrom = t.dataset.id;
        location.hash = 'start-group';
        break;
      }

      case 'ob-next': {
        const step = Number(t.dataset.step);
        const ob = document.getElementById('onboarding');
        const patch = {};
        if (step === 1) {
          patch.city = ob?.querySelector('#ob-city')?.value;
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
        if (sheet.open && document.getElementById('sheet-title')?.textContent === 'Member profile') openProfileSheet(uid);
        render();
        toast(isFriend(uid) ? `Added ${person(uid).name} as a familiar face.` : `Removed ${person(uid).name} from friends.`);
        break;
      }

      case 'suggest-coffee': {
        if (!g) break;
        const target = person(t.dataset.uid);
        ui.plan = true;
        render();
        const whatEl = document.getElementById('plan-what');
        const whenEl = document.getElementById('plan-when');
        if (whatEl) { whatEl.value = `Coffee catch-up with ${target?.name || 'group'}`; whatEl.focus(); }
        if (whenEl) whenEl.value = 'This weekend';
        break;
      }

      case 'answer-icebreaker': {
        const inp = document.getElementById('chat-input');
        if (inp) {
          inp.placeholder = `Answer: ${t.dataset.q}`;
          inp.focus();
        }
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
          if (sheet.open && document.getElementById('sheet-title')?.textContent === 'Notifications') await openNotificationsSheet();
          render();
          if (milestone) {
            toast(`${milestone} meetup${milestone > 1 ? 's' : ''} attended — you're becoming a regular!`);
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

      case 'arrive': {
        if (!g) break;
        const note = document.getElementById('arrival-note-input')?.value || '';
        mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/arrive`, { method: 'POST', body: JSON.stringify({ note }) }));
        render();
        toast(state.groups.find(x => x.id === g.id)?.arrived[state.me.id] ? "Checked in — others can see you're here." : 'Check-in removed.');
        break;
      }

      case 'arrive-note': {
        if (!g) break;
        const note = document.getElementById('arrival-note-input')?.value || '';
        mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/arrive`, { method: 'POST', body: JSON.stringify({ noteOnly: true, note }) }));
        render();
        toast('Arrival note updated.');
        break;
      }

      case 'welcome-buddy': {
        if (!g) break;
        mergeState(await api(`/api/groups/${encodeURIComponent(g.id)}/welcome-buddy`, { method: 'POST' }));
        render();
        const updated = byId(g.id);
        toast(updated?.welcomeBuddies?.includes(state.me.id) ? "You're this week's Welcome buddy!" : 'Welcome buddy status removed.');
        break;
      }

      case 'toggle-host-notes':
        ui.editHostNotes = !ui.editHostNotes;
        render();
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

      case 'cohost':
        if (!g) break; {
          const others = g.members.filter(id => id !== g.host);
          document.getElementById('sheet-title').textContent = 'Set co-host';
          document.getElementById('sheet-body').innerHTML = `<div class="profile-modal">
            <p class="muted" style="margin-bottom:12px">Choose a member to help manage the group and post icebreakers.</p>
            ${others.length ? `<ul class="members">${others.map(id => {
              const p = person(id);
              return `<li class="member"><button type="button" class="member-btn" data-act="cohost-confirm" data-id="${g.id}" data-uid="${id}">${avatar(id)}<span class="member-text"><strong>${esc(p?.name)}${id === g.coHost ? ' (current)' : ''}</strong><span>${esc(p?.since)}</span></span></button></li>`;
            }).join('')}</ul>` : '<p class="muted">No other members in the group yet.</p>'}
            ${g.coHost ? `<button type="button" class="btn btn-secondary btn-sm" data-act="cohost-confirm" data-id="${g.id}" data-uid="">Remove co-host</button>` : ''}
          </div>`;
          sheet.showModal();
          break;
        }

      case 'cohost-confirm': {
        const gid = t.dataset.id;
        const uid = t.dataset.uid || null;
        sheet.close();
        mergeState(await api(`/api/groups/${encodeURIComponent(gid)}`, { method: 'PATCH', body: JSON.stringify({ coHost: uid }) }));
        render();
        toast(uid ? `${person(uid)?.name} is now co-host.` : 'Co-host removed.');
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
        setUserId('me');
        mergeState(await api('/api/reset', { method: 'POST' }));
        Object.assign(ui, { cat: 'all', lang: 'any', dist: 'any', sort: 'suggested', friendsOnly: false, newHereOnly: false, view: 'list', pin: null, leave: false, plan: false, editHostNotes: false });
        lastKey = '';
        connectEvents();
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
});

document.addEventListener('input', e => {
  if (e.target.closest('#start-form')) {
    if (e.target.setCustomValidity) e.target.setCustomValidity('');
    updatePreview();
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
      toast('Said hello to the group!');
    } else if (f.id === 'plan-form') {
      const what = f.elements.what.value.trim();
      const whenTxt = f.elements.when.value.trim();
      if (!what) { f.elements.what.reportValidity(); return; }
      if (!whenTxt) { f.elements.when.reportValidity(); return; }
      mergeState(await api(`/api/groups/${encodeURIComponent(f.dataset.id)}/messages`, { method: 'POST', body: JSON.stringify({ plan: { what, when: whenTxt } }) }));
      ui.plan = false;
      render();
      toast('Plan shared with the group.');
    } else if (f.id === 'host-notes-form') {
      const icebreaker = f.elements.icebreaker.value.trim();
      const tips = f.elements.tips.value.trim();
      mergeState(await api(`/api/groups/${encodeURIComponent(f.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ icebreaker, tips }) }));
      ui.editHostNotes = false;
      render();
      toast('Group tips & icebreaker updated.');
    } else if (f.id === 'new-user-form') {
      const fd = new FormData(f);
      const res = await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: fd.get('name'), city: fd.get('city') || 'Heidelberg' })
      });
      setUserId(res.userId);
      sheet.close();
      mergeState(res.state);
      connectEvents();
      ui.onboarding = 1;
      renderOnboarding();
      render();
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
          city: fd.get('city'),
          area: fd.get('area'),
          homeLat: ui.profileLat,
          homeLng: ui.profileLng,
          intro: fd.get('intro'),
          verified: fd.get('verified') === 'on',
          interests: fd.getAll('interests'),
          languages: fd.getAll('languages'),
          availability: fd.getAll('availability').map(Number)
        })
      }));
      render();
      toast('Profile updated. Suggestions refreshed.');
    }
  } catch (err) {
    toast(err.message);
  }
});

window.addEventListener('hashchange', render);
loadState().catch(err => toast(err.message));
