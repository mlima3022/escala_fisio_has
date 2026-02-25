-- Habilitar RLS
alter table public.schedules enable row level security;
alter table public.employees enable row level security;
alter table public.assignments enable row level security;
alter table public.code_legend enable row level security;
alter table public.profiles enable row level security;

-- Limpeza para reexecucao segura
drop policy if exists "public read schedules" on public.schedules;
drop policy if exists "admin write schedules" on public.schedules;
drop policy if exists "public read employees" on public.employees;
drop policy if exists "admin write employees" on public.employees;
drop policy if exists "public read assignments" on public.assignments;
drop policy if exists "admin write assignments" on public.assignments;
drop policy if exists "public read code_legend" on public.code_legend;
drop policy if exists "admin write code_legend" on public.code_legend;
drop policy if exists "self read profile" on public.profiles;

-- Leitura publica
create policy "public read schedules" on public.schedules
for select to anon, authenticated using (true);

create policy "public read employees" on public.employees
for select to anon, authenticated using (true);

create policy "public read assignments" on public.assignments
for select to anon, authenticated using (true);

create policy "public read code_legend" on public.code_legend
for select to anon, authenticated using (true);

-- Escrita somente admin
create policy "admin write schedules" on public.schedules
for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
);

create policy "admin write employees" on public.employees
for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
);

create policy "admin write assignments" on public.assignments
for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
);

create policy "admin write code_legend" on public.code_legend
for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.user_id = auth.uid()
      and profiles.is_admin = true
  )
);

-- Profiles: somente leitura do proprio profile para usuario autenticado
create policy "self read profile" on public.profiles
for select to authenticated
using (profiles.user_id = auth.uid());

-- Sem policy de escrita em profiles (somente SQL/manual do owner/admin DB)
