begin;

-- ==========================================================================
-- Reset dos dados de TESTE da Fusão (pedido explícito) — apaga corridas,
-- cargas, transferências, mensagens, histórico de alterações e log de
-- pesagens da Ponte. A numeração da próxima corrida de cada forno é
-- ajustada pra continuar exatamente de onde a área já está praticando no
-- papel (não volta pro 1) — via uma linha CANCELADA "semente" com o último
-- número praticado, já que o cálculo do próximo é sempre max(sequencia)+1
-- dentro do ciclo. Ciclo de refratário também ajustado pro número real.
-- ==========================================================================
delete from public.transferencias_fusao;
delete from public.corridas_fusao; -- cascade: carga_itens, pesagens_ponte_log, mensagens, alteracoes, adicoes

update public.ciclos_refratario_fusao set numero_ciclo = 53 where id = 3; -- F1
update public.ciclos_refratario_fusao set numero_ciclo = 60 where id = 1; -- F2
update public.ciclos_refratario_fusao set numero_ciclo = 47 where id = 4; -- H1
update public.ciclos_refratario_fusao set numero_ciclo = 48 where id = 5; -- H2

insert into public.corridas_fusao (forno_id, ciclo_refratario_id, numero_sequencia, codigo, data_operacional, turno, status, sobra_inicial_kg)
values
  (1, 3, 247, 'F1053247', current_date, 'MANHA', 'CANCELADA', 0),
  (2, 1, 12,  'F2060012', current_date, 'MANHA', 'CANCELADA', 0),
  (3, 4, 50,  'H1047050', current_date, 'MANHA', 'CANCELADA', 0),
  (4, 5, 121, 'H2048121', current_date, 'MANHA', 'CANCELADA', 0);

-- ==========================================================================
-- Cadastro real dos materiais (substitui os 3 de teste) — lista fornecida
-- pelo usuário. "Ti" (Titânio) não tem coluna no schema hoje — o único
-- valor real perdido é 30% Ti do material TITÂNIO (fica só com Si=20%
-- registrado; se precisar do Ti, precisa de uma coluna nova).
-- ==========================================================================
delete from public.materiais_fusao;

insert into public.materiais_fusao (nome, tipo, ativo, pct_c, pct_si, pct_mn, pct_p, pct_cr, pct_s, pct_sn, pct_cu, pct_mo, pct_al, pct_pb, modo_pesagem)
values
('SUCATA DE AÇO ESTAMPARIA','SUCATA',true,0.20,0.20,0.30,0.03,0.00,0.02,0.00,0.00,0.00,0.00,0.00,'CARRO'),
('SUCATA DE AÇO OXICORTE','SUCATA',true,0.20,0.20,0.60,0.03,0.00,0.02,0.00,0.00,0.00,0.00,0.00,'CARRO'),
('FERRO GUSA SIDERURGIA','GUSA',true,4.20,0.50,0.00,0.10,0.00,0.02,0.00,0.00,0.00,0.00,0.00,'CARRO'),
('FERRO GUSA UTG','GUSA',true,3.80,0.20,0.00,0.04,0.00,0.02,0.00,0.00,0.00,0.00,0.00,'CARRO'),
('FERRO GUSA ACIARIA','GUSA',true,4.00,1.50,0.80,0.12,0.10,0.45,0.00,0.10,0.00,0.00,0,'CARRO'),
('LINGOTE  DISA ( LÍQUIDO)','RETORNO',true,3.65,2.50,null,null,null,null,null,null,null,null,null,'PONTE'),
('RETORNO  CINZENTO PADRÃO','RETORNO',true,3.65,2.40,null,null,null,null,null,null,null,null,null,'CARRO'),
('RETORNO  CINZENTO (+ Cu +Mn )','RETORNO',true,3.45,2.40,null,null,null,null,null,null,null,null,null,'CARRO'),
('RETORNO  CINZENTO ( + Mo )','RETORNO',true,3.75,1.80,null,null,null,null,null,null,null,null,null,'CARRO'),
('RETORNO NODULAR PADRÃO','RETORNO',true,3.65,2.60,null,null,null,null,null,null,null,null,null,'CARRO'),
('RETORNO NODULAR  (+ Cu + Mn)','RETORNO',true,3.65,2.60,null,null,null,null,null,null,null,null,null,'CARRO'),
('BLOCOS METAL SÓLIDO (LINGOTES)','RETORNO',true,3.65,2.60,null,null,null,null,null,null,null,null,null,'PONTE'),
('CAVACO DE USINAGEM','ALTERNATIVO',true,3.65,2.60,null,null,null,null,null,null,null,null,null,'CARRO'),
('SUCATA DE GUSA UTG','ALTERNATIVO',true,3.65,2.60,null,null,null,null,null,null,null,null,null,'CARRO'),
('SUCATA UBE','ALTERNATIVO',true,3.65,2.60,null,null,null,null,null,null,null,null,null,'CARRO'),
('LINGOTEIRAS','ALTERNATIVO',true,3.65,2.60,null,null,null,null,null,null,null,null,null,'CARRO'),
('CARBURANTE GRAFITE','LIGA_CORRECAO',true,70.00,null,null,null,null,null,null,null,null,null,null,'DIRETO'),
('FERRO SILÍCIO','LIGA_CORRECAO',true,null,70.00,null,null,null,null,null,null,null,null,null,'DIRETO'),
('FERRO CROMO','LIGA_CORRECAO',true,5.00,5.00,null,null,50.00,null,null,null,null,null,null,'DIRETO'),
('FERRO MANGANÊS','LIGA_CORRECAO',true,5.00,5.00,70.00,null,null,null,null,null,null,null,null,'DIRETO'),
('SUCATA DE COBRE','LIGA_CORRECAO',true,null,null,null,null,null,null,null,100.00,null,null,null,'DIRETO'),
('NUCLEANTE','LIGA_CORRECAO',true,null,null,70.00,null,null,null,null,null,null,null,null,'DIRETO'),
('MOLIBIDÊNIO','LIGA_CORRECAO',true,null,30.00,null,null,null,null,null,null,55.00,null,null,'DIRETO'),
('ESTANHO','LIGA_CORRECAO',true,null,null,null,null,null,null,100.00,null,null,null,null,'DIRETO'),
('TITÂNIO','LIGA_CORRECAO',true,null,20.00,null,null,null,null,null,null,null,null,null,'DIRETO'),
('PIRIRA / ENXOFRE','LIGA_CORRECAO',true,null,null,null,null,null,70.00,null,null,null,null,null,'DIRETO'),
('CARBETO SI','LIGA_CORRECAO',true,40.00,40.00,null,null,null,null,null,null,null,null,null,'DIRETO');

notify pgrst, 'reload schema';

commit;
