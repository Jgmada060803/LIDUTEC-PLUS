begin;

alter table public.turnos_producao_moldes
  add column if not exists rascunho_producoes jsonb not null default '[]'::jsonb,
  add column if not exists rascunho_paradas jsonb not null default '[]'::jsonb,
  add column if not exists versao bigint not null default 0,
  add column if not exists atualizado_por uuid references public.usuarios(id),
  add column if not exists atualizado_em timestamptz;

do $$ begin
  if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='turnos_producao_moldes') then
    alter publication supabase_realtime add table public.turnos_producao_moldes;
  end if;
end $$;

create or replace function public.salvar_rascunho_turno_producao_moldes(
  p_data_operacional date,
  p_turno text,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb,
  p_versao bigint default null
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_moldes%rowtype;
begin
  if not public.usuario_tem_permissao_producao_moldes('producao_moldes.lancar') then
    raise exception 'Usuário sem permissão para lançar produção.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if jsonb_typeof(coalesce(p_producoes,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_paradas,'[]'::jsonb))<>'array' then raise exception 'Rascunho inválido.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))>100 or jsonb_array_length(coalesce(p_paradas,'[]'::jsonb))>200 then raise exception 'O rascunho excede o limite de linhas.'; end if;

  insert into public.turnos_producao_moldes(data_operacional,turno,status,criado_por)
  values(p_data_operacional,p_turno,'ABERTO',auth.uid())
  on conflict(data_operacional,turno) do nothing;

  select * into v_turno from public.turnos_producao_moldes
  where data_operacional=p_data_operacional and turno=p_turno for update;
  if v_turno.status='FECHADO' then raise exception 'Este turno já foi fechado.'; end if;
  if (p_versao is null and v_turno.versao<>0) or (p_versao is not null and p_versao<>v_turno.versao) then
    raise exception 'CONFLITO_RASCUNHO: o turno foi atualizado por outro usuário.' using errcode='40001';
  end if;

  update public.turnos_producao_moldes set
    rascunho_producoes=coalesce(p_producoes,'[]'::jsonb),
    rascunho_paradas=coalesce(p_paradas,'[]'::jsonb),
    versao=versao+1,atualizado_por=auth.uid(),atualizado_em=now()
  where id=v_turno.id
  returning * into v_turno;

  return jsonb_build_object('id',v_turno.id,'versao',v_turno.versao,'atualizado_por',v_turno.atualizado_por,'atualizado_em',v_turno.atualizado_em);
end;
$$;

create or replace function public.fechar_turno_producao_moldes(
  p_data_operacional date,
  p_turno text,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb,
  p_versao bigint default null
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_moldes%rowtype;v_esperado integer;v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_moldes('producao_moldes.lancar') then raise exception 'Usuário sem permissão para fechar o turno.'; end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos uma linha de produção.'; end if;
  insert into public.turnos_producao_moldes(data_operacional,turno,status,criado_por)
  values(p_data_operacional,p_turno,'ABERTO',auth.uid()) on conflict(data_operacional,turno) do nothing;
  select * into v_turno from public.turnos_producao_moldes where data_operacional=p_data_operacional and turno=p_turno for update;
  if v_turno.status='FECHADO' then raise exception 'Este turno já foi fechado.'; end if;
  if p_versao is not null and p_versao<>v_turno.versao then raise exception 'CONFLITO_RASCUNHO: o turno foi atualizado por outro usuário.' using errcode='40001'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_moldes(turno_producao_id,data_operacional,turno,produto_id,inicio,fim,quantidade_planejada,quantidade_produzida,quantidade_aprovada,quantidade_refugada,moldes_vazados,moldes_quebrados,pecas_por_molde,peso_peca_kg,total_pecas,toneladas_produzidas,rastreabilidade,observacao,criado_por)
  select v_turno.id,p_data_operacional,p_turno,item.produto_id,item.inicio,item.fim,0,item.moldes_vazados+item.moldes_quebrados,item.moldes_vazados,item.moldes_quebrados,item.moldes_vazados,item.moldes_quebrados,produto.cavidades_molde,produto.peso_peca_kg,item.moldes_vazados*produto.cavidades_molde,item.moldes_vazados*produto.cavidades_molde*produto.peso_peca_kg/1000,nullif(trim(item.rastreabilidade),''),nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(inicio timestamptz,fim timestamptz,produto_id bigint,moldes_vazados integer,moldes_quebrados integer,rastreabilidade text,observacao text)
  join public.produtos produto on produto.id=item.produto_id where item.inicio is not null and item.fim is not null and item.fim>=item.inicio and item.moldes_vazados>=0 and item.moldes_quebrados>=0 and produto.cavidades_molde is not null and produto.peso_peca_kg is not null;
  get diagnostics v_inserido=row_count;if v_inserido<>v_esperado then raise exception 'Uma ou mais produções são inválidas ou possuem produto sem peso/cavidades.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_moldes(turno_producao_id,data_operacional,turno,categoria_id,setor_responsavel_id,motivo,inicio,fim,duracao_minutos,observacao,criado_por)
  select v_turno.id,p_data_operacional,p_turno,item.categoria_id,item.setor_id,categoria.nome,item.inicio,item.fim,round(extract(epoch from(item.fim-item.inicio))/60)::integer,nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,observacao text)
  join public.categorias_parada_producao categoria on categoria.id=item.categoria_id where item.inicio is not null and item.fim is not null and item.fim>=item.inicio and item.setor_id is not null;
  get diagnostics v_inserido=row_count;if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados ou horários inválidos.'; end if;

  update public.turnos_producao_moldes set status='FECHADO',fechado_por=auth.uid(),fechado_em=now(),rascunho_producoes='[]'::jsonb,rascunho_paradas='[]'::jsonb,versao=versao+1,atualizado_por=auth.uid(),atualizado_em=now() where id=v_turno.id;
  return v_turno.id;
end;
$$;

revoke all on function public.salvar_rascunho_turno_producao_moldes(date,text,jsonb,jsonb,bigint) from public,anon;
grant execute on function public.salvar_rascunho_turno_producao_moldes(date,text,jsonb,jsonb,bigint) to authenticated;
revoke all on function public.fechar_turno_producao_moldes(date,text,jsonb,jsonb,bigint) from public,anon;
grant execute on function public.fechar_turno_producao_moldes(date,text,jsonb,jsonb,bigint) to authenticated;

commit;
