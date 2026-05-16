-- Campos extras na tabela chamadas
alter table chamadas add column if not exists encerrada_em  timestamptz;
alter table chamadas add column if not exists observacao    text;
alter table chamadas add column if not exists duracao_seg   integer; -- calculado ao encerrar

-- Índice para buscar chamadas recentes por professor (via turma)
create index if not exists chamadas_encerrada_em_idx on chamadas(encerrada_em desc);
