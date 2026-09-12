-- Equinoterapia Vista Verde — demo seed data — 100% fictional, no real client/staff data.
-- Run AFTER schema.sql, and AFTER creating these 5 auth users
-- (Authentication > Users > Add user, "Auto Confirm User" enabled):
--
--   ana.admin@vistaverde-demo.com         -> Ana Martínez     / colaborador
--   carmen.coord@vistaverde-demo.com      -> Carmen Díaz      / coordinador
--   luis.pesticero@vistaverde-demo.com    -> Luis Fernández   / pesticero
--   sofia.pesticera@vistaverde-demo.com   -> Sofía Ramírez    / pesticero
--   carlos.voluntario@vistaverde-demo.com -> Carlos Gómez     / volunteer
--
-- Names are assigned below by e-mail, so it does not matter whether the "name"
-- key was set in User Metadata when the users were created.
--
-- The four roles drive four different UIs: colaborador = full management view,
-- coordinador = office view, pesticero = daily farm view, volunteer = volunteer view.
--
-- This script INSERTs and is NOT idempotent: run it only against a database whose
-- demo tables are empty, i.e. straight after reset.sql. The precondition block
-- below refuses to run otherwise, and also refuses if the auth users or their
-- profiles rows are missing — both of which would otherwise fail silently.

-- ============================================================
-- PRECONDITION CHECK
-- Everything below assigns names and roles with UPDATE, so an empty or partial
-- profiles table would leave this script doing nothing at all — silently, with a
-- "Success" message. That is the one failure mode worth guarding: it produces a
-- demo that loads but has no names, no roles and no working login.
-- ============================================================

do $$
declare
  expected text[] := array[
    'ana.admin@vistaverde-demo.com',
    'carmen.coord@vistaverde-demo.com',
    'luis.pesticero@vistaverde-demo.com',
    'sofia.pesticera@vistaverde-demo.com',
    'carlos.voluntario@vistaverde-demo.com'
  ];
  missing_users   text;
  missing_profile text;
begin
  select string_agg(e, ', ') into missing_users
  from unnest(expected) e
  where not exists (select 1 from auth.users u where u.email = e);

  if missing_users is not null then
    raise exception
      'seed.sql aborted: these auth users do not exist yet: %. Create them under Authentication > Users (Auto Confirm User enabled), then run this script again.',
      missing_users;
  end if;

  select string_agg(e, ', ') into missing_profile
  from unnest(expected) e
  join auth.users u on u.email = e
  where not exists (select 1 from public.profiles p where p.id = u.id);

  if missing_profile is not null then
    raise exception
      'seed.sql aborted: these users have no public.profiles row: %. Nothing recreates those rows — the auth trigger only fires on sign-up. Delete and recreate the affected auth users, then run this script again.',
      missing_profile;
  end if;

  -- This script INSERTs; it is not idempotent. Some tables would raise a duplicate
  -- key on a second run (horses.name is unique, tasks.id is the primary key) but
  -- clients and the therapy schedule would simply double up, which is harder to
  -- notice. Refuse to run on a database that still holds data.
  if exists (select 1 from public.clients)
     or exists (select 1 from public.tasks)
     or exists (select 1 from public.inventory_items) then
    raise exception
      'seed.sql aborted: the demo tables are not empty. Run reset.sql first (it clears the data and keeps the accounts), then run this script.';
  end if;
end $$;

-- ============================================================
-- PROFILES (auth trigger creates them with role='volunteer'; set names + roles here)
-- daily_target_mins stays NULL on purpose so the app's role defaults apply
-- (coordinador 450 min, pesticero 540 min — see roleDefaultTarget in app.js).
-- ============================================================

update public.profiles p
set name = case u.email
    when 'ana.admin@vistaverde-demo.com'         then 'Ana Martínez'
    when 'carmen.coord@vistaverde-demo.com'      then 'Carmen Díaz'
    when 'luis.pesticero@vistaverde-demo.com'    then 'Luis Fernández'
    when 'sofia.pesticera@vistaverde-demo.com'   then 'Sofía Ramírez'
    when 'carlos.voluntario@vistaverde-demo.com' then 'Carlos Gómez'
    else p.name
  end
from auth.users u
where u.id = p.id;

update public.profiles set role = 'colaborador' where name = 'Ana Martínez';
update public.profiles set role = 'coordinador' where name = 'Carmen Díaz';
update public.profiles set role = 'pesticero'   where name = 'Luis Fernández';
update public.profiles set role = 'pesticero'   where name = 'Sofía Ramírez';
-- Carlos Gómez stays 'volunteer' (trigger default).

-- Hourly rates in DOP (the app renders overtime as "RD$ … · <rate> DOP/h").
insert into public.staff_pay (user_id, hourly_rate)
select id, 180 from public.profiles where name = 'Luis Fernández';
insert into public.staff_pay (user_id, hourly_rate)
select id, 180 from public.profiles where name = 'Sofía Ramírez';
insert into public.staff_pay (user_id, hourly_rate)
select id, 250 from public.profiles where name = 'Carmen Díaz';

-- ============================================================
-- HORSES
-- ============================================================

insert into public.horses (name, active, sort) values
  ('Luna', true, 1),
  ('Trueno', true, 2),
  ('Estrella', true, 3),
  ('Paloma', true, 4),
  ('Nube', true, 5),
  ('Sol', true, 6),
  ('Canela', false, 7);

-- ============================================================
-- CLIENTS + CLIENT_PRIVATE (clients.horse holds the horse NAME, matching horses.name)
-- ============================================================

insert into public.clients (name, horse, is_active, notes) values
  ('Mateo Rivas', 'Luna', true, 'Progreso constante en equilibrio postural.'),
  ('Valentina Cruz', 'Estrella', true, 'Muy motivada, disfruta el cepillado previo.'),
  ('Emilia Torres', 'Paloma', true, 'Requiere acompañamiento doble los primeros minutos.'),
  ('Joaquín Silva', 'Trueno', true, 'Sesiones enfocadas en coordinación motora.'),
  ('Camila Núñez', 'Trueno', true, 'Trabaja la confianza al montar sin apoyo.'),
  ('Andrés Vargas', 'Nube', true, 'Responde muy bien al paso lento.'),
  ('Lucía Herrera', 'Estrella', true, 'Sesiones cortas, buena tolerancia al ruido.'),
  ('Samuel Peña', 'Paloma', true, 'Avanza en fuerza de agarre y postura.'),
  ('Isabella Rojas', 'Luna', false, 'Pausó sesiones por mudanza familiar.'),
  ('Renata Guzmán', 'Sol', false, 'En lista de espera para el próximo ciclo.');

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'TEA - nivel de apoyo 1 (ficticio)', 'Responde bien a rutinas visuales.', 'Carla Rivas', '+1 809 000 0001', 'tutor.rivas@demo-mail.com', 'Calle Ficticia 12, Ciudad Demo'
from public.clients where name = 'Mateo Rivas';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'Parálisis cerebral leve (ficticio)', 'Buen control de tronco al final de sesión.', 'Roberto Cruz', '+1 809 000 0002', 'tutor.cruz@demo-mail.com', 'Avenida Ejemplo 45, Ciudad Demo'
from public.clients where name = 'Valentina Cruz';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'Síndrome de Down (ficticio)', 'Le encanta cantar durante el paso.', 'Marina Torres', '+1 809 000 0003', 'tutor.torres@demo-mail.com', 'Pasaje Prueba 8, Ciudad Demo'
from public.clients where name = 'Emilia Torres';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'TDAH (ficticio)', 'Mejora notable en atención sostenida.', 'Diego Silva', '+1 809 000 0004', 'tutor.silva@demo-mail.com', 'Calle Muestra 3, Ciudad Demo'
from public.clients where name = 'Joaquín Silva';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'Discapacidad visual parcial (ficticio)', 'En pausa temporal.', 'Laura Rojas', '+1 809 000 0005', 'tutor.rojas@demo-mail.com', 'Avenida Simulada 77, Ciudad Demo'
from public.clients where name = 'Isabella Rojas';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'Retraso madurativo (ficticio)', 'Necesita anticipar los cambios de ritmo.', 'Patricia Núñez', '+1 809 000 0006', 'tutor.nunez@demo-mail.com', 'Calle Inventada 21, Ciudad Demo'
from public.clients where name = 'Camila Núñez';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'TEA - nivel de apoyo 2 (ficticio)', 'Prefiere el mismo caballo cada semana.', 'Hugo Vargas', '+1 809 000 0007', 'tutor.vargas@demo-mail.com', 'Avenida Prueba 9, Ciudad Demo'
from public.clients where name = 'Andrés Vargas';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'Hipoacusia leve (ficticia)', 'Usa señas simples durante la sesión.', 'Elena Herrera', '+1 809 000 0008', 'tutor.herrera@demo-mail.com', 'Pasaje Demo 14, Ciudad Demo'
from public.clients where name = 'Lucía Herrera';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'Distrofia muscular (ficticia)', 'Traslado asistido al montar.', 'Julio Peña', '+1 809 000 0009', 'tutor.pena@demo-mail.com', 'Calle Ejemplo 30, Ciudad Demo'
from public.clients where name = 'Samuel Peña';

insert into public.client_private (client_id, diagnosis, notes, tutor_name, phone, email, address)
select id, 'Ansiedad infantil (ficticia)', 'Pendiente de cupo.', 'Sofía Guzmán', '+1 809 000 0010', 'tutor.guzman@demo-mail.com', 'Avenida Ficticia 55, Ciudad Demo'
from public.clients where name = 'Renata Guzmán';

-- ============================================================
-- THERAPY SCHEDULE (weekly recurring slots, day_of_week = ISO 1=Mon .. 7=Sun)
-- ============================================================

-- Four slots per weekday, spread so that all three agenda sections have content
-- (the app buckets by time: 08:30-11:59 morning, 12:00-13:59 midday, rest afternoon).
-- No horse is booked more than three times a day, which is what the "check the
-- board" warning in the agenda watches for.
insert into public.therapy_schedule (client_id, day_of_week, time_slot, is_active)
-- v.slot needs the explicit cast: inside a VALUES list the literal is typed as
-- text, and text -> time is not an implicit cast.
select c.id, v.dow, v.slot::time, true
from (values
  -- Monday
  ('Mateo Rivas',    1, '09:00'),
  ('Camila Núñez',   1, '10:00'),
  ('Andrés Vargas',  1, '12:00'),
  ('Lucía Herrera',  1, '15:00'),
  -- Tuesday
  ('Samuel Peña',    2, '09:00'),
  ('Valentina Cruz', 2, '10:00'),
  ('Joaquín Silva',  2, '12:30'),
  ('Mateo Rivas',    2, '14:30'),
  -- Wednesday
  ('Emilia Torres',  3, '09:00'),
  ('Lucía Herrera',  3, '11:00'),
  ('Camila Núñez',   3, '12:00'),
  ('Andrés Vargas',  3, '16:00'),
  -- Thursday
  ('Andrés Vargas',  4, '09:30'),
  ('Joaquín Silva',  4, '11:00'),
  ('Samuel Peña',    4, '13:00'),
  ('Valentina Cruz', 4, '15:00'),
  -- Friday
  ('Emilia Torres',  5, '09:00'),
  ('Camila Núñez',   5, '10:30'),
  ('Lucía Herrera',  5, '12:00'),
  ('Mateo Rivas',    5, '15:00')
) as v(client_name, dow, slot)
join public.clients c on c.name = v.client_name
where c.is_active;

-- Materialise every scheduled slot across a 4-week window (3 weeks back, 1 week ahead),
-- so the agenda has history and upcoming sessions no matter which weekday the seed runs on.
insert into public.therapy_sessions (schedule_id, date, client_id, horse, time_slot, session_type, status, attendance, client_name, prep_done_by, prep_done_at)
select
  ts.id,
  d::date,
  ts.client_id,
  c.horse,
  ts.time_slot,
  'regular',
  case when d::date < current_date then 'confirmo' else 'pendiente' end,
  case when d::date < current_date then 'asistio' else null end,
  c.name,
  case when d::date < current_date then (select id from public.profiles where name = 'Luis Fernández') else null end,
  case when d::date < current_date then d::date + time '08:30' else null end
from public.therapy_schedule ts
join public.clients c on c.id = ts.client_id
cross join generate_series((current_date - 21)::timestamp, (current_date + 7)::timestamp, interval '1 day') d
where extract(isodow from d) = ts.day_of_week;

-- A bit of variety: one cancelled/absent session and one first-time evaluation.
update public.therapy_sessions
set status = 'cancelo', attendance = 'ausente', notes = 'Cancelado por lluvia (ficticio).'
where id = (
  select id from public.therapy_sessions
  where client_name = 'Joaquín Silva' and date < current_date
  order by date desc limit 1
);

insert into public.therapy_sessions (date, client_id, horse, time_slot, session_type, status, client_name, notes)
select current_date + 2, id, horse, '16:00', 'primera_vez', 'pendiente', name, 'Primera evaluación (ficticia).'
from public.clients where name = 'Isabella Rojas';

-- ============================================================
-- TASKS
-- The app distributes daily tasks via assignee_id (DAILY_BY_USER[r.assignee_id]),
-- and splits the views by scope: 'finca' = pesticero, 'oficina' = coordinador.
-- ============================================================

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'feed-horses-am', 'Alimentar caballos (mañana)', 'Feed horses (morning)', 'daily', 1, 'finca', 'individual', id, 'pesticero', '07:00', 30, 1
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'clean-stalls', 'Limpiar establos', 'Muck out stalls', 'daily', 1, 'finca', 'individual', id, 'pesticero', '08:00', 45, 3
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'prep-session-material', 'Preparar material de sesión', 'Prepare session equipment', 'daily', 1, 'finca', 'individual', id, 'pesticero', '08:30', 20, 4
from public.profiles where name = 'Sofía Ramírez';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'feed-horses-pm', 'Alimentar caballos (tarde)', 'Feed horses (afternoon)', 'daily', 1, 'finca', 'individual', id, 'pesticero', '16:00', 30, 7
from public.profiles where name = 'Sofía Ramírez';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'weekly-tack-check', 'Revisar y limpiar monturas', 'Check and clean tack', 'weekly', 1, 'finca', 'shared', id, 'pesticero', '16:00', 60, 9
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'biweekly-paddock-check', 'Revisión de cercas y potreros', 'Fence and paddock check', 'biweekly', 1, 'finca', 'shared', id, 'pesticero', '15:00', 90, 11
from public.profiles where name = 'Sofía Ramírez';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'turnout-horses', 'Sacar caballos al potrero', 'Turn horses out to paddock', 'daily', 1, 'finca', 'individual', id, 'pesticero', '07:30', 25, 2
from public.profiles where name = 'Sofía Ramírez';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'check-water', 'Revisar bebederos', 'Check water troughs', 'daily', 1, 'finca', 'individual', id, 'pesticero', '09:30', 15, 5
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'sweep-arena', 'Barrer el picadero', 'Sweep the arena', 'daily', 1, 'finca', 'individual', id, 'pesticero', '13:30', 20, 6
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'evening-stable-check', 'Ronda de cierre en establos', 'Evening stable round', 'daily', 1, 'finca', 'individual', id, 'pesticero', '16:45', 20, 8
from public.profiles where name = 'Sofía Ramírez';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'weekly-deep-clean', 'Limpieza profunda de establos', 'Deep clean stables', 'weekly', 2, 'finca', 'shared', id, 'pesticero', '14:00', 75, 10
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'monthly-vet-prep', 'Preparar visita veterinaria', 'Prepare vet visit', 'monthly', 1, 'finca', 'shared', id, 'pesticero', '10:00', 60, 12
from public.profiles where name = 'Sofía Ramírez';

-- Office scope -> coordinador view
insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'office-agenda-review', 'Revisar agenda de terapias', 'Review therapy schedule', 'daily', 1, 'oficina', 'individual', id, 'coordinador', '08:30', 30, 1
from public.profiles where name = 'Carmen Díaz';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'office-family-calls', 'Llamadas de seguimiento a familias', 'Follow-up calls to families', 'daily', 1, 'oficina', 'individual', id, 'coordinador', '11:00', 45, 2
from public.profiles where name = 'Carmen Díaz';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'monthly-inventory-count', 'Conteo mensual de inventario', 'Monthly stock count', 'monthly', 1, 'oficina', 'individual', id, 'coordinador', '10:00', 90, 6
from public.profiles where name = 'Carmen Díaz';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'office-confirm-next-day', 'Confirmar sesiones del día siguiente', 'Confirm next day sessions', 'daily', 1, 'oficina', 'individual', id, 'coordinador', '15:00', 30, 3
from public.profiles where name = 'Carmen Díaz';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'office-waitlist', 'Actualizar lista de espera', 'Update the waiting list', 'weekly', 1, 'oficina', 'individual', id, 'coordinador', '13:00', 40, 4
from public.profiles where name = 'Carmen Díaz';

insert into public.tasks (id, name, name_en, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'office-invoices', 'Registrar facturas en Alegra', 'Log invoices in Alegra', 'weekly', 1, 'oficina', 'individual', id, 'coordinador', '14:00', 60, 5
from public.profiles where name = 'Carmen Díaz';

-- Completions for the last 7 days, always by the task's own assignee.
insert into public.task_completions (user_id, task_id, task_type, date, completed_at)
select t.assignee_id, t.id, 'daily', (current_date - g),
       (current_date - g) + t.default_time + interval '5 minutes'
from public.tasks t
cross join generate_series(1, 7) g
where t.cadence = 'daily'
  and extract(isodow from (current_date - g)) <= 5;

insert into public.task_completions (user_id, task_id, task_type, date, completed_at)
select t.assignee_id, t.id, 'weekly', (current_date - 7), (current_date - 7) + time '16:45'
from public.tasks t where t.id = 'weekly-tack-check';

-- Today, on a weekday: tick off whatever was already due when the seed ran, so the
-- daily plan opens on a believable half-finished day rather than a wall of overdue
-- rows. Nothing is stamped in the future, whatever time of day this runs.
insert into public.task_completions (user_id, task_id, task_type, date, completed_at)
select t.assignee_id, t.id, 'daily', current_date,
       current_date + t.default_time + interval '4 minutes'
from public.tasks t
where t.cadence = 'daily'
  and extract(isodow from current_date) <= 5
  and t.default_time + interval '4 minutes' < current_time;

-- weekly-deep-clean needs two completions a week, so leave it at 1/2 in progress.
insert into public.task_completions (user_id, task_id, task_type, date, completed_at)
select t.assignee_id, t.id, 'weekly',
       greatest(date_trunc('week', current_date::timestamp)::date, current_date - 3),
       greatest(date_trunc('week', current_date::timestamp)::date, current_date - 3) + time '14:50'
from public.tasks t where t.id = 'weekly-deep-clean';

-- ============================================================
-- VOLUNTEER POOL (task_id is a free-text key; name_en drives the EN toggle, as in tasks)
-- ============================================================

insert into public.volunteer_pool (task_id, name, name_en, sort, active) values
  ('vol-grooming',  'Cepillado de caballos',      'Horse grooming',    1, true),
  ('vol-tack',      'Limpieza de monturas',       'Tack cleaning',     2, true),
  ('vol-paddock',   'Recoger el picadero',        'Tidy the arena',    3, true),
  ('vol-events',    'Apoyo en eventos',           'Event support',     4, true),
  ('vol-feed-help', 'Apoyo en la alimentación',   'Feeding support',   5, true),
  ('vol-garden',    'Mantenimiento de jardines',  'Garden upkeep',     6, true);

-- Volunteer pool completions use task_type 'vol_pool'.
insert into public.task_completions (user_id, task_id, task_type, date, completed_at)
select id, 'vol-grooming', 'vol_pool', current_date - 3, (current_date - 3) + time '10:15'
from public.profiles where name = 'Carlos Gómez';

insert into public.task_completions (user_id, task_id, task_type, date, completed_at)
select id, 'vol-tack', 'vol_pool', current_date - 9, (current_date - 9) + time '11:40'
from public.profiles where name = 'Carlos Gómez';

-- ============================================================
-- WEEK PLAN (start_time is plain text 'HH:MM')
-- ============================================================

insert into public.week_plan (user_id, task_name, task_name_en, task_id, day_of_week, week_start, start_time, duration_mins, confirmed, created_by)
select p.id, tk.name, tk.name_en, tk.id, v.dow,
       date_trunc('week', current_date::timestamp)::date, v.slot, v.dur, v.confirmed, a.id
from (values
  ('Luis Fernández',  'weekly-deep-clean',      1, '14:00', 75, true),
  ('Luis Fernández',  'weekly-tack-check',      3, '16:00', 60, true),
  ('Luis Fernández',  'monthly-vet-prep',       5, '10:00', 60, true),
  ('Sofía Ramírez',   'weekly-deep-clean',      2, '14:00', 75, true),
  ('Sofía Ramírez',   'weekly-tack-check',      4, '16:00', 60, false),
  ('Sofía Ramírez',   'biweekly-paddock-check', 5, '15:00', 90, false)
) as v(person, task_id, dow, slot, dur, confirmed)
join public.profiles p on p.name = v.person
join public.tasks   tk on tk.id  = v.task_id
cross join (select id from public.profiles where name = 'Ana Martínez') a;

-- ============================================================
-- EXTRA TASKS
-- ============================================================

insert into public.extra_tasks (assigned_to, created_by, name, name_en, date, duration_mins, note, recurrence)
select l.id, a.id, 'Reparar cerca del picadero', 'Repair the arena fence', current_date, 90, 'Sección norte (ficticio).', 'once'
from public.profiles l, public.profiles a
where l.name = 'Luis Fernández' and a.name = 'Ana Martínez';

insert into public.extra_tasks (assigned_to, created_by, name, name_en, date, duration_mins, note, recurrence)
select s.id, a.id, 'Ordenar la sala de monturas', 'Tidy the tack room', current_date, 45, 'Antes de la visita del sábado (ficticio).', 'once'
from public.profiles s, public.profiles a
where s.name = 'Sofía Ramírez' and a.name = 'Ana Martínez';

-- ============================================================
-- TIME ENTRIES — weekdays only, last 14 days.
-- Pesticeros work 07:00–17:00 (600 min) against a 540 min target -> positive overtime bank,
-- which makes the compensation card show an RD$ amount in the demo.
-- ============================================================

insert into public.time_entries (user_id, entry_type, clock_in, clock_out)
select p.id, 'work', (current_date - g) + time '07:00', (current_date - g) + time '17:00'
from public.profiles p
cross join generate_series(1, 14) g
where p.role = 'pesticero' and extract(isodow from (current_date - g)) <= 5;

insert into public.time_entries (user_id, entry_type, clock_in, clock_out)
select p.id, 'merienda', (current_date - g) + time '12:00', (current_date - g) + time '12:30'
from public.profiles p
cross join generate_series(1, 14) g
where p.role = 'pesticero' and extract(isodow from (current_date - g)) <= 5;

insert into public.time_entries (user_id, entry_type, clock_in, clock_out)
select p.id, 'work', (current_date - g) + time '08:00', (current_date - g) + time '16:00'
from public.profiles p
cross join generate_series(1, 14) g
where p.role = 'coordinador' and extract(isodow from (current_date - g)) <= 5;

insert into public.time_entries (user_id, entry_type, clock_in, clock_out)
select p.id, 'work', (current_date - g) + time '09:00', (current_date - g) + time '12:00'
from public.profiles p
cross join generate_series(3, 10, 7) g
where p.role = 'volunteer';

-- ============================================================
-- COMPENSATION REQUESTS (type is 'money' or 'time_off'; status pending/approved/denied)
-- ============================================================

insert into public.compensation_requests (user_id, type, hours_requested, status, note)
select id, 'money', 4, 'pending', 'Horas acumuladas del período (ficticio).'
from public.profiles where name = 'Luis Fernández';

insert into public.compensation_requests (user_id, type, hours_requested, status, note)
select id, 'time_off', 3, 'approved', 'Compensación en tiempo libre (ficticio).'
from public.profiles where name = 'Sofía Ramírez';

-- ============================================================
-- ATTENDANCE OVERRIDES (the app inserts these without `type`, relying on the
-- 'ausencia_injustificada' default — so we do the same here.)
-- ============================================================

insert into public.attendance_overrides (user_id, date, note, created_by)
select s.id, current_date - 10, 'No se presentó (ficticio).', a.id
from public.profiles s, public.profiles a
where s.name = 'Sofía Ramírez' and a.name = 'Ana Martínez';

-- ============================================================
-- INVENTORY (unit_type: 'count' default, 'pct' for level-style items, 'free' for free text)
-- ============================================================

insert into public.inventory_items (name, name_en, category, category_en, quantity, unit, unit_en, min_stock, threshold_week, emoji, unit_type, sort_order) values
  ('Heno',               'Hay',                     'Alimentación', 'Feed',      40, 'pacas',    'bales', 10, 12, '🌾', 'count', 1),
  ('Concentrado equino', 'Equine concentrate feed', 'Alimentación', 'Feed',      18, 'sacos',    'sacks',  6,  8, '🥣', 'count', 2),
  ('Silo de alimento',   'Feed silo',               'Alimentación', 'Feed',      65, '%',        '%',    null, null, '🛢', 'pct',   3),
  ('Cascos de repuesto', 'Spare horseshoes',        'Equipo',       'Equipment',  6, 'unidades', 'units',  2, null, '🐴', 'count', 4),
  ('Guantes de trabajo', 'Work gloves',             'Equipo',       'Equipment', 15, 'pares',    'pairs',  5, null, '🧤', 'count', 5),
  ('Cepillos de aseo',   'Grooming brushes',        'Equipo',       'Equipment', 10, 'unidades', 'units',  3, null, '🧹', 'count', 6),
  ('Botiquín',           'First-aid kit',           'Salud',        'Health',     1, 'kit',      'kit',    1, null, '🩹', 'free',  7),
  ('Avena',              'Oats',                    'Alimentación', 'Feed',       4, 'sacos',    'sacks',  6,  8, '🌰', 'count', 8),
  ('Sal mineral',        'Mineral salt',            'Alimentación', 'Feed',       7, 'kg',       'kg',     4,  8, '🧂', 'count', 9),
  ('Mantas',             'Blankets',                'Equipo',       'Equipment',  8, 'unidades', 'units',  3, null, '🧶', 'count', 10),
  ('Cuerdas de guía',    'Lead ropes',              'Equipo',       'Equipment',  9, 'unidades', 'units',  4, null, '🪢', 'count', 11),
  ('Vendas',             'Bandages',                'Salud',        'Health',    12, 'rollos',   'rolls',  5, null, '🩺', 'count', 12),
  ('Desinfectante',      'Disinfectant',            'Salud',        'Health',     2, 'litros',   'litres', 3, null, '🧴', 'count', 13);

insert into public.inventory_snapshots (taken_by, note, taken_at)
values ('Carmen Díaz', 'Conteo mensual (ficticio)', now() - interval '20 days');

insert into public.inventory_snapshot_lines (snapshot_id, item_name, item_name_en, emoji, category, category_en, quantity, unit, unit_en, unit_type, sort_order)
select s.id, i.name, i.name_en, i.emoji, i.category, i.category_en, i.quantity, i.unit, i.unit_en, i.unit_type, i.sort_order
from public.inventory_snapshots s, public.inventory_items i
where s.note = 'Conteo mensual (ficticio)';

-- ============================================================
-- LEGACY TABLES
-- absences, income and expenses exist in the schema but are not read by this
-- version of app.js. Seeded minimally so the schema is exercised end to end.
-- Amounts are in DOP, matching the RD$ formatting used elsewhere in the app.
-- ============================================================

insert into public.absences (user_id, date, reason, note)
select id, current_date - 17, 'cita_medica', 'Ausencia justificada (ficticia).'
from public.profiles where name = 'Luis Fernández';

insert into public.income (date, amount, concept, client_id, created_by)
select current_date - 5, 3500, 'Cuota mensual de terapia (ficticia)', c.id, a.id
from public.clients c, public.profiles a
where c.name = 'Mateo Rivas' and a.name = 'Ana Martínez';

insert into public.expenses (date, category, amount, concept, created_by)
select current_date - 3, 'Alimentación', 8200, 'Compra de heno (ficticia)', id
from public.profiles where name = 'Ana Martínez';
