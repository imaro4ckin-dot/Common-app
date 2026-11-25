import { pad, ymd } from './data.js';

function escapeIcsText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function nextSessionDate(g) {
  const d = new Date(`${g.date}T${g.time}:00`);
  const now = Date.now();
  if (g.weekly) {
    while (d.getTime() + g.duration * 60000 < now) {
      d.setDate(d.getDate() + 7);
    }
  }
  return d;
}

function formatIcsLocal(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function formatIcsUtc(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function generateIcs(group) {
  const start = nextSessionDate(group);
  const end = new Date(start.getTime() + group.duration * 60000);
  const location = `${group.place}, ${group.area}, Heidelberg`;
  const descriptionParts = [group.desc];
  if (group.spot) descriptionParts.push(`Meeting spot: ${group.spot}`);
  if (group.cost) descriptionParts.push(`Cost: EUR ${group.cost} per meetup`);
  const description = descriptionParts.filter(Boolean).join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Common//Weekly Meetups//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:common-${group.id}-${ymd(start)}@common.local`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART;TZID=Europe/Berlin:${formatIcsLocal(start)}`,
    `DTEND;TZID=Europe/Berlin:${formatIcsLocal(end)}`,
    ...(group.weekly ? ['RRULE:FREQ=WEEKLY'] : []),
    `SUMMARY:${escapeIcsText(group.name)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  return lines.join('\r\n') + '\r\n';
}
