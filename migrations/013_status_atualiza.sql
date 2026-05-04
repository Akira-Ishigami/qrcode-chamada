-- Atualiza status dos tickets: em_analise → em_andamento, resolvido → finalizado
ALTER TABLE feedbacks DROP CONSTRAINT IF EXISTS feedbacks_status_check;

UPDATE feedbacks SET status = 'em_andamento' WHERE status = 'em_analise';
UPDATE feedbacks SET status = 'finalizado'   WHERE status = 'resolvido';

ALTER TABLE feedbacks
  ADD CONSTRAINT feedbacks_status_check
  CHECK (status IN ('aberto', 'em_andamento', 'finalizado'));
