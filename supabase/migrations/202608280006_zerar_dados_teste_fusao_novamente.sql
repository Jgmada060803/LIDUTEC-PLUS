begin;

-- Segundo reset dos dados de teste da Fusão — mesma numeração de antes
-- (F1→248, F2→13, H1→51, H2→122). Materiais não são mexidos.
delete from public.transferencias_fusao;
delete from public.corridas_fusao; -- cascade: carga_itens, pesagens_ponte_log, mensagens, alteracoes, adicoes

insert into public.corridas_fusao (forno_id, ciclo_refratario_id, numero_sequencia, codigo, data_operacional, turno, status, sobra_inicial_kg)
values
  (1, 3, 247, 'F1053247', current_date, 'MANHA', 'CANCELADA', 0),
  (2, 1, 12,  'F2060012', current_date, 'MANHA', 'CANCELADA', 0),
  (3, 4, 50,  'H1047050', current_date, 'MANHA', 'CANCELADA', 0),
  (4, 5, 121, 'H2048121', current_date, 'MANHA', 'CANCELADA', 0);

commit;
