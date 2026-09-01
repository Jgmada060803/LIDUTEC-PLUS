-- Coluna "Lote" no apontamento do Acabamento — mesmo padrão já usado na
-- Moldagem (rastreabilidade, texto livre, opcional). Só as duas funções
-- realmente usadas pelo front (as com p_linhas jsonb, uma linha por
-- produto/linha de produção) precisam persistir o campo; a versão de
-- rascunho já guarda o JSON bruto e não precisa mudar.
alter table public.registros_producao_acabamento
  add column if not exists rastreabilidade text;

create or replace function public.fechar_turno_producao_acabamento(
  p_data_operacional date,
  p_turno text,
  p_linhas jsonb default '[]'::jsonb,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb,
  p_versao bigint default null
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_acabamento%rowtype;
  v_area_id bigint;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_acabamento('producao_acabamento.lancar') then
    raise exception 'Usuário sem permissão para fechar o turno.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos uma linha de produção.'; end if;
  if jsonb_array_length(coalesce(p_linhas,'[]'::jsonb))=0 then raise exception 'Informe os operadores presentes de ao menos uma linha.'; end if;

  select id into v_area_id from public.areas_checklist where codigo='ACABAMENTO';

  insert into public.turnos_producao_acabamento(data_operacional,turno,status,criado_por)
  values(p_data_operacional,p_turno,'ABERTO',auth.uid())
  on conflict(data_operacional,turno) do nothing;

  select * into v_turno from public.turnos_producao_acabamento
  where data_operacional=p_data_operacional and turno=p_turno for update;
  if v_turno.status='FECHADO' then raise exception 'Este turno já foi fechado.'; end if;
  if p_versao is not null and p_versao<>v_turno.versao then
    raise exception 'CONFLITO_RASCUNHO: o turno foi atualizado por outro usuário.' using errcode='40001';
  end if;

  insert into public.turnos_acabamento_linhas(turno_producao_id,linha_maquina_id,operadores_planejados,operadores_presentes)
  select v_turno.id,item.linha_id,
    public.meta_vigente(v_area_id,item.linha_id,p_turno,'OPERADORES_PLANEJADOS',p_data_operacional),
    item.operadores_presentes
  from jsonb_to_recordset(coalesce(p_linhas,'[]'::jsonb)) as item(linha_id bigint,operadores_presentes integer)
  on conflict(turno_producao_id,linha_maquina_id) do update set
    operadores_planejados=excluded.operadores_planejados,
    operadores_presentes=excluded.operadores_presentes;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_acabamento(turno_producao_id,linha_maquina_id,data_operacional,turno,produto_id,quantidade_liberada,quantidade_rejeitada,quantidade_retrabalhada,quantidade_refugada,rastreabilidade,criado_por)
  select v_turno.id,item.linha_id,p_data_operacional,p_turno,item.produto_id,item.quantidade_liberada,item.quantidade_rejeitada,item.quantidade_retrabalhada,item.quantidade_refugada,nullif(trim(item.rastreabilidade),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(linha_id bigint,produto_id bigint,quantidade_liberada integer,quantidade_rejeitada integer,quantidade_retrabalhada integer,quantidade_refugada integer,rastreabilidade text)
  join public.produtos produto on produto.id=item.produto_id
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  where coalesce(item.quantidade_liberada,0)>=0 and coalesce(item.quantidade_rejeitada,0)>=0
    and coalesce(item.quantidade_retrabalhada,0)>=0 and coalesce(item.quantidade_refugada,0)>=0;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais linhas de produção são inválidas ou possuem produto/linha inexistente.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_acabamento(
    turno_producao_id,data_operacional,turno,setor_origem_id,categoria_id,posto_equipamento_id,
    inicio,fim,duracao_minutos,tipo_ocorrencia,componentes_indisponiveis,tempo_perdido_equivalente_minutos,
    observacao,criado_por
  )
  select v_turno.id,p_data_operacional,p_turno,sub.setor_id,sub.categoria_id,sub.posto_id,
    sub.inicio,sub.fim,sub.duracao_minutos,sub.tipo_ocorrencia,
    case when sub.tipo_ocorrencia='PARCIAL' then sub.componentes_indisponiveis else null end,
    public.parada_tempo_perdido_equivalente(sub.duracao_minutos,sub.tipo_ocorrencia,sub.componentes_indisponiveis,sub.numero_turbinas),
    nullif(trim(sub.observacao),''),auth.uid()
  from (
    select item.inicio,item.fim,item.setor_id,item.categoria_id,item.posto_id,item.observacao,
      coalesce(item.tipo_ocorrencia,'TOTAL') as tipo_ocorrencia,item.componentes_indisponiveis,
      round(extract(epoch from(item.fim-item.inicio))/60)::integer as duracao_minutos,posto.numero_turbinas
    from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
      inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,posto_id bigint,observacao text,
      tipo_ocorrencia text,componentes_indisponiveis integer
    )
    join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
    join public.setores_responsaveis_parada setor on setor.id=item.setor_id
    join public.postos_equipamentos_acabamento posto on posto.id=item.posto_id
    where item.inicio is not null and item.fim is not null and item.fim>=item.inicio
  ) sub
  where sub.tipo_ocorrencia in ('TOTAL','PARCIAL')
    and (sub.tipo_ocorrencia='TOTAL' or (sub.numero_turbinas is not null and sub.componentes_indisponiveis between 1 and greatest(sub.numero_turbinas-1,0)));
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados, horários ou posto/equipamento inválidos, ou a condição de capacidade reduzida é inválida para o equipamento.'; end if;

  update public.turnos_producao_acabamento set
    status='FECHADO',fechado_por=auth.uid(),fechado_em=now(),
    rascunho_producoes='[]'::jsonb,rascunho_paradas='[]'::jsonb,rascunho_linhas='[]'::jsonb,
    versao=versao+1,atualizado_por=auth.uid(),atualizado_em=now()
  where id=v_turno.id;
  return v_turno.id;
end;
$$;

create or replace function public.editar_turno_producao_acabamento(
  p_turno_id bigint,
  p_linhas jsonb default '[]'::jsonb,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_acabamento%rowtype;
  v_anteriores jsonb;
  v_novos jsonb;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_acabamento('producao_acabamento.editar') then
    raise exception 'Usuário sem permissão para editar turnos fechados.';
  end if;
  select * into v_turno from public.turnos_producao_acabamento where id=p_turno_id and status='FECHADO' for update;
  if not found then raise exception 'Turno fechado não encontrado.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos uma linha de produção.'; end if;

  select jsonb_build_object(
    'linhas',coalesce((select jsonb_agg(jsonb_build_object('linha_id',linha_maquina_id,'operadores_presentes',operadores_presentes) order by linha_maquina_id) from public.turnos_acabamento_linhas where turno_producao_id=p_turno_id),'[]'::jsonb),
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by linha_maquina_id,produto_id) from public.registros_producao_acabamento registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.paradas_producao_acabamento parada where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_anteriores;

  delete from public.paradas_producao_acabamento where turno_producao_id=p_turno_id;
  delete from public.registros_producao_acabamento where turno_producao_id=p_turno_id;

  insert into public.turnos_acabamento_linhas(turno_producao_id,linha_maquina_id,operadores_planejados,operadores_presentes)
  select v_turno.id,item.linha_id,
    (select operadores_planejados from public.turnos_acabamento_linhas where turno_producao_id=v_turno.id and linha_maquina_id=item.linha_id),
    item.operadores_presentes
  from jsonb_to_recordset(coalesce(p_linhas,'[]'::jsonb)) as item(linha_id bigint,operadores_presentes integer)
  on conflict(turno_producao_id,linha_maquina_id) do update set operadores_presentes=excluded.operadores_presentes;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_acabamento(turno_producao_id,linha_maquina_id,data_operacional,turno,produto_id,quantidade_liberada,quantidade_rejeitada,quantidade_retrabalhada,quantidade_refugada,rastreabilidade,criado_por)
  select v_turno.id,item.linha_id,v_turno.data_operacional,v_turno.turno,item.produto_id,item.quantidade_liberada,item.quantidade_rejeitada,item.quantidade_retrabalhada,item.quantidade_refugada,nullif(trim(item.rastreabilidade),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(linha_id bigint,produto_id bigint,quantidade_liberada integer,quantidade_rejeitada integer,quantidade_retrabalhada integer,quantidade_refugada integer,rastreabilidade text)
  join public.produtos produto on produto.id=item.produto_id
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  where coalesce(item.quantidade_liberada,0)>=0 and coalesce(item.quantidade_rejeitada,0)>=0
    and coalesce(item.quantidade_retrabalhada,0)>=0 and coalesce(item.quantidade_refugada,0)>=0;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais linhas de produção são inválidas ou possuem produto/linha inexistente.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_acabamento(
    turno_producao_id,data_operacional,turno,setor_origem_id,categoria_id,posto_equipamento_id,
    inicio,fim,duracao_minutos,tipo_ocorrencia,componentes_indisponiveis,tempo_perdido_equivalente_minutos,
    observacao,criado_por
  )
  select v_turno.id,v_turno.data_operacional,v_turno.turno,sub.setor_id,sub.categoria_id,sub.posto_id,
    sub.inicio,sub.fim,sub.duracao_minutos,sub.tipo_ocorrencia,
    case when sub.tipo_ocorrencia='PARCIAL' then sub.componentes_indisponiveis else null end,
    public.parada_tempo_perdido_equivalente(sub.duracao_minutos,sub.tipo_ocorrencia,sub.componentes_indisponiveis,sub.numero_turbinas),
    nullif(trim(sub.observacao),''),auth.uid()
  from (
    select item.inicio,item.fim,item.setor_id,item.categoria_id,item.posto_id,item.observacao,
      coalesce(item.tipo_ocorrencia,'TOTAL') as tipo_ocorrencia,item.componentes_indisponiveis,
      round(extract(epoch from(item.fim-item.inicio))/60)::integer as duracao_minutos,posto.numero_turbinas
    from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
      inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,posto_id bigint,observacao text,
      tipo_ocorrencia text,componentes_indisponiveis integer
    )
    join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
    join public.setores_responsaveis_parada setor on setor.id=item.setor_id
    join public.postos_equipamentos_acabamento posto on posto.id=item.posto_id
    where item.inicio is not null and item.fim is not null and item.fim>=item.inicio
  ) sub
  where sub.tipo_ocorrencia in ('TOTAL','PARCIAL')
    and (sub.tipo_ocorrencia='TOTAL' or (sub.numero_turbinas is not null and sub.componentes_indisponiveis between 1 and greatest(sub.numero_turbinas-1,0)));
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados, horários ou posto/equipamento inválidos, ou a condição de capacidade reduzida é inválida para o equipamento.'; end if;

  select jsonb_build_object(
    'linhas',coalesce((select jsonb_agg(jsonb_build_object('linha_id',linha_maquina_id,'operadores_presentes',operadores_presentes) order by linha_maquina_id) from public.turnos_acabamento_linhas where turno_producao_id=p_turno_id),'[]'::jsonb),
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by linha_maquina_id,produto_id) from public.registros_producao_acabamento registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.paradas_producao_acabamento parada where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_novos;

  if v_anteriores = v_novos then
    raise exception 'Nenhuma alteração foi identificada.';
  end if;

  update public.turnos_producao_acabamento set atualizado_por=auth.uid(),atualizado_em=now() where id=v_turno.id;

  insert into public.historico_edicoes_turno_acabamento(
    turno_producao_id,descricao,dados_anteriores,dados_novos,alterado_por
  ) values (
    p_turno_id,'os apontamentos do turno',v_anteriores,v_novos,auth.uid()
  );
  return p_turno_id;
end;
$$;
