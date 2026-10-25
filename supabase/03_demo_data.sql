-- Vauban-CIM · OPTIONAL demo data so the map isn't empty in the presentation.
-- Creates ~300 fake reports (new questionnaires) around four safety hotspots and three crowd hotspots, all flagged is_demo = true.
-- Remove them before real use:   delete from private.feedback where is_demo;
-- (all four spots are inside the Vauban-Esquermes boundary from 02_study_area.sql)
insert into private.feedback
  (geom, topic, age_group, feeling, score, category, answers, source, occurred_at, travel_mode, time_of_day,
   avoids_place, improvement, comment_status, consent_version, session_id, is_demo, created_at)
select
  extensions.st_setsrid(extensions.st_makepoint(h.lon + (random()-0.5)*0.0012, h.lat + (random()-0.5)*0.0008), 4326),
  h.topic,
  (array['under_18','18_25','18_25','26_plus'])[1 + floor(random()*4)::int],
  h.feeling,
  case h.feeling when 'unsafe' then 1 when 'crowded' then 1 when 'hard' then 2 when 'busy' then 2 else 3 end,
  case when h.topic = 'crowd' then 'crowd_general' else h.category end,
  case when h.topic = 'safety' then
         jsonb_build_object('problems', jsonb_build_object(h.category, case h.feeling when 'unsafe' then 1 + floor(random()*2)::int when 'hard' then 3 else 4 + floor(random()*2)::int end),
                            'modes', jsonb_build_array(h.mode))
       else
         jsonb_build_object('count', case h.feeling when 'crowded' then (array[100,150])[1 + floor(random()*2)::int] when 'busy' then 50 else (array[5,20])[1 + floor(random()*2)::int] end,
                            'difficulty', case h.feeling when 'crowded' then 4 + floor(random()*2)::int when 'busy' then 3 else 1 + floor(random()*2)::int end,
                            'peak', (array['morning','afternoon','evening'])[1 + floor(random()*3)::int],
                            'effects', case h.feeling when 'calm' then jsonb_build_array('no_effect') else jsonb_build_array('slow_down','change_route') end)
       end,
  case when random() < 0.35 then 'remembered' else 'here_now' end,
  t.ts,
  h.mode,
  case when extract(hour from (t.ts at time zone 'Europe/Paris')) between 5 and 11 then 'morning'
       when extract(hour from (t.ts at time zone 'Europe/Paris')) between 12 and 17 then 'afternoon'
       when extract(hour from (t.ts at time zone 'Europe/Paris')) between 18 and 21 then 'evening'
       else 'night' end,
  h.feeling in ('unsafe','hard') and random() < 0.6,
  case when random() < 0.35 then h.cm[1 + floor(random() * array_length(h.cm, 1))::int] end,
  'approved',
  'demo', gen_random_uuid(), true,
  t.ts
from (values
  -- safety
  (3.0452, 50.6335, 'safety', 'unsafe',  'bike_lane',      'bike',  55, array['The bike lane just stops with no warning', 'I have to merge with the cars at the junction', 'Really scary on my bike in the morning', 'Piste cyclable coupée au carrefour']),
  (3.0431, 50.6368, 'safety', 'unsafe',  'lighting',       'walk',  40, array['Very dark in the evening near the park', 'I avoid this street after 7 pm', 'One more streetlight would make a big difference', 'Trop sombre le soir']),
  (3.0489, 50.6322, 'safety', 'hard',    'crossing',       'walk',  35, array['No crossing in front of the campus entrance', 'Cars do not stop for pedestrians', 'I always have to run across', 'Pas de passage piéton ici']),
  (3.0475, 50.6372, 'safety', 'good',    'good_place',     'walk',  20, array['Nice and open, feels safe', 'Great spot to sit between classes', 'Calme et agréable']),
  -- crowd
  (3.0440, 50.6342, 'crowd',  'crowded', 'crowd_transit',  'bus',   45, array['The bus is packed at 8:15', 'Impossible to get on during rush hour', 'The platform is far too narrow', 'Toujours bondé le matin']),
  (3.0489, 50.6322, 'crowd',  'busy',    'crowd_sidewalk', 'walk',  30, array['Sidewalk is full when classes end', 'People end up walking on the road', 'Trottoir saturé à la sortie des cours']),
  (3.0431, 50.6368, 'crowd',  'calm',    'crowd_calm',     'walk',  25, array['Always quiet here', 'Perfect place to study outside', 'Jamais de monde'])
) as h(lon, lat, topic, feeling, category, mode, n, cm)
cross join lateral generate_series(1, h.n) as g(i)
cross join lateral (select now() - (random() * interval '25 days') as ts where g.i > 0) as t;   -- references g.i so each row gets its own random time

-- demo obstacles (emoji on the map when zoomed in)
insert into private.obstacles (geom, emoji, age_group, source, occurred_at, time_of_day, status, consent_version, session_id, is_demo, created_at)
select extensions.st_setsrid(extensions.st_makepoint(o.lon, o.lat), 4326), o.emoji, '18_25', 'here_now', t.ts, 'afternoon', 'approved', 'demo', gen_random_uuid(), true, t.ts
from (values
  (3.04495, 50.63350, '🚧'), (3.04520, 50.63362, '🚗'), (3.04310, 50.63680, '🕳️'), (3.04335, 50.63665, '🗑️'),
  (3.04890, 50.63220, '🛴'), (3.04905, 50.63232, '🛴'), (3.04400, 50.63420, '🌳'), (3.04750, 50.63720, '💧'),
  (3.04600, 50.63300, '⛔'), (3.04180, 50.63150, '🚲'), (3.04250, 50.63250, '📦'), (3.04050, 50.63600, '🏗️')
) as o(lon, lat, emoji)
cross join lateral (select now() - (random() * interval '20 days') as ts where o.lon > 0) as t;
