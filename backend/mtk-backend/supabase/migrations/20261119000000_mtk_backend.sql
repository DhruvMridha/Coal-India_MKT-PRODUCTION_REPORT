-- =====================================================================
-- MTK WISE SHIFTWISE DAILY PRODUCTION REPORT — Supabase backend
--
-- Contract preserved from the existing frontend (lib/report-store.ts,
-- lib/report.ts):
--   * tables  mtk_reports / mtk_shifts / mtk_production / mtk_pumps / mtk_targets
--   * nested select
--       day,revision,saved_at,
--       mtk_shifts(shift,rainfall,mtk_production(source,coal_trips,coal_qty,ob_trips,ob_qty)),
--       mtk_pumps(sump,installed,running,initial,final)
--   * RPC  mtk_save(p_day, p_revision, p_entries)  ->  one row {revision, saved_at}
--   * conflict  -> SQLSTATE 40001
--   * entry keys  "<shift 0-2>:<source>:<metric 0-3>", "rain:<0-2>", "pump:<sump>:<0-3>"
--     metric order: coal trips, coal quantity, OB trips, OB quantity
--     pump order:   installed, running, initial, final
--
-- Requires PostgreSQL 15+ (UNIQUE NULLS NOT DISTINCT, security_invoker views).
-- All Supabase projects created since 2023 satisfy this.
-- =====================================================================

create schema if not exists mtk_private;
revoke all on schema mtk_private from public;
grant usage on schema mtk_private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Reference data (the report layout, straight from the Excel/lib/report.ts)
-- ---------------------------------------------------------------------
create table public.mtk_shift_defs (
  shift     smallint primary key check (shift between 0 and 2),
  name      text not null unique,
  starts_at time not null,
  ends_at   time not null
);
insert into public.mtk_shift_defs (shift, name, starts_at, ends_at) values
  (0, 'First Shift',  '06:00', '14:00'),
  (1, 'Second Shift', '14:00', '22:00'),
  (2, 'Third Shift',  '22:00', '06:00');

-- Contractor vs. equipment is preserved in `kind` (and the MTK-1 / MTK-2 section).
create table public.mtk_sources (
  name       text primary key,
  kind       text not null check (kind in ('contractor', 'equipment')),
  mtk_unit   text not null check (mtk_unit in ('MTK-1', 'MTK-2')),
  sort_order smallint not null unique,
  constraint mtk_sources_kind_unit check (
    (kind = 'contractor' and mtk_unit = 'MTK-1') or (kind = 'equipment' and mtk_unit = 'MTK-2')),
  -- keys are ':'-delimited, so names must never contain a colon
  constraint mtk_sources_name_chk check (name <> '' and name = btrim(name) and position(':' in name) = 0)
);
insert into public.mtk_sources (name, kind, mtk_unit, sort_order) values
  ('KCCDECO',      'contractor', 'MTK-1',  1),
  ('KCCL',         'contractor', 'MTK-1',  2),
  ('JARPL',        'contractor', 'MTK-1',  3),
  ('PRTPL',        'contractor', 'MTK-1',  4),
  ('Shovel - 314', 'equipment',  'MTK-2',  5),
  ('Shovel - 229', 'equipment',  'MTK-2',  6),
  ('Shovel - 002', 'equipment',  'MTK-2',  7),
  ('Shovel - 003', 'equipment',  'MTK-2',  8),
  ('PC - 180',     'equipment',  'MTK-2',  9),
  ('PC - 249',     'equipment',  'MTK-2', 10),
  ('PC - 250',     'equipment',  'MTK-2', 11),
  ('Payloader198', 'equipment',  'MTK-2', 12);

create table public.mtk_sumps (
  name       text primary key,
  sort_order smallint not null unique,
  constraint mtk_sumps_name_chk check (name <> '' and name = btrim(name) and position(':' in name) = 0)
);
insert into public.mtk_sumps (name, sort_order) values
  ('LK-1', 1), ('LK-2', 2), ('OLD DIPKA', 3);

-- ---------------------------------------------------------------------
-- 2. Access control: profiles (authoritative role + active flag)
--    Roles: admin (everything), operator (read + save reports), viewer (read).
--    The role is mirrored to auth app_metadata.mtk_role purely for the UI,
--    which displays it. Authorization always reads this table, so
--    deactivation takes effect immediately, not at token refresh.
-- ---------------------------------------------------------------------
create table public.mtk_profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  role         text not null check (role in ('admin', 'operator', 'viewer')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create function mtk_private.app_role() returns text
language sql stable security definer set search_path = ''
as $$ select p.role from public.mtk_profiles p where p.id = (select auth.uid()) and p.active $$;

create function mtk_private.can_read() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(mtk_private.app_role() in ('admin', 'operator', 'viewer'), false) $$;

create function mtk_private.can_write() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(mtk_private.app_role() in ('admin', 'operator'), false) $$;

create function mtk_private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(mtk_private.app_role() = 'admin', false) $$;

-- Matches the frontend's reportingDay(): UTC date of (now - 30 min),
-- i.e. the reporting day rolls over at 06:00 Asia/Kolkata.
create function mtk_private.reporting_day() returns date
language sql stable set search_path = ''
as $$ select ((now() at time zone 'UTC') - interval '30 minutes')::date $$;

create function mtk_private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- 3. Report tables
--    Numbers: trips are whole numbers (bigint), quantities/rainfall/pump
--    readings are numeric(16,6) = up to 10 integer digits + 6 decimals,
--    exactly what the UI input masks allow. NULL = not entered (never 0).
-- ---------------------------------------------------------------------
create table public.mtk_reports (
  day        date primary key check (day >= date '2000-01-01'),
  revision   integer not null default 0 check (revision >= 0),
  saved_at   timestamptz not null default now(),
  status     text not null default 'draft' check (status in ('draft', 'locked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);

create table public.mtk_shifts (
  id         bigint generated always as identity primary key,
  report_day date     not null references public.mtk_reports (day) on delete cascade on update cascade,
  shift      smallint not null references public.mtk_shift_defs (shift),
  rainfall   numeric(16, 6) check (rainfall >= 0),          -- MM
  constraint mtk_shifts_day_shift_key unique (report_day, shift)
);

create table public.mtk_production (
  id         bigint generated always as identity primary key,
  shift_id   bigint not null references public.mtk_shifts (id) on delete cascade,
  source     text   not null references public.mtk_sources (name) on update cascade,
  coal_trips bigint         check (coal_trips >= 0),
  coal_qty   numeric(16, 6) check (coal_qty >= 0),          -- Ton
  ob_trips   bigint         check (ob_trips >= 0),
  ob_qty     numeric(16, 6) check (ob_qty >= 0),            -- Cum.
  constraint mtk_production_shift_source_key unique (shift_id, source),
  constraint mtk_production_not_empty check (num_nonnulls(coal_trips, coal_qty, ob_trips, ob_qty) > 0)
);
create index mtk_production_source_idx on public.mtk_production (source);

create table public.mtk_pumps (
  id         bigint generated always as identity primary key,
  report_day date not null references public.mtk_reports (day) on delete cascade on update cascade,
  sump       text not null references public.mtk_sumps (name) on update cascade,
  installed  numeric(16, 6) check (installed >= 0),
  running    numeric(16, 6) check (running >= 0),
  "initial"  numeric(16, 6) check ("initial" >= 0),
  "final"    numeric(16, 6) check ("final" >= 0),
  constraint mtk_pumps_day_sump_key unique (report_day, sump),
  constraint mtk_pumps_not_empty check (num_nonnulls(installed, running, "initial", "final") > 0)
);

-- Targets: the frontend reads rows where shift IS NULL and source IS NULL.
create table public.mtk_targets (
  id         bigint generated always as identity primary key,
  day        date not null,
  coal_qty   numeric(16, 6) check (coal_qty >= 0),          -- Ton / day
  ob_qty     numeric(16, 6) check (ob_qty >= 0),            -- Cum. / day
  shift      smallint references public.mtk_shift_defs (shift),
  source     text references public.mtk_sources (name) on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint mtk_targets_scope_key unique nulls not distinct (day, shift, source),
  constraint mtk_targets_not_empty check (num_nonnulls(coal_qty, ob_qty) > 0)
);

create table public.mtk_audit_logs (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor         uuid,
  actor_email   text,
  actor_role    text,
  action        text not null,
  report_day    date,
  revision_from integer,
  revision_to   integer,
  changes       jsonb not null default '{}'::jsonb   -- { key: {old, new} } for every changed cell
);
create index mtk_audit_logs_day_idx   on public.mtk_audit_logs (report_day, at desc);
create index mtk_audit_logs_actor_idx on public.mtk_audit_logs (actor, at desc);

create trigger mtk_reports_touch  before update on public.mtk_reports  for each row execute function mtk_private.touch_updated_at();
create trigger mtk_profiles_touch before update on public.mtk_profiles for each row execute function mtk_private.touch_updated_at();

create function mtk_private.stamp_row() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger mtk_targets_stamp before insert or update on public.mtk_targets
  for each row execute function mtk_private.stamp_row();

-- ---------------------------------------------------------------------
-- 4. Row Level Security
--    Report data is written ONLY through mtk_save(). Authenticated users get
--    SELECT (if they hold an active profile); no direct INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------
alter table public.mtk_shift_defs enable row level security;
alter table public.mtk_sources    enable row level security;
alter table public.mtk_sumps      enable row level security;
alter table public.mtk_profiles   enable row level security;
alter table public.mtk_reports    enable row level security;
alter table public.mtk_shifts     enable row level security;
alter table public.mtk_production enable row level security;
alter table public.mtk_pumps      enable row level security;
alter table public.mtk_targets    enable row level security;
alter table public.mtk_audit_logs enable row level security;

revoke all on public.mtk_shift_defs, public.mtk_sources, public.mtk_sumps, public.mtk_profiles,
  public.mtk_reports, public.mtk_shifts, public.mtk_production, public.mtk_pumps,
  public.mtk_targets, public.mtk_audit_logs from anon, authenticated;

grant select on public.mtk_shift_defs, public.mtk_sources, public.mtk_sumps, public.mtk_profiles,
  public.mtk_reports, public.mtk_shifts, public.mtk_production, public.mtk_pumps,
  public.mtk_targets, public.mtk_audit_logs to authenticated;
grant insert, update, delete on public.mtk_targets to authenticated;   -- gated to admins by policy

create policy mtk_shift_defs_read on public.mtk_shift_defs for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_sources_read    on public.mtk_sources    for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_sumps_read      on public.mtk_sumps      for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_reports_read    on public.mtk_reports    for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_shifts_read     on public.mtk_shifts     for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_production_read on public.mtk_production for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_pumps_read      on public.mtk_pumps      for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_targets_read    on public.mtk_targets    for select to authenticated using ((select mtk_private.can_read()));
create policy mtk_targets_insert  on public.mtk_targets    for insert to authenticated with check ((select mtk_private.is_admin()));
create policy mtk_targets_update  on public.mtk_targets    for update to authenticated using ((select mtk_private.is_admin())) with check ((select mtk_private.is_admin()));
create policy mtk_targets_delete  on public.mtk_targets    for delete to authenticated using ((select mtk_private.is_admin()));
create policy mtk_profiles_read   on public.mtk_profiles   for select to authenticated
  using (id = (select auth.uid()) or (select mtk_private.is_admin()));
create policy mtk_audit_read      on public.mtk_audit_logs  for select to authenticated using ((select mtk_private.is_admin()));

-- ---------------------------------------------------------------------
-- 5. Helper: current report as a flat entries map (same keys the UI uses)
--    Values are canonical text (trim_scale) so old/new can be compared.
-- ---------------------------------------------------------------------
create function mtk_private.report_entries(p_day date) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
  from (
    select 'rain:' || s.shift as k, trim_scale(s.rainfall)::text as v
      from public.mtk_shifts s
     where s.report_day = p_day and s.rainfall is not null
    union all
    select sh.shift::text || ':' || p.source || ':' || x.i, x.v
      from public.mtk_shifts sh
      join public.mtk_production p on p.shift_id = sh.id
      cross join lateral (values
        (0, p.coal_trips::text),
        (1, trim_scale(p.coal_qty)::text),
        (2, p.ob_trips::text),
        (3, trim_scale(p.ob_qty)::text)) as x(i, v)
     where sh.report_day = p_day and x.v is not null
    union all
    select 'pump:' || pp.sump || ':' || x.i, x.v
      from public.mtk_pumps pp
      cross join lateral (values
        (0, trim_scale(pp.installed)::text),
        (1, trim_scale(pp.running)::text),
        (2, trim_scale(pp."initial")::text),
        (3, trim_scale(pp."final")::text)) as x(i, v)
     where pp.report_day = p_day and x.v is not null
  ) e
$$;
revoke all on function mtk_private.report_entries(date) from public;

-- ---------------------------------------------------------------------
-- 6. mtk_save(p_day, p_revision, p_entries)
--
-- p_entries is the frontend's FULL flattened snapshot: a key that is absent
-- or '' means "not entered" and is stored as NULL (never 0). p_revision is
-- the revision the client last loaded (0 = report does not exist yet).
--
-- Errors (SQLSTATE):  28000 not signed in · 42501 role not permitted ·
--   22023 invalid date / key / value · 40001 revision conflict ·
--   55000 report is locked · 55P03 lock wait timed out.
-- A save that changes nothing returns the current revision unchanged, so a
-- redundant "Save" click can never invalidate another operator's draft.
-- ---------------------------------------------------------------------
create function public.mtk_save(p_day date, p_revision integer, p_entries jsonb)
returns table (revision integer, saved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_now     timestamptz := now();
  v_rep     public.mtk_reports%rowtype;
  v_new     jsonb := '{}'::jsonb;   -- normalised: key -> canonical text, non-null values only
  v_old     jsonb;
  v_changes jsonb;
  v_prod    jsonb;
  v_pump    jsonb;
  v_k       text;
  v_v       jsonb;
  v_txt     text;
  v_m       text[];
  v_whole   boolean;
  v_rev     integer;
begin
  -- authenticate + authorise ------------------------------------------------
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select p.role into v_role from public.mtk_profiles p where p.id = v_uid and p.active;
  if v_role is null or v_role not in ('admin', 'operator') then
    raise exception 'Your account is not permitted to save production reports' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);

  -- validate arguments --------------------------------------------------------
  if p_day is null or p_day < date '2000-01-01' or p_day > mtk_private.reporting_day() then
    raise exception 'Invalid report date' using errcode = '22023',
      hint = 'The date must be between 2000-01-01 and the current reporting day.';
  end if;
  if p_revision is null or p_revision < 0 then
    raise exception 'Invalid revision' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'object' then
    raise exception 'Entries must be a JSON object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_entries)) > 200 then
    raise exception 'Too many entries' using errcode = '22023';
  end if;

  -- validate + normalise every entry --------------------------------------------
  for v_k, v_v in select e.key, e.value from jsonb_each(p_entries) e loop
    case jsonb_typeof(v_v)
      when 'null'   then v_txt := null;
      when 'string' then v_txt := btrim(v_v #>> '{}');
      when 'number' then v_txt := v_v #>> '{}';
      else raise exception 'Invalid value for entry "%"', left(v_k, 60) using errcode = '22023';
    end case;
    if v_txt = '' then v_txt := null; end if;

    v_m := regexp_match(v_k, '^([0-2]):(.+):([0-3])$');
    if v_m is not null then                                   -- production cell
      if not exists (select 1 from public.mtk_sources s where s.name = v_m[2]) then
        raise exception 'Unknown source in entry "%"', left(v_k, 60) using errcode = '22023';
      end if;
      v_whole := v_m[3]::int in (0, 2);                       -- trips are whole numbers
    else
      v_m := regexp_match(v_k, '^rain:([0-2])$');
      if v_m is not null then                                 -- rainfall
        v_whole := false;
      else
        v_m := regexp_match(v_k, '^pump:(.+):([0-3])$');
        if v_m is not null then                               -- pump reading
          if not exists (select 1 from public.mtk_sumps s where s.name = v_m[1]) then
            raise exception 'Unknown sump in entry "%"', left(v_k, 60) using errcode = '22023';
          end if;
          v_whole := false;
        else
          raise exception 'Unknown entry key "%"', left(v_k, 60) using errcode = '22023';
        end if;
      end if;
    end if;

    continue when v_txt is null;                              -- not entered -> stays NULL

    if v_whole then
      if v_txt !~ '^[0-9]{1,10}$' then
        raise exception 'Entry "%" must be a whole number of up to 10 digits', left(v_k, 60) using errcode = '22023';
      end if;
      v_new := v_new || jsonb_build_object(v_k, v_txt::bigint::text);
    else
      -- same mask as the UI: up to 10 integer digits, up to 6 decimals ("12." is allowed mid-typing)
      if v_txt !~ '^[0-9]{1,10}(\.[0-9]{0,6})?$' then
        raise exception 'Entry "%" must be a non-negative number (up to 10 digits, 6 decimals)', left(v_k, 60) using errcode = '22023';
      end if;
      v_new := v_new || jsonb_build_object(v_k, trim_scale(v_txt::numeric)::text);
    end if;
  end loop;

  -- create-if-missing, then lock the report row; concurrent creators queue on the unique index
  insert into public.mtk_reports (day, revision, saved_at, created_by, updated_by)
  values (p_day, 0, v_now, v_uid, v_uid)
  on conflict (day) do nothing;

  select * into v_rep from public.mtk_reports r where r.day = p_day for update;

  if v_rep.revision <> p_revision then
    raise exception 'Report was changed by another operator' using errcode = '40001',
      detail = format('expected revision %s, current revision %s', p_revision, v_rep.revision),
      hint = 'Reload the latest report before saving.';
  end if;
  if v_rep.status = 'locked' then
    raise exception 'Report is locked' using errcode = '55000';
  end if;

  -- what actually changes (also feeds the audit trail) ------------------------------
  v_old := mtk_private.report_entries(p_day);
  select coalesce(jsonb_object_agg(u.k, jsonb_build_object('old', v_old -> u.k, 'new', v_new -> u.k)), '{}'::jsonb)
    into v_changes
    from (select k from jsonb_object_keys(v_old) as k
          union
          select k from jsonb_object_keys(v_new) as k) u
   where (v_old -> u.k) is distinct from (v_new -> u.k);

  if v_rep.revision > 0 and v_changes = '{}'::jsonb then
    return query select v_rep.revision, v_rep.saved_at;       -- nothing to save
    return;
  end if;

  -- reshape the normalised map into rows ---------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_prod
  from (
    select ((x.m)[1])::smallint as shift,
           (x.m)[2]             as source,
           (max(n.value) filter (where (x.m)[3] = '0'))::bigint  as coal_trips,
           (max(n.value) filter (where (x.m)[3] = '1'))::numeric as coal_qty,
           (max(n.value) filter (where (x.m)[3] = '2'))::bigint  as ob_trips,
           (max(n.value) filter (where (x.m)[3] = '3'))::numeric as ob_qty
      from jsonb_each_text(v_new) n
     cross join lateral regexp_match(n.key, '^([0-2]):(.+):([0-3])$') as x(m)
     where x.m is not null
     group by (x.m)[1], (x.m)[2]
  ) g;

  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_pump
  from (
    select (x.m)[1] as sump,
           (max(n.value) filter (where (x.m)[2] = '0'))::numeric as installed,
           (max(n.value) filter (where (x.m)[2] = '1'))::numeric as running,
           (max(n.value) filter (where (x.m)[2] = '2'))::numeric as "initial",
           (max(n.value) filter (where (x.m)[2] = '3'))::numeric as "final"
      from jsonb_each_text(v_new) n
     cross join lateral regexp_match(n.key, '^pump:(.+):([0-3])$') as x(m)
     where x.m is not null
     group by (x.m)[1]
  ) g;

  -- write (single transaction: any error above or below rolls everything back) -----------
  update public.mtk_reports r
     set revision   = r.revision + 1,
         saved_at   = v_now,
         updated_at = v_now,
         updated_by = v_uid
   where r.day = p_day
  returning r.revision into v_rev;

  insert into public.mtk_shifts as s (report_day, shift, rainfall)
  select p_day, d.shift, (v_new ->> ('rain:' || d.shift))::numeric
    from public.mtk_shift_defs d
  on conflict (report_day, shift) do update set rainfall = excluded.rainfall;

  delete from public.mtk_production p
   using public.mtk_shifts s
   where p.shift_id = s.id and s.report_day = p_day;

  insert into public.mtk_production (shift_id, source, coal_trips, coal_qty, ob_trips, ob_qty)
  select s.id, x.source, x.coal_trips, x.coal_qty, x.ob_trips, x.ob_qty
    from jsonb_to_recordset(v_prod) as x(shift smallint, source text, coal_trips bigint, coal_qty numeric, ob_trips bigint, ob_qty numeric)
    join public.mtk_shifts s on s.report_day = p_day and s.shift = x.shift;

  delete from public.mtk_pumps where report_day = p_day;

  insert into public.mtk_pumps (report_day, sump, installed, running, "initial", "final")
  select p_day, x.sump, x.installed, x.running, x."initial", x."final"
    from jsonb_to_recordset(v_pump) as x(sump text, installed numeric, running numeric, "initial" numeric, "final" numeric);

  insert into public.mtk_audit_logs (actor, actor_email, actor_role, action, report_day, revision_from, revision_to, changes)
  values (v_uid, auth.jwt() ->> 'email', v_role,
          case when p_revision = 0 then 'report.create' else 'report.save' end,
          p_day, p_revision, v_rev, v_changes);

  return query select v_rev, v_now;
end
$fn$;

revoke all on function public.mtk_save(date, integer, jsonb) from public, anon;
grant execute on function public.mtk_save(date, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Totals views (same logic as the Excel SUMs and the UI's sum()):
--    NULL when nothing was entered, otherwise the sum of what was entered;
--    contractor (MTK-1), departmental (MTK-2) and GRAND are kept separate.
--    security_invoker => the caller's RLS applies.
-- ---------------------------------------------------------------------
create view public.mtk_shift_totals with (security_invoker = true) as
with base as (
  select s.report_day as day, s.shift, src.mtk_unit,
         p.coal_trips, p.coal_qty, p.ob_trips, p.ob_qty
    from public.mtk_shifts s
    join public.mtk_production p on p.shift_id = s.id
    join public.mtk_sources src on src.name = p.source
)
select day, shift, mtk_unit as section,
       sum(coal_trips) as coal_trips, sum(coal_qty) as coal_qty,
       sum(ob_trips) as ob_trips, sum(ob_qty) as ob_qty
  from base group by day, shift, mtk_unit
union all
select day, shift, 'GRAND',
       sum(coal_trips), sum(coal_qty), sum(ob_trips), sum(ob_qty)
  from base group by day, shift;

create view public.mtk_daily_summary with (security_invoker = true) as
select r.day, r.revision, r.saved_at, r.status,
       t.coal_trips, t.coal_qty, t.ob_trips, t.ob_qty,
       (select sum(s.rainfall) from public.mtk_shifts s where s.report_day = r.day) as rainfall_total,
       (select count(*) from public.mtk_shifts s where s.report_day = r.day and s.rainfall is not null)
       + (select count(*) filter (where p.coal_trips is not null) + count(*) filter (where p.coal_qty is not null)
                 + count(*) filter (where p.ob_trips is not null) + count(*) filter (where p.ob_qty is not null)
            from public.mtk_production p join public.mtk_shifts s on s.id = p.shift_id where s.report_day = r.day)
       + (select count(*) filter (where pp.installed is not null) + count(*) filter (where pp.running is not null)
                 + count(*) filter (where pp."initial" is not null) + count(*) filter (where pp."final" is not null)
            from public.mtk_pumps pp where pp.report_day = r.day) as entries_filled,
       159 as entries_expected          -- 3 shifts x 12 sources x 4 + 3 rainfall + 3 sumps x 4
  from public.mtk_reports r
  left join (select day, sum(coal_trips) coal_trips, sum(coal_qty) coal_qty, sum(ob_trips) ob_trips, sum(ob_qty) ob_qty
               from public.mtk_shift_totals where section = 'GRAND' group by day) t on t.day = r.day;

revoke all on public.mtk_shift_totals, public.mtk_daily_summary from anon, authenticated;
grant select on public.mtk_shift_totals, public.mtk_daily_summary to authenticated;

-- ---------------------------------------------------------------------
-- 8. Operator onboarding (run from the SQL editor / service role only)
--      select mtk_private.grant_access('name@example.com', 'operator', 'Display Name');
--      select mtk_private.revoke_access('name@example.com');
--    The user must already exist in Supabase Auth (Authentication > Users).
-- ---------------------------------------------------------------------
create function mtk_private.grant_access(p_email text, p_role text, p_display_name text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_role not in ('admin', 'operator', 'viewer') then
    raise exception 'Role must be admin, operator or viewer' using errcode = '22023';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(p_email);
  if v_id is null then
    raise exception 'No Supabase Auth user with email %', p_email using errcode = 'P0002';
  end if;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('mtk_role', p_role)
   where id = v_id;
  insert into public.mtk_profiles as p (id, email, display_name, role, active)
  values (v_id, lower(p_email), p_display_name, p_role, true)
  on conflict (id) do update
     set role = excluded.role, active = true, email = excluded.email,
         display_name = coalesce(excluded.display_name, p.display_name);
end $$;

create function mtk_private.revoke_access(p_email text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(p_email);
  if v_id is null then
    raise exception 'No Supabase Auth user with email %', p_email using errcode = 'P0002';
  end if;
  update public.mtk_profiles set active = false where id = v_id;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'mtk_role' where id = v_id;
end $$;

revoke all on function mtk_private.grant_access(text, text, text), mtk_private.revoke_access(text)
  from public, anon, authenticated;
grant execute on function mtk_private.grant_access(text, text, text), mtk_private.revoke_access(text) to service_role;
