-- Migration 003 — Autenticação por roles (admin / professor)
-- Criado em: 2026-04-20

-- ─── Tabela de perfis vinculada ao auth.users ─────────────────────────────────
create table if not exists profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  role      text not null default 'professor' check (role in ('admin', 'professor')),
  nome      text not null default '',
  email     text not null default '',
  criado_em timestamptz default now()
);

alter table profiles enable row level security;

-- ─── Helper: retorna role do usuário atual ────────────────────────────────────
-- security definer necessário para evitar recursão no RLS
create or replace function public.get_my_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ─── Políticas de profiles ────────────────────────────────────────────────────
-- Usuário lê/edita o próprio perfil
create policy "profiles_self" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Admin lê todos
create policy "profiles_admin_read" on profiles
  for select using (public.get_my_role() = 'admin');

-- Admin escreve todos (create/update/delete)
create policy "profiles_admin_write" on profiles
  for all using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- ─── Adicionar campos em turmas ───────────────────────────────────────────────
alter table turmas
  add column if not exists materia      text,
  add column if not exists professor_id uuid references profiles(id) on delete set null;

-- ─── Políticas extras em turmas ───────────────────────────────────────────────
-- Nota: políticas anon da migration 001 continuam ativas para o projeto vanilla JS.
-- Aqui adicionamos políticas para usuários autenticados.

create policy "turmas_professor_own" on turmas
  for select using (
    auth.uid() is not null and professor_id = auth.uid()
  );

create policy "turmas_admin_all" on turmas
  for all using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- ─── Trigger: auto-create profile ao criar usuário ───────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, nome, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'professor'),
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── INSTRUÇÕES DE USO ────────────────────────────────────────────────────────
-- 1. Execute este arquivo no Supabase SQL Editor
-- 2. O primeiro admin deve ser criado manualmente:
--    UPDATE profiles SET role = 'admin' WHERE email = 'seu@email.com';
-- 3. Professores se cadastram normalmente pelo app (role padrão = 'professor')
-- 4. Admin pode alterar roles pelo ProfessoresPage ou diretamente no banco
