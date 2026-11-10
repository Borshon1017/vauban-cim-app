-- Vauban-CIM · DEMO: a "festival" on the Esplanade, so the AI can be asked "Where is the festival?" in the presentation.
--
-- What it does: adds 5 crowd reports (5 different anonymous sessions, so the 3-people privacy rule is met) at the same
-- spot, near the bus stop ESPLANADE / MAGASIN, each with an already-approved comment that mentions the festival.
-- All rows are flagged is_demo = true and consent_version = 'demo-festival', so they are easy to remove.
--
-- Run it once in Supabase -> SQL Editor. Wait about a minute (the AI caches the map for 60 s), then ask:
--   "Where is the festival?"     or     "Is there any event going on in the district?"
--
-- Remove it after the presentation:
--   delete from private.feedback where consent_version = 'demo-festival';

insert into private.feedback
  (geom, topic, age_group, feeling, score, category, answers, source, occurred_at, travel_mode, time_of_day,
   avoids_place, improvement, comment_status, consent_version, session_id, is_demo, created_at)
select
  extensions.st_setsrid(extensions.st_makepoint(3.05090, 50.64485), 4326),     -- inside Vauban, ~15 m from the Esplanade bus stop
  'crowd', r.age, 'crowded', 1, 'crowd_general',
  jsonb_build_object('count', 150, 'difficulty', 5, 'peak', 'afternoon', 'effects', jsonb_build_array('slow_down', 'change_route')),
  'here_now', now() - r.ago, 'walk', 'afternoon',
  false, r.comment, 'approved', 'demo-festival', gen_random_uuid(), true, now() - r.ago
from (values
  ('18_25',   interval '2 minutes',  'Festival going on here today! Live music, food stalls and lots of people.'),
  ('26_plus', interval '5 minutes',  'There is a festival here right now, very lively but too crowded to walk through.'),
  ('18_25',   interval '9 minutes',  'Street festival this weekend, the whole esplanade is full of stalls and music.'),
  ('under_18',interval '14 minutes', 'Fête en cours ici : concerts et stands, ça déborde sur la route.'),
  ('26_plus', interval '20 minutes', 'Festival de musique ce soir sur l''esplanade, venez nombreux !')
) as r(age, ago, comment);

-- check: this should return one cell near 3.0509 / 50.6448 with the festival comments
-- select public.get_hotspots('crowd');
