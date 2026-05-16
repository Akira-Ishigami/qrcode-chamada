-- Vincula cada chamada ao professor que a iniciou
alter table chamadas
  add column if not exists professor_id uuid references profiles(id) on delete set null;

create index if not exists idx_chamadas_professor on chamadas(professor_id);
