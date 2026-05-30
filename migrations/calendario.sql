-- ══════════════════════════════════════════════════════════════════
-- Calendário Escolar — novas tabelas
-- Rodar no Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════

-- 1. Eventos do calendário escolar
CREATE TABLE IF NOT EXISTS eventos_calendario (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo         text        NOT NULL,
  descricao      text,
  data_inicio    date        NOT NULL,
  data_fim       date,                          -- NULL = evento de 1 dia
  hora_inicio    time,
  hora_fim       time,
  tipo           text        NOT NULL DEFAULT 'evento'
                             CHECK (tipo IN ('feriado','prova','reuniao','recesso','evento')),
  instituicao_id uuid        REFERENCES instituicoes(id) ON DELETE CASCADE,
  criado_por     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now()
);

-- Índice para busca por instituição + período
CREATE INDEX IF NOT EXISTS idx_eventos_inst_data
  ON eventos_calendario (instituicao_id, data_inicio);

-- RLS
ALTER TABLE eventos_calendario ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados da mesma instituição podem ler
CREATE POLICY "read_eventos_inst" ON eventos_calendario
  FOR SELECT USING (
    instituicao_id IN (
      SELECT instituicao_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Apenas role=instituicao pode inserir/atualizar/deletar
CREATE POLICY "write_eventos_inst" ON eventos_calendario
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'instituicao'
        AND instituicao_id = eventos_calendario.instituicao_id
    )
  );


-- 2. Notificações in-app para professores
CREATE TABLE IF NOT EXISTS notificacoes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  evento_id   uuid        REFERENCES eventos_calendario(id) ON DELETE CASCADE,
  lida        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificacoes (usuario_id, lida);

ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

-- Cada usuário só vê/edita as próprias notificações
CREATE POLICY "own_notificacoes" ON notificacoes
  FOR ALL USING (usuario_id = auth.uid());


-- 3. Subscriptions de Web Push
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint    text        NOT NULL,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (usuario_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Usuário gerencia apenas as próprias subscriptions
CREATE POLICY "own_push_subs" ON push_subscriptions
  FOR ALL USING (usuario_id = auth.uid());

-- Service role pode ler todas (Edge Function precisa disso para enviar push)
CREATE POLICY "service_read_push_subs" ON push_subscriptions
  FOR SELECT USING (auth.role() = 'service_role');


-- ══════════════════════════════════════════════════════════════════
-- VARIÁVEIS DE AMBIENTE necessárias no .env / Vercel:
--
--   VITE_VAPID_PUBLIC_KEY=<sua_chave_pública_VAPID>
--   VAPID_PRIVATE_KEY=<sua_chave_privada_VAPID>   ← só na Edge Function
--
-- Gerar par de chaves VAPID:
--   npx web-push generate-vapid-keys
--
-- Edge Function (Supabase):
--   supabase/functions/notify-event/index.ts
--   (enviar Web Push para todos os push_subscriptions da instituição)
-- ══════════════════════════════════════════════════════════════════
