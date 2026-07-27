begin;

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
  values(
    new.id,
    user_name,
    lower(new.email),
    'CLIENTE',
    'PENDENTE'
  )
  on conflict(id) do update
  set nome=excluded.nome,
      email=excluded.email;

  return new;
end;
$$;

revoke all on function public.criar_usuario_pendente()
  from public,anon,authenticated;

commit;
