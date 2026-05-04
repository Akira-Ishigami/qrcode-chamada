-- Adiciona tabelas à publicação do Supabase Realtime
-- Sem isso, postgres_changes não dispara eventos nessas tabelas
ALTER PUBLICATION supabase_realtime ADD TABLE suporte_mensagens;
ALTER PUBLICATION supabase_realtime ADD TABLE feedbacks;
