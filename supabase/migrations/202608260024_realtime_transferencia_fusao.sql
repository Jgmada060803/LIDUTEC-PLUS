begin;

-- O forno destino de uma transferência demorava até 3min pra mostrar o
-- volume novo (só a rede de segurança cobria isso) — liga Realtime também
-- pra transferencias_fusao, mesmo padrão das outras tabelas do módulo.
do $$ begin
  if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='transferencias_fusao') then
    alter publication supabase_realtime add table public.transferencias_fusao;
  end if;
end $$;

commit;
