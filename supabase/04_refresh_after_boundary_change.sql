-- Run this ONCE in Supabase → SQL Editor after you re-ran 02_study_area.sql (new boundary):
-- it replaces the demo reports with ones that all lie inside the Vauban-Esquermes boundary,
-- and deletes the two test reports made while connecting the app.
delete from private.feedback where is_demo or improvement = 'TEST-DELETE-ME';
-- then run 03_demo_data.sql again (optional, only for the demo)
