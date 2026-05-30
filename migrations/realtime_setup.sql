-- ══════════════════════════════════════════════════════════════════
-- Habilitar Supabase Realtime nas tabelas do calendário
-- Rodar no Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════════

-- REPLICA IDENTITY FULL: Realtime envia a linha completa no payload
-- (necessário para filtros como usuario_id=eq.xxx funcionarem)
ALTER TABLE notificacoes       REPLICA IDENTITY FULL;
ALTER TABLE eventos_calendario REPLICA IDENTITY FULL;

-- Adicionar ao publication do Supabase Realtime
-- (se já existir, o Supabase ignora silenciosamente)
ALTER PUBLICATION supabase_realtime ADD TABLE notificacoes;
ALTER PUBLICATION supabase_realtime ADD TABLE eventos_calendario;
