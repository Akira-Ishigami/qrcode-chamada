-- ============================================================
-- Migration 021 — Matérias + vínculo professor + horários FK
-- ============================================================

-- 1. Limpa professor_id de materias (vira M2M)
ALTER TABLE public.materias DROP COLUMN IF EXISTS professor_id;

-- 2. Garante que materias tem nome único por instituição
ALTER TABLE public.materias
  DROP CONSTRAINT IF EXISTS materias_nome_inst_unique;
ALTER TABLE public.materias
  ADD CONSTRAINT materias_nome_inst_unique UNIQUE (nome, instituicao_id);

-- 3. Tabela M2M: professor ↔ matéria
CREATE TABLE IF NOT EXISTS public.professor_materias (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_id   uuid        NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  materia_id     uuid        NOT NULL REFERENCES public.materias(id)     ON DELETE CASCADE,
  instituicao_id uuid        NOT NULL REFERENCES public.instituicoes(id) ON DELETE CASCADE,
  criado_em      timestamptz DEFAULT now(),
  UNIQUE(professor_id, materia_id)
);

ALTER TABLE public.professor_materias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pm_instituicao_all" ON public.professor_materias
  FOR ALL USING     (public.get_my_role() = 'instituicao')
  WITH CHECK        (public.get_my_role() = 'instituicao');

CREATE POLICY "pm_professor_select" ON public.professor_materias
  FOR SELECT USING  (public.get_my_role() IN ('professor', 'admin', 'instituicao'));

CREATE POLICY "pm_admin_all" ON public.professor_materias
  FOR ALL USING     (public.get_my_role() = 'admin')
  WITH CHECK        (public.get_my_role() = 'admin');

-- 4. Adiciona materia_id + professor_id nos horários (mantém coluna materia text por compatibilidade)
ALTER TABLE public.horarios
  ADD COLUMN IF NOT EXISTS materia_id    uuid REFERENCES public.materias(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS professor_id  uuid REFERENCES public.profiles(id)  ON DELETE SET NULL;

-- 5. RLS para materias (instituição gerencia, professor lê)
DROP POLICY IF EXISTS "materias_instituicao_all" ON public.materias;
DROP POLICY IF EXISTS "materias_professor_select" ON public.materias;
DROP POLICY IF EXISTS "materias_admin_all" ON public.materias;

CREATE POLICY "materias_instituicao_all" ON public.materias
  FOR ALL USING     (public.get_my_role() = 'instituicao')
  WITH CHECK        (public.get_my_role() = 'instituicao');

CREATE POLICY "materias_professor_select" ON public.materias
  FOR SELECT USING  (public.get_my_role() IN ('professor', 'admin'));

CREATE POLICY "materias_admin_all" ON public.materias
  FOR ALL USING     (public.get_my_role() = 'admin')
  WITH CHECK        (public.get_my_role() = 'admin');

-- 6. Índices
CREATE INDEX IF NOT EXISTS idx_pm_professor  ON public.professor_materias(professor_id);
CREATE INDEX IF NOT EXISTS idx_pm_materia    ON public.professor_materias(materia_id);
CREATE INDEX IF NOT EXISTS idx_hor_materia   ON public.horarios(materia_id);
CREATE INDEX IF NOT EXISTS idx_hor_professor ON public.horarios(professor_id);
