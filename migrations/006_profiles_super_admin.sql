-- Migration 006 — Adiciona super_admin e instituicao_id em profiles
-- Execute no Supabase SQL Editor

-- 1. Atualiza constraint de role para incluir super_admin
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'professor', 'super_admin'));

-- 2. Adiciona coluna instituicao_id (nullable — super_admin não precisa ter)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS instituicao_id uuid REFERENCES public.instituicoes(id) ON DELETE SET NULL;

-- 3. Políticas de RLS para super_admin
DROP POLICY IF EXISTS "profiles_super_admin_read"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_super_admin_write" ON public.profiles;

-- super_admin lê todos os perfis
CREATE POLICY "profiles_super_admin_read" ON public.profiles
  FOR SELECT USING (public.get_my_role() = 'super_admin');

-- super_admin escreve todos os perfis
CREATE POLICY "profiles_super_admin_write" ON public.profiles
  FOR ALL
  USING     (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- 4. Atualiza políticas de admin para não sobrepor super_admin (drop e recria)
DROP POLICY IF EXISTS "profiles_admin_read"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_write" ON public.profiles;

CREATE POLICY "profiles_admin_read" ON public.profiles
  FOR SELECT USING (public.get_my_role() IN ('admin', 'super_admin'));

CREATE POLICY "profiles_admin_write" ON public.profiles
  FOR ALL
  USING     (public.get_my_role() IN ('admin', 'super_admin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

-- 5. Para definir o primeiro super_admin manualmente após executar:
--    UPDATE public.profiles SET role = 'super_admin' WHERE email = 'seu@email.com';
