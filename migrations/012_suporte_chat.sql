-- Chat de suporte por ticket (mensagens dentro de cada feedback)
CREATE TABLE IF NOT EXISTS suporte_mensagens (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_id uuid REFERENCES feedbacks(id) ON DELETE CASCADE NOT NULL,
  autor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_role  text NOT NULL CHECK (autor_role IN ('instituicao', 'admin')),
  texto       text NOT NULL CHECK (char_length(trim(texto)) > 0),
  criado_em   timestamptz DEFAULT now()
);

ALTER TABLE suporte_mensagens ENABLE ROW LEVEL SECURITY;

-- Instituição: vê e envia mensagens apenas nos seus próprios tickets
CREATE POLICY "sm_inst" ON suporte_mensagens
  FOR ALL
  USING (
    feedback_id IN (
      SELECT id FROM feedbacks
      WHERE instituicao_id = (
        SELECT instituicao_id FROM profiles WHERE id = auth.uid()
      )
    )
  )
  WITH CHECK (
    feedback_id IN (
      SELECT id FROM feedbacks
      WHERE instituicao_id = (
        SELECT instituicao_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- Admin: vê e envia mensagens em todos os tickets
CREATE POLICY "sm_admin" ON suporte_mensagens
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Admin também precisa enxergar todos os feedbacks (a policy atual só deixa instituição ver os dela)
CREATE POLICY "feedbacks_admin_all" ON feedbacks
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
