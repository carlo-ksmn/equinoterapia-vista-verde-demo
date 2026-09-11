-- Equinoterapia Vista Verde — wipe all demo data.
--
-- Use this to rebuild the demo from scratch, e.g. after recreating the auth users
-- (deleting a user in Supabase does NOT delete its public.profiles row, and every
-- seeded record references profiles by UUID — so recreating users without this
-- reset leaves the data attached to orphaned profiles).
--
-- Order of operations:
--   1. Delete the auth users (Authentication > Users)
--   2. Run this script
--   3. Create the auth users listed at the top of seed.sql
--   4. Run seed.sql
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
