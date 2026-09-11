# Equinoterapia Vista Verde — Management App (Demo)

Operations app for an equine-assisted therapy centre: therapy scheduling, staff time
tracking, recurring task management, volunteer coordination and inventory — built as a
mobile-first single-page app on top of Supabase.

**This is a public demo build.** The application was built for a real therapy centre, but
this version runs against its own isolated Supabase project under a fictional brand and
contains **only fictional data** — no real clients, staff, diagnoses or contact details.

🔗 **Live demo:** _(Netlify URL — coming)_

## Demo logins

The app renders four different interfaces depending on the signed-in user's role, so
each login shows a genuinely different application. Password for all accounts:
`VistaVerde2026!`

| Role | Login | What you see |
|---|---|---|
| `colaborador` | `ana.admin@vistaverde-demo.com` | Full management view: team, agenda, payroll, admin |
| `coordinador` | `carmen.coord@vistaverde-demo.com` | Office view: therapy agenda, office tasks, finances |
| `pesticero` | `luis.pesticero@vistaverde-demo.com` | Daily farm view: own task list, clock-in, overtime balance |
| `volunteer` | `carlos.voluntario@vistaverde-demo.com` | Volunteer view: task pool, own hours, ES/EN toggle |

## Features

- **Therapy scheduling** — recurring weekly slots per client and horse, materialised into
  individual sessions with attendance and preparation tracking
- **Time tracking** — clock in/out with break handling, per-role daily targets, rolling
  overtime balance per pay period, and compensation requests (payout or time off)
- **Task management** — daily/weekly/biweekly/monthly cadences, per-person assignment,
  shared vs. individual completion, plus ad-hoc extra tasks and weekly planning
- **Client records** — public roster separated from private data (diagnosis, tutor,
  contact details) at the database level, enforced by row-level security
- **Inventory** — stock levels with thresholds and point-in-time snapshots
- **Bilingual UI** — Spanish throughout, with an English toggle for volunteers

## Tech stack

Vanilla JavaScript (no framework, no build step), Supabase (PostgreSQL, Auth, PostgREST),
CSS custom properties, deployed as static files on Netlify.

## Architecture notes

**Security is enforced in the database, not the client.** Every table has row-level
security enabled and all policies are scoped to the `authenticated` role, so the
publishable API key embedded in the client exposes nothing to anonymous visitors.
Privilege checks run through a `SECURITY DEFINER` helper:

```sql
create function public.my_role() returns text
language sql stable security definer as $$
  select role from public.profiles where id = auth.uid();
$$;
```

Policies then gate writes on `my_role() = any (array['colaborador','coordinador'])`,
while staff can always read their own rows (`user_id = auth.uid()`). Sensitive client
data lives in a separate `client_private` table that only privileged roles can read at
all — a role split that holds even if the frontend is bypassed entirely.

New accounts are provisioned by a trigger on `auth.users` that creates the matching
`profiles` row, so application state and auth state cannot drift apart.

## Running it yourself

1. Create a Supabase project
2. Run [`supabase/schema.sql`](supabase/schema.sql) — tables, RLS policies, functions, trigger
3. Create the auth users listed at the top of [`supabase/seed.sql`](supabase/seed.sql)
4. Run [`supabase/seed.sql`](supabase/seed.sql) — assigns roles and loads the fictional dataset
5. Point `SUPABASE_URL` / `SUPABASE_KEY` in [`app.js`](app.js) at your project
6. Serve the folder statically (`python3 -m http.server 8123`)

[`supabase/reset.sql`](supabase/reset.sql) wipes the seeded data if you need to start over.

## Differences from the production build

The clock-in is normally restricted by a 200 m geofence around the centre. This demo sets
`GEOFENCE_ENABLED = false` so the time tracking can be tried from anywhere, and the
coordinates in the source are fictional.
