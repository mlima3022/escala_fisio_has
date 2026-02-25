-- Extensoes necessarias
create extension if not exists pgcrypto;

-- Profiles para controle de admin
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, is_admin)
  values (new.id, new.email, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Escalas mensais
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  month int not null,
  year int not null,
  month_name text,
  source_filename text,
  created_at timestamptz not null default now(),
  unique(month, year)
);

-- Funcionarios
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  matricula text unique not null,
  name text not null
);

-- Lancamentos de escala
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  sector text not null,
  role text,
  shift_hours text,
  day int not null check (day between 1 and 31),
  code text not null,
  unique(schedule_id, employee_id, sector, day)
);

-- Legenda opcional
create table if not exists public.code_legend (
  code text primary key,
  description text
);

create index if not exists idx_assignments_schedule_day on public.assignments(schedule_id, day);
create index if not exists idx_assignments_employee on public.assignments(employee_id);
