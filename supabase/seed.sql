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
  ('Canela', false, 5);

-- ============================================================
-- CLIENTS + CLIENT_PRIVATE (clients.horse holds the horse NAME, matching horses.name)
-- ============================================================

insert into public.clients (name, horse, is_active, notes) values
  ('Mateo Rivas', 'Luna', true, 'Progreso constante en equilibrio postural.'),
  ('Valentina Cruz', 'Estrella', true, 'Muy motivada, disfruta el cepillado previo.'),
  ('Emilia Torres', 'Paloma', true, 'Requiere acompañamiento doble los primeros minutos.'),
  ('Joaquín Silva', 'Trueno', true, 'Sesiones enfocadas en coordinación motora.'),
  ('Isabella Rojas', 'Luna', false, 'Pausó sesiones por mudanza familiar.');

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

-- ============================================================
-- THERAPY SCHEDULE (weekly recurring slots, day_of_week = ISO 1=Mon .. 7=Sun)
-- ============================================================

insert into public.therapy_schedule (client_id, day_of_week, time_slot, is_active)
select id, 1, '09:00', true from public.clients where name = 'Mateo Rivas';
insert into public.therapy_schedule (client_id, day_of_week, time_slot, is_active)
select id, 2, '10:00', true from public.clients where name = 'Valentina Cruz';
insert into public.therapy_schedule (client_id, day_of_week, time_slot, is_active)
select id, 3, '09:00', true from public.clients where name = 'Emilia Torres';
insert into public.therapy_schedule (client_id, day_of_week, time_slot, is_active)
select id, 4, '11:00', true from public.clients where name = 'Joaquín Silva';
insert into public.therapy_schedule (client_id, day_of_week, time_slot, is_active)
select id, 5, '15:00', true from public.clients where name = 'Mateo Rivas';

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

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'feed-horses-am', 'Alimentar caballos (mañana)', 'daily', 1, 'finca', 'individual', id, 'pesticero', '07:00', 30, 1
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'clean-stalls', 'Limpiar establos', 'daily', 1, 'finca', 'individual', id, 'pesticero', '08:00', 45, 2
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'prep-session-material', 'Preparar material de sesión', 'daily', 1, 'finca', 'individual', id, 'pesticero', '08:30', 20, 3
from public.profiles where name = 'Sofía Ramírez';

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'feed-horses-pm', 'Alimentar caballos (tarde)', 'daily', 1, 'finca', 'individual', id, 'pesticero', '16:00', 30, 4
from public.profiles where name = 'Sofía Ramírez';

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'weekly-tack-check', 'Revisar y limpiar monturas', 'weekly', 1, 'finca', 'shared', id, 'pesticero', '16:00', 60, 5
from public.profiles where name = 'Luis Fernández';

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'biweekly-paddock-check', 'Revisión de cercas y potreros', 'biweekly', 1, 'finca', 'shared', id, 'pesticero', '15:00', 90, 6
from public.profiles where name = 'Sofía Ramírez';

-- Office scope -> coordinador view
insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'office-agenda-review', 'Revisar agenda de terapias', 'daily', 1, 'oficina', 'individual', id, 'coordinador', '08:30', 30, 1
from public.profiles where name = 'Carmen Díaz';

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'office-family-calls', 'Llamadas de seguimiento a familias', 'daily', 1, 'oficina', 'individual', id, 'coordinador', '11:00', 45, 2
from public.profiles where name = 'Carmen Díaz';

insert into public.tasks (id, name, cadence, frequency_count, scope, completion_mode, assignee_id, target_role, default_time, duration_mins, sort_order)
select 'monthly-inventory-count', 'Conteo mensual de inventario', 'monthly', 1, 'oficina', 'individual', id, 'coordinador', '10:00', 90, 3
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

-- ============================================================
-- VOLUNTEER POOL (task_id is a free-text key, name_en drives the EN toggle)
-- ============================================================

insert into public.volunteer_pool (task_id, name, name_en, sort, active) values
  ('vol-grooming',  'Cepillado de caballos',      'Horse grooming',    1, true),
  ('vol-tack',      'Limpieza de monturas',       'Tack cleaning',     2, true),
  ('vol-paddock',   'Recoger el picadero',        'Tidy the arena',    3, true),
  ('vol-events',    'Apoyo en eventos',           'Event support',     4, true);

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

insert into public.week_plan (user_id, task_name, task_id, day_of_week, week_start, start_time, duration_mins, confirmed, created_by)
select p.id, 'Revisar y limpiar monturas', 'weekly-tack-check', 3, date_trunc('week', current_date::timestamp)::date, '16:00', 60, true, a.id
from public.profiles p, public.profiles a
where p.name = 'Luis Fernández' and a.name = 'Ana Martínez';

insert into public.week_plan (user_id, task_name, task_id, day_of_week, week_start, start_time, duration_mins, confirmed, created_by)
select p.id, 'Revisión de cercas y potreros', 'biweekly-paddock-check', 5, date_trunc('week', current_date::timestamp)::date, '15:00', 90, false, a.id
from public.profiles p, public.profiles a
where p.name = 'Sofía Ramírez' and a.name = 'Ana Martínez';

-- ============================================================
-- EXTRA TASKS
-- ============================================================

insert into public.extra_tasks (assigned_to, created_by, name, date, duration_mins, note, recurrence)
select l.id, a.id, 'Reparar cerca del picadero', current_date, 90, 'Sección norte (ficticio).', 'once'
from public.profiles l, public.profiles a
where l.name = 'Luis Fernández' and a.name = 'Ana Martínez';

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

insert into public.inventory_items (name, category, quantity, unit, min_stock, threshold_week, emoji, unit_type, sort_order) values
  ('Heno',               'Alimentación', 40, 'pacas',    10, 12, '🌾', 'count', 1),
  ('Concentrado equino', 'Alimentación', 18, 'sacos',     6,  8, '🥣', 'count', 2),
  ('Silo de alimento',   'Alimentación', 65, '%',       null, null, '🛢', 'pct',   3),
  ('Cascos de repuesto', 'Equipo',        6, 'unidades',  2, null, '🐴', 'count', 4),
  ('Guantes de trabajo', 'Equipo',       15, 'pares',     5, null, '🧤', 'count', 5),
  ('Cepillos de aseo',   'Equipo',       10, 'unidades',  3, null, '🧹', 'count', 6),
  ('Botiquín',           'Salud',         1, 'kit',       1, null, '🩹', 'free',  7);

insert into public.inventory_snapshots (taken_by, note, taken_at)
values ('Carmen Díaz', 'Conteo mensual (ficticio)', now() - interval '20 days');

insert into public.inventory_snapshot_lines (snapshot_id, item_name, emoji, category, quantity, unit, unit_type, sort_order)
select s.id, i.name, i.emoji, i.category, i.quantity, i.unit, i.unit_type, i.sort_order
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
