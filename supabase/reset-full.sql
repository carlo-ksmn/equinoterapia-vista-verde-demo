-- Equinoterapia Vista Verde — full wipe, INCLUDING public.profiles.
--
-- ⚠ Only use this when you have deleted the auth users, or are about to.
-- Deleting a user in Supabase does NOT delete its public.profiles row, and every
-- seeded record references profiles by UUID — so recreating users without this
-- reset leaves the data attached to orphaned profiles.
--
-- After this script the profiles table is EMPTY and stays empty until the auth
-- users exist again: the rows are created by an auth trigger on sign-up, and
-- seed.sql only UPDATEs them. Running seed.sql before step 3 below updates zero
-- rows and leaves the app with no names, no roles and no working login.
--
-- Order of operations:
--   1. Delete the auth users (Authentication > Users)
--   2. Run this script
--   3. Create the auth users listed at the top of seed.sql
--   4. Run seed.sql
--
-- For the routine data refresh, use reset.sql instead — it keeps the accounts.
--
-- This touches the public schema only; the auth schema is left alone.

truncate table
  public.task_completions,
  public.time_entries,
  public.compensation_requests,
  public.absences,
  public.attendance_overrides,
  public.week_plan,
  public.extra_tasks,
  public.tasks,
  public.volunteer_pool,
  public.staff_pay,
  public.therapy_sessions,
  public.therapy_schedule,
  public.client_private,
  public.clients,
  public.horses,
  public.income,
  public.expenses,
  public.inventory_snapshot_lines,
  public.inventory_snapshots,
  public.inventory_items,
  public.profiles
cascade;
