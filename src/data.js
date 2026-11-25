export const KM_PER_UNIT = 0.006; // kept for legacy; real distances use lat/lng now

// [lat, lng] for each neighbourhood centre
export const AREAS = {
  'Altstadt':          [49.4093, 8.7100],
  'Bergheim':          [49.4055, 8.6900],
  'Neuenheim':         [49.4160, 8.6950],
  'Weststadt':         [49.3990, 8.6870],
  'Handschuhsheim':    [49.4260, 8.6900],
  'Neuenheimer Feld':  [49.4180, 8.6700],
  'Bahnstadt':         [49.3980, 8.6720]
};

export const LANGS = ['English', 'German', 'Spanish', 'French', 'Turkish', 'Arabic'];

export const CATS = {
  running: { label: 'Running', hue: '#2F80ED' },
  games: { label: 'Board games', hue: '#E8590C' },
  coffee: { label: 'Coffee & chat', hue: '#9C6B3F' },
  creative: { label: 'Creative', hue: '#D6336C' },
  coworking: { label: 'Coworking', hue: '#0CA678' },
  cooking: { label: 'Cooking', hue: '#F08C00' },
  hiking: { label: 'Hiking', hue: '#2B8A3E' },
  photography: { label: 'Photography', hue: '#495057' },
  language: { label: 'Language exchange', hue: '#1098AD' },
  climbing: { label: 'Climbing', hue: '#E03131' },
  music: { label: 'Music', hue: '#364FC7' },
  volunteering: { label: 'Volunteering', hue: '#5C940D' }
};

export const SEED_PEOPLE = [
  { id: 'me', name: 'Alex', since: 'Moved here 2 weeks ago', newHere: true, verified: true, area: 'Bergheim', languages: ['English', 'German'], interests: ['Running', 'Board games', 'Coworking', 'Coffee & chat'], availability: [1, 2, 3, 4], intro: "Just moved to Heidelberg and looking for a regular weekly crew." },
  { id: 'lena', name: 'Lena', since: 'Moved here 3 months ago', newHere: false, verified: true, area: 'Neuenheim', languages: ['English', 'German'], interests: ['Running', 'Podcasts'], availability: [2, 6], intro: "Moved from Hamburg in summer and missed my running crew. Slow, chatty runs only." },
  { id: 'kofi', name: 'Kofi', since: 'Moved here 2 weeks ago', newHere: true, verified: true, area: 'Neuenheim', languages: ['English'], interests: ['Running', 'Chess', 'Hiking'], availability: [2, 6], intro: "Software engineer from Accra, excited to explore the Neckar trails." },
  { id: 'sofia', name: 'Sofía', since: 'Moved here 1 year ago', newHere: false, verified: true, area: 'Altstadt', languages: ['English', 'Spanish', 'German'], interests: ['Photography', 'Hiking', 'Running'], availability: [2, 6], intro: "Always up for golden hour walks and weekend hikes." },
  { id: 'jonas', name: 'Jonas', since: 'Grew up in Heidelberg', newHere: false, verified: true, area: 'Altstadt', languages: ['English', 'German'], interests: ['Board games', 'Jazz'], availability: [3, 5], intro: "Grew up here and still learning new games. Happy to explain any rules, twice." },
  { id: 'elif', name: 'Elif', since: 'Moved here 4 months ago', newHere: false, verified: true, area: 'Bergheim', languages: ['English', 'Turkish', 'German'], interests: ['Board games', 'Baking', 'Cooking'], availability: [3, 5], intro: "Architect from Istanbul. Board games and good bread are my love languages." },
  { id: 'amir', name: 'Amir', since: 'Moved here 3 weeks ago', newHere: true, verified: false, area: 'Weststadt', languages: ['English', 'Arabic'], interests: ['Football', 'Cooking', 'Board games'], availability: [3, 5], intro: "Doing a master's here. Looking for friendly weeknight plans." },
  { id: 'hana', name: 'Hana', since: 'Moved here 7 months ago', newHere: false, verified: true, area: 'Bergheim', languages: ['English', 'German'], interests: ['Creative', 'Drawing', 'Museums'], availability: [0, 3], intro: "Illustrator from Seoul. Sketching is my favourite way to get to know a city." },
  { id: 'priya', name: 'Priya', since: 'Moved here 2 months ago', newHere: false, verified: true, area: 'Bergheim', languages: ['English'], interests: ['Coworking', 'Design', 'Yoga'], availability: [4], intro: "Freelance designer from Bangalore. I get more done with people around." },
  { id: 'david', name: 'David', since: 'Moved here 3 weeks ago', newHere: true, verified: true, area: 'Weststadt', languages: ['English', 'German'], interests: ['Coworking', 'Coding', 'Coffee & chat'], availability: [1, 4, 6], intro: "Remote developer, trying to get out of my apartment more." },
  { id: 'mei', name: 'Mei', since: 'Moved here 1 month ago', newHere: true, verified: false, area: 'Bergheim', languages: ['English', 'German'], interests: ['Creative', 'Sketching', 'Photography'], availability: [0, 6], intro: "Visiting researcher, learning to sketch and taking lots of bridge photos." },
  { id: 'yuki', name: 'Yuki', since: 'Moved here 5 months ago', newHere: false, verified: true, area: 'Altstadt', languages: ['English', 'German'], interests: ['Photography', 'Creative', 'Design'], availability: [0, 6], intro: "Photographer from Osaka. The light on the old bridge never gets old." },
  { id: 'tomas', name: 'Tomás', since: 'Moved here 6 months ago', newHere: false, verified: true, area: 'Neuenheim', languages: ['English', 'Spanish'], interests: ['Cooking', 'Salsa'], availability: [5], intro: "From Valencia. I always cook too much, so I started sharing it." },
  { id: 'luca', name: 'Luca', since: 'Moved here 2 weeks ago', newHere: true, verified: true, area: 'Weststadt', languages: ['English', 'German'], interests: ['Cooking', 'Cycling'], availability: [1, 5], intro: "Just arrived from Milan. Happy to trade pasta recipes!" },
  { id: 'ana', name: 'Ana', since: 'Moved here 1 month ago', newHere: true, verified: true, area: 'Neuenheim', languages: ['English', 'Spanish', 'German'], interests: ['Language exchange', 'Coffee & chat', 'Cooking'], availability: [1, 5], intro: "Practising my German and always down for a coffee." },
  { id: 'noah', name: 'Noah', since: 'Moved here 8 months ago', newHere: false, verified: true, area: 'Neuenheim', languages: ['English'], interests: ['Hiking', 'Climbing'], availability: [6], intro: "From Toronto, here for a postdoc. Always looking for the next viewpoint." },
  { id: 'marta', name: 'Marta', since: 'Grew up in Heidelberg', newHere: false, verified: true, area: 'Weststadt', languages: ['German', 'English'], interests: ['Language exchange', 'Books', 'Coffee & chat'], availability: [1], intro: "Born here, teacher by day. Happy to help with German, slowly." }
];

export const SEED_FRIENDS = ['kofi', 'priya'];

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nextDay(dow, time) {
  const now = new Date();
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  d.setDate(now.getDate() + ((dow - now.getDay() + 7) % 7));
  d.setHours(h, m, 0, 0);
  if (d < now) d.setDate(d.getDate() + 7);
  return ymd(d);
}

export const SEED_GROUPS = [
  {
    id: 'run', name: 'Easy Tuesday Run', cat: 'running', dow: 2, time: '18:30', duration: 45, weekly: true,
    desc: 'A relaxed 5 km along the river. No pace goals, just a reason to get outside and talk.',
    place: 'Neckarwiese', area: 'Neuenheim', spot: 'By the big plane tree next to Theodor-Heuss-Brücke',
    lang: ['English'], cost: 0, size: 6, host: 'lena', friendsOnly: false,
    members: ['lena', 'kofi', 'sofia'],
    rsvp: { lena: 'going', kofi: 'going', sofia: 'skip' },
    lat: 49.4147, lng: 8.6978,
    chat: [
      { from: 'lena', text: 'Welcome Kofi! We keep it slow, so nobody gets left behind.' },
      { from: 'kofi', text: 'Perfect, that is exactly my speed. See you Tuesday!' }
    ]
  },
  {
    id: 'games', name: 'Board Game Evening', cat: 'games', dow: 3, time: '19:00', duration: 90, weekly: true,
    desc: 'Bring a favourite game or learn a new one. Nobody needs to know the rules yet.',
    place: 'Café Gegend', area: 'Altstadt', spot: 'Big table in the back room, ask at the counter for Jonas',
    lang: ['English', 'German'], cost: 0, size: 6, host: 'jonas', friendsOnly: false,
    members: ['jonas', 'elif', 'amir', 'hana'],
    rsvp: { jonas: 'going', elif: 'going', amir: 'going', hana: 'skip' },
    lat: 49.4098, lng: 8.7072,
    chat: [
      { from: 'jonas', text: 'This week: Codenames and Azul. Bring anything you like playing.' },
      { from: 'elif', text: 'I will bring Ticket to Ride!' },
      { from: 'jonas', plan: { what: 'Christmas market after games', when: 'Wednesday, from 21:00' }, ins: ['jonas', 'elif'] }
    ]
  },
  {
    id: 'focus', name: 'Focus & Coffee', cat: 'coworking', dow: 4, time: '17:30', duration: 60, weekly: true,
    desc: 'Work alongside others for an hour, then take a proper coffee break together.',
    place: 'Goodie Café', area: 'Bergheim', spot: 'Window tables on the left as you come in',
    lang: ['English'], cost: 0, size: 5, host: 'priya', friendsOnly: false,
    members: ['priya', 'david'],
    rsvp: { priya: 'going', david: 'going' },
    lat: 49.4062, lng: 8.6893,
    chat: [
      { from: 'priya', text: 'Window tables again on Thursday. The oat flat white is worth it.' }
    ]
  },
  {
    id: 'sketch', name: 'Sunday Sketch Club', cat: 'creative', dow: 0, time: '15:00', duration: 60, weekly: true,
    desc: 'Bring a notebook and draw together. Beginners and new faces are very welcome.',
    place: 'Stadtbücherei', area: 'Bergheim', spot: 'Reading area on the first floor',
    lang: ['German', 'English'], cost: 0, size: 5, host: 'hana', friendsOnly: false,
    members: ['hana', 'mei', 'yuki'],
    rsvp: { hana: 'going', mei: 'going' },
    lat: 49.4071, lng: 8.6882,
    chat: [
      { from: 'hana', text: 'Theme for Sunday: hands. Bring a pencil and an eraser, that is all.' },
      { from: 'mei', text: 'Can I join even if I have not drawn since school?' },
      { from: 'hana', text: 'Absolutely. Most of us had not either.' }
    ]
  },
  {
    id: 'cook', name: 'Cook & Share Night', cat: 'cooking', dow: 5, time: '18:30', duration: 120, weekly: true,
    desc: 'One person picks a dish from home, everyone cooks it together, then we eat.',
    place: 'Nachbarschaftsküche', area: 'Neuenheim', spot: 'Ring the bell marked Küche, second floor',
    lang: ['English', 'Spanish'], cost: 6, size: 8, host: 'tomas', friendsOnly: false,
    members: ['tomas', 'luca', 'amir', 'ana', 'elif'],
    rsvp: { tomas: 'going', luca: 'going', ana: 'going', elif: 'skip' },
    lat: 49.4188, lng: 8.6940,
    chat: [
      { from: 'tomas', text: "Luca picked the dish this week: his grandmother's risotto. The €6 covers everything." },
      { from: 'ana', text: 'I can bring dessert!' }
    ]
  },
  {
    id: 'hike', name: 'Philosophenweg Walk', cat: 'hiking', dow: 6, time: '10:00', duration: 90, weekly: true,
    desc: 'An easy walk up the Philosophenweg with views over the old town and the river.',
    place: 'Philosophenweg', area: 'Neuenheim', spot: 'At the bottom of the Schlangenweg steps',
    lang: ['English'], cost: 0, size: 8, host: 'noah', friendsOnly: false,
    members: ['noah', 'sofia', 'kofi', 'david'],
    rsvp: { noah: 'going', sofia: 'going', kofi: 'going' },
    lat: 49.4175, lng: 8.7045,
    chat: [
      { from: 'noah', text: 'About 4 km with a stop at the viewpoint. Shoes with some grip help if it rained.' }
    ]
  },
  {
    id: 'photo', name: 'Golden Hour Photo Walk', cat: 'photography', dow: 6, time: '16:00', duration: 60, weekly: true,
    desc: 'A slow walk with phones or cameras, swapping tips while the light changes.',
    place: 'Alte Brücke', area: 'Altstadt', spot: 'At the bridge gate on the old town side',
    lang: ['German', 'English'], cost: 0, size: 6, host: 'yuki', friendsOnly: false,
    members: ['yuki', 'sofia', 'mei'],
    rsvp: { yuki: 'going', sofia: 'going' },
    lat: 49.4113, lng: 8.7108,
    chat: [
      { from: 'yuki', text: 'Sunset is around 16:30 now, so we start right at 16:00.' }
    ]
  },
  {
    id: 'german', name: 'German Over Coffee', cat: 'language', dow: 1, time: '18:00', duration: 60, weekly: true,
    desc: 'Practise everyday German with patient locals. All levels, no grammar drills.',
    place: 'Café Linde', area: 'Weststadt', spot: 'The table with the small German flag',
    lang: ['German'], cost: 0, size: 6, host: 'marta', friendsOnly: false,
    members: ['marta', 'ana', 'david', 'luca'],
    rsvp: { marta: 'going', ana: 'going', david: 'going', luca: 'skip' },
    lat: 49.3998, lng: 8.6865,
    chat: [
      { from: 'marta', text: 'Herzlich willkommen! This week we talk about the weekend, nice and slow.' },
      { from: 'david', text: 'Danke! Ich bin ein bisschen nervös.' },
      { from: 'marta', text: 'Kein Problem, das sind am Anfang alle.' }
    ]
  },
  {
    id: 'boulder', name: 'Bergheim Friends Coffee', cat: 'coffee', dow: 5, time: '09:00', duration: 45, weekly: true,
    desc: 'A quick Friday morning espresso with familiar faces before the workday starts.',
    place: 'Kaffeezimmer', area: 'Bergheim', spot: 'Bench outside if sunny, otherwise the high table',
    lang: ['English', 'German'], cost: 0, size: 5, host: 'priya', friendsOnly: true,
    members: ['priya', 'kofi', 'david'],
    rsvp: { priya: 'going', kofi: 'going', david: 'going' },
    lat: 49.4048, lng: 8.6878,
    chat: [
      { from: 'priya', text: 'Keeping this one small for people we already met at Focus & Coffee or runs.' }
    ]
  }
];
