export function pad(n) {
  return String(n).padStart(2, '0');
}

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nextDay(dow, time, now = new Date()) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  d.setDate(now.getDate() + ((dow - now.getDay() + 7) % 7));
  d.setHours(h, m, 0, 0);
  if (d < now) d.setDate(d.getDate() + 7);
  return ymd(d);
}

export function isDatePaused(pausedUntil, dateObj) {
  if (!pausedUntil) return false;
  return ymd(dateObj) <= pausedUntil;
}

/**
 * Returns the next upcoming (or currently active) session start Date.
 * If skipPaused is true, skips dates <= group.pausedUntil.
 */
export function nextSessionDate(g, nowTs = Date.now(), skipPaused = false) {
  const d = new Date(`${g.date}T${g.time}:00`);
  if (g.weekly) {
    while (d.getTime() + g.duration * 60000 < nowTs || (skipPaused && isDatePaused(g.pausedUntil, d))) {
      d.setDate(d.getDate() + 7);
    }
  }
  return d;
}

/**
 * Returns the most recent session start Date whose end time is already in the past,
 * or null if no past session exists for a one-off future meetup.
 */
export function lastSessionDate(g, nowTs = Date.now()) {
  const base = new Date(`${g.date}T${g.time}:00`);
  const durMs = g.duration * 60000;
  if (!g.weekly) {
    return base.getTime() + durMs <= nowTs ? base : null;
  }
  // Walk to next active/upcoming session, then step back 7 days
  const next = new Date(base);
  while (next.getTime() + durMs <= nowTs) {
    next.setDate(next.getDate() + 7);
  }
  const prev = new Date(next);
  prev.setDate(prev.getDate() - 7);
  // Note: for weekly groups seeded with nextDay, the previous week's occurrence
  // happened 7 days prior even if `g.date` was set to this week.
  if (prev.getTime() + durMs <= nowTs) return prev;
  return null;
}

/**
 * True if we are within [0, 6h] after the most recently ended session.
 */
export function isInRatingWindow(g, nowTs = Date.now()) {
  const last = lastSessionDate(g, nowTs);
  if (!last) return false;
  const endTs = last.getTime() + g.duration * 60000;
  const sinceEnd = nowTs - endTs;
  return sinceEnd >= 0 && sinceEnd <= 6 * 3600000;
}

/**
 * True if we are within [-2h, +3h] around the upcoming/active meetup.
 */
export function isNearMeetup(g, nowTs = Date.now()) {
  const s = nextSessionDate(g, nowTs);
  const diff = s.getTime() - nowTs;
  return diff <= 2 * 3600000 && diff >= -3 * 3600000;
}

export function getMondayTs(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
