begin;

-- Supervisor pode planejar a carga intercalando o mesmo material várias
-- vezes (ex.: aço, gusa, aço, gusa) pra melhor acomodação no forno — a
-- trava que só deixava 1 linha por (corrida, material, estado) impedia
-- isso. A ordem de inserção (id) é o que define a sequência mostrada pro
-- operador da ponte, então nenhuma tela deve reordenar por nome/tipo.
drop index if exists public.corridas_fusao_carga_itens_corrida_material_estado_uidx;

-- Insere respeitando a ordem exata em que o supervisor listou os itens no
-- formulário (with ordinality + order by), em vez de confiar na ordem
-- "provável" que o join devolveria sem um order by explícito.
create or replace function public.criar_corrida_fusao(
  p_forno_id bigint, p_turno text, p_data_operacional date, p_numero_sequencia integer, p_itens jsonb
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_ciclo record;
  v_forno record;
  v_codigo text;
  v_corrida_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if p_data_operacional is null then raise exception 'Informe a data operacional.'; end if;
  if coalesce(p_numero_sequencia, 0) <= 0 then raise exception 'Informe o número da corrida.'; end if;
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

  if exists(select 1 from public.corridas_fusao where ciclo_refratario_id = v_ciclo.id and numero_sequencia = p_numero_sequencia) then
    raise exception 'Já existe uma corrida com esse número neste ciclo.';
  end if;

  v_codigo := v_forno.codigo || lpad(v_ciclo.numero_ciclo::text, 3, '0') || lpad(p_numero_sequencia::text, 3, '0');

  insert into public.corridas_fusao(forno_id, ciclo_refratario_id, numero_sequencia, codigo, data_operacional, turno, criado_por, atualizado_por)
  values (p_forno_id, v_ciclo.id, p_numero_sequencia, v_codigo, p_data_operacional, p_turno, auth.uid(), auth.uid())
  returning id into v_corrida_id;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  select v_corrida_id, item.material_id, item.quantidade_planejada_kg,
    case when material.tipo = 'GUSA' then item.estado_fisico else null end
  from jsonb_to_recordset(p_itens) with ordinality as item(material_id bigint, quantidade_planejada_kg numeric, estado_fisico text, ord bigint)
  join public.materiais_fusao material on material.id = item.material_id
  where item.material_id is not null and item.quantidade_planejada_kg >= 0
  order by item.ord;

  return v_corrida_id;
end;
$$;

-- Sem mais trava de duplicidade — o supervisor pode incluir o mesmo
-- material de novo na sequência, quantas vezes quiser.
create or replace function public.adicionar_item_carga_fusao(
  p_corrida_id bigint, p_material_id bigint, p_quantidade_planejada_kg numeric, p_estado_fisico text default null
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_material record;
  v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível incluir material numa corrida aberta.'; end if;
  if coalesce(p_quantidade_planejada_kg, -1) < 0 then raise exception 'Informe a quantidade planejada.'; end if;

  select * into v_material from public.materiais_fusao where id = p_material_id;
  if not found then raise exception 'Material inválido.'; end if;
  if v_material.tipo = 'GUSA' and p_estado_fisico is null then
    raise exception 'Informe se o gusa está sólido ou líquido.';
  end if;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  values (p_corrida_id, p_material_id, p_quantidade_planejada_kg, case when v_material.tipo = 'GUSA' then p_estado_fisico else null end)
  returning id into v_id;
  return v_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
