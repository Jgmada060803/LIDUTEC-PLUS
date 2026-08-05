begin;

create or replace view public.export_turnos_producao as
select id,data_operacional,turno,status,fechado_em,fechado_por,criado_em,criado_por
from public.turnos_producao_moldes;

create or replace view public.export_apontamentos_producao as
select registro.id,registro.turno_producao_id,registro.data_operacional,registro.turno,
  registro.inicio,registro.fim,produto.codigo as produto_codigo,produto.nome as produto_nome,
  registro.moldes_vazados,registro.moldes_quebrados,
  registro.moldes_vazados+registro.moldes_quebrados as total_moldes,
  registro.pecas_por_molde,registro.peso_peca_kg,registro.total_pecas,
  registro.toneladas_produzidas,registro.criado_em
from public.registros_producao_moldes registro
join public.produtos produto on produto.id=registro.produto_id;

create or replace view public.export_paradas_producao as
select parada.id,parada.turno_producao_id,parada.data_operacional,parada.turno,
  parada.inicio,parada.fim,parada.duracao_minutos,
  setor.codigo as setor_codigo,setor.nome as setor_nome,
  categoria.codigo as motivo_codigo,categoria.nome as motivo_nome,
  parada.observacao,parada.criado_em
from public.paradas_producao_moldes parada
left join public.setores_responsaveis_parada setor on setor.id=parada.setor_responsavel_id
left join public.categorias_parada_producao categoria on categoria.id=parada.categoria_id;

create or replace view public.export_historico_edicoes_producao as
select historico.id,historico.turno_producao_id,historico.descricao,
  historico.dados_anteriores,historico.dados_novos,
  historico.alterado_em,historico.alterado_por
from public.historico_edicoes_turno_producao historico;

create or replace view public.export_catalogo_colunas as
select table_name,column_name,ordinal_position,data_type,udt_name,
  is_nullable,column_default,character_maximum_length,numeric_precision,numeric_scale
from information_schema.columns
where table_schema='public'
order by table_name,ordinal_position;

create or replace view public.export_relacionamentos as
select constraint_definition.conname as restricao,
  source_table.relname as tabela_origem,source_column.attname as coluna_origem,
  target_table.relname as tabela_destino,target_column.attname as coluna_destino
from pg_catalog.pg_constraint constraint_definition
join pg_catalog.pg_class source_table on source_table.oid=constraint_definition.conrelid
join pg_catalog.pg_class target_table on target_table.oid=constraint_definition.confrelid
cross join lateral unnest(constraint_definition.conkey,constraint_definition.confkey)
  with ordinality as key_pair(source_attnum,target_attnum,position)
join pg_catalog.pg_attribute source_column on source_column.attrelid=source_table.oid
  and source_column.attnum=key_pair.source_attnum
join pg_catalog.pg_attribute target_column on target_column.attrelid=target_table.oid
  and target_column.attnum=key_pair.target_attnum
join pg_catalog.pg_namespace namespace on namespace.oid=source_table.relnamespace
where constraint_definition.contype='f' and namespace.nspname='public';

revoke all on public.export_turnos_producao,public.export_apontamentos_producao,
  public.export_paradas_producao,public.export_historico_edicoes_producao,
  public.export_catalogo_colunas,public.export_relacionamentos
from public,anon,authenticated;

commit;
