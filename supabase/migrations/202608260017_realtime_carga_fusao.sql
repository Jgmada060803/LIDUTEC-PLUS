begin;

-- Tela de planejamento da carga (corrida.html) passa a usar Supabase
-- Realtime em vez de recarregar tudo de tempos em tempos — só a linha/
-- coluna que mudou é redesenhada quando a Ponte pesa ou outro supervisor
-- edita. Mesmo padrão já usado em turnos_producao_moldes/acabamento/
-- macharia.
do $$ begin
  if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='corridas_fusao_carga_itens') then
    alter publication supabase_realtime add table public.corridas_fusao_carga_itens;
  end if;
  if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='corridas_fusao') then
    alter publication supabase_realtime add table public.corridas_fusao;
  end if;
  if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='corridas_fusao_adicoes') then
    alter publication supabase_realtime add table public.corridas_fusao_adicoes;
  end if;
end $$;

commit;
