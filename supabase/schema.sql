-- Equinoterapia Vista Verde — demo project schema
-- Reconstructed from the production Supabase project's information_schema/pg_catalog export.
-- Run this once in the SQL Editor of the NEW (demo) Supabase project, before seed.sql.

create extension if not exists pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================

create table public.profiles (
  id uuid primary key,
  name text,
  role text,
  language text default 'es',
  created_at timestamptz default now(),
  daily_target_mins integer,
  active boolean not null default true
);

create table public.horses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort integer default 0,
  created_at timestamptz default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  horse text not null,
  is_active boolean default true,
  notes text,
  created_at timestamptz default now()
);

create table public.client_private (
  client_id uuid primary key references public.clients(id) on delete cascade,
  diagnosis text,
  notes text,
  tutor_name text,
  phone text,
  email text,
  address text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table public.therapy_schedule (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  day_of_week integer not null check (day_of_week >= 1 and day_of_week <= 7),
  time_slot time not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.therapy_sessions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.therapy_schedule(id) on delete set null,
  date date not null,
  client_id uuid references public.clients(id) on delete cascade,
  horse text not null,
  time_slot time not null,
  session_type text not null default 'regular' check (session_type in ('regular','primera_vez','reposicion','extra')),
  status text not null default 'pendiente' check (status in ('pendiente','confirmo','cancelo')),
  notes text,
  created_at timestamptz default now(),
  client_name text,
  attendance text,
  prep_done_by uuid references public.profiles(id),
  prep_done_at timestamptz
);

create table public.tasks (
  id text primary key,
  name text not null,
  name_en text,
  cadence text not null check (cadence in ('daily','weekly','biweekly','monthly')),
  frequency_count integer not null default 1,
  scope text not null check (scope in ('finca','oficina','ejecutivo')),
  completion_mode text not null default 'individual' check (completion_mode in ('shared','individual')),
  assignee_id uuid references public.profiles(id) on delete set null,
  target_role text,
  default_time time,
  duration_mins integer,
  note text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  task_id text,
  task_type text,
  date date,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id, task_id, date)
);

create table public.week_plan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  task_name text not null,
  task_name_en text,
  task_id text,
  day_of_week integer not null check (day_of_week >= 1 and day_of_week <= 7),
  week_start date not null,
  start_time text,
  duration_mins integer,
  note text,
  confirmed boolean default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table public.extra_tasks (
  id uuid primary key default gen_random_uuid(),
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  name text,
  name_en text,
  date date,
  duration_mins integer,
  note text,
  recurrence text default 'once',
  created_at timestamptz default now()
);

create table public.volunteer_pool (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  name text not null,
  sort integer default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  name_en text
);

create table public.staff_pay (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hourly_rate numeric,
  daily_target_mins integer,
  created_at timestamptz default now()
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  entry_type text,
  clock_in timestamptz,
  clock_out timestamptz,
  gps_lat double precision,
  gps_lng double precision,
  created_at timestamptz default now()
);

create table public.compensation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  type text,
  hours_requested numeric,
  status text default 'pending',
  note text,
  created_at timestamptz default now()
);

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  date date,
  reason text,
  note text,
  created_at timestamptz default now()
);

create table public.attendance_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  type text not null default 'ausencia_injustificada',
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create table public.income (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric not null,
  concept text,
  client_id uuid references public.clients(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  category text,
  amount numeric not null,
  concept text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_en text,
  category text,
  category_en text,
  quantity numeric not null default 0,
  unit text,
  unit_en text,
  min_stock numeric,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  emoji text,
  unit_type text default 'count',
  threshold_week numeric,
  sort_order integer default 100
);

create table public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  taken_by text,
  note text,
  created_at timestamptz not null default now()
);

create table public.inventory_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.inventory_snapshots(id) on delete cascade,
  item_name text not null,
  item_name_en text,
  emoji text,
  category text,
  category_en text,
  quantity numeric,
  unit text,
  unit_en text,
  unit_type text,
  sort_order integer default 100
);

-- ============================================================
-- HELPER FUNCTION + AUTH TRIGGER
-- ============================================================

create or replace function public.my_role()
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select role from public.profiles where id = auth.uid();
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, name, role, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'name',''), 'volunteer', true);
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.time_entries enable row level security;
alter table public.compensation_requests enable row level security;
alter table public.absences enable row level security;
alter table public.clients enable row level security;
alter table public.therapy_schedule enable row level security;
alter table public.task_completions enable row level security;
alter table public.week_plan enable row level security;
alter table public.extra_tasks enable row level security;
alter table public.horses enable row level security;
alter table public.volunteer_pool enable row level security;
alter table public.staff_pay enable row level security;
alter table public.client_private enable row level security;
alter table public.therapy_sessions enable row level security;
alter table public.income enable row level security;
alter table public.expenses enable row level security;
alter table public.attendance_overrides enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.inventory_snapshot_lines enable row level security;
alter table public.tasks enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or my_role() = any (array['colaborador','coordinador']));

create policy time_entries_select on public.time_entries for select to authenticated
  using (user_id = auth.uid() or my_role() = any (array['colaborador','coordinador']));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (user_id = auth.uid());
create policy time_entries_update on public.time_entries for update to authenticated
  using (user_id = auth.uid() or my_role() = any (array['colaborador','coordinador']));
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (my_role() = any (array['colaborador','coordinador']));

create policy comp_select on public.compensation_requests for select to authenticated
  using (user_id = auth.uid() or my_role() = any (array['colaborador','coordinador']));
create policy comp_insert on public.compensation_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy comp_update on public.compensation_requests for update to authenticated
  using (my_role() = any (array['colaborador','coordinador']));
create policy comp_delete on public.compensation_requests for delete to authenticated
  using (my_role() = any (array['colaborador','coordinador']));

create policy absences_select on public.absences for select to authenticated
  using (user_id = auth.uid() or my_role() = any (array['colaborador','coordinador']));
create policy absences_write on public.absences for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy clients_select on public.clients for select to authenticated using (true);
create policy clients_write on public.clients for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy therapy_schedule_select on public.therapy_schedule for select to authenticated using (true);
create policy therapy_schedule_write on public.therapy_schedule for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy taskc_select on public.task_completions for select to authenticated using (true);
create policy taskc_insert on public.task_completions for insert to authenticated
  with check (user_id = auth.uid());
create policy taskc_update on public.task_completions for update to authenticated
  using (user_id = auth.uid());
create policy taskc_delete on public.task_completions for delete to authenticated
  using (user_id = auth.uid() or my_role() = any (array['colaborador','coordinador']));

create policy weekplan_select on public.week_plan for select to authenticated using (true);
create policy weekplan_write on public.week_plan for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy extra_select on public.extra_tasks for select to authenticated using (true);
create policy extra_write on public.extra_tasks for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy horses_select on public.horses for select to authenticated using (true);
create policy horses_write on public.horses for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy volunteer_pool_select on public.volunteer_pool for select to authenticated using (true);
create policy volunteer_pool_write on public.volunteer_pool for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy staff_pay_select on public.staff_pay for select to authenticated
  using (user_id = auth.uid() or my_role() = any (array['colaborador','coordinador']));
create policy staff_pay_write on public.staff_pay for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy client_private_rw on public.client_private for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy therapy_sessions_select on public.therapy_sessions for select to authenticated using (true);
create policy therapy_sessions_write on public.therapy_sessions for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy income_rw on public.income for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy expenses_rw on public.expenses for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy ao_select_all on public.attendance_overrides for select to authenticated using (true);
create policy ao_insert_colaborador on public.attendance_overrides for insert to authenticated
  with check (my_role() = 'colaborador');
create policy ao_delete_colaborador on public.attendance_overrides for delete to authenticated
  using (my_role() = 'colaborador');

create policy inventory_rw on public.inventory_items for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy snap_rw on public.inventory_snapshots for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy snapline_rw on public.inventory_snapshot_lines for all to authenticated
  using (my_role() = any (array['colaborador','coordinador']))
  with check (my_role() = any (array['colaborador','coordinador']));

create policy tasks_select_all_authenticated on public.tasks for select to authenticated using (true);
