export const ICONS = {
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z"/>',
  euro: '<path d="M17 6.5a6.5 6.5 0 1 0 0 11"/><path d="M4.5 10.5h8M4.5 13.5h8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  map: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
  send: '<path d="M4 12l16-7.5-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  spark: '<path d="M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z"/>',
  chat: '<path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17.5h-1A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5z"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3.2 8.7-7 10-3.8-1.3-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c.8-3.5 3.5-5.5 7-5.5s6.2 2 7 5.5"/>',
  download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'
};

export const CATS = {
  running: { label: 'Running', hue: '#2F80ED', icon: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.6 16.6c2.6-1.2 1.6-4.8 4.4-5.8s3.6-2.2 4.4-3.4"/>' },
  games: { label: 'Board games', hue: '#E8590C', icon: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/>' },
  coffee: { label: 'Coffee & chat', hue: '#9C6B3F', icon: '<path d="M5 9.5h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8.5 3.5V6M12.5 3.5V6"/>' },
  creative: { label: 'Creative', hue: '#D6336C', icon: '<path d="M15.5 4.5l4 4L9 19H5v-4z"/><path d="M13.5 6.5l4 4"/>' },
  coworking: { label: 'Coworking', hue: '#0CA678', icon: '<rect x="4.5" y="5" width="15" height="10" rx="1.8"/><path d="M2.5 19h19"/>' },
  cooking: { label: 'Cooking', hue: '#F08C00', icon: '<path d="M4.5 10.5h15V14a5.5 5.5 0 0 1-5.5 5.5h-4A5.5 5.5 0 0 1 4.5 14z"/><path d="M2.5 10.5h2M19.5 10.5h2"/><path d="M9.5 3.5c-.8 1 .8 2 0 3.5M14.5 3.5c-.8 1 .8 2 0 3.5"/>' },
  hiking: { label: 'Hiking', hue: '#2B8A3E', icon: '<path d="M2.5 19.5l7-12 4.5 7.5 2.5-3.5 5 8z"/>' },
  photography: { label: 'Photography', hue: '#495057', icon: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8.5 7L10 4.5h4L15.5 7"/><circle cx="12" cy="13.5" r="3.5"/>' },
  language: { label: 'Language exchange', hue: '#1098AD', icon: '<path d="M4 4.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3.5 3v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M19 9h1a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-.5V20l-3-2.5H13"/>' },
  climbing: { label: 'Climbing', hue: '#E03131', icon: '<path d="M5 20.5L12 4l7 16.5"/><path d="M8.2 13h7.6"/>' },
  music: { label: 'Music', hue: '#364FC7', icon: '<path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>' },
  volunteering: { label: 'Volunteering', hue: '#5C940D', icon: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>' }
};

export function svg(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || (CATS[name] && CATS[name].icon) || ''}</svg>`;
}
