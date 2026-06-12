-- ============================================================
-- Migration 028 — Aulas e limite de faltas por semestre (matéria)
-- Descrição: A instituição define, por matéria, quantas aulas há
--            no semestre e quantas faltas o aluno pode ter no
--            semestre. null = não definido.
-- ============================================================

alter table materias
  add column if not exists aulas_semestre integer
  check (aulas_semestre is null or aulas_semestre >= 0);

alter table materias
  add column if not exists limite_faltas integer
  check (limite_faltas is null or limite_faltas >= 0);
