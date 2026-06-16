-- ============================================================
-- Migration 033 — Matéria no evento + regra de conflito
-- Descrição: Professores lançam provas/trabalhos vinculados a
--            uma matéria. Impede duas provas/trabalhos no MESMO
--            horário para a MESMA turma (mesmo dia + mesma hora).
--            Mesmo dia em horários diferentes é permitido.
-- ============================================================

alter table eventos_calendario
  add column if not exists materia_id uuid references materias(id) on delete set null;

-- Um único compromisso por turma/dia/horário (para provas e trabalhos)
create unique index if not exists eventos_turma_slot_unico
  on eventos_calendario (turma_id, data_inicio, hora_inicio)
  where turma_id is not null
    and hora_inicio is not null
    and tipo in ('prova', 'trabalho');
