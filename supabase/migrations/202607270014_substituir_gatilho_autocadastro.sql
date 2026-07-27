begin;

create or replace function public.criar_solicitacao_acesso_pendente()
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
  values(
    new.id,
    user_name,
    lower(new.email),
    'CLIENTE',
    'PENDENTE'
  )
  on conflict(id) do update
  set nome=excluded.nome,
      email=excluded.email,
      perfil='CLIENTE',
      status='PENDENTE';

  return new;
end;
$$;

drop trigger if exists criar_usuario_pendente on auth.users;
drop trigger if exists criar_solicitacao_acesso_pendente on auth.users;

create trigger criar_solicitacao_acesso_pendente
after insert on auth.users
for each row execute function public.criar_solicitacao_acesso_pendente();

revoke all on function public.criar_solicitacao_acesso_pendente()
  from public,anon,authenticated;

commit;
