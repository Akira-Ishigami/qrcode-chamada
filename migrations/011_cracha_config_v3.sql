-- Garante que TODAS as colunas do cracha_config existem (safe upsert)
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS cor_principal  text DEFAULT '#2563eb';
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS cor_secundaria text DEFAULT '#1e40af';
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS logo_url       text;
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS padrao         text DEFAULT 'limpo';
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS fonte          text DEFAULT 'georgia';
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS atualizado_em  timestamptz DEFAULT now();

-- Novas colunas de personalização avançada
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS cor_texto      text DEFAULT '#111827';
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS cor_decoracao  text DEFAULT '#2563eb';
