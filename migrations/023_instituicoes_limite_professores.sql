-- Limite de professores por instituição
-- NULL = sem limite / ilimitado
ALTER TABLE public.instituicoes
  ADD COLUMN IF NOT EXISTS limite_professores integer DEFAULT NULL;
