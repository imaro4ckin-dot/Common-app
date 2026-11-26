# common_

> Weekly small-group meetups that help newcomers build lasting friendships.

---

## What is this?

**Common** is a single-page app for people who've recently moved somewhere new and want to meet the same small group of people, week after week, until they actually become friends.

You join (or start) a recurring meetup around something you already enjoy — a Tuesday run, a Thursday board game evening, a Sunday photo walk. The same 4–6 people, same time, same place. No big events, no strangers-in-a-crowd awkwardness. Just a reason to show up.

---

## Features

- **Discover groups** — filter by activity, language, distance, new-here, or friends; ranked by interests, availability, distance, and familiar faces
- **Map view** — OpenStreetMap tiles via Leaflet with group pins and a distance ring
- **Global multi-city support & location picker** — pin your home neighbourhood anywhere via Nominatim and search/drop a pin when creating a group
- **Per-session attendance & co-attendance** — weekly Going/Skip resets cleanly per session, tracks real meetups attended, and shows `"Met N×"` history between members
- **Post-meetup connection loop** — 6-hour post-meetup rating window with `"Who did you click with?"` 1-tap friend & coffee catch-up prompts
- **Arrival & icebreaker helpers** — `"I'm here"` check-in with `"what I'm wearing"` arrival notes, weekly Welcome buddy volunteer role, newcomer tips, and pinned weekly icebreakers in chat
- **Live calendar subscriptions** — per-user `webcal://` / `.ics` feeds and per-group `.ics` downloads with `RRULE:FREQ=WEEKLY` and `EXDATE` exclusions for skipped or paused weeks
- **Waitlist & spin-off groups** — automatic waitlist promotion with in-app notifications, plus 1-click spin-off creation when 2+ people are waiting
- **Real-time updates** — Server-Sent Events (`/api/events`) keep group chat, RSVPs, and arrival check-ins synced live
- **Multi-user persona switcher** — switch personas or create new newcomer accounts with guided onboarding

---

## Tech stack

| Layer | Choice |
|---|---|
| Server | Node.js `node:http` + Server-Sent Events (no framework) |
| Database | SQLite via `node:sqlite` (Node ≥ 22.5) |
| Frontend | Vanilla JS ES modules, no build step |
| Maps | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) |
| Geocoding | [Nominatim](https://nominatim.org/) (free, no API key) |
| Calendar | Hand-rolled RFC 5545 ICS + `EXDATE` generation |
| Tests | Built-in `node:test` (`npm test`) |
| Fonts | Bricolage Grotesque + Inter (Google Fonts) |

No React. No bundler. No dependencies. No `node_modules` folder required.

---

## Getting started

**Requires Node.js ≥ 22.5.0** (for the built-in `node:sqlite` module).

```bash
cd common-app
npm test
npm start
```

Open **http://127.0.0.1:3456**

The database is created automatically on first run and seeded with 9 groups, 17 people, past session history, and sample friendships. Delete `data/common.db` and restart to reset everything, or use the **Reset demo data** button in the footer.

---

## Project structure

```
common-app/
├── src/
│   ├── server.js     # HTTP server, SSE stream, REST API routes
│   ├── db.js         # SQLite schema, migrations, seed data, queries
│   ├── data.js       # Seed people, groups, areas, categories
│   └── ics.js        # Per-group & per-user ICS calendar generation
├── public/
│   ├── index.html    # Shell — one page, no server-side rendering
│   ├── app.js        # SPA router, views, SSE client, event handling
│   ├── schedule.js   # Shared session-date & rating-window logic
│   ├── map.js        # Leaflet map init, global location picker, mini-map
│   ├── icons.js      # SVG icon library + category definitions
│   └── styles.css    # Design tokens, layout, components
├── test/
│   └── app.test.js   # Unit, migration, API, ICS, and SSE tests
├── data/             # SQLite database (gitignored, auto-created)
└── package.json
```

---

## API

All endpoints accept and return JSON. Pass `X-User-Id` header (or `?user=`) to act as a specific user (defaults to `me`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | Server-Sent Events stream for live updates |
| `GET` | `/api/state` | Full app state for the current user |
| `POST` | `/api/users` | Create a new user profile |
| `PATCH` | `/api/me` | Update profile, home location, interests, availability |
| `POST` | `/api/groups` | Create a group (including optional `spinoffFrom`) |
| `PATCH` | `/api/groups/:id` | Update icebreaker, tips, spot, or co-host |
| `POST` | `/api/groups/:id/join` | Join a group |
| `POST` | `/api/groups/:id/leave` | Leave a group (auto-promotes & notifies waitlist) |
| `POST` | `/api/groups/:id/rsvp` | Per-session RSVP going / skip |
| `POST` | `/api/groups/:id/arrive` | Toggle `"I'm here"` arrival & optional arrival note |
| `POST` | `/api/groups/:id/welcome-buddy` | Toggle weekly Welcome buddy role |
| `POST` | `/api/groups/:id/messages` | Post a chat message or extra plan |
| `POST` | `/api/groups/:id/rate` | Rate meetup within 6h after session end |
| `GET` | `/api/groups/:id/calendar.ics` | Download group recurring `.ics` invite |
| `GET` | `/api/users/:id/calendar.ics` | Live combined `.ics` feed for all joined groups |
| `POST` | `/api/friends/:id/toggle` | Add / remove a familiar face |
| `POST` | `/api/notifications/read` | Mark notifications read |
| `POST` | `/api/reset` | Re-seed the database |

---

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `3456` | HTTP port |
| `COMMON_DB_PATH` | `data/common.db` | SQLite database path |

---

## License

MIT
