-- Prévia (só leitura) do que "Lingotar" calcularia agora — quantidade de
-- panelas vazadas desde o último lingotamento, peso enviado e consumo
-- teórico — pra o operador do Vazamento acompanhar antes de decidir a
-- hora de lingotar. Mesma consulta usada dentro de
-- iniciar_lingotamento_vazamento, só que sem gravar nada.
create or replace function public.resumo_lingotamento_pendente()
returns table(quantidade_panelas integer, peso_enviado_kg numeric, peso_consumido_teorico_kg numeric)
language sql stable
set search_path=pg_catalog,public as $$
  select count(*)::integer, coalesce(sum(p.peso_kg), 0), coalesce(sum(p.quantidade_moldes * pr.peso_cacho_kg), 0)
  from public.panelas_holding p
  join public.produtos pr on pr.id = p.produto_id
  where p.status = 'VAZADA' and p.lingotamento_id is null;
$$;

grant execute on function public.resumo_lingotamento_pendente() to authenticated;
