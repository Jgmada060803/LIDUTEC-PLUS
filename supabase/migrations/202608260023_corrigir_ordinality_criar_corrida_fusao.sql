begin;

-- Corrige erro de sintaxe: "WITH ORDINALITY cannot be used with a column
-- definition list" — jsonb_to_recordset() exige lista de colunas (retorna
-- "record" genérico), e o Postgres só aceita combinar isso com WITH
-- ORDINALITY dentro de ROWS FROM(...). A versão anterior (migrations
-- 202608260019/20) só passava no create (plpgsql não valida o SQL interno
-- na criação) e quebrava ao chamar a função de verdade.
create or replace function public.criar_corrida_fusao(
  p_forno_id bigint, p_turno text, p_data_operacional date, p_produto_id bigint, p_inicio timestamptz, p_itens jsonb
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_ciclo record;
  v_forno record;
  v_sequencia integer;
  v_codigo text;
  v_corrida_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if p_data_operacional is null then raise exception 'Informe a data operacional.'; end if;
  if p_produto_id is null then raise exception 'Informe o produto.'; end if;
  if p_inicio is null then raise exception 'Informe o horário de início.'; end if;
  if not exists(select 1 from public.produtos where id = p_produto_id) then raise exception 'Produto inválido.'; end if;
  if jsonb_array_length(coalesce(p_itens,'[]'::jsonb)) = 0 then raise exception 'Informe ao menos um material na carga.'; end if;

  if exists(
    select 1 from jsonb_to_recordset(p_itens) as item(material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
    join public.materiais_fusao material on material.id = item.material_id
    where material.tipo = 'GUSA' and item.estado_fisico is null
  ) then
    raise exception 'Informe se o gusa está sólido ou líquido.';
  end if;

  select * into v_forno from public.fornos_fusao where id = p_forno_id and ativo for update;
  if not found then raise exception 'Forno inválido.'; end if;

  if exists(select 1 from public.corridas_fusao where forno_id = p_forno_id and status = 'ABERTA') then
    raise exception 'Já existe uma corrida em andamento neste forno.';
  end if;

  select * into v_ciclo from public.ciclos_refratario_fusao where forno_id = p_forno_id and encerrado_em is null for update;
  if not found then
    insert into public.ciclos_refratario_fusao(forno_id, numero_ciclo, iniciado_por)
    values (p_forno_id, 1, auth.uid())
    returning * into v_ciclo;
  end if;

  select coalesce(max(numero_sequencia), 0) + 1 into v_sequencia
  from public.corridas_fusao where ciclo_refratario_id = v_ciclo.id;
  v_codigo := v_forno.codigo || lpad(v_ciclo.numero_ciclo::text, 3, '0') || lpad(v_sequencia::text, 3, '0');

  insert into public.corridas_fusao(forno_id, ciclo_refratario_id, numero_sequencia, codigo, data_operacional, turno, produto_id, inicio, criado_por, atualizado_por)
  values (p_forno_id, v_ciclo.id, v_sequencia, v_codigo, p_data_operacional, p_turno, p_produto_id, p_inicio, auth.uid(), auth.uid())
  returning id into v_corrida_id;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  select v_corrida_id, item.material_id, item.quantidade_planejada_kg,
    case when material.tipo = 'GUSA' then item.estado_fisico else null end
  from rows from (
    jsonb_to_recordset(p_itens) as (material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
  ) with ordinality as item(material_id, quantidade_planejada_kg, estado_fisico, ord)
  join public.materiais_fusao material on material.id = item.material_id
  where item.material_id is not null and item.quantidade_planejada_kg >= 0
  order by item.ord;

  return v_corrida_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
