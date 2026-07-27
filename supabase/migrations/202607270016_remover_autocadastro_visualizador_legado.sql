begin;

do $$
declare
  legacy_trigger record;
begin
  for legacy_trigger in
    select
      trigger_data.tgname,
      trigger_data.tgrelid::regclass::text as table_name
    from pg_catalog.pg_trigger trigger_data
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid=trigger_data.tgfoid
    where trigger_data.tgrelid in (
        'auth.users'::regclass,
        'public.usuarios'::regclass
      )
      and not trigger_data.tgisinternal
      and trigger_function.prosrc ilike '%VISUALIZADOR%'
  loop
    execute format(
      'drop trigger %I on %s',
      legacy_trigger.tgname,
      legacy_trigger.table_name
    );
  end loop;
end;
$$;

drop trigger if exists criar_solicitacao_acesso_pendente on auth.users;
create trigger criar_solicitacao_acesso_pendente
after insert on auth.users
for each row execute function public.criar_solicitacao_acesso_pendente();

commit;
