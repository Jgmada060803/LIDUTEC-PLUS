begin;

-- Paradas programadas passa a ter permissões próprias em vez de depender de
-- metas.gerenciar — criar e encerrar são ações distintas, cada uma com seu
-- próprio controle de acesso.
insert into public.permissoes(codigo,nome,descricao,modulo,ativo)
select codigo,nome,descricao,'PLANEJAMENTO',true from (values
  ('paradas_programadas.criar','Criar paradas programadas','Cadastra novos ciclos de paradas programadas.'),
  ('paradas_programadas.encerrar','Encerrar paradas programadas','Encerra o ciclo vigente de uma parada programada.')
) permission(codigo,nome,descricao)
where not exists(select 1 from public.permissoes current_permission
  where current_permission.codigo=permission.codigo);

insert into public.perfil_permissoes(perfil_id,permissao_id)
select profile.id,permission.id from public.perfis profile
cross join public.permissoes permission
where (upper(profile.codigo) in ('ADMIN','ADMINISTRADOR','GERENTE_GERAL','GERENTE_PRODUCAO')
  or upper(profile.nome)='ADMINISTRADOR')
and permission.codigo in ('paradas_programadas.criar','paradas_programadas.encerrar')
and not exists(select 1 from public.perfil_permissoes relation
  where relation.perfil_id=profile.id and relation.permissao_id=permission.id);

-- Quem só tem as permissões novas (sem metas.visualizar/gerenciar) também
-- precisa conseguir ver a lista na tela própria de paradas programadas.
drop policy if exists paradas_programadas_select on public.paradas_programadas;
create policy paradas_programadas_select on public.paradas_programadas for select to authenticated using(
  public.usuario_tem_permissao_metas('metas.visualizar')
  or public.usuario_tem_permissao_metas('metas.gerenciar')
  or public.usuario_tem_permissao_metas('paradas_programadas.criar')
  or public.usuario_tem_permissao_metas('paradas_programadas.encerrar')
);

create or replace function public.definir_parada_programada(
  p_area_id bigint,
  p_linha_maquina_id bigint,
  p_equipamento_planejamento_id bigint,
  p_turno text,
  p_tipo_parada_codigo text,
  p_horario_inicial time,
  p_horario_final time,
  p_dias_semana smallint[],
  p_vigencia_inicio date
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_id bigint;
begin
  if not public.usuario_tem_permissao_metas('paradas_programadas.criar') then
    raise exception 'Usuário sem permissão para criar paradas programadas.';
  end if;
  if p_turno is not null and p_turno not in ('MANHA','TARDE','NOITE') then
    raise exception 'Turno inválido.';
  end if;
  if p_linha_maquina_id is not null and p_equipamento_planejamento_id is not null then
    raise exception 'Selecione apenas uma unidade de trabalho: linha ou equipamento.';
  end if;
  if p_dias_semana is null or array_length(p_dias_semana,1) is null then
    raise exception 'Selecione ao menos um dia da semana.';
  end if;

  update public.paradas_programadas set vigencia_fim = p_vigencia_inicio - 1
  where area_id=p_area_id
    and coalesce(linha_maquina_id,-1)=coalesce(p_linha_maquina_id,-1)
    and coalesce(equipamento_planejamento_id,-1)=coalesce(p_equipamento_planejamento_id,-1)
    and coalesce(turno,'-')=coalesce(p_turno,'-')
    and tipo_parada_codigo=p_tipo_parada_codigo
    and vigencia_fim is null
    and vigencia_inicio < p_vigencia_inicio;

  insert into public.paradas_programadas(
    area_id,linha_maquina_id,equipamento_planejamento_id,turno,tipo_parada_codigo,horario_inicial,horario_final,dias_semana,vigencia_inicio,criado_por
  ) values (
    p_area_id,p_linha_maquina_id,p_equipamento_planejamento_id,p_turno,p_tipo_parada_codigo,p_horario_inicial,p_horario_final,p_dias_semana,p_vigencia_inicio,auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.encerrar_parada_programada(
  p_id bigint,
  p_vigencia_fim date default current_date
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_vigencia_inicio date;
begin
  if not public.usuario_tem_permissao_metas('paradas_programadas.encerrar') then
    raise exception 'Usuário sem permissão para encerrar paradas programadas.';
  end if;

  select vigencia_inicio into v_vigencia_inicio
  from public.paradas_programadas
  where id = p_id and vigencia_fim is null
  for update;

  if not found then
    raise exception 'Parada programada não encontrada ou já encerrada.';
  end if;

  if p_vigencia_fim < v_vigencia_inicio then
    raise exception 'A data de encerramento não pode ser anterior ao início da vigência.';
  end if;

  update public.paradas_programadas
  set vigencia_fim = p_vigencia_fim
  where id = p_id;
end;
$$;

notify pgrst,'reload schema';

commit;
