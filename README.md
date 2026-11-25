# common_

> Weekly small-group meetups that help newcomers build lasting friendships in Heidelberg.

---

## What is this?

**Common** is a single-page app for people who've recently moved somewhere new and want to meet the same small group of people, week after week, until they actually become friends.

You join (or start) a recurring meetup around something you already enjoy — a Tuesday run, a Thursday board game evening, a Sunday photo walk. The same 4–6 people, same time, same place. No big events, no strangers-in-a-crowd awkwardness. Just a reason to show up.

---

## Features

- **Discover groups** — filter by activity, language, distance, or friends
- **Map view** — real OpenStreetMap tiles with group pins and a distance ring
- **Location picker** — search any address via Nominatim and drop a pin on the exact spot when creating a group
- **Recurring calendar invites** — `.ics` download works with Google Calendar, Apple Calendar, Outlook
- **Friends-only groups** — visible only to people you've connected with
- **I'm here** — tap when you arrive so members can spot each other
- **Group chat** — simple in-group messaging with shared plans
- **Match scoring** — groups ranked by interests, availability, language, distance, and familiar faces
- **Verified profiles** — badge for people who've verified their identity
- **Seed data** — 9 real groups across 7 Heidelberg neighbourhoods, ready to explore on first run

---

## Tech stack

| Layer | Choice |
|---|---|
| Server | Node.js `node:http` (no framework) |
| Database | SQLite via `node:sqlite` (Node ≥ 22.5) |
| Frontend | Vanilla JS ES modules, no build step |
| Maps | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) |
| Geocoding | [Nominatim](https://nominatim.org/) (free, no API key) |
| Calendar | Hand-rolled ICS generation |
| Fonts | Bricolage Grotesque + Inter (Google Fonts) |

No React. No bundler. No dependencies. The entire `node_modules` folder doesn't exist.

---

## Getting started

**Requires Node.js ≥ 22.5.0** (for the built-in `node:sqlite` module).

```bash
git clone https://github.com/YOUR_USER/common-app.git
cd common-app
npm start
```

Open **http://localhost:3456**

The database is created automatically on first run and seeded with 9 groups, 15 people, and a handful of friendships. Delete `data/common.db` and restart to reset everything, or use the **Reset demo data** button in the footer.

---

## Project structure

```
common-app/
├── src/
│   ├── server.js     # HTTP server, REST API routes
│   ├── db.js         # SQLite schema, seed data, queries
│   ├── data.js       # Seed people, groups, areas, categories
│   └── ics.js        # ICS calendar file generation
├── public/
│   ├── index.html    # Shell — one page, no server-side rendering
│   ├── app.js        # SPA router, views, event handling
│   ├── map.js        # Leaflet map init, location picker, mini-map
│   ├── icons.js      # SVG icon library + category definitions
│   └── styles.css    # Design tokens, layout, components
├── data/             # SQLite database (gitignored, auto-created)
└── package.json
```

---

## API

All endpoints accept and return JSON. Pass `X-User-Id` header to act as a specific user (defaults to `me`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/state` | Full app state for the current user |
| `PATCH` | `/api/me` | Update profile |
| `POST` | `/api/groups` | Create a group |
| `POST` | `/api/groups/:id/join` | Join a group |
| `POST` | `/api/groups/:id/leave` | Leave a group |
| `POST` | `/api/groups/:id/rsvp` | RSVP going / skip |
| `POST` | `/api/groups/:id/arrive` | Toggle "I'm here" arrival |
| `POST` | `/api/groups/:id/messages` | Post a message or plan |
| `GET` | `/api/groups/:id/calendar.ics` | Download recurring calendar invite |
| `POST` | `/api/friends/:id/toggle` | Add / remove a familiar face |
| `POST` | `/api/reset` | Re-seed the database |

---

## Neighbourhoods

Groups are pinned to real coordinates across seven Heidelberg areas:

`Altstadt` · `Bergheim` · `Neuenheim` · `Weststadt` · `Handschuhsheim` · `Neuenheimer Feld` · `Bahnstadt`

---

## Activity categories

`Running` · `Board games` · `Coffee & chat` · `Creative` · `Coworking` · `Cooking` · `Hiking` · `Photography` · `Language exchange` · `Climbing` · `Music` · `Volunteering`

---

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `3456` | HTTP port |
| `COMMON_DB_PATH` | `data/common.db` | SQLite database path |

---

## License

MIT
