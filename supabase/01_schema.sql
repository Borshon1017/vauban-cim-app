-- Vauban-CIM · Secure spatial backend · schema (v6: Safety + Crowd questionnaires + emoji Obstacles, "here now" vs "remembered" reports, FR/EN, reviewed comments)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- It is safe to run again. If you already ran v1, running this file UPGRADES it and keeps your data.

create extension if not exists postgis with schema extensions;
create schema if not exists private;          -- NOT exposed through the API

-- ---------------------------------------------------------------- settings
create table if not exists private.settings (
  key   text primary key,
  value int  not null
);
insert into private.settings (key, value) values
  ('k_threshold', 3),          -- a public map cell needs at least this many reports
  ('grid_m', 50),              -- public cell size in metres
  ('max_per_hour', 20),        -- max reports per anonymous user per hour
  ('max_past_days', 365),      -- how far back a "remembered" report may be dated
  ('comments_auto_approve', 0), -- 0 = a comment shows on the public map only after the team approves it; 1 = shows right away
  ('obstacles_auto_approve', 1), -- 1 = an obstacle shows on the map right away; 0 = only after the team approves it
  ('obstacle_days', 30),        -- an obstacle stays on the map this many days after it was reported
  ('obstacle_grid_m', 10),      -- public position of an obstacle is rounded to this many metres
  ('max_obstacles_per_hour', 10)
on conflict (key) do nothing;

-- ------------------------------------------------------------- study area
create table if not exists private.study_area (
  id   serial primary key,
  name text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null
);
create index if not exists study_area_gix on private.study_area using gist (geom);

-- ------------------------------------------------------------- categories
create table if not exists public.categories (
  code       text primary key,
  label      text not null,                -- English
  label_fr   text,                         -- French
  sort_order int  not null default 0,
  topic      text not null default 'safety' check (topic in ('safety','crowd'))
);
alter table public.categories add column if not exists label_fr text;
alter table public.categories add column if not exists topic text not null default 'safety' check (topic in ('safety','crowd'));
insert into public.categories (code, label, label_fr, sort_order, topic) values
  -- Safety
  ('crossing',   'Crossing',                  'Traversée / passage piéton',   1, 'safety'),
  ('traffic',    'Traffic',                   'Circulation',                  2, 'safety'),
  ('sidewalk',   'Sidewalk',                  'Trottoir',                     3, 'safety'),
  ('bike_lane',  'Bike lane',                 'Piste cyclable',               4, 'safety'),
  ('lighting',   'Lighting / too dark',       'Éclairage / trop sombre',      5, 'safety'),
  ('surface',    'Road or path surface',      'Revêtement de la chaussée ou du chemin', 6, 'safety'),
  ('enclosed',   'Narrow or enclosed street', 'Rue étroite ou oppressante',   7, 'safety'),
  ('other',      'Other',                     'Autre',                        8, 'safety'),
  ('good_place', 'Nothing to report, it works well here', 'Rien à signaler, ça fonctionne bien ici', 9, 'safety'),
  -- Crowd
  ('crowd_transit',  'Bus, tram or metro',           'Bus, tram ou métro',             11, 'crowd'),
  ('crowd_sidewalk', 'Sidewalk or crossing',         'Trottoir ou passage piéton',     12, 'crowd'),
  ('crowd_bike',     'Bike lane or bike parking',    'Piste cyclable ou parking vélo', 13, 'crowd'),
  ('crowd_queue',    'Queue or waiting area',        'File d’attente ou zone d’attente', 14, 'crowd'),
  ('crowd_event',    'Event, market or campus rush', 'Événement, marché ou heure de pointe du campus', 15, 'crowd'),
  ('crowd_other',    'Other',                        'Autre',                          16, 'crowd'),
  ('crowd_calm',     'Quiet place, never crowded',   'Endroit calme, jamais bondé',    17, 'crowd'),
  ('crowd_general',  'Crowd level',                  'Niveau d’affluence',             18, 'crowd')
on conflict (code) do update
  set label = excluded.label, label_fr = excluded.label_fr, sort_order = excluded.sort_order, topic = excluded.topic;

alter table public.categories enable row level security;
drop policy if exists "categories are public" on public.categories;
create policy "categories are public" on public.categories for select to anon, authenticated using (true);

-- --------------------------------------------------------------- feedback
-- source      : 'here_now'    = sent from the spot, the time is recorded automatically
--               'remembered'  = a place marked afterwards (e.g. from home), the user says WHEN
-- occurred_at : when the thing happened (what researchers analyse)
-- created_at  : when the report was sent
create table if not exists private.feedback (
  id              uuid primary key default gen_random_uuid(),
  geom            extensions.geometry(Point, 4326) not null,
  age_group       text not null check (age_group in ('under_18','18_25','26_plus')),
  topic           text not null default 'safety' check (topic in ('safety','crowd')),
  feeling         text not null check (feeling in ('unsafe','hard','good','crowded','busy','calm')),
  score           smallint not null check (score between 1 and 3),   -- 1 = bad (red)  2 = medium (yellow)  3 = good (green)
                                                                       -- safety: unsafe=1 hard=2 good=3 · crowd: crowded=1 busy=2 calm=3
  category        text not null references public.categories(code),
  source          text not null default 'here_now' check (source in ('here_now','remembered')),
  occurred_at     timestamptz not null default now(),
  travel_mode     text check (travel_mode in ('walk','bike','scooter','bus','metro','car')),
  time_of_day     text check (time_of_day in ('morning','afternoon','evening','night')),
  avoids_place    boolean,
  improvement     text check (char_length(improvement) <= 300),
  accuracy_m      real,
  consent_version text not null,
  session_id      uuid not null,                       -- anonymous auth id, not an identity
  status          text not null default 'approved' check (status in ('approved','rejected')),
  answers         jsonb,                                  -- the answers to the Safety or Crowd questions (checked by submit_feedback)
  comment_status  text not null default 'pending' check (comment_status in ('pending','approved','rejected')),   -- only 'approved' comments reach the public map
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now()
);

-- upgrade path from earlier versions (no-ops on a fresh install)
alter table private.feedback add column if not exists topic text not null default 'safety' check (topic in ('safety','crowd'));
alter table private.feedback add column if not exists answers jsonb;
alter table private.feedback add column if not exists comment_status text not null default 'pending' check (comment_status in ('pending','approved','rejected'));
do $$ declare c record; begin           -- drop the old "feeling" rule, whatever it is called
  for c in select conname from pg_constraint
           where conrelid = 'private.feedback'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%feeling%'
  loop execute format('alter table private.feedback drop constraint %I', c.conname); end loop;
end $$;
alter table private.feedback add constraint feedback_feeling_check check (feeling in ('unsafe','hard','good','crowded','busy','calm'));
alter table private.feedback add column if not exists source text not null default 'here_now'
  check (source in ('here_now','remembered'));
alter table private.feedback add column if not exists occurred_at timestamptz;
update private.feedback set occurred_at = created_at where occurred_at is null;
alter table private.feedback alter column occurred_at set default now();
alter table private.feedback alter column occurred_at set not null;

create index if not exists feedback_gix      on private.feedback using gist (geom);
create index if not exists feedback_session  on private.feedback (session_id, created_at);
create index if not exists feedback_occurred on private.feedback (occurred_at);
create index if not exists feedback_topic    on private.feedback (topic);

-- -------------------------------------------------------------- submit API
-- the v1 signature is replaced (a leftover overload would confuse the API)
drop function if exists public.submit_feedback(double precision, double precision, text, text, text, text, text, boolean, text, real, text);          -- v1
drop function if exists public.submit_feedback(double precision, double precision, text, text, text, text, date, text, text, boolean, text, real, text); -- v2 / v2.1
drop function if exists public.submit_feedback(double precision, double precision, text, text, text, text, date, text, text, boolean, text, real, text, time); -- v2.2
drop function if exists public.submit_feedback(double precision, double precision, text, text, text, text, date, text, text, boolean, text, real, text, time, text); -- v3/v4
drop function if exists public.submit_feedback(double precision, double precision, text, text, text, text, date, text, text, boolean, text, real, text, time, text, jsonb); -- current (re-created below)

create or replace function public.submit_feedback(
  p_lat double precision, p_lon double precision,
  p_age_group text, p_feeling text default null, p_category text default null,
  p_source text default 'here_now',
  p_occurred_date date default null,          -- only for 'remembered'
  p_time_of_day text default null,            -- only for 'remembered'
  p_travel_mode text default null,
  p_avoids_place boolean default null,
  p_improvement text default null,
  p_accuracy_m real default null,
  p_consent_version text default null,         -- the app always sends the version of the consent text shown
  p_occurred_time time default null,           -- optional exact time (Paris), only for 'remembered'
  p_topic text default 'safety',               -- 'safety' or 'crowd'
  p_answers jsonb default null                 -- the answers to the questions of that topic (see below)
) returns uuid
language plpgsql security definer
set search_path = public, private, extensions
as $$
declare
  pt      geometry := st_setsrid(st_makepoint(p_lon, p_lat), 4326);
  uid     uuid := auth.uid();
  maxph   int  := (select value from private.settings where key = 'max_per_hour');
  maxpast int  := (select value from private.settings where key = 'max_past_days');
  occ     timestamptz;
  tod     text;
  hr      int;
  new_id  uuid;
  v_feeling  text := p_feeling;
  v_category text := p_category;
  v_score    int;
  v_avg      numeric;
  v_clean    jsonb;
  v_mode     text;
  r          record;
  n_prob     int;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Invalid location';
  end if;

  if p_source is null or p_source not in ('here_now', 'remembered') then
    raise exception 'Invalid report type';
  end if;

  if p_topic is null or p_topic not in ('safety', 'crowd') then
    raise exception 'Invalid topic';
  end if;
  if p_answers is not null then
    -- ---------- new questionnaires: the server checks the answers and works out the circle colour itself
    if jsonb_typeof(p_answers) <> 'object' then raise exception 'Invalid answers'; end if;

    if p_topic = 'safety' then
      -- problems: {"lighting": 2, "crossing": 4}  each problem rated 1 (very unsafe) .. 5 (very safe)
      if coalesce(jsonb_typeof(p_answers->'problems'), '') <> 'object' then raise exception 'Invalid answers'; end if;
      select count(*) into n_prob from jsonb_object_keys(p_answers->'problems');
      if n_prob not between 1 and 8 then raise exception 'Invalid answers'; end if;
      for r in select key, value from jsonb_each(p_answers->'problems') loop
        if not exists (select 1 from public.categories c where c.code = r.key and c.topic = 'safety') then
          raise exception 'Invalid category for this topic';
        end if;
        if jsonb_typeof(r.value) <> 'number' or (r.value::text) !~ '^[1-5]$' then raise exception 'Invalid rating'; end if;
      end loop;
      select avg((value #>> '{}')::numeric) into v_avg from jsonb_each(p_answers->'problems');
      v_score := case when v_avg < 2.5 then 1 when v_avg < 3.5 then 2 else 3 end;
      select key into v_category from jsonb_each(p_answers->'problems') order by (value #>> '{}')::int, key limit 1;
      v_feeling := case v_score when 1 then 'unsafe' when 2 then 'hard' else 'good' end;
      v_clean := jsonb_build_object('problems', p_answers->'problems');
      if p_answers ? 'modes' and jsonb_typeof(p_answers->'modes') <> 'null' then
        if jsonb_typeof(p_answers->'modes') <> 'array' or jsonb_array_length(p_answers->'modes') > 6
           or exists (select 1 from jsonb_array_elements(p_answers->'modes') m
                      where jsonb_typeof(m) <> 'string' or (m #>> '{}') not in ('walk','bike','scooter','bus','metro','car')) then
          raise exception 'Invalid answers';
        end if;
        v_clean := v_clean || jsonb_build_object('modes', p_answers->'modes');
        v_mode := p_answers->'modes'->>0;
      end if;

    else
      -- crowd: people around (5/20/50/100/150), difficulty moving 1 (never) .. 5 (always), usual peak time, effects on movement
      if coalesce(jsonb_typeof(p_answers->'count'), '') <> 'number' or (p_answers->>'count') not in ('5','20','50','100','150') then raise exception 'Invalid answers'; end if;
      if p_answers ? 'difficulty' and jsonb_typeof(p_answers->'difficulty') <> 'null'
         and (jsonb_typeof(p_answers->'difficulty') <> 'number' or (p_answers->>'difficulty') !~ '^[1-5]$') then raise exception 'Invalid answers'; end if;
      v_score := case (p_answers->>'count')::int when 5 then 3 when 20 then 3 when 50 then 2 else 1 end;
      v_feeling := case v_score when 1 then 'crowded' when 2 then 'busy' else 'calm' end;
      v_category := 'crowd_general';
      v_clean := jsonb_build_object('count', p_answers->'count');
      if p_answers ? 'difficulty' and jsonb_typeof(p_answers->'difficulty') = 'number' then v_clean := v_clean || jsonb_build_object('difficulty', p_answers->'difficulty'); end if;
      if p_answers ? 'peak' and jsonb_typeof(p_answers->'peak') <> 'null' then
        if jsonb_typeof(p_answers->'peak') <> 'string' or (p_answers->>'peak') not in ('morning','afternoon','evening','night') then raise exception 'Invalid answers'; end if;
        v_clean := v_clean || jsonb_build_object('peak', p_answers->'peak');
      end if;
      if p_answers ? 'effects' and jsonb_typeof(p_answers->'effects') <> 'null' then
        if jsonb_typeof(p_answers->'effects') <> 'array' or jsonb_array_length(p_answers->'effects') > 6
           or exists (select 1 from jsonb_array_elements(p_answers->'effects') m
                      where jsonb_typeof(m) <> 'string' or (m #>> '{}') not in ('slow_down','change_route','avoid','switch_mode','on_road','no_effect')) then
          raise exception 'Invalid answers';
        end if;
        v_clean := v_clean || jsonb_build_object('effects', p_answers->'effects');
      end if;
    end if;

  else
    -- ---------- older single-answer form (kept so earlier versions of the app still work)
    if p_feeling is null or p_category is null then raise exception 'Invalid answers'; end if;
    if not ((p_topic = 'safety' and p_feeling in ('unsafe', 'hard', 'good'))
         or (p_topic = 'crowd'  and p_feeling in ('crowded', 'busy', 'calm'))) then
      raise exception 'Invalid feeling for this topic';
    end if;
    if not exists (select 1 from public.categories c where c.code = p_category and c.topic = p_topic) then
      raise exception 'Invalid category for this topic';
    end if;
    v_score := case p_feeling when 'unsafe' then 1 when 'crowded' then 1 when 'hard' then 2 when 'busy' then 2 else 3 end;
    v_mode := p_travel_mode;
  end if;

  if p_consent_version is null or char_length(p_consent_version) > 20 then
    raise exception 'Consent required';
  end if;

  if not exists (select 1 from private.study_area a where st_contains(a.geom, pt)) then
    raise exception 'This location is outside the Vauban area';
  end if;

  -- one request at a time per user, so parallel calls cannot slip past the limit
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  if (select count(*) from private.feedback
        where session_id = uid and created_at > now() - interval '1 hour') >= maxph then
    raise exception 'Too many reports, please try again later';
  end if;

  if p_source = 'here_now' then
    -- the time comes from the server clock, whatever the app sends
    occ := now();
    hr  := extract(hour from (now() at time zone 'Europe/Paris'))::int;
    tod := case when hr between 5 and 11 then 'morning'
                when hr between 12 and 17 then 'afternoon'
                when hr between 18 and 21 then 'evening'
                else 'night' end;
  else
    if p_occurred_date is null or (p_time_of_day is null and p_occurred_time is null) then
      raise exception 'Please say when this happened';
    end if;

    if p_occurred_time is not null then
      -- an exact time was given (Paris time): it wins over the time-of-day buttons
      occ := (p_occurred_date + p_occurred_time) at time zone 'Europe/Paris';
      hr  := extract(hour from p_occurred_time)::int;
      tod := case when hr between 5 and 11 then 'morning'
                  when hr between 12 and 17 then 'afternoon'
                  when hr between 18 and 21 then 'evening'
                  else 'night' end;
      if occ > now() then raise exception 'That time is in the future'; end if;
    else
      if p_time_of_day not in ('morning','afternoon','evening','night') then
        raise exception 'Invalid time of day';
      end if;
      -- people remember "yesterday evening", not minutes: use a representative hour (Paris time)
      occ := (p_occurred_date + make_time(case p_time_of_day
                when 'morning' then 8 when 'afternoon' then 14 when 'evening' then 19 else 23 end, 0, 0))
             at time zone 'Europe/Paris';
      if occ > now() then
        -- "this morning" at 06:30: the period has started, so it is not the future; store it as now
        if (p_occurred_date + make_time(case p_time_of_day
              when 'morning' then 5 when 'afternoon' then 12 when 'evening' then 18 else 22 end, 0, 0))
           at time zone 'Europe/Paris' <= now()
        then occ := now();
        else raise exception 'That time is in the future';
        end if;
      end if;
      tod := p_time_of_day;
    end if;

    if occ < now() - make_interval(days => maxpast) then raise exception 'That date is too long ago'; end if;
  end if;

  insert into private.feedback
    (geom, topic, age_group, feeling, score, category, answers, source, occurred_at, travel_mode, time_of_day,
     avoids_place, improvement, comment_status, accuracy_m, consent_version, session_id)
  values
    (pt, p_topic, p_age_group, v_feeling,
     v_score,
     v_category, v_clean, p_source, occ, case when p_answers is null then p_travel_mode else v_mode end, tod, p_avoids_place,
     nullif(trim(p_improvement), ''),
     case when (select value from private.settings where key = 'comments_auto_approve') = 1 then 'approved' else 'pending' end,
     case when p_source = 'here_now' and p_accuracy_m between 0 and 5000 then p_accuracy_m end,
     p_consent_version, uid)
  returning id into new_id;

  return new_id;
end $$;

-- ---------------------------------------------------- public, privacy-safe map
-- Snaps reports to a grid (default 50 m) and only returns cells with >= k reports.
drop function if exists public.get_hotspots();
create or replace function public.get_hotspots(p_topic text default 'safety')
returns json
language sql stable security definer
set search_path = public, private, extensions
as $$
  with s as (
    select (select value from private.settings where key = 'k_threshold') as k,
           (select value from private.settings where key = 'grid_m')      as g
  ),
  cells as (
    select st_snaptogrid(st_transform(f.geom, 2154), s.g) as cell,
           count(*)                                       as reports,
           round(avg(f.score)::numeric, 2)                as avg_score,
           mode() within group (order by f.category)      as top_category,
           round(avg((f.answers->>'count')::numeric))      as avg_count,        -- crowd: people around
           round(avg((f.answers->>'difficulty')::numeric), 1) as avg_difficulty, -- crowd: difficulty moving, 1..5
           -- up to 3 recent comments that the team approved, shown only for areas that pass the privacy rule
           coalesce(to_json((array_agg(f.improvement order by f.created_at desc)
                             filter (where f.comment_status = 'approved' and f.improvement is not null))[1:3]), '[]'::json) as comments
    from private.feedback f, s
    where f.status = 'approved' and f.topic = coalesce(p_topic, 'safety')
    group by 1, s.k
    having count(distinct f.session_id) >= s.k      -- k distinct people, not k reports
  )
  select json_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(json_agg(json_build_object(
      'type', 'Feature',
      'geometry', st_asgeojson(st_transform(cell, 4326))::json,   -- snapped grid point = cell centre
      'properties', json_build_object(
          'reports', reports, 'avg_score', avg_score, 'top_category', top_category, 'avg_count', avg_count, 'avg_difficulty', avg_difficulty, 'comments', comments)
    )), '[]'::json))
  from cells;
$$;

-- ------------------------------------------------------------- obstacles (emoji on the map)
create table if not exists private.obstacles (
  id              uuid primary key default gen_random_uuid(),
  geom            extensions.geometry(Point, 4326) not null,
  emoji           text not null check (char_length(emoji) between 1 and 12),
  age_group       text not null check (age_group in ('under_18','18_25','26_plus')),
  source          text not null default 'here_now' check (source in ('here_now','remembered')),
  occurred_at     timestamptz not null default now(),
  time_of_day     text check (time_of_day in ('morning','afternoon','evening','night')),
  accuracy_m      real,
  status          text not null default 'approved' check (status in ('approved','pending','rejected')),
  consent_version text not null,
  session_id      uuid not null,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists obstacles_gix on private.obstacles using gist (geom);
create index if not exists obstacles_session on private.obstacles (session_id, created_at);

-- turns "here now / remembered + date + time of day or exact time" into the moment it happened (same rules as submit_feedback)
create or replace function private.resolve_when(p_source text, p_date date, p_tod text, p_time time, out occ timestamptz, out tod text)
language plpgsql stable
set search_path = public, private, extensions
as $$
declare
  maxpast int := (select value from private.settings where key = 'max_past_days');
  hr int;
begin
  if p_source = 'here_now' then
    occ := now();
    hr  := extract(hour from (now() at time zone 'Europe/Paris'))::int;
    tod := case when hr between 5 and 11 then 'morning' when hr between 12 and 17 then 'afternoon'
                when hr between 18 and 21 then 'evening' else 'night' end;
    return;
  end if;
  if p_date is null or (p_tod is null and p_time is null) then raise exception 'Please say when this happened'; end if;
  if p_time is not null then
    occ := (p_date + p_time) at time zone 'Europe/Paris';
    hr  := extract(hour from p_time)::int;
    tod := case when hr between 5 and 11 then 'morning' when hr between 12 and 17 then 'afternoon'
                when hr between 18 and 21 then 'evening' else 'night' end;
    if occ > now() then raise exception 'That time is in the future'; end if;
  else
    if p_tod not in ('morning','afternoon','evening','night') then raise exception 'Invalid time of day'; end if;
    occ := (p_date + make_time(case p_tod when 'morning' then 8 when 'afternoon' then 14 when 'evening' then 19 else 23 end, 0, 0)) at time zone 'Europe/Paris';
    if occ > now() then
      if (p_date + make_time(case p_tod when 'morning' then 5 when 'afternoon' then 12 when 'evening' then 18 else 22 end, 0, 0)) at time zone 'Europe/Paris' <= now()
      then occ := now(); else raise exception 'That time is in the future'; end if;
    end if;
    tod := p_tod;
  end if;
  if occ < now() - make_interval(days => maxpast) then raise exception 'That date is too long ago'; end if;
end $$;

drop function if exists public.submit_obstacle(double precision, double precision, text, text, text, date, text, time, real, text);
create or replace function public.submit_obstacle(
  p_lat double precision, p_lon double precision,
  p_age_group text, p_emoji text,
  p_source text default 'here_now',
  p_occurred_date date default null,
  p_time_of_day text default null,
  p_occurred_time time default null,
  p_accuracy_m real default null,
  p_consent_version text default null
) returns uuid
language plpgsql security definer
set search_path = public, private, extensions
as $$
declare
  pt     geometry := st_setsrid(st_makepoint(p_lon, p_lat), 4326);
  uid    uuid := auth.uid();
  maxph  int  := (select value from private.settings where key = 'max_obstacles_per_hour');
  w      record;
  new_id uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then raise exception 'Invalid location'; end if;
  if p_source is null or p_source not in ('here_now', 'remembered') then raise exception 'Invalid report type'; end if;
  if p_age_group is null or p_age_group not in ('under_18','18_25','26_plus') then raise exception 'Invalid answers'; end if;
  -- one emoji: short, no letters, digits, spaces or markup, and not plain ASCII
  if p_emoji is null or char_length(p_emoji) not between 1 and 12 or p_emoji ~ '[[:alnum:][:space:]<>&"'']' or p_emoji ~ '^[\u0001-\u007f]*$' then
    raise exception 'Invalid emoji';
  end if;
  if p_consent_version is null or char_length(p_consent_version) > 20 then raise exception 'Consent required'; end if;
  if not exists (select 1 from private.study_area a where st_contains(a.geom, pt)) then raise exception 'This location is outside the Vauban area'; end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 1));
  if (select count(*) from private.obstacles where session_id = uid and created_at > now() - interval '1 hour') >= maxph then
    raise exception 'Too many reports, please try again later';
  end if;

  select * into w from private.resolve_when(p_source, p_occurred_date, p_time_of_day, p_occurred_time);

  insert into private.obstacles (geom, emoji, age_group, source, occurred_at, time_of_day, accuracy_m, status, consent_version, session_id)
  values (pt, p_emoji, p_age_group, p_source, w.occ, w.tod,
          case when p_source = 'here_now' and p_accuracy_m between 0 and 5000 then p_accuracy_m end,
          case when (select value from private.settings where key = 'obstacles_auto_approve') = 1 then 'approved' else 'pending' end,
          p_consent_version, uid)
  returning id into new_id;
  return new_id;
end $$;

-- the public map of obstacles: same emoji in the same ~10 m square are merged, recent ones only
create or replace function public.get_obstacles()
returns json
language sql stable security definer
set search_path = public, private, extensions
as $$
  with s as (
    select (select value from private.settings where key = 'obstacle_grid_m') as g,
           (select value from private.settings where key = 'obstacle_days')    as d
  ),
  cells as (
    select st_snaptogrid(st_transform(o.geom, 2154), s.g) as cell, o.emoji,
           count(*) as reports, max(o.occurred_at) as last_at
    from private.obstacles o, s
    where o.status = 'approved' and o.occurred_at > now() - make_interval(days => s.d)
    group by 1, 2
    order by max(o.occurred_at) desc
    limit 500
  )
  select json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
    'type', 'Feature',
    'geometry', st_asgeojson(st_transform(cell, 4326))::json,
    'properties', json_build_object('emoji', emoji, 'reports', reports, 'last_at', last_at)
  )), '[]'::json)) from cells;
$$;

-- --------------------------------------------------------------- lock down
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

revoke execute on function public.submit_feedback(double precision, double precision, text, text, text, text, date, text, text, boolean, text, real, text, time, text, jsonb) from public;
revoke execute on function public.submit_feedback(double precision, double precision, text, text, text, text, date, text, text, boolean, text, real, text, time, text, jsonb) from anon;
revoke execute on function public.get_hotspots(text) from public;
grant  execute on function public.submit_feedback(double precision, double precision, text, text, text, text, date, text, text, boolean, text, real, text, time, text, jsonb) to authenticated;  -- anonymous users use the "authenticated" role
grant  execute on function public.get_hotspots(text) to anon, authenticated;
revoke all   on public.categories from anon, authenticated;
grant  select on public.categories to anon, authenticated;

revoke execute on function public.submit_obstacle(double precision, double precision, text, text, text, date, text, time, real, text) from public;
revoke execute on function public.submit_obstacle(double precision, double precision, text, text, text, date, text, time, real, text) from anon;
revoke execute on function public.get_obstacles() from public;
grant  execute on function public.submit_obstacle(double precision, double precision, text, text, text, date, text, time, real, text) to authenticated;
grant  execute on function public.get_obstacles() to anon, authenticated;
