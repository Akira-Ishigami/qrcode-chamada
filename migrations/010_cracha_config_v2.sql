-- Adiciona colunas de personalização visual ao crachá
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS padrao text DEFAULT 'limpo';
ALTER TABLE cracha_config ADD COLUMN IF NOT EXISTS fonte   text DEFAULT 'georgia';
