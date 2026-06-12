-- ============================================================
-- Migration 029 — Login do aluno
-- Descrição: Alunos passam a ter conta (Supabase Auth). A
--            instituição define e-mail/senha. Vincula a conta
--            (profiles/auth.users) ao registro em alunos.
-- ============================================================

-- 1. Permite role 'aluno' nos profiles
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'instituicao', 'professor', 'aluno'));

-- 2. Vincula a conta de auth ao aluno
alter table public.alunos
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists alunos_user_id_unique
  on public.alunos(user_id) where user_id is not null;

-- 3. RLS: o aluno pode ler o próprio registro
alter table public.alunos enable row level security;
drop policy if exists alunos_self_select on public.alunos;
create policy alunos_self_select on public.alunos
  for select using (user_id = auth.uid());
