begin;

alter table public.registros_producao_moldes
  add column if not exists rastreabilidade text;

create or replace function public.fechar_turno_producao_moldes(
  p_data_operacional date,
  p_turno text,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno_id bigint;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_moldes('producao_moldes.lancar') then raise exception 'Usuário sem permissão para fechar o turno.'; end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos uma linha de produção.'; end if;
  insert into public.turnos_producao_moldes(data_operacional,turno,status,fechado_por,fechado_em,criado_por)
  values(p_data_operacional,p_turno,'FECHADO',auth.uid(),now(),auth.uid())
  on conflict(data_operacional,turno) do nothing returning id into v_turno_id;
  if v_turno_id is null then raise exception 'Este turno já foi apontado ou fechado.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_moldes(
    turno_producao_id,data_operacional,turno,produto_id,inicio,fim,
    quantidade_planejada,quantidade_produzida,quantidade_aprovada,quantidade_refugada,
    moldes_vazados,moldes_quebrados,pecas_por_molde,peso_peca_kg,total_pecas,
    toneladas_produzidas,rastreabilidade,observacao,criado_por
  ) select v_turno_id,p_data_operacional,p_turno,item.produto_id,item.inicio,item.fim,
    0,item.moldes_vazados+item.moldes_quebrados,item.moldes_vazados,item.moldes_quebrados,
    item.moldes_vazados,item.moldes_quebrados,produto.cavidades_molde,produto.peso_peca_kg,
    item.moldes_vazados*produto.cavidades_molde,
    item.moldes_vazados*produto.cavidades_molde*produto.peso_peca_kg/1000,
    nullif(trim(item.rastreabilidade),''),nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(
    inicio timestamptz,fim timestamptz,produto_id bigint,moldes_vazados integer,
    moldes_quebrados integer,rastreabilidade text,observacao text
  ) join public.produtos produto on produto.id=item.produto_id
  where item.inicio is not null and item.fim is not null and item.fim>=item.inicio
    and item.moldes_vazados>=0 and item.moldes_quebrados>=0
    and produto.cavidades_molde is not null and produto.peso_peca_kg is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais produções são inválidas ou possuem produto sem peso/cavidades.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_moldes(
    turno_producao_id,data_operacional,turno,categoria_id,setor_responsavel_id,
    motivo,inicio,fim,duracao_minutos,observacao,criado_por
  ) select v_turno_id,p_data_operacional,p_turno,item.categoria_id,item.setor_id,
    categoria.nome,item.inicio,item.fim,round(extract(epoch from(item.fim-item.inicio))/60)::integer,
    nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
    inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,observacao text
  ) join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
  where item.inicio is not null and item.fim is not null and item.fim>=item.inicio and item.setor_id is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados ou horários inválidos.'; end if;
  return v_turno_id;
end;
$$;

create or replace function public.editar_turno_producao_moldes(
  p_turno_id bigint,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb,
  p_alteracoes jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_moldes%rowtype;
  v_anteriores jsonb;
  v_novos jsonb;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_moldes('producao_moldes.editar') then raise exception 'Usuário sem permissão para editar turnos fechados.'; end if;
  select * into v_turno from public.turnos_producao_moldes where id=p_turno_id and status='FECHADO' for update;
  if not found then raise exception 'Turno fechado não encontrado.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos uma linha de produção.'; end if;
  select jsonb_build_object(
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.registros_producao_moldes registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.paradas_producao_moldes parada where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_anteriores;
  delete from public.paradas_producao_moldes where turno_producao_id=p_turno_id;
  delete from public.registros_producao_moldes where turno_producao_id=p_turno_id;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_moldes(
    turno_producao_id,data_operacional,turno,produto_id,inicio,fim,
    quantidade_planejada,quantidade_produzida,quantidade_aprovada,quantidade_refugada,
    moldes_vazados,moldes_quebrados,pecas_por_molde,peso_peca_kg,total_pecas,
    toneladas_produzidas,rastreabilidade,observacao,criado_por
  ) select p_turno_id,v_turno.data_operacional,v_turno.turno,item.produto_id,item.inicio,item.fim,
    0,item.moldes_vazados+item.moldes_quebrados,item.moldes_vazados,item.moldes_quebrados,
    item.moldes_vazados,item.moldes_quebrados,produto.cavidades_molde,produto.peso_peca_kg,
    item.moldes_vazados*produto.cavidades_molde,
    item.moldes_vazados*produto.cavidades_molde*produto.peso_peca_kg/1000,
    nullif(trim(item.rastreabilidade),''),nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(p_producoes) as item(
    inicio timestamptz,fim timestamptz,produto_id bigint,moldes_vazados integer,
    moldes_quebrados integer,rastreabilidade text,observacao text
  ) join public.produtos produto on produto.id=item.produto_id
  where item.inicio is not null and item.fim>=item.inicio
    and item.moldes_vazados>=0 and item.moldes_quebrados>=0
    and produto.cavidades_molde is not null and produto.peso_peca_kg is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais produções são inválidas ou possuem produto sem peso/cavidades.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_moldes(
    turno_producao_id,data_operacional,turno,categoria_id,setor_responsavel_id,
    motivo,inicio,fim,duracao_minutos,observacao,criado_por
  ) select p_turno_id,v_turno.data_operacional,v_turno.turno,item.categoria_id,item.setor_id,
    categoria.nome,item.inicio,item.fim,round(extract(epoch from(item.fim-item.inicio))/60)::integer,
    nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
    inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,observacao text
  ) join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
  where item.inicio is not null and item.fim>=item.inicio and item.setor_id is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados ou horários inválidos.'; end if;
  select jsonb_build_object(
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.registros_producao_moldes registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.paradas_producao_moldes parada where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_novos;
  if v_anteriores=v_novos then raise exception 'Nenhuma alteração foi identificada.'; end if;
  insert into public.historico_edicoes_turno_producao(turno_producao_id,descricao,dados_anteriores,dados_novos,alterado_por)
  values(p_turno_id,'os apontamentos do turno',v_anteriores,v_novos,auth.uid());
  return p_turno_id;
end;
$$;

grant execute on function public.fechar_turno_producao_moldes(date,text,jsonb,jsonb) to authenticated;
grant execute on function public.editar_turno_producao_moldes(bigint,jsonb,jsonb,jsonb) to authenticated;

commit;
