-- TASKORA Pro database schema for Supabase PostgreSQL.
-- Run this whole file in Supabase Dashboard -> SQL Editor.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 70),
  color text not null default '#7565e8',
  archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (char_length(title) between 1 and 140),
  description text not null default '',
  category text not null default 'Personal',
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  due_date date,
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  duration_seconds integer not null check (duration_seconds between 60 and 14400),
  completed boolean not null default true,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro')),
  status text not null default 'active' check (status in ('active','inactive','past_due','canceled')),
  current_period_end timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_order_id text not null unique,
  pidx text not null unique,
  plan_key text not null check (plan_key in ('pro_monthly','pro_yearly')),
  amount_paisa bigint not null check (amount_paisa > 0),
  currency text not null default 'NPR',
  status text not null default 'initiated',
  transaction_id text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists tasks_user_due_idx on public.tasks(user_id, due_date);
create index if not exists tasks_user_status_idx on public.tasks(user_id, status);
create index if not exists projects_user_idx on public.projects(user_id);
create index if not exists focus_sessions_user_ended_idx on public.focus_sessions(user_id, ended_at desc);
create index if not exists payment_orders_user_idx on public.payment_orders(user_id, created_at desc);

-- Profiles and subscriptions are created automatically for new signups.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill accounts that existed before this schema was installed.
insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', '') from auth.users
on conflict (id) do nothing;
insert into public.subscriptions (user_id, plan, status)
select id, 'free', 'active' from auth.users
on conflict (user_id) do nothing;

-- Updated-at triggers.
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();
drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
for each row execute procedure public.set_updated_at();
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks
for each row execute procedure public.set_updated_at();

-- Enable RLS on every exposed user-data table.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_orders enable row level security;

-- Profiles: each customer may read/update only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Projects: all operations are restricted to their owner.
drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_all" on public.projects for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Tasks: all operations are restricted to their owner.
drop policy if exists "tasks_owner_all" on public.tasks;
create policy "tasks_owner_all" on public.tasks for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Focus history: a user may only access their own records.
drop policy if exists "focus_sessions_owner_all" on public.focus_sessions;
create policy "focus_sessions_owner_all" on public.focus_sessions for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Subscription/payment records are readable by their owner, but writable only by the server service role.
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "payment_orders_select_own" on public.payment_orders;
create policy "payment_orders_select_own" on public.payment_orders for select to authenticated using (user_id = (select auth.uid()));

-- Optional realtime task updates; ignore this block if the realtime publication is not enabled.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.tasks;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Enforce Free-tier limits in the database as well as in the interface.
create or replace function public.enforce_taskora_free_limits()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  active_plan text;
  active_count integer;
begin
  select plan into active_plan from public.subscriptions
  where user_id = new.user_id and status = 'active'
    and (current_period_end is null or current_period_end > now());
  if coalesce(active_plan, 'free') = 'pro' then return new; end if;

  if new.status <> 'done' then
    select count(*) into active_count from public.tasks
    where user_id = new.user_id and status <> 'done' and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
    if active_count >= 50 then
      raise exception 'Free plan limit reached: up to 50 active tasks. Upgrade to Pro for more.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_enforce_free_limit on public.tasks;
create trigger tasks_enforce_free_limit before insert or update of user_id, status on public.tasks
for each row execute procedure public.enforce_taskora_free_limits();

create or replace function public.enforce_taskora_project_limit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  active_plan text;
  project_count integer;
begin
  select plan into active_plan from public.subscriptions
  where user_id = new.user_id and status = 'active'
    and (current_period_end is null or current_period_end > now());
  if coalesce(active_plan, 'free') = 'pro' or new.archived then return new; end if;
  select count(*) into project_count from public.projects where user_id = new.user_id and archived = false and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if project_count >= 2 then
    raise exception 'Free plan limit reached: up to 2 active projects. Upgrade to Pro for more.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_enforce_free_limit on public.projects;
create trigger projects_enforce_free_limit before insert or update of user_id, archived on public.projects
for each row execute procedure public.enforce_taskora_project_limit();

-- Called only by the server after a successful Khalti lookup. The update is atomic
-- and idempotent, so a repeated browser callback cannot extend the plan twice.
create or replace function public.complete_khalti_order(p_pidx text, p_transaction_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_order public.payment_orders%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_days integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_order from public.payment_orders where pidx = p_pidx for update;
  if not found then raise exception 'Payment order not found.'; end if;

  if v_order.status = 'completed' then
    select * into v_subscription from public.subscriptions where user_id = v_order.user_id;
    return jsonb_build_object('already_processed', true, 'subscription', to_jsonb(v_subscription));
  end if;

  v_days := case v_order.plan_key when 'pro_yearly' then 365 else 30 end;
  select * into v_subscription from public.subscriptions where user_id = v_order.user_id for update;
  v_start := greatest(coalesce(v_subscription.current_period_end, now()), now());
  v_end := v_start + make_interval(days => v_days);

  insert into public.subscriptions (user_id, plan, status, current_period_end, updated_at)
  values (v_order.user_id, 'pro', 'active', v_end, now())
  on conflict (user_id) do update set plan = 'pro', status = 'active', current_period_end = v_end, updated_at = now();

  update public.payment_orders set status = 'completed', transaction_id = p_transaction_id, completed_at = now()
  where id = v_order.id;

  select * into v_subscription from public.subscriptions where user_id = v_order.user_id;
  return jsonb_build_object('already_processed', false, 'subscription', to_jsonb(v_subscription));
end;
$$;
revoke all on function public.complete_khalti_order(text, text) from public, anon, authenticated;
grant execute on function public.complete_khalti_order(text, text) to service_role;

-- Explicit table privileges work together with the RLS policies above.
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.focus_sessions to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.payment_orders to authenticated;
grant all on public.profiles, public.projects, public.tasks, public.focus_sessions, public.subscriptions, public.payment_orders to service_role;

-- Ensure tasks can only be attached to projects owned by the same account.
create or replace function public.enforce_task_project_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects where id = new.project_id and user_id = new.user_id and archived = false
  ) then
    raise exception 'The selected project does not belong to this account or is archived.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_project_owner_check on public.tasks;
create trigger tasks_project_owner_check before insert or update of user_id, project_id on public.tasks
for each row execute procedure public.enforce_task_project_owner();


-- Focus sessions may only point to tasks owned by the same user.
create or replace function public.enforce_focus_task_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.task_id is not null and not exists (
    select 1 from public.tasks where id = new.task_id and user_id = new.user_id
  ) then
    raise exception 'The selected focus task does not belong to this account.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists focus_sessions_task_owner_check on public.focus_sessions;
create trigger focus_sessions_task_owner_check before insert or update of user_id, task_id on public.focus_sessions
for each row execute procedure public.enforce_focus_task_owner();
