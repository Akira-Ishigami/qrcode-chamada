-- ═══════════════════════════════════════════════════════════════════════════
--  CHAMADA QR — Funções SQL dos Botões
--  Execute no SQL Editor do Supabase após o schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Botão: Iniciar Chamada ──────────────────────────────────────────────────
-- Cria chamada para hoje ou reabre a existente. Retorna o ID da chamada.
CREATE OR REPLACE FUNCTION fn_iniciar_chamada(p_turma_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Reutiliza chamada aberta do dia
  SELECT id INTO v_id
  FROM chamadas
  WHERE turma_id = p_turma_id
    AND data      = CURRENT_DATE
    AND aberta    = true
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO chamadas (turma_id, data, aberta)
    VALUES (p_turma_id, CURRENT_DATE, true)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ─── Botão: Escanear QR Code → Registrar Presença ───────────────────────────
-- Recebe o valor do QR (matrícula do aluno) e registra presença.
-- Retorna: 'ok', 'ja_presente' ou 'aluno_nao_encontrado'.
CREATE OR REPLACE FUNCTION fn_registrar_presenca(
  p_chamada_id uuid,
  p_matricula  text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_aluno_id uuid;
BEGIN
  -- Encontra aluno pela matrícula
  SELECT id INTO v_aluno_id
  FROM alunos
  WHERE matricula = p_matricula
  LIMIT 1;

  IF v_aluno_id IS NULL THEN
    RETURN 'aluno_nao_encontrado';
  END IF;

  -- Tenta inserir presença (ignora duplicata via ON CONFLICT)
  INSERT INTO presencas (chamada_id, aluno_id)
  VALUES (p_chamada_id, v_aluno_id)
  ON CONFLICT (chamada_id, aluno_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'ja_presente';
  END IF;

  RETURN 'ok';
END;
$$;

-- ─── Botão: Encerrar Chamada ─────────────────────────────────────────────────
-- Fecha a chamada e retorna o resumo final.
CREATE OR REPLACE FUNCTION fn_encerrar_chamada(p_chamada_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total    int;
  v_presentes int;
BEGIN
  -- Fecha chamada
  UPDATE chamadas SET aberta = false WHERE id = p_chamada_id;

  -- Conta alunos da turma vs presenças
  SELECT COUNT(*) INTO v_total
  FROM alunos a
  JOIN chamadas c ON a.turma_id = c.turma_id
  WHERE c.id = p_chamada_id;

  SELECT COUNT(*) INTO v_presentes
  FROM presencas
  WHERE chamada_id = p_chamada_id;

  RETURN json_build_object(
    'chamada_id', p_chamada_id,
    'total',      v_total,
    'presentes',  v_presentes,
    'ausentes',   v_total - v_presentes,
    'encerrada_em', now()
  );
END;
$$;

-- ─── Botão: Exportar Planilha — View para relatório ──────────────────────────
-- Retorna todos os alunos de uma chamada com status de presença.
CREATE OR REPLACE FUNCTION fn_relatorio_chamada(p_chamada_id uuid)
RETURNS TABLE (
  numero      int,
  nome        text,
  matricula   text,
  presenca    text,
  horario     timestamptz
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY a.nome)::int AS numero,
    a.nome,
    a.matricula,
    CASE WHEN p.id IS NOT NULL THEN 'Presente' ELSE 'Ausente' END AS presenca,
    p.registrado_em AS horario
  FROM alunos a
  JOIN chamadas c ON a.turma_id = c.turma_id
  LEFT JOIN presencas p ON p.aluno_id = a.id AND p.chamada_id = p_chamada_id
  WHERE c.id = p_chamada_id
  ORDER BY a.nome;
$$;

-- ─── Estatísticas de uma chamada (painel de stats) ───────────────────────────
CREATE OR REPLACE FUNCTION fn_stats_chamada(p_chamada_id uuid)
RETURNS json
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total',     COUNT(a.id),
    'presentes', COUNT(p.id),
    'ausentes',  COUNT(a.id) - COUNT(p.id),
    'pct',       ROUND(COUNT(p.id)::numeric / NULLIF(COUNT(a.id), 0) * 100, 1)
  )
  FROM alunos a
  JOIN chamadas c ON a.turma_id = c.turma_id
  LEFT JOIN presencas p ON p.aluno_id = a.id AND p.chamada_id = p_chamada_id
  WHERE c.id = p_chamada_id;
$$;

-- ─── View: Chamadas abertas (dashboard rápido) ───────────────────────────────
CREATE OR REPLACE VIEW vw_chamadas_abertas AS
SELECT
  c.id                AS chamada_id,
  c.data,
  t.nome              AS turma,
  t.professor,
  t.horario,
  i.nome              AS instituicao,
  COUNT(DISTINCT a.id)     AS total_alunos,
  COUNT(DISTINCT p.aluno_id) AS presentes
FROM chamadas c
JOIN turmas t       ON t.id = c.turma_id
JOIN instituicoes i ON i.id = t.instituicao_id
LEFT JOIN alunos a  ON a.turma_id = c.turma_id
LEFT JOIN presencas p ON p.chamada_id = c.id
WHERE c.aberta = true
GROUP BY c.id, c.data, t.nome, t.professor, t.horario, i.nome
ORDER BY c.data DESC;

-- ─── View: Histórico de chamadas encerradas ──────────────────────────────────
CREATE OR REPLACE VIEW vw_historico_chamadas AS
SELECT
  c.id,
  c.data,
  t.nome              AS turma,
  t.professor,
  i.nome              AS instituicao,
  COUNT(DISTINCT a.id)       AS total_alunos,
  COUNT(DISTINCT p.aluno_id) AS presentes,
  ROUND(
    COUNT(DISTINCT p.aluno_id)::numeric
    / NULLIF(COUNT(DISTINCT a.id), 0) * 100, 1
  )                          AS pct_presenca
FROM chamadas c
JOIN turmas t       ON t.id = c.turma_id
JOIN instituicoes i ON i.id = t.instituicao_id
LEFT JOIN alunos a  ON a.turma_id = c.turma_id
LEFT JOIN presencas p ON p.chamada_id = c.id
WHERE c.aberta = false
GROUP BY c.id, c.data, t.nome, t.professor, i.nome
ORDER BY c.data DESC;

-- ─── Permissões (anon pode executar as funções) ──────────────────────────────
GRANT EXECUTE ON FUNCTION fn_iniciar_chamada(uuid)            TO anon;
GRANT EXECUTE ON FUNCTION fn_registrar_presenca(uuid, text)   TO anon;
GRANT EXECUTE ON FUNCTION fn_encerrar_chamada(uuid)           TO anon;
GRANT EXECUTE ON FUNCTION fn_relatorio_chamada(uuid)          TO anon;
GRANT EXECUTE ON FUNCTION fn_stats_chamada(uuid)              TO anon;
GRANT SELECT  ON vw_chamadas_abertas                          TO anon;
GRANT SELECT  ON vw_historico_chamadas                        TO anon;
