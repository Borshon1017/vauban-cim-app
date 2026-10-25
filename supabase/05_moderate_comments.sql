-- Vauban-CIM · moderating comments (run these in Supabase → SQL Editor, one block at a time)
-- A comment is shown on the public map only when its comment_status is 'approved'.
-- New comments start as 'pending'. Nothing is published until your team has read it.

-- 1) See the comments waiting for review
select id, created_at, topic, category, improvement
from private.feedback
where improvement is not null and comment_status = 'pending' and not is_demo
order by created_at;

-- 2) Approve ONE comment (paste its id)
-- update private.feedback set comment_status = 'approved' where id = 'PASTE-THE-ID-HERE';

-- 3) Hide ONE comment for good (insults, names, personal information)
-- update private.feedback set comment_status = 'rejected' where id = 'PASTE-THE-ID-HERE';

-- 4) Approve everything pending (only after you have read the list in step 1)
-- update private.feedback set comment_status = 'approved' where comment_status = 'pending' and improvement is not null;

-- 5) OPTIONAL: publish new comments right away, without review (not recommended for a public launch)
-- update private.settings set value = 1 where key = 'comments_auto_approve';
-- ...and back to review mode:
-- update private.settings set value = 0 where key = 'comments_auto_approve';
