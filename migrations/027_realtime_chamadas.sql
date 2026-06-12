-- ============================================================
-- Migration 027 — Realtime para chamadas e presenças
-- Descrição: Habilita postgres_changes nas tabelas de chamada
--            para o relatório atualizar em tempo real a cada
--            alteração (nova presença, encerrar, reabrir).
-- ============================================================

-- Envia a linha completa no payload dos eventos
alter table chamadas  replica identity full;
alter table presencas replica identity full;

-- Adiciona à publicação do Supabase Realtime
alter publication supabase_realtime add table chamadas;
alter publication supabase_realtime add table presencas;
