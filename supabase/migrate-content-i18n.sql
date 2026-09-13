-- Equinoterapia Vista Verde — add English columns for staff-entered content.
--
-- The UI itself is translated in app.js; this covers the content that lives in the
-- database: recurring task names, ad-hoc task names, week-plan entries and the
-- inventory catalogue (name, category, unit). Every column is nullable and the app
-- falls back to the Spanish value when it is empty, so this script is safe to run
-- before or after deploying the app — and safe to re-run.
--
-- Notes and diagnoses stay Spanish-only on purpose: they are free text written by
-- staff, and translating them would mean typing everything twice.
--
-- Run this once in the Supabase SQL editor, against a database that already exists.
-- A fresh install does NOT need it: schema.sql already declares these columns and
-- seed.sql already carries the English values.
--
-- It touches no existing data apart from filling in the English values for the
-- seeded demo rows, and it is safe to re-run.

-- ── 1. Columns ────────────────────────────────────────────────────────────────

alter table public.tasks                    add column if not exists name_en      text;
alter table public.extra_tasks              add column if not exists name_en      text;
alter table public.week_plan                add column if not exists task_name_en text;

alter table public.inventory_items          add column if not exists name_en      text;
alter table public.inventory_items          add column if not exists category_en  text;
alter table public.inventory_items          add column if not exists unit_en      text;

-- Snapshots freeze the item name at the time of the count, so they carry their own copies.
alter table public.inventory_snapshot_lines add column if not exists item_name_en text;
alter table public.inventory_snapshot_lines add column if not exists category_en  text;
alter table public.inventory_snapshot_lines add column if not exists unit_en      text;

-- Dead column from the production build: never read by the app, never populated.
-- The convention it hinted at (name_<lang>) is what name_en follows.
alter table public.extra_tasks              drop column if exists name_ht;

-- ── 2. Backfill the seeded demo content ───────────────────────────────────────

update public.tasks set name_en = v.name_en
from (values
  ('feed-horses-am',          'Feed horses (morning)'),
  ('clean-stalls',            'Muck out stalls'),
  ('prep-session-material',   'Prepare session equipment'),
  ('feed-horses-pm',          'Feed horses (afternoon)'),
  ('weekly-tack-check',       'Check and clean tack'),
  ('biweekly-paddock-check',  'Fence and paddock check'),
  ('office-agenda-review',    'Review therapy schedule'),
  ('office-family-calls',     'Follow-up calls to families'),
  ('monthly-inventory-count', 'Monthly stock count')
) as v(id, name_en)
where public.tasks.id = v.id;

update public.inventory_items set
    name_en     = v.name_en,
    category_en = v.category_en,
    unit_en     = v.unit_en
from (values
  ('Heno',               'Hay',                     'Feed',      'bales'),
  ('Concentrado equino', 'Equine concentrate feed', 'Feed',      'sacks'),
  ('Silo de alimento',   'Feed silo',               'Feed',      '%'),
  ('Cascos de repuesto', 'Spare horseshoes',        'Equipment', 'units'),
  ('Guantes de trabajo', 'Work gloves',             'Equipment', 'pairs'),
  ('Cepillos de aseo',   'Grooming brushes',        'Equipment', 'units'),
  ('Botiquín',           'First-aid kit',           'Health',    'kit')
) as v(name, name_en, category_en, unit_en)
where public.inventory_items.name = v.name;

update public.extra_tasks set name_en = 'Repair the arena fence'
where name = 'Reparar cerca del picadero';

-- Week-plan rows copy their name from tasks when they are created, so mirror that.
update public.week_plan wp set task_name_en = tk.name_en
from public.tasks tk
where wp.task_id = tk.id and tk.name_en is not null;

-- Existing snapshot lines: take the English values from the catalogue by name.
update public.inventory_snapshot_lines sl set
    item_name_en = ii.name_en,
    category_en  = ii.category_en,
    unit_en      = ii.unit_en
from public.inventory_items ii
where sl.item_name = ii.name and ii.name_en is not null;
