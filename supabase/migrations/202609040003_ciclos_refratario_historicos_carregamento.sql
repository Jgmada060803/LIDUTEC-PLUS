-- Ciclos de refratário históricos (campanhas já encerradas, reconstruídas a partir do CSV de carregamento)
insert into public.ciclos_refratario_fusao (id, forno_id, numero_ciclo, iniciado_em, encerrado_em, motivo_encerramento, observacoes, numero_sequencia_inicial) values
(6, 3, 43, '2026-02-01T07:57:00-03:00', '2026-06-16T21:25:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(7, 1, 49, '2025-02-15T15:01:00-03:00', '2026-03-07T23:59:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(8, 2, 55, '2026-02-01T01:47:00-03:00', '2026-06-16T21:45:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(9, 4, 44, '2025-02-15T19:28:00-03:00', '2026-03-13T01:57:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(10, 2, 56, '2026-03-07T05:16:00-03:00', '2026-03-16T02:51:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(11, 1, 50, '2026-03-12T03:57:00-03:00', '2026-04-09T14:06:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(12, 4, 45, '2026-03-15T07:40:00-03:00', '2026-05-01T03:15:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(13, 2, 57, '2026-03-19T21:29:00-03:00', '2026-04-23T18:56:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(14, 3, 44, '2026-03-22T20:45:00-03:00', '2026-05-08T22:45:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(15, 1, 51, '2026-04-14T02:21:00-03:00', '2026-06-03T23:56:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(16, 2, 58, '2026-04-26T23:14:00-03:00', '2026-06-27T10:08:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(17, 4, 46, '2026-05-03T05:35:00-03:00', '2026-06-20T02:35:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(18, 3, 45, '2026-05-11T03:36:00-03:00', '2026-06-27T00:54:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(19, 1, 52, '2026-06-07T06:22:00-03:00', '2026-07-02T08:08:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(20, 4, 47, '2026-06-22T00:00:00-03:00', '2026-07-31T23:39:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(21, 3, 46, '2026-06-28T16:03:00-03:00', '2026-08-15T02:49:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0),
(22, 2, 59, '2026-07-01T01:35:00-03:00', '2026-08-20T18:20:00-03:00', 'Troca de refratário (importado do histórico)', 'Ciclo reconstruído a partir da planilha histórica de carregamento (importação em 04/09/2026).', 0);

-- Ajusta a data de início dos 4 ciclos ativos pra refletir quando a campanha realmente começou
update public.ciclos_refratario_fusao set iniciado_em = '2026-07-06T07:15:00-03:00' where id = 3;
update public.ciclos_refratario_fusao set iniciado_em = '2026-08-02T21:31:00-03:00' where id = 5;
update public.ciclos_refratario_fusao set iniciado_em = '2026-08-17T03:43:00-03:00' where id = 4;
update public.ciclos_refratario_fusao set iniciado_em = '2026-08-26T03:28:00-03:00' where id = 1;

select setval(pg_get_serial_sequence('public.ciclos_refratario_fusao','id'), (select max(id) from public.ciclos_refratario_fusao));
