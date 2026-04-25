-- Migration 007 — Renomeia roles e adiciona novos campos
-- super_admin → admin  |  admin → instituicao  |  professor permanece
-- Execute no Supabase SQL Editor

-- ─── 1. Atualiza dados existentes ANTES de mudar a constraint ────────────────
UPDATE public.profiles SET role = 'admin'       WHERE role = 'super_admin';
UPDATE public.profiles SET role = 'instituicao' WHERE role = 'admin';

-- ─── 2. Atualiza constraint de role ──────────────────────────────────────────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'instituicao', 'professor'));

-- Atualiza trigger de novo usuário para usar 'professor' como padrão
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, nome, email)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'role', 'professor'),
    COALESCE(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ─── 3. Atualiza get_my_role (sem mudança mas recria para garantir) ───────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ─── 4. Adiciona observacoes em turmas (bloco de notas do professor) ──────────
ALTER TABLE public.turmas
  ADD COLUMN IF NOT EXISTS observacoes text;

-- ─── 5. Adiciona tipo em horarios (integral / normal) ────────────────────────
ALTER TABLE public.horarios
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'normal'
  CHECK (tipo IN ('normal', 'integral'));

-- ─── 6. Tabela materias ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.materias (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nome           text        NOT NULL,
  professor_id   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  instituicao_id uuid        NOT NULL REFERENCES public.instituicoes(id) ON DELETE CASCADE,
  criado_em      timestamptz DEFAULT now()
);

ALTER TABLE public.materias ENABLE ROW LEVEL SECURITY;

-- ─── 7. Atualiza RLS policies ─────────────────────────────────────────────────

-- profiles: recria policies com novos nomes de role
DROP POLICY IF EXISTS "profiles_admin_read"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_write"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_super_admin_read"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_super_admin_write" ON public.profiles;

CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "profiles_instituicao_read" ON public.profiles
  FOR SELECT USING (public.get_my_role() = 'instituicao');

CREATE POLICY "profiles_instituicao_write" ON public.profiles
  FOR ALL
  USING     (public.get_my_role() = 'instituicao')
  WITH CHECK (public.get_my_role() = 'instituicao');

-- materias: instituicao gerencia, professor visualiza
CREATE POLICY "materias_instituicao_all" ON public.materias
  FOR ALL
  USING     (public.get_my_role() = 'instituicao')
  WITH CHECK (public.get_my_role() = 'instituicao');

CREATE POLICY "materias_professor_select" ON public.materias
  FOR SELECT USING (public.get_my_role() = 'professor');

CREATE POLICY "materias_admin_all" ON public.materias
  FOR ALL
  USING     (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ─── 8. Atualiza policies de turmas/chamadas para incluir 'instituicao' ───────
DROP POLICY IF EXISTS "turmas_admin_all" ON public.turmas;

CREATE POLICY "turmas_instituicao_all" ON public.turmas
  FOR ALL
  USING     (public.get_my_role() = 'instituicao')
  WITH CHECK (public.get_my_role() = 'instituicao');

-- ─── 9. Horarios: policy para instituicao e professor ────────────────────────
DROP POLICY IF EXISTS "horarios_admin_all"     ON public.horarios;
DROP POLICY IF EXISTS "horarios_prof_select"   ON public.horarios;

CREATE POLICY "horarios_instituicao_all" ON public.horarios
  FOR ALL
  USING     (public.get_my_role() = 'instituicao')
  WITH CHECK (public.get_my_role() = 'instituicao');

CREATE POLICY "horarios_professor_select" ON public.horarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.turmas t
      WHERE t.id = horarios.turma_id AND t.professor_id = auth.uid()
    )
  );

-- ─── RESULTADO DAS ROLES ─────────────────────────────────────────────────────
-- admin      : cria/gerencia contas de instituição. Só vê dashboard.
-- instituicao: gerencia professores, alunos, turmas, horários, relatórios.
-- professor  : faz chamada, vê horário, notas de turma, relatório do dia.

-- Para definir admin manualmente:
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'seu@email.com';
