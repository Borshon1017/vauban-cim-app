# Vauban map

A phone-first web app where people mark places in the Vauban-Esquermes neighbourhood of Lille and say how they feel there: safe or not, crowded or calm. We built it as a student project at JUNIA for NextGenMobility, a research project on how young people get around the city.

Reports go into a private PostGIS database. The public map never shows a single report, only 50 m squares where at least three different people said something. Researchers see the raw data, everyone else sees the grouped picture.

The map itself is drawn with MapLibre on top of the city's own GIS data (buildings with heights, trees, street lamps, crossings, traffic lights, benches, bus stops), with an optional 3D view.

```
phone ── HTTPS ──> Netlify (this app) ──> Supabase (PostgreSQL + PostGIS, anonymous sign-in)
```

Stack: vanilla JS + Vite, MapLibre GL, Supabase (Postgres, PostGIS, row-level security), Netlify.

## How reporting works

You can report a place two ways. "I am here now" uses your GPS and the server stamps the time. "I remember a place" lets you drop the pin from anywhere, then asks when it happened (a date and a part of the day). The database keeps both the time it happened (`occurred_at`) and the time it was sent (`created_at`), plus where the report came from (`here_now` or `remembered`).

There are two topics, safety and crowding, each with its own short set of questions. The app is in French by default with an English switch; all the text is in `src/i18n.js`.

## Privacy

This was the part we spent the most time on.

- Raw reports sit in a `private` schema that the public API can't read at all.
- The app can only write through one function, `submit_feedback()`. It checks that you're signed in (anonymously), that you accepted the current consent text, that the point is inside the study area, that the answers are valid and that a "remembered" date makes sense. It also caps you at 20 reports an hour, even if you fire requests in parallel.
- The public map comes from `get_hotspots()`, which groups reports into a 50 m grid and drops any square with fewer than 3 different people. The threshold lives in the database, so the app can't lower it.
- Free-text comments only reach the map after someone on the team approves them (`supabase/05_moderate_comments.sql`).
- No name, email or phone number is collected. A random ID in the browser links one person's reports together so we can spot spam.

An easy way to check it: run `select * from private.feedback;` in the Supabase SQL editor (works), then try the same read with the public key from the browser console (fails).

Both privacy settings can be changed in SQL:

```sql
update private.settings set value = 5   where key = 'k_threshold';  -- need 5 people per square instead of 3
update private.settings set value = 100 where key = 'grid_m';       -- 100 m squares instead of 50 m
```

## Running it yourself

### Database (Supabase, about 10 minutes)

1. Create a project on supabase.com in an EU region and keep the database password somewhere safe.
2. Under Authentication → Sign In / Providers, turn on anonymous sign-ins.
3. In the SQL editor, run these in order:
   - `supabase/01_schema.sql` (safe to re-run; it upgrades an older install without losing data)
   - `supabase/02_study_area.sql` (an approximate boundary, swap in the official one when you have it)
   - `supabase/03_demo_data.sql` if you want fake reports to look at. Remove them later with `delete from private.feedback where is_demo;`
4. Copy the project URL and the anon (publishable) key from Project Settings → API. Never put the service_role key in this app.

If you're demoing to a room full of phones on the same Wi-Fi, raise the anonymous sign-in limit under Authentication → Rate Limits, otherwise people get blocked.

### Locally

```bash
cp .env.example .env    # paste the URL and anon key
npm install
npm run dev             # open the "Network" URL on your phone
```

GPS only works over HTTPS on a phone, so test location on the deployed site rather than on `http://192.168...`.

### Deploying (Netlify)

Connect the repo in Netlify (Add new site → Import from Git) and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under environment variables. The build command and output folder are already in `netlify.toml`. Every push redeploys.

For a quick one-off, `npm run build` and drag the `dist` folder onto app.netlify.com/drop. The keys are baked in at build time, so fill in `.env` first.

### Before going live

If you change the consent or privacy text, bump `CONSENT_VERSION` in `src/main.js` so everyone is asked again. The data controller, retention period and contact address in the privacy text (`info.p5` in `src/i18n.js`) should be confirmed with the project lead.

## Map data

The layers in `public/data/` are generated from the team's QGIS shapefiles with `npm run data`: reprojected to WGS84, clipped to the neighbourhood and trimmed to the few attributes the map needs. The shapefiles are 283 MB, so they're not in the repo. Keep the `Vauban_Webdata/` folder next to this one, or run `VAUBAN_DATA=/path/to/Vauban_Webdata npm run data`.

`docs/HOW-THE-DATA-PIPELINE-WORKS.md` walks through the pipeline step by step. `docs/MAP-DATA-AND-API.md` covers the 3D rules and the backend calls.

## Layout

```
index.html, src/     the app (main.js, map layers, translations, styles)
supabase/            schema, study area, demo data, moderation
tools/build-data.mjs shapefiles -> GeoJSON
public/data/         generated map layers
docs/                pipeline and API notes
```
