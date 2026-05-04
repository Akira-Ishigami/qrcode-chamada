-- Suporte a imagens nas mensagens de suporte (base64 direto no banco)
ALTER TABLE suporte_mensagens ADD COLUMN IF NOT EXISTS imagem_base64 text;
