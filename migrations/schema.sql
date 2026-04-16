-- ═══════════════════════════════════════════════════════════════════════════
--  CHAMADA QR — Schema Supabase
--  Execute no SQL Editor do Supabase (Dashboard → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. INSTITUIÇÕES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instituicoes (
  id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nome      text        NOT NULL,
  criado_em timestamptz DEFAULT now(),
  CONSTRAINT instituicoes_nome_unique UNIQUE (nome)
);

-- ─── 2. TURMAS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turmas (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nome           text        NOT NULL,
  professor      text,
  horario        text,
  instituicao_id uuid        NOT NULL REFERENCES instituicoes(id) ON DELETE RESTRICT,
  criado_em      timestamptz DEFAULT now()
);

-- ─── 3. ALUNOS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alunos (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nome           text        NOT NULL,
  matricula      text        NOT NULL,
  foto_url       text,
  turma_id       uuid        NOT NULL REFERENCES turmas(id)       ON DELETE RESTRICT,
  instituicao_id uuid        NOT NULL REFERENCES instituicoes(id) ON DELETE RESTRICT,
  criado_em      timestamptz DEFAULT now(),
  CONSTRAINT alunos_matricula_unique UNIQUE (matricula)
);

-- ─── 4. CHAMADAS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chamadas (
  id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  turma_id  uuid        NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  data      date        NOT NULL DEFAULT CURRENT_DATE,
  aberta    boolean     NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

-- ─── 5. PRESENÇAS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS presencas (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  chamada_id    uuid        NOT NULL REFERENCES chamadas(id) ON DELETE CASCADE,
  aluno_id      uuid        NOT NULL REFERENCES alunos(id)   ON DELETE CASCADE,
  registrado_em timestamptz DEFAULT now(),
  CONSTRAINT presencas_unica UNIQUE (chamada_id, aluno_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
--  ÍNDICES (performance)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_turmas_inst        ON turmas(instituicao_id);
CREATE INDEX IF NOT EXISTS idx_alunos_turma       ON alunos(turma_id);
CREATE INDEX IF NOT EXISTS idx_alunos_inst        ON alunos(instituicao_id);
CREATE INDEX IF NOT EXISTS idx_chamadas_turma     ON chamadas(turma_id);
CREATE INDEX IF NOT EXISTS idx_chamadas_data      ON chamadas(data);
CREATE INDEX IF NOT EXISTS idx_presencas_chamada  ON presencas(chamada_id);
CREATE INDEX IF NOT EXISTS idx_presencas_aluno    ON presencas(aluno_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS)
--  Permite acesso anônimo (anon) — ajuste conforme sua necessidade de auth
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE instituicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE turmas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE alunos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamadas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE presencas    ENABLE ROW LEVEL SECURITY;

-- Acesso total para anon (sem autenticação)
CREATE POLICY "anon_all_instituicoes" ON instituicoes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_turmas"       ON turmas       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_alunos"       ON alunos       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_chamadas"     ON chamadas     FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_presencas"    ON presencas    FOR ALL TO anon USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
--  STORAGE (foto de perfil dos alunos — opcional)
--  Execute separadamente se quiser habilitar upload de fotos
-- ═══════════════════════════════════════════════════════════════════════════
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('fotos-alunos', 'fotos-alunos', true)
-- ON CONFLICT (id) DO NOTHING;

-- CREATE POLICY "upload_fotos" ON storage.objects
--   FOR INSERT TO anon WITH CHECK (bucket_id = 'fotos-alunos');

-- CREATE POLICY "leitura_fotos" ON storage.objects
--   FOR SELECT TO anon USING (bucket_id = 'fotos-alunos');
