-- Turno da Macharia passa a ser por máquina, não mais compartilhado entre as
-- 5 máquinas na mesma linha de turnos_producao_macharia. Cada máquina abre e
-- fecha seu turno independentemente.

alter table public.turnos_producao_macharia
  add column linha_maquina_id bigint references public.linhas_maquinas_producao(id);

-- Precisa cair antes do backfill: com ela ainda ativa, a segunda linha nova
-- criada pra uma "outra máquina" do mesmo (data,turno) violaria a unicidade
-- antiga antes de existir a nova (data,turno,linha_maquina_id).
alter table public.turnos_producao_macharia drop constraint turnos_producao_macharia_data_operacional_turno_key;

alter table public.turnos_producao_macharia disable trigger validar_area_turno_macharia;
alter table public.registros_producao_macharia disable trigger validar_area_registro_macharia;
alter table public.paradas_producao_macharia disable trigger validar_area_parada_macharia;
alter table public.descartes_producao_macharia disable trigger validar_area_descarte_macharia;

-- Backfill: para cada turno hoje compartilhado, descobre quais máquinas têm
-- dado (nas 3 tabelas de detalhe, pros fechados, e também dentro dos rascunhos
-- jsonb, pros abertos). Sem máquina nenhuma -> apaga (lixo vazio). Uma máquina
-- só -> grava direto na linha existente. Mais de uma -> escolhe uma "primária"
-- (mais linhas em registros_producao_macharia, empate pelo menor id) que fica
-- com a linha existente (mantém id e histórico de edição), e cria uma linha
-- nova pra cada outra máquina, repontando as linhas de detalhe dela.
do $$
declare
  r_turno record;
  r_machine record;
  v_machines bigint[];
  v_primary bigint;
  v_new_id bigint;
begin
  for r_turno in
    select t.id, t.data_operacional, t.turno, t.status, t.fechado_por, t.fechado_em,
           t.criado_por, t.criado_em, t.rascunho_producoes, t.rascunho_paradas, t.rascunho_descartes
    from public.turnos_producao_macharia t
    where t.linha_maquina_id is null
  loop
    select array_agg(distinct m) into v_machines
    from (
      select linha_maquina_id as m from public.registros_producao_macharia where turno_producao_id = r_turno.id
      union
      select linha_maquina_id from public.paradas_producao_macharia where turno_producao_id = r_turno.id
      union
      select linha_maquina_id from public.descartes_producao_macharia where turno_producao_id = r_turno.id
      union
      select (elem->>'linha_id')::bigint from jsonb_array_elements(r_turno.rascunho_producoes) elem
      union
      select (elem->>'linha_id')::bigint from jsonb_array_elements(r_turno.rascunho_paradas) elem
      union
      select (elem->>'linha_id')::bigint from jsonb_array_elements(r_turno.rascunho_descartes) elem
    ) x
    where m is not null;

    if v_machines is null or array_length(v_machines, 1) = 0 then
      delete from public.turnos_producao_macharia where id = r_turno.id;
      continue;
    end if;

    if array_length(v_machines, 1) = 1 then
      update public.turnos_producao_macharia set linha_maquina_id = v_machines[1] where id = r_turno.id;
      continue;
    end if;

    select linha_maquina_id into v_primary
    from (
      select linha_maquina_id, count(*) as cnt
      from public.registros_producao_macharia
      where turno_producao_id = r_turno.id
      group by linha_maquina_id
    ) c
    order by cnt desc, linha_maquina_id asc
    limit 1;

    if v_primary is null then
      select min(m) into v_primary from unnest(v_machines) as m;
    end if;

    update public.turnos_producao_macharia set
      linha_maquina_id = v_primary,
      rascunho_producoes = case when r_turno.status = 'ABERTO' then
        coalesce((select jsonb_agg(elem) from jsonb_array_elements(r_turno.rascunho_producoes) elem where (elem->>'linha_id')::bigint = v_primary), '[]'::jsonb)
        else rascunho_producoes end,
      rascunho_paradas = case when r_turno.status = 'ABERTO' then
        coalesce((select jsonb_agg(elem) from jsonb_array_elements(r_turno.rascunho_paradas) elem where (elem->>'linha_id')::bigint = v_primary), '[]'::jsonb)
        else rascunho_paradas end,
      rascunho_descartes = case when r_turno.status = 'ABERTO' then
        coalesce((select jsonb_agg(elem) from jsonb_array_elements(r_turno.rascunho_descartes) elem where (elem->>'linha_id')::bigint = v_primary), '[]'::jsonb)
        else rascunho_descartes end
    where id = r_turno.id;

    for r_machine in select unnest(v_machines) as m loop
      if r_machine.m = v_primary then
        continue;
      end if;

      insert into public.turnos_producao_macharia(
        data_operacional, turno, status, fechado_por, fechado_em, criado_por, criado_em,
        linha_maquina_id, versao, rascunho_producoes, rascunho_paradas, rascunho_descartes
      ) values (
        r_turno.data_operacional, r_turno.turno, r_turno.status, r_turno.fechado_por, r_turno.fechado_em,
        r_turno.criado_por, r_turno.criado_em, r_machine.m, 0,
        case when r_turno.status = 'ABERTO' then
          coalesce((select jsonb_agg(elem) from jsonb_array_elements(r_turno.rascunho_producoes) elem where (elem->>'linha_id')::bigint = r_machine.m), '[]'::jsonb)
          else '[]'::jsonb end,
        case when r_turno.status = 'ABERTO' then
          coalesce((select jsonb_agg(elem) from jsonb_array_elements(r_turno.rascunho_paradas) elem where (elem->>'linha_id')::bigint = r_machine.m), '[]'::jsonb)
          else '[]'::jsonb end,
        case when r_turno.status = 'ABERTO' then
          coalesce((select jsonb_agg(elem) from jsonb_array_elements(r_turno.rascunho_descartes) elem where (elem->>'linha_id')::bigint = r_machine.m), '[]'::jsonb)
          else '[]'::jsonb end
      )
      returning id into v_new_id;

      update public.registros_producao_macharia set turno_producao_id = v_new_id
      where turno_producao_id = r_turno.id and linha_maquina_id = r_machine.m;

      update public.paradas_producao_macharia set turno_producao_id = v_new_id
      where turno_producao_id = r_turno.id and linha_maquina_id = r_machine.m;

      update public.descartes_producao_macharia set turno_producao_id = v_new_id
      where turno_producao_id = r_turno.id and linha_maquina_id = r_machine.m;
    end loop;
  end loop;
end $$;

alter table public.turnos_producao_macharia enable trigger validar_area_turno_macharia;
alter table public.registros_producao_macharia enable trigger validar_area_registro_macharia;
alter table public.paradas_producao_macharia enable trigger validar_area_parada_macharia;
alter table public.descartes_producao_macharia enable trigger validar_area_descarte_macharia;

do $$ begin
  if exists (select 1 from public.turnos_producao_macharia where linha_maquina_id is null) then
    raise exception 'Backfill incompleto: existem turnos sem linha_maquina_id.';
  end if;
end $$;

alter table public.turnos_producao_macharia alter column linha_maquina_id set not null;
alter table public.turnos_producao_macharia
  add constraint turnos_producao_macharia_data_turno_linha_key unique (data_operacional, turno, linha_maquina_id);

drop function if exists public.salvar_rascunho_turno_producao_macharia(date, text, jsonb, jsonb, jsonb, bigint);
create or replace function public.salvar_rascunho_turno_producao_macharia(
  p_data_operacional date, p_turno text, p_linha_maquina_id bigint,
  p_producoes jsonb default '[]'::jsonb, p_paradas jsonb default '[]'::jsonb,
  p_descartes jsonb default '[]'::jsonb, p_versao bigint default null::bigint
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_turno public.turnos_producao_macharia%rowtype;
begin
  if not public.usuario_tem_permissao_producao_macharia('producao_macharia.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de macharia.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if not exists (
    select 1 from public.linhas_maquinas_producao lm
    join public.areas_checklist a on a.id = lm.area_id
    where lm.id = p_linha_maquina_id and a.codigo = 'MACHARIA' and lm.ativo
  ) then
    raise exception 'Máquina inválida ou fora da área de Macharia.';
  end if;
  if jsonb_typeof(coalesce(p_producoes,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_paradas,'[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p_descartes,'[]'::jsonb))<>'array' then
    raise exception 'Rascunho inválido.';
  end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))>500 or jsonb_array_length(coalesce(p_paradas,'[]'::jsonb))>200
    or jsonb_array_length(coalesce(p_descartes,'[]'::jsonb))>200 then
    raise exception 'O rascunho excede o limite de linhas.';
  end if;

  insert into public.turnos_producao_macharia(data_operacional,turno,linha_maquina_id,status,criado_por)
  values(p_data_operacional,p_turno,p_linha_maquina_id,'ABERTO',auth.uid())
  on conflict(data_operacional,turno,linha_maquina_id) do nothing;

  select * into v_turno from public.turnos_producao_macharia
  where data_operacional=p_data_operacional and turno=p_turno and linha_maquina_id=p_linha_maquina_id for update;
  if v_turno.status='FECHADO' then raise exception 'Este turno já foi fechado.'; end if;
  if (p_versao is null and v_turno.versao<>0) or (p_versao is not null and p_versao<>v_turno.versao) then
    raise exception 'CONFLITO_RASCUNHO: o turno foi atualizado por outro usuário.' using errcode='40001';
  end if;

  update public.turnos_producao_macharia set
    rascunho_producoes=coalesce(p_producoes,'[]'::jsonb),
    rascunho_paradas=coalesce(p_paradas,'[]'::jsonb),
    rascunho_descartes=coalesce(p_descartes,'[]'::jsonb),
    versao=versao+1,atualizado_por=auth.uid(),atualizado_em=now()
  where id=v_turno.id
  returning * into v_turno;

  return jsonb_build_object('id',v_turno.id,'versao',v_turno.versao,'atualizado_por',v_turno.atualizado_por,'atualizado_em',v_turno.atualizado_em);
end;
$function$;

drop function if exists public.fechar_turno_producao_macharia(date, text, jsonb, jsonb, jsonb, bigint);
create or replace function public.fechar_turno_producao_macharia(
  p_data_operacional date, p_turno text, p_linha_maquina_id bigint,
  p_producoes jsonb default '[]'::jsonb, p_paradas jsonb default '[]'::jsonb,
  p_descartes jsonb default '[]'::jsonb, p_versao bigint default null::bigint
)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_turno public.turnos_producao_macharia%rowtype;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_macharia('producao_macharia.lancar') then
    raise exception 'Usuário sem permissão para fechar o turno.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if not exists (
    select 1 from public.linhas_maquinas_producao lm
    join public.areas_checklist a on a.id = lm.area_id
    where lm.id = p_linha_maquina_id and a.codigo = 'MACHARIA' and lm.ativo
  ) then
    raise exception 'Máquina inválida ou fora da área de Macharia.';
  end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos um lançamento de sopro.'; end if;

  insert into public.turnos_producao_macharia(data_operacional,turno,linha_maquina_id,status,criado_por)
  values(p_data_operacional,p_turno,p_linha_maquina_id,'ABERTO',auth.uid())
  on conflict(data_operacional,turno,linha_maquina_id) do nothing;

  select * into v_turno from public.turnos_producao_macharia
  where data_operacional=p_data_operacional and turno=p_turno and linha_maquina_id=p_linha_maquina_id for update;
  if v_turno.status='FECHADO' then raise exception 'Este turno já foi fechado.'; end if;
  if p_versao is not null and p_versao<>v_turno.versao then
    raise exception 'CONFLITO_RASCUNHO: o turno foi atualizado por outro usuário.' using errcode='40001';
  end if;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_macharia(turno_producao_id,linha_maquina_id,estacao,data_operacional,turno,horario_previsto,macho_id,quantidade_sopros,criado_por)
  select v_turno.id,item.linha_id,item.estacao,p_data_operacional,p_turno,item.horario_previsto,item.macho_id,item.quantidade_sopros,auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(linha_id bigint,estacao integer,horario_previsto timestamptz,macho_id bigint,quantidade_sopros integer)
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id and item.estacao between 1 and linha.numero_estacoes
  join public.machos_macharia macho on macho.id=item.macho_id and macho.status='APROVADO'
  where coalesce(item.quantidade_sopros,0)>=0 and item.horario_previsto is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Um ou mais lançamentos são inválidos (máquina, estação ou macho).'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_macharia(turno_producao_id,linha_maquina_id,data_operacional,turno,categoria_id,setor_responsavel_id,motivo,inicio,fim,duracao_minutos,observacao,criado_por)
  select v_turno.id,item.linha_id,p_data_operacional,p_turno,item.categoria_id,item.setor_id,categoria.nome,item.inicio,item.fim,round(extract(epoch from(item.fim-item.inicio))/60)::integer,nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(linha_id bigint,inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,observacao text)
  join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  where item.inicio is not null and item.fim is not null and item.fim>=item.inicio and item.setor_id is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados ou horários inválidos.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_descartes,'[]'::jsonb));
  insert into public.descartes_producao_macharia(turno_producao_id,linha_maquina_id,data_operacional,turno,macho_id,quantidade_descartada,observacao,criado_por)
  select v_turno.id,item.linha_id,p_data_operacional,p_turno,item.macho_id,item.quantidade_descartada,nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_descartes,'[]'::jsonb)) as item(linha_id bigint,macho_id bigint,quantidade_descartada integer,observacao text)
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  join public.machos_macharia macho on macho.id=item.macho_id
  where coalesce(item.quantidade_descartada,0)>0;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Um ou mais descartes possuem máquina ou macho inválidos.'; end if;

  update public.turnos_producao_macharia set
    status='FECHADO',fechado_por=auth.uid(),fechado_em=now(),
    rascunho_producoes='[]'::jsonb,rascunho_paradas='[]'::jsonb,rascunho_descartes='[]'::jsonb,
    versao=versao+1,atualizado_por=auth.uid(),atualizado_em=now()
  where id=v_turno.id;
  return v_turno.id;
end;
$function$;

notify pgrst, 'reload schema';
