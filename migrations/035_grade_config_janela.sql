-- ============================================================
-- Migration 035 — Janela do dia na configuração da grade
-- Descrição: Define o horário em que as aulas acontecem
--            (ex: 07:00 às 11:00). Usado como padrão na geração.
--            A janela própria da turma (turmas.hora_inicio/fim),
--            quando preenchida, tem prioridade.
-- ============================================================

alter table grade_config
  add column if not exists hora_inicio time not null default '07:00',
  add column if not exists hora_fim    time not null default '12:00';
