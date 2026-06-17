-- ============================================================
-- Migration 036 — Corrige FK chamadas.horario_id
-- Descrição: Garante ON DELETE SET NULL. Sem isso, apagar um
--            horário com chamada dava erro de foreign key.
--            Ao remover o horário, a chamada é preservada e
--            apenas perde o vínculo (horario_id = null).
-- ============================================================

alter table chamadas drop constraint if exists chamadas_horario_id_fkey;
alter table chamadas
  add constraint chamadas_horario_id_fkey
  foreign key (horario_id) references horarios(id) on delete set null;
