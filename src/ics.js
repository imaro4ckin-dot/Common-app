import { pad, ymd } from './data.js';
import { isDatePaused, nextSessionDate } from '../public/schedule.js';

function escapeIcsText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsLocal(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function formatIcsUtc(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function buildGroupEventLines(group, opts = {}) {
  const nowTs = opts.nowTs ?? Date.now();
  const skippedDates = new Set(opts.skippedDates || group.skippedDates || []);
  const start = nextSessionDate(group, nowTs, false);
  const end = new Date(start.getTime() + group.duration * 60000);
  const city = group.city || 'Heidelberg';
  const location = `${group.place}, ${group.area}, ${city}`;
  const descriptionParts = [group.desc];
  if (group.spot) descriptionParts.push(`Meeting spot: ${group.spot}`);
  if (group.tips) descriptionParts.push(`Good to know: ${group.tips}`);
  if (group.cost) descriptionParts.push(`Cost: EUR ${group.cost} per meetup`);
  const description = descriptionParts.filter(Boolean).join('\n\n');

  // Compute EXDATEs for the next 12 weekly occurrences if skipped or paused
  const exdates = [];
  if (group.weekly) {
    for (let i = 0; i < 12; i++) {
      const occ = new Date(start);
      occ.setDate(occ.getDate() + i * 7);
      const occYmd = ymd(occ);
      if (skippedDates.has(occYmd) || isDatePaused(group.pausedUntil, occ)) {
        exdates.push(formatIcsLocal(occ));
      }
    }
  }

  const lines = [
    'BEGIN:VEVENT',
    `UID:common-${group.id}-${ymd(start)}@common.local`,
    `DTSTAMP:${formatIcsUtc(new Date(nowTs))}`,
    `DTSTART;TZID=Europe/Berlin:${formatIcsLocal(start)}`,
    `DTEND;TZID=Europe/Berlin:${formatIcsLocal(end)}`,
    ...(group.weekly ? ['RRULE:FREQ=WEEKLY'] : []),
    ...(exdates.length ? [`EXDATE;TZID=Europe/Berlin:${exdates.join(',')}`] : []),
    `SUMMARY:${escapeIcsText(group.name)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT'
  ];

  return lines;
}

export function generateIcs(group, opts = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Common//Weekly Meetups//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(group.name)}`,
    ...buildGroupEventLines(group, opts),
    'END:VCALENDAR'
  ];
  return lines.join('\r\n') + '\r\n';
}

export function generateUserCalendarIcs(user, groups, opts = {}) {
  const calName = `Common Meetups (${user.name})`;
  const eventLines = groups.flatMap(g => buildGroupEventLines(g, opts));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Common//Weekly Meetups//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    ...eventLines,
    'END:VCALENDAR'
  ];
  return lines.join('\r\n') + '\r\n';
}
