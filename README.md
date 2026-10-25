# Vauban Map (Project 4045 · deliverables 3 + 4)

Phone-first web app + Supabase database for the Vauban-CIM project.
People drop a pin, say how a place feels, and the report goes into a private spatial database.
The public map only shows grouped, anonymised results.

```
Phone ──HTTPS──▶ Netlify (this app) ──▶ Supabase (PostgreSQL + PostGIS, anonymous login, security rules)
```

## 1. Supabase (about 10 minutes)

1. supabase.com → New project. Pick an **EU region**. Save the database password.
2. **Authentication → Sign In / Providers → turn on "Allow anonymous sign-ins".**
3. **SQL Editor → New query**, paste and run, in this order:
   1. `supabase/01_schema.sql` (safe to run again; if you ran an older version it upgrades it and keeps your data)
   2. `supabase/02_study_area.sql` (approximate boundary; replace with the official one later)
   3. `supabase/03_demo_data.sql` (optional fake reports for the demo; remove later with `delete from private.feedback where is_demo;`)
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**.
   Never use the `service_role` / secret key in this app.
5. Demo day tip: **Authentication → Rate Limits**, raise "anonymous sign-ins" so many phones on one Wi-Fi are not blocked.

## 2. Run it on your Mac

```bash
cp .env.example .env      # then paste your URL and anon key
npm install
npm run dev               # opens on your network; open the "Network" URL on your phone
```

Location on a phone needs HTTPS, so test GPS on the Netlify link, not on `http://192.168…`.

## 3. Put it online with Netlify

**Option A, easiest (drag and drop):** `npm run build`, then drag the `dist` folder onto app.netlify.com/drop.
The keys are baked in at build time, so make sure `.env` is filled in first.

**Option B, automatic (recommended):** push this folder to GitHub → Netlify → *Add new site → Import from Git*.
Under *Site configuration → Environment variables* add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Every `git push` redeploys.
Build command and publish folder are already set in `netlify.toml`.

## 3b. What the app does

- **Two ways to report.** "I am here now" uses the GPS and the server records the time. "I remember a place" lets you place the pin from anywhere (e.g. from home) and asks **when** (today / yesterday / another date, plus morning / afternoon / evening / night).
  The database keeps `source` (`here_now` / `remembered`), `occurred_at` (when it happened) and `created_at` (when it was sent).
- **French by default**, English with the FR | EN switch (texts in `src/i18n.js`).
- When you change the consent or privacy text, bump `CONSENT_VERSION` in `src/main.js` so everyone is asked again.
- **To confirm with the client before launch:** the data controller and retention period in the privacy text (`info.p5` in `src/i18n.js`), and the contact address.

## 4. What is protected

- Raw reports live in the `private` schema, which the API cannot read.
- The app can only write through `submit_feedback()`, which checks: signed in (anonymous), consent version sent, inside the study area, valid values, a sensible date for "remembered" reports, max 20 reports per hour (enforced even for parallel requests).
- The public map comes from `get_hotspots()`: 50 m grid, a cell appears only with reports from at least 3 different anonymous users. The threshold is stored in the database, so the app cannot lower it.
- Researchers read the raw data in the Supabase dashboard (Table Editor → schema `private`), or run an export query.

Test it: in Supabase, run `select * from private.feedback;` (works) then try reading it with the anon key from the browser console (fails). Keep screenshots as evidence for the report.

## 5. Settings you can change (SQL Editor)

```sql
update private.settings set value = 5  where key = 'k_threshold';  -- stricter privacy
update private.settings set value = 100 where key = 'grid_m';      -- coarser grid
```

## Files

- `index.html`, `src/main.js`, `src/style.css`: the app
- `supabase/*.sql`: database
- `netlify.toml`: hosting config

## 6. The map data (QGIS) and the 3D view

`npm run data` turns the QGIS shapefiles into `public/data/*.geojson`. The full description, the 3D design rules and the backend API are in `docs/MAP-DATA-AND-API.md`.
The shapefiles (283 MB) are not in this repo: keep the `Vauban_Webdata/` folder next to it (`../Vauban_Webdata`), or point to it with `VAUBAN_DATA=/path/to/Vauban_Webdata npm run data`.
