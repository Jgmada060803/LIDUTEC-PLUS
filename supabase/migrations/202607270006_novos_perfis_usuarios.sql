begin;

alter table public.usuarios
  drop constraint if exists usuarios_perfil_check;

update public.usuarios
set perfil=case perfil
  when 'ENGENHARIA' then 'GERENTE_ENGENHARIA'
  when 'QUALIDADE' then 'GERENTE_QUALIDADE'
  when 'OPERADOR' then 'MOLDAGEM'
  when 'VISUALIZADOR' then 'CLIENTE'
  else perfil
end;

update public.perfis
set codigo='GERENTE_ENGENHARIA',
    nome='Gerente Engenharia'
where codigo='ENGENHARIA';

update public.perfis
set codigo='COORDENADOR_PRODUCAO',
    nome='Coordenador Produção'
where codigo='SUPERVISOR_PRODUCAO';

update public.perfis
set nome='Gerente Produção'
where codigo='GERENTE_PRODUCAO';

update public.perfis
set codigo='GERENTE_QUALIDADE',
    nome='Gerente Qualidade'
where codigo='QUALIDADE';

update public.perfis
set codigo='MOLDAGEM',
    nome='Moldagem'
where codigo='OPERADOR';

update public.perfis
set codigo='CLIENTE',
    nome='Cliente'
where codigo='VISUALIZADOR';

insert into public.perfis(codigo,nome,descricao,ativo)
values
  ('GERENTE_GERAL','Gerente Geral',
    'Gestão geral do sistema e dos processos.',true),
  ('TECNICO_ENGENHARIA','Técnico Engenharia',
    'Atividades técnicas de Engenharia.',true),
  ('FUSAO','Fusão',
    'Operações e consultas do processo de Fusão.',true),
  ('VAZAMENTO','Vazamento',
    'Operações e consultas do processo de Vazamento.',true),
  ('MACHARIA','Macharia',
    'Operações e consultas do processo de Macharia.',true),
  ('ACABAMENTO','Acabamento',
    'Operações e consultas do processo de Acabamento.',true),
  ('REFUGO','Refugo',
    'Operações e consultas relacionadas a refugos.',true),
  ('ASSISTENTE_TECNICO','Assistente Técnico',
    'Atividades de assistência técnica.',true)
on conflict(codigo) do update
set nome=excluded.nome,
    descricao=excluded.descricao,
    ativo=excluded.ativo;

alter table public.usuarios
  add constraint usuarios_perfil_check
  check (
    perfil=any(array[
      'ADMINISTRADOR',
      'GERENTE_ENGENHARIA',
      'GERENTE_PRODUCAO',
      'GERENTE_QUALIDADE',
      'GERENTE_GERAL',
      'TECNICO_ENGENHARIA',
      'COORDENADOR_PRODUCAO',
      'FUSAO',
      'MOLDAGEM',
      'VAZAMENTO',
      'MACHARIA',
      'ACABAMENTO',
      'REFUGO',
      'ASSISTENTE_TECNICO',
      'CLIENTE'
    ]::text[])
  );

create or replace function public.configurar_acesso_usuario(
  p_usuario_id uuid,
  p_perfil_id bigint,
  p_permissao_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  profile_code text;
  total integer;
begin
  select codigo into profile_code
  from public.perfis
  where id=p_perfil_id and ativo=true;
  if profile_code is null then
    raise exception 'Perfil inválido.';
  end if;

  delete from public.usuario_perfis
  where usuario_id=p_usuario_id;
  insert into public.usuario_perfis(usuario_id,perfil_id)
  values(p_usuario_id,p_perfil_id);

  delete from public.usuario_permissoes
  where usuario_id=p_usuario_id;
  insert into public.usuario_permissoes(
    usuario_id,permissao_id,permitido
  )
  select p_usuario_id,permission.id,
    permission.id=any(coalesce(p_permissao_ids,'{}'::bigint[]))
  from public.permissoes permission
  where permission.ativo=true;

  get diagnostics total=row_count;
  update public.usuarios
  set perfil=profile_code,status='ATIVO'
  where id=p_usuario_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  return total;
end;
$$;

revoke all on function public.configurar_acesso_usuario(
  uuid,bigint,bigint[]
) from public,anon,authenticated;
grant execute on function public.configurar_acesso_usuario(
  uuid,bigint,bigint[]
) to service_role;

commit;
