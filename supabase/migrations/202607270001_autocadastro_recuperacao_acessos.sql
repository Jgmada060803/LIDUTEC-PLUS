begin;

create or replace function public.validar_dominio_email_corporativo()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
begin
  if new.email is null
    or lower(trim(new.email)) !~ '^[^@[:space:]]+@metalsider[.]com[.]br$'
  then
    raise exception 'Somente e-mails @metalsider.com.br podem ser cadastrados.'
      using errcode='22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validar_dominio_email_corporativo on auth.users;
drop trigger if exists validar_dominio_email_corporativo_insert on auth.users;
drop trigger if exists validar_dominio_email_corporativo_update on auth.users;
create trigger validar_dominio_email_corporativo_insert
before insert on auth.users
for each row execute function public.validar_dominio_email_corporativo();
create trigger validar_dominio_email_corporativo_update
before update of email on auth.users
for each row execute function public.validar_dominio_email_corporativo();

create or replace function public.criar_usuario_pendente()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  user_name text;
begin
  user_name:=coalesce(
    nullif(trim(new.raw_user_meta_data->>'nome'),''),
    split_part(new.email,'@',1)
  );
  insert into public.usuarios(id,nome,email,perfil,status)
  values(new.id,user_name,lower(new.email),'Aguardando definição','INATIVO')
  on conflict(id) do update
  set nome=excluded.nome,email=excluded.email;
  return new;
end;
$$;

drop trigger if exists criar_usuario_pendente
on auth.users;
create trigger criar_usuario_pendente
after insert on auth.users
for each row execute function public.criar_usuario_pendente();

-- Recupera solicitações corporativas criadas antes da instalação do gatilho.
insert into public.usuarios(id,nome,email,perfil,status)
select
  auth_user.id,
  coalesce(
    nullif(trim(auth_user.raw_user_meta_data->>'nome'),''),
    split_part(auth_user.email,'@',1)
  ),
  lower(auth_user.email),
  'Aguardando definição',
  'INATIVO'
from auth.users auth_user
where lower(trim(auth_user.email))
  ~ '^[^@[:space:]]+@metalsider[.]com[.]br$'
on conflict(id) do nothing;

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
  profile_name text;
  total integer;
begin
  select nome into profile_name
  from public.perfis
  where id=p_perfil_id;
  if profile_name is null then
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
  set perfil=profile_name,status='ATIVO'
  where id=p_usuario_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  return total;
end;
$$;

revoke all on function public.validar_dominio_email_corporativo()
from public,anon,authenticated;
revoke all on function public.criar_usuario_pendente()
from public,anon,authenticated;
revoke all on function public.configurar_acesso_usuario(uuid,bigint,bigint[])
from public,anon,authenticated;
grant execute on function public.configurar_acesso_usuario(uuid,bigint,bigint[])
to service_role;

commit;
