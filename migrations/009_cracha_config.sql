-- Configuração visual do crachá por instituição
CREATE TABLE IF NOT EXISTS cracha_config (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  instituicao_id uuid REFERENCES instituicoes(id) ON DELETE CASCADE UNIQUE NOT NULL,
  cor_principal  text NOT NULL DEFAULT '#2563eb',
  cor_secundaria text NOT NULL DEFAULT '#1e40af',
  logo_url       text,   -- base64 data URL (thumbnail pequeno)
  atualizado_em  timestamptz DEFAULT now()
);

ALTER TABLE cracha_config ENABLE ROW LEVEL SECURITY;

-- Instituição gerencia apenas sua própria config
CREATE POLICY "cracha_config_own" ON cracha_config
  FOR ALL
  USING (
    instituicao_id = (SELECT instituicao_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    instituicao_id = (SELECT instituicao_id FROM profiles WHERE id = auth.uid())
  );

-- Admin pode ver todas as configs (para gerar crachás no painel ADM)
CREATE POLICY "cracha_config_admin_read" ON cracha_config
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
