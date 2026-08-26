begin;

-- Sobra do forno na hora de abrir a corrida vira um valor guardado (não
-- recalculado depois) — é o volume que o forno já tinha antes desta
-- corrida existir, pra virar uma linha "Sobra" na carga (igual pedido pras
-- entradas/saídas de transferência).
alter table public.corridas_fusao
  add column if not exists sobra_inicial_kg numeric not null default 0;

-- Material planejado deixa de ser obrigatório pra abrir a corrida — dá pra
-- abrir só com forno/produto/turno/início e incluir material aos poucos
-- depois, pela ação "+ Incluir material".
create or replace function public.criar_corrida_fusao(
  p_forno_id bigint, p_turno text, p_data_operacional date, p_produto_id bigint, p_inicio timestamptz, p_itens jsonb default '[]'::jsonb
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_ciclo record;
  v_forno record;
  v_sequencia integer;
  v_codigo text;
  v_corrida_id bigint;
  v_sobra numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if p_data_operacional is null then raise exception 'Informe a data operacional.'; end if;
  if p_produto_id is null then raise exception 'Informe o produto.'; end if;
  if p_inicio is null then raise exception 'Informe o horário de início.'; end if;
  if not exists(select 1 from public.produtos where id = p_produto_id) then raise exception 'Produto inválido.'; end if;

  if exists(
    select 1 from jsonb_to_recordset(coalesce(p_itens,'[]'::jsonb)) as item(material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
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

  v_sobra := public.volume_atual_forno_fusao(p_forno_id);

  select * into v_ciclo from public.ciclos_refratario_fusao where forno_id = p_forno_id and encerrado_em is null for update;
  if not found then
    insert into public.ciclos_refratario_fusao(forno_id, numero_ciclo, iniciado_por)
    values (p_forno_id, 1, auth.uid())
    returning * into v_ciclo;
  end if;

  select coalesce(max(numero_sequencia), 0) + 1 into v_sequencia
  from public.corridas_fusao where ciclo_refratario_id = v_ciclo.id;
  v_codigo := v_forno.codigo || lpad(v_ciclo.numero_ciclo::text, 3, '0') || lpad(v_sequencia::text, 3, '0');

  insert into public.corridas_fusao(forno_id, ciclo_refratario_id, numero_sequencia, codigo, data_operacional, turno, produto_id, inicio, sobra_inicial_kg, criado_por, atualizado_por)
  values (p_forno_id, v_ciclo.id, v_sequencia, v_codigo, p_data_operacional, p_turno, p_produto_id, p_inicio, v_sobra, auth.uid(), auth.uid())
  returning id into v_corrida_id;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  select v_corrida_id, item.material_id, item.quantidade_planejada_kg,
    case when material.tipo = 'GUSA' then item.estado_fisico else null end
  from rows from (
    jsonb_to_recordset(coalesce(p_itens,'[]'::jsonb)) as (material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
  ) with ordinality as item(material_id, quantidade_planejada_kg, estado_fisico, ord)
  join public.materiais_fusao material on material.id = item.material_id
  where item.material_id is not null and item.quantidade_planejada_kg >= 0
  order by item.ord;

  return v_corrida_id;
end;
$$;

-- Fechar exige movimento mínimo: carregado nesta corrida + recebido por
-- transferência + enviado por transferência precisa passar de 10.000 kg —
-- só pra não fechar uma corrida que praticamente não teve atividade
-- nenhuma (sobra herdada não conta, tem que ser movimento desta corrida).
create or replace function public.fechar_corrida_fusao(p_corrida_id bigint, p_versao bigint, p_fim timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_movimentado numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_fim is null then raise exception 'Informe o horário de fim.'; end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.versao <> p_versao then
    raise exception 'CONFLITO_RASCUNHO: a corrida foi atualizada por outro usuário.' using errcode = '40001';
  end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Esta corrida não está aberta.'; end if;

  select
    coalesce((select sum(quantidade_realizada_kg) from public.corridas_fusao_carga_itens where corrida_id = p_corrida_id), 0)
    + coalesce((select sum(quantidade_kg) from public.transferencias_fusao where corrida_destino_id = p_corrida_id), 0)
    + coalesce((select sum(quantidade_kg) from public.transferencias_fusao where corrida_origem_id = p_corrida_id), 0)
  into v_movimentado;
  if v_movimentado <= 10000 then
    raise exception 'É preciso movimentar mais de 10.000 kg (carregado + transferido) antes de fechar a corrida. Movimentado até agora: % kg.', v_movimentado;
  end if;

  update public.corridas_fusao set status = 'FECHADA', fim = p_fim, versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
