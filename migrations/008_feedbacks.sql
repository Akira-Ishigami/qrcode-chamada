-- Tabela de feedbacks das instituições (bugs e melhorias)
CREATE TABLE IF NOT EXISTS feedbacks (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  instituicao_id uuid REFERENCES instituicoes(id) ON DELETE CASCADE NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('bug', 'melhoria')),
  titulo         text NOT NULL,
  descricao      text DEFAULT '',
  status         text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_analise', 'resolvido')),
  criado_em      timestamptz DEFAULT now()
);

ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;

-- Instituição gerencia apenas seus próprios feedbacks
CREATE POLICY "feedbacks_inst_own" ON feedbacks
  FOR ALL
  USING (
    instituicao_id = (
      SELECT instituicao_id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    instituicao_id = (
      SELECT instituicao_id FROM profiles WHERE id = auth.uid()
    )
  );
