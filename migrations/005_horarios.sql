-- Tabela de horários de aula
-- Cada entrada representa: em qual turma, qual matéria, em qual dia/hora
CREATE TABLE IF NOT EXISTS public.horarios (
  id          uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  turma_id    uuid     NOT NULL REFERENCES public.turmas(id) ON DELETE CASCADE,
  materia     text     NOT NULL,
  dia_semana  smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  -- 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sab
  hora_inicio time     NOT NULL,
  hora_fim    time     NOT NULL,
  sala        text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.horarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY horarios_admin_all ON public.horarios
  FOR ALL USING (get_my_role() = 'admin');

CREATE POLICY horarios_prof_select ON public.horarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.turmas t
      WHERE t.id = horarios.turma_id AND t.professor_id = auth.uid()
    )
  );
