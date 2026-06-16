-- ============================================================
-- Migration 034 — Fundação da grade horária automática
-- Descrição: dados de entrada para gerar a grade com 1 clique.
--   - grade_config: parâmetros (duração da aula, recreio, dias…)
--   - grade_curricular: demanda (turma × matéria × professor × aulas/semana)
--   - professor_indisponibilidade: quando o professor NÃO pode dar aula
-- ============================================================

-- 1. Configuração de geração por instituição
create table if not exists grade_config (
  instituicao_id  uuid primary key references instituicoes(id) on delete cascade,
  aula_min        int  not null default 50,      -- duração de cada aula (min)
  intervalo_min   int  not null default 0,       -- intervalo entre aulas (min)
  recreio_inicio  time,                           -- recreio fixo (opcional)
  recreio_fim     time,
  dias_semana     int[] not null default '{1,2,3,4,5}', -- 0=Dom … 6=Sáb
  max_materia_dia int  not null default 2,        -- máx. aulas da mesma matéria/dia
  atualizado_em   timestamptz default now()
);

-- 2. Grade curricular: o que cada turma precisa ter (a demanda)
create table if not exists grade_curricular (
  id             uuid primary key default gen_random_uuid(),
  instituicao_id uuid not null references instituicoes(id) on delete cascade,
  turma_id       uuid not null references turmas(id)   on delete cascade,
  materia_id     uuid not null references materias(id) on delete cascade,
  professor_id   uuid references profiles(id) on delete set null,
  aulas_semana   int  not null default 1 check (aulas_semana >= 0),
  unique (turma_id, materia_id)
);
create index if not exists idx_grade_curr_turma on grade_curricular(turma_id);

-- 3. Indisponibilidade do professor (blocos em que ele não pode)
create table if not exists professor_indisponibilidade (
  id           uuid primary key default gen_random_uuid(),
  professor_id uuid not null references profiles(id) on delete cascade,
  dia_semana   smallint not null check (dia_semana between 0 and 6),
  hora_inicio  time not null,
  hora_fim     time not null
);
create index if not exists idx_prof_indisp on professor_indisponibilidade(professor_id, dia_semana);

-- ── RLS ──────────────────────────────────────────────────────
alter table grade_config               enable row level security;
alter table grade_curricular           enable row level security;
alter table professor_indisponibilidade enable row level security;

-- Instituição gerencia a própria config e grade
create policy grade_config_inst on grade_config
  for all using (instituicao_id in (select instituicao_id from profiles where id = auth.uid()));
create policy grade_curr_inst on grade_curricular
  for all using (instituicao_id in (select instituicao_id from profiles where id = auth.uid()));

-- Professor gerencia a própria indisponibilidade; instituição/admin leem
create policy prof_indisp_own on professor_indisponibilidade
  for all using (professor_id = auth.uid());
create policy prof_indisp_read on professor_indisponibilidade
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role in ('instituicao','admin'))
  );
