-- ============================================================
-- Migration 032 — Eventos por turma + tipo "trabalho"
-- Descrição: Permite escopar eventos do calendário a uma turma
--            (turma_id null = escola toda) e adiciona o tipo
--            "trabalho" (provas e trabalhos da turma para o aluno).
-- ============================================================

alter table eventos_calendario
  add column if not exists turma_id uuid references turmas(id) on delete cascade;

alter table eventos_calendario drop constraint if exists eventos_calendario_tipo_check;
alter table eventos_calendario
  add constraint eventos_calendario_tipo_check
  check (tipo in ('feriado','prova','trabalho','reuniao','recesso','evento'));

create index if not exists idx_eventos_turma on eventos_calendario(turma_id);
