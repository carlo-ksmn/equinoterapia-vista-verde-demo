-- Equinoterapia Vista Verde — wipe the demo DATA and keep the accounts.
--
-- This is the script for the routine refresh described in the README: the seed
-- anchors every date to the moment it runs, so re-running reset.sql + seed.sql
-- re-centres the agenda, the weekly plan and the pay period on today.
--
-- public.profiles is deliberately NOT truncated. Nothing recreates those rows:
-- they are created by an auth trigger when a user signs up, and seed.sql only
-- UPDATEs them (names, roles, targets). Truncating profiles without recreating
-- the auth users would leave the table empty, seed.sql would quietly update
-- zero rows, and the app would have no names, no roles and no working login.
--
-- Usage:
--   1. Run this script
--   2. Run seed.sql
--
-- If you deleted and recreated the auth users, the old profiles rows are now
-- orphaned and you need reset-full.sql instead.
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
  public.inventory_items
cascade;
