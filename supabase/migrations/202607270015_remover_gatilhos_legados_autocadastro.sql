begin;

do $$
declare
  legacy_trigger record;
begin
  for legacy_trigger in
    select trigger_data.tgname
    from pg_catalog.pg_trigger trigger_data
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid=trigger_data.tgfoid
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid=trigger_function.pronamespace
    where trigger_data.tgrelid='auth.users'::regclass
      and not trigger_data.tgisinternal
      and function_schema.nspname='public'
      and trigger_function.proname='criar_usuario_pendente'
  loop
    execute format(
      'drop trigger %I on auth.users',
      legacy_trigger.tgname
    );
  end loop;
end;
$$;

drop trigger if exists criar_solicitacao_acesso_pendente on auth.users;
create trigger criar_solicitacao_acesso_pendente
after insert on auth.users
for each row execute function public.criar_solicitacao_acesso_pendente();

commit;
