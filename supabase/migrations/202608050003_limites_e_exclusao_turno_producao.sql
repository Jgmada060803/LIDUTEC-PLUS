begin;

create or replace function public.validar_horario_turno_producao()
returns trigger language plpgsql
set search_path=pg_catalog,public as $$
declare
  v_inicio_turno timestamptz;
  v_fim_turno timestamptz;
begin
  if new.inicio is null or new.fim is null then return new; end if;
  v_inicio_turno := (new.data_operacional + case new.turno
    when 'MANHA' then time '06:00'
    when 'TARDE' then time '13:20'
    when 'NOITE' then time '21:30'
  end) at time zone 'America/Sao_Paulo';
  v_fim_turno := ((new.data_operacional + case when new.turno='NOITE' then 1 else 0 end) + case new.turno
    when 'MANHA' then time '13:20'
    when 'TARDE' then time '21:30'
    when 'NOITE' then time '06:00'
  end) at time zone 'America/Sao_Paulo';
  if new.inicio < v_inicio_turno or new.inicio > v_fim_turno or
     new.fim < v_inicio_turno or new.fim > v_fim_turno or new.fim < new.inicio then
    raise exception 'O período informado está fora do horário do turno %.',new.turno;
  end if;
  return new;
end;
$$;

drop trigger if exists validar_horario_registro_producao on public.registros_producao_moldes;
create trigger validar_horario_registro_producao before insert or update of
  data_operacional,turno,inicio,fim on public.registros_producao_moldes
for each row execute function public.validar_horario_turno_producao();

drop trigger if exists validar_horario_parada_producao on public.paradas_producao_moldes;
create trigger validar_horario_parada_producao before insert or update of
  data_operacional,turno,inicio,fim on public.paradas_producao_moldes
for each row execute function public.validar_horario_turno_producao();

insert into public.permissoes(codigo,nome,descricao,modulo,ativo)
select 'producao_moldes.excluir_turno','Excluir turno de produção',
  'Exclui integralmente um turno fechado e seus apontamentos.','PRODUCAO',true
where not exists(select 1 from public.permissoes where codigo='producao_moldes.excluir_turno');

insert into public.perfil_permissoes(perfil_id,permissao_id)
select perfil.id,permissao.id from public.perfis perfil
join public.permissoes permissao on permissao.codigo='producao_moldes.excluir_turno'
where upper(coalesce(perfil.codigo,'')) in ('ADMIN','ADMINISTRADOR','GERENTE_PRODUCAO','GERENTE_DE_PRODUCAO')
   or upper(coalesce(perfil.nome,'')) in ('ADMINISTRADOR','GERENTE DE PRODUÇÃO','GERENTE DE PRODUCAO')
on conflict do nothing;

create or replace function public.excluir_turno_producao_moldes(p_turno_id bigint)
returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if not exists(
    select 1 from public.usuario_perfis usuario_perfil
    join public.perfis perfil on perfil.id=usuario_perfil.perfil_id
    where usuario_perfil.usuario_id=auth.uid() and (
      upper(coalesce(perfil.codigo,'')) in ('ADMIN','ADMINISTRADOR','GERENTE_PRODUCAO','GERENTE_DE_PRODUCAO')
      or upper(coalesce(perfil.nome,'')) in ('ADMINISTRADOR','GERENTE DE PRODUÇÃO','GERENTE DE PRODUCAO')
    )
  ) then raise exception 'Somente Gerente de Produção ou Administrador pode excluir turnos.'; end if;
  if not exists(select 1 from public.turnos_producao_moldes where id=p_turno_id and status='FECHADO') then
    raise exception 'Turno fechado não encontrado.';
  end if;
  delete from public.paradas_producao_moldes where turno_producao_id=p_turno_id;
  delete from public.registros_producao_moldes where turno_producao_id=p_turno_id;
  delete from public.historico_edicoes_turno_producao where turno_producao_id=p_turno_id;
  delete from public.turnos_producao_moldes where id=p_turno_id;
end;
$$;

grant execute on function public.excluir_turno_producao_moldes(bigint) to authenticated;

commit;
