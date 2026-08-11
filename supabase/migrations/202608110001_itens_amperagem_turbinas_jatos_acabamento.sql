begin;

-- A02 "Jatos 1 e 2": os itens de Amperagem (04) e Mix de partículas grandes
-- (05) hoje são uma medição única pro turno inteiro. Como existem dois jatos
-- operando em paralelo (e cada jato tem várias turbinas), viram vários itens
-- distintos — um por turbina/jato — mantendo a mesma especificação mínima já
-- em uso (30 A por turbina, 40% de mix por jato). Os itens antigos ficam
-- inativos (não deletados) pra preservar o histórico de execuções já
-- registradas.
update public.itens_checklist item
set ativo = false
from public.modelos_checklist modelo
where item.modelo_id = modelo.id
  and modelo.codigo = 'A02'
  and item.codigo in ('04', '05');

update public.itens_checklist item
set ativo = false
from public.modelos_checklist modelo
where item.modelo_id = modelo.id
  and modelo.codigo = 'A03'
  and item.codigo = '04';

with item_data(modelo, codigo, secao, descricao, ordem) as (values
 ('A02', '04J1T01', 'Medição', 'Amperagem mínima — Jato 1, Turbina 01', 4),
 ('A02', '04J1T02', 'Medição', 'Amperagem mínima — Jato 1, Turbina 02', 5),
 ('A02', '04J1T03', 'Medição', 'Amperagem mínima — Jato 1, Turbina 03', 6),
 ('A02', '04J1T04', 'Medição', 'Amperagem mínima — Jato 1, Turbina 04', 7),
 ('A02', '04J2T01', 'Medição', 'Amperagem mínima — Jato 2, Turbina 01', 8),
 ('A02', '04J2T02', 'Medição', 'Amperagem mínima — Jato 2, Turbina 02', 9),
 ('A02', '04J2T03', 'Medição', 'Amperagem mínima — Jato 2, Turbina 03', 10),
 ('A02', '04J2T04', 'Medição', 'Amperagem mínima — Jato 2, Turbina 04', 11),
 ('A02', '05J1', 'Granalha', 'Mix de partículas grandes — Jato 1', 12),
 ('A02', '05J2', 'Granalha', 'Mix de partículas grandes — Jato 2', 13)
)
insert into public.itens_checklist(
  modelo_id, codigo, secao, descricao, tipo_resposta, unidade, valor_minimo,
  critico, gera_carta, plano_reacao, ordem, chave_especificacao, fonte_limite_tipo
)
select model.id, item.codigo, item.secao, item.descricao, 'NUMERO',
  case when item.codigo like '04%' then 'A' else '%' end,
  case when item.codigo like '04%' then 30 else 40 end,
  true, true,
  case when item.codigo like '04%' then 'Parar e avaliar turbina/manutenção.' else 'Corrigir o mix de granalha.' end,
  item.ordem,
  case when item.codigo like '04%' then 'AMPERAGEM_JATOS_1_2' else 'MIX_GRANALHA' end,
  'FIXO'
from item_data item join public.modelos_checklist model on model.codigo = item.modelo
on conflict(modelo_id, codigo) do update set
  secao = excluded.secao, descricao = excluded.descricao, tipo_resposta = excluded.tipo_resposta,
  unidade = excluded.unidade, valor_minimo = excluded.valor_minimo, critico = excluded.critico,
  gera_carta = excluded.gera_carta, plano_reacao = excluded.plano_reacao, ordem = excluded.ordem,
  chave_especificacao = excluded.chave_especificacao, fonte_limite_tipo = excluded.fonte_limite_tipo,
  ativo = true;

-- "Peças jateadas em condição" (A03/05) empurra ordem pra abrir espaço pros
-- itens de amperagem por turbina, que entram na frente dela.
update public.itens_checklist item
set ordem = 7
from public.modelos_checklist modelo
where item.modelo_id = modelo.id
  and modelo.codigo = 'A03'
  and item.codigo = '05';

with item_data(modelo, codigo, secao, descricao, ordem) as (values
 ('A03', '04T01', 'Medição', 'Amperagem mínima — Turbina 01', 4),
 ('A03', '04T02', 'Medição', 'Amperagem mínima — Turbina 02', 5),
 ('A03', '04T03', 'Medição', 'Amperagem mínima — Turbina 03', 6)
)
insert into public.itens_checklist(
  modelo_id, codigo, secao, descricao, tipo_resposta, unidade, valor_minimo,
  critico, gera_carta, plano_reacao, ordem, chave_especificacao, fonte_limite_tipo
)
select model.id, item.codigo, item.secao, item.descricao, 'NUMERO', 'A', 12,
  true, true, 'Parar e avaliar a turbina.', item.ordem, 'AMPERAGEM_JATO_3', 'FIXO'
from item_data item join public.modelos_checklist model on model.codigo = item.modelo
on conflict(modelo_id, codigo) do update set
  secao = excluded.secao, descricao = excluded.descricao, tipo_resposta = excluded.tipo_resposta,
  unidade = excluded.unidade, valor_minimo = excluded.valor_minimo, critico = excluded.critico,
  gera_carta = excluded.gera_carta, plano_reacao = excluded.plano_reacao, ordem = excluded.ordem,
  chave_especificacao = excluded.chave_especificacao, fonte_limite_tipo = excluded.fonte_limite_tipo,
  ativo = true;

commit;
