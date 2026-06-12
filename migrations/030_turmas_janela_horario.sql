-- ============================================================
-- Migration 030 — Janela de funcionamento da turma
-- Descrição: Hora de início e fim em que a turma funciona
--            (turno/período). Referência geral; não substitui
--            a grade de aulas (tabela horarios). null = não def.
-- ============================================================

alter table turmas
  add column if not exists hora_inicio time,
  add column if not exists hora_fim    time;
