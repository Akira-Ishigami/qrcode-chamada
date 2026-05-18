-- ============================================================
-- Migration 022 — Correções de segurança
-- ============================================================

-- ── 1. Corrige views SECURITY DEFINER → SECURITY INVOKER ──────────────────
-- As views usavam SECURITY DEFINER, ignorando o RLS e expondo dados de todos.
-- SECURITY INVOKER faz a view rodar com as permissões de quem a chama.

-- Recria vw_chamadas_abertas
DROP VIEW IF EXISTS public.vw_chamadas_abertas;
CREATE VIEW public.vw_chamadas_abertas
  WITH (security_invoker = true)
AS
  SELECT
    c.id,
    c.turma_id,
    c.data,
    c.aberta,
    c.criado_em,
    c.professor_id,
    t.nome  AS turma_nome,
    t.instituicao_id
  FROM public.chamadas c
  JOIN public.turmas t ON t.id = c.turma_id
  WHERE c.aberta = true;

-- Recria vw_historico_chamadas
DROP VIEW IF EXISTS public.vw_historico_chamadas;
CREATE VIEW public.vw_historico_chamadas
  WITH (security_invoker = true)
AS
  SELECT
    c.id,
    c.turma_id,
    c.data,
    c.aberta,
    c.criado_em,
    c.professor_id,
    c.duracao_seg,
    c.observacao,
    t.nome         AS turma_nome,
    t.professor    AS turma_professor,
    t.instituicao_id
  FROM public.chamadas c
  JOIN public.turmas t ON t.id = c.turma_id;

-- ── 2. Corrige Auth RLS Initialization Plan ───────────────────────────────
-- O Supabase recomenda usar (select auth.uid()) em vez de auth.uid()
-- diretamente nas policies para evitar re-execução por linha.

-- profiles
DROP POLICY IF EXISTS "profiles_own_read"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_write" ON public.profiles;

CREATE POLICY "profiles_own_read" ON public.profiles
  FOR SELECT USING (id = (SELECT auth.uid()));

CREATE POLICY "profiles_own_write" ON public.profiles
  FOR UPDATE USING (id = (SELECT auth.uid()))
  WITH CHECK    (id = (SELECT auth.uid()));

-- turmas: professor só vê suas turmas
DROP POLICY IF EXISTS "turmas_professor_select" ON public.turmas;

CREATE POLICY "turmas_professor_select" ON public.turmas
  FOR SELECT USING (
    professor_id = (SELECT auth.uid())
    OR public.get_my_role() IN ('instituicao', 'admin')
  );

-- horarios: professor só vê horários das suas turmas
DROP POLICY IF EXISTS "horarios_professor_select" ON public.horarios;
DROP POLICY IF EXISTS "horarios_prof_select"      ON public.horarios;

CREATE POLICY "horarios_professor_select" ON public.horarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.turmas t
      WHERE t.id = horarios.turma_id
        AND t.professor_id = (SELECT auth.uid())
    )
    OR public.get_my_role() IN ('instituicao', 'admin')
  );

-- ── 3. Garante que get_my_role() é STABLE (executado uma vez por query) ───
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())
$$;
