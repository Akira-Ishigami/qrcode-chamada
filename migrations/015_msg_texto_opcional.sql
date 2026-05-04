-- Torna texto opcional (mensagens podem ser só imagem)
ALTER TABLE suporte_mensagens ALTER COLUMN texto DROP NOT NULL;
ALTER TABLE suporte_mensagens DROP CONSTRAINT IF EXISTS suporte_mensagens_texto_check;

-- Garante que pelo menos texto ou imagem esteja presente
ALTER TABLE suporte_mensagens
  ADD CONSTRAINT suporte_mensagens_content_check
  CHECK (
    (texto IS NOT NULL AND char_length(trim(texto)) > 0)
    OR imagem_base64 IS NOT NULL
  );
