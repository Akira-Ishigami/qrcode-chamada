-- Adiciona flag de chegada tardia na tabela de presenças
alter table presencas add column if not exists atrasado boolean not null default false;

-- Índice útil para relatórios de atraso
create index if not exists presencas_atrasado_idx on presencas(chamada_id, atrasado);
