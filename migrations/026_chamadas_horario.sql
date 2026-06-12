-- ============================================================
-- Migration 026 — Vincula chamada ao horário (slot de aula)
-- Descrição: Permite mais de uma chamada por turma no mesmo dia,
--            uma por horário (slot). Assim "Iniciar Chamada"
--            continua/reabre a chamada do horário atual e só cria
--            uma nova quando vira outro horário.
-- ============================================================

alter table chamadas
  add column if not exists horario_id uuid references horarios(id) on delete set null;

-- Busca rápida da chamada do horário atual no dia
create index if not exists chamadas_turma_data_horario_idx
  on chamadas(turma_id, data, horario_id);
