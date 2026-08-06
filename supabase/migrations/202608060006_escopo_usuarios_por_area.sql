begin;
create table if not exists public.usuario_areas_operacionais(
 usuario_id uuid not null references public.usuarios(id) on delete cascade,
 area_id bigint not null references public.areas_checklist(id) on delete cascade,
 atribuido_por uuid default auth.uid() references public.usuarios(id),
 atribuido_em timestamptz not null default now(),primary key(usuario_id,area_id));

create or replace function public.usuario_possui_visao_global_operacional()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.usuario_perfis up join public.perfis p on p.id=up.perfil_id
 where up.usuario_id=auth.uid() and upper(p.codigo) in('ADMIN','ADMINISTRADOR','GERENTE_GERAL','GERENTE_PRODUCAO','COORDENADOR_PRODUCAO'))
$$;
create or replace function public.usuario_pode_acessar_area(p_area_id bigint)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and (public.usuario_possui_visao_global_operacional() or exists(
  select 1 from public.usuario_areas_operacionais ua where ua.usuario_id=auth.uid() and ua.area_id=p_area_id))
$$;
grant execute on function public.usuario_possui_visao_global_operacional(),public.usuario_pode_acessar_area(bigint) to authenticated;

insert into public.usuario_areas_operacionais(usuario_id,area_id,atribuido_por)
select distinct up.usuario_id,a.id,up.usuario_id from public.usuario_perfis up join public.perfis p on p.id=up.perfil_id
join public.areas_checklist a on upper(a.codigo)=upper(p.codigo)
on conflict do nothing;

alter table public.usuario_areas_operacionais enable row level security;
create policy usuario_areas_select on public.usuario_areas_operacionais for select to authenticated using(
 usuario_id=auth.uid() or public.usuario_tem_permissao_checklist('usuarios.gerenciar_acessos'));
create policy usuario_areas_insert on public.usuario_areas_operacionais for insert to authenticated with check(public.usuario_tem_permissao_checklist('usuarios.gerenciar_acessos'));
create policy usuario_areas_delete on public.usuario_areas_operacionais for delete to authenticated using(public.usuario_tem_permissao_checklist('usuarios.gerenciar_acessos'));
grant select,insert,delete on public.usuario_areas_operacionais to authenticated;

drop policy if exists areas_checklist_select on public.areas_checklist;
create policy areas_checklist_select on public.areas_checklist for select to authenticated using(
 public.usuario_tem_permissao_checklist('checklist.visualizar') and public.usuario_pode_acessar_area(id));
drop policy if exists modelos_checklist_select on public.modelos_checklist;
create policy modelos_checklist_select on public.modelos_checklist for select to authenticated using(
 public.usuario_tem_permissao_checklist('checklist.visualizar') and public.usuario_pode_acessar_area(area_id));
drop policy if exists itens_checklist_select on public.itens_checklist;
create policy itens_checklist_select on public.itens_checklist for select to authenticated using(exists(
 select 1 from public.modelos_checklist m where m.id=modelo_id and public.usuario_pode_acessar_area(m.area_id)));
drop policy if exists execucoes_checklist_select on public.execucoes_checklist;
create policy execucoes_checklist_select on public.execucoes_checklist for select to authenticated using(exists(
 select 1 from public.modelos_checklist m where m.id=modelo_id and public.usuario_pode_acessar_area(m.area_id)));
drop policy if exists respostas_checklist_select on public.respostas_checklist;
create policy respostas_checklist_select on public.respostas_checklist for select to authenticated using(exists(
 select 1 from public.execucoes_checklist e join public.modelos_checklist m on m.id=e.modelo_id
 where e.id=execucao_id and public.usuario_pode_acessar_area(m.area_id)));
drop policy if exists liberacoes_checklist_select on public.liberacoes_checklist;
create policy liberacoes_checklist_select on public.liberacoes_checklist for select to authenticated using(exists(
 select 1 from public.execucoes_checklist e join public.modelos_checklist m on m.id=e.modelo_id
 where e.id=execucao_id and public.usuario_pode_acessar_area(m.area_id)));
drop policy if exists medicoes_checklist_select on public.medicoes_checklist;
create policy medicoes_checklist_select on public.medicoes_checklist for select to authenticated using(exists(
 select 1 from public.execucoes_checklist e join public.modelos_checklist m on m.id=e.modelo_id
 where e.id=execucao_id and public.usuario_pode_acessar_area(m.area_id)));
drop policy if exists instrucoes_it_select on public.instrucoes_trabalho;
create policy instrucoes_it_select on public.instrucoes_trabalho for select to authenticated using(
 public.usuario_tem_permissao_ficha('ficha.visualizar') and public.usuario_pode_acessar_area(area_id));
drop policy if exists revisoes_it_select on public.revisoes_instrucao_trabalho;
create policy revisoes_it_select on public.revisoes_instrucao_trabalho for select to authenticated using(exists(
 select 1 from public.instrucoes_trabalho i where i.id=instrucao_id and public.usuario_pode_acessar_area(i.area_id)));
drop policy if exists especificacoes_it_select on public.especificacoes_instrucao_trabalho;
create policy especificacoes_it_select on public.especificacoes_instrucao_trabalho for select to authenticated using(exists(
 select 1 from public.revisoes_instrucao_trabalho r join public.instrucoes_trabalho i on i.id=r.instrucao_id
 where r.id=revisao_id and public.usuario_pode_acessar_area(i.area_id)));
drop policy if exists aprovacoes_it_select on public.aprovacoes_instrucao_trabalho;
create policy aprovacoes_it_select on public.aprovacoes_instrucao_trabalho for select to authenticated using(exists(
 select 1 from public.revisoes_instrucao_trabalho r join public.instrucoes_trabalho i on i.id=r.instrucao_id
 where r.id=revisao_id and public.usuario_pode_acessar_area(i.area_id)));

create or replace function public.validar_area_execucao_checklist()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_area bigint;begin select area_id into v_area from public.modelos_checklist where id=new.modelo_id;
 if not public.usuario_pode_acessar_area(v_area) then raise exception 'Usuário sem acesso à área deste checklist.';end if;return new;end $$;
drop trigger if exists validar_area_execucao_checklist_trigger on public.execucoes_checklist;
create trigger validar_area_execucao_checklist_trigger before insert or update on public.execucoes_checklist for each row execute function public.validar_area_execucao_checklist();

create or replace function public.usuario_pode_acessar_area_codigo(p_codigo text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.usuario_pode_acessar_area((select id from public.areas_checklist where codigo=upper(trim(p_codigo))))
$$;
grant execute on function public.usuario_pode_acessar_area_codigo(text) to authenticated;

drop policy if exists producao_moldes_select on public.registros_producao_moldes;
create policy producao_moldes_select on public.registros_producao_moldes for select to authenticated using(
 public.usuario_tem_permissao_producao_moldes('producao_moldes.visualizar') and public.usuario_pode_acessar_area_codigo('MOLDAGEM'));
drop policy if exists paradas_moldes_select on public.paradas_producao_moldes;
create policy paradas_moldes_select on public.paradas_producao_moldes for select to authenticated using(
 public.usuario_tem_permissao_producao_moldes('producao_moldes.visualizar') and public.usuario_pode_acessar_area_codigo('MOLDAGEM'));
drop policy if exists turnos_producao_select on public.turnos_producao_moldes;
create policy turnos_producao_select on public.turnos_producao_moldes for select to authenticated using(
 public.usuario_tem_permissao_producao_moldes('producao_moldes.visualizar') and public.usuario_pode_acessar_area_codigo('MOLDAGEM'));

create or replace function public.validar_acesso_producao_moldagem()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin if not public.usuario_pode_acessar_area_codigo('MOLDAGEM') then raise exception 'Usuário sem acesso à área de Moldagem.';end if;return new;end $$;
drop trigger if exists validar_area_turno_moldagem on public.turnos_producao_moldes;
create trigger validar_area_turno_moldagem before insert or update on public.turnos_producao_moldes for each row execute function public.validar_acesso_producao_moldagem();
drop trigger if exists validar_area_registro_moldagem on public.registros_producao_moldes;
create trigger validar_area_registro_moldagem before insert or update on public.registros_producao_moldes for each row execute function public.validar_acesso_producao_moldagem();
drop trigger if exists validar_area_parada_moldagem on public.paradas_producao_moldes;
create trigger validar_area_parada_moldagem before insert or update on public.paradas_producao_moldes for each row execute function public.validar_acesso_producao_moldagem();

notify pgrst,'reload schema';

commit;
