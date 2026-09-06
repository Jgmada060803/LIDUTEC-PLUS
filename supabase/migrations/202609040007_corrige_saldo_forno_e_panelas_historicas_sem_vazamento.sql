-- O saldo atual do forno (volume_atual_forno_fusao) somava o histórico
-- INTEIRO de corridas desde sempre (toda carga menos toda escória/lingote/
-- ajuste/transferência/panela já registrada) — funcionava por coincidência
-- com poucas corridas bem preenchidas, mas depois da importação histórica
-- (milhares de corridas sem escória, já que a planilha CARREGAMENTO nunca
-- teve essa coluna) o saldo foi pra milhões de kg.
--
-- Correção: olhar só a corrida mais recente do forno (sobra_inicial_kg dela
-- + carga/transferências/perdas/panelas só dela) — é exatamente pra isso
-- que sobra_inicial_kg já existe (gravado na abertura como "saldo herdado"
-- da corrida anterior); a função antiga ignorava esse campo e recontava
-- tudo do zero. Cada corrida vira um elo da corrente, não uma resoma total
-- — as corridas históricas (sobra_inicial_kg = 0, isoladas) não têm efeito
-- nenhum sobre o saldo atual, que só depende da corrida mais recente de
-- verdade (a aberta hoje, ou a última fechada).
create or replace function public.volume_atual_forno_fusao(p_forno_id bigint)
returns numeric language plpgsql stable set search_path = pg_catalog, public as $$
declare
  v_corrida record;
begin
  select * into v_corrida from public.corridas_fusao
  where forno_id = p_forno_id
  order by inicio desc nulls last, id desc
  limit 1;
  if not found then return 0; end if;

  return coalesce(v_corrida.sobra_inicial_kg, 0)
    + coalesce((select sum(item.quantidade_realizada_kg) from public.corridas_fusao_carga_itens item where item.corrida_id = v_corrida.id), 0)
    + coalesce((select sum(t.quantidade_kg) from public.transferencias_fusao t where t.corrida_destino_id = v_corrida.id), 0)
    - coalesce((select sum(t.quantidade_kg) from public.transferencias_fusao t where t.corrida_origem_id = v_corrida.id), 0)
    - coalesce(v_corrida.escoria_kg, 0) - coalesce(v_corrida.lingote_kg, 0) - coalesce(v_corrida.ajuste_kg, 0)
    - coalesce((select sum(p.peso_kg) from public.panelas_holding p where p.holding_corrida_id = v_corrida.id), 0);
end;
$$;

-- As panelas retiradas historicamente (id >= 213, do import de hoje) sem
-- dados de vazamento ficaram com status 'SAIDA_HOLDING' — mesmo status das
-- panelas realmente pendentes hoje. Como a fila do Vazamento lista todas as
-- panelas nesse status (mais antigas primeiro), elas apareciam no topo da
-- fila real. Marca como rejeitada (a história delas realmente termina
-- aqui) pra sair da fila sem precisar de status novo no schema.
update public.panelas_holding
set status = 'REJEITADA', motivo_rejeicao = 'Sem dados de vazamento no histórico importado (planilha antiga não tinha essa informação para esta panela).'
where id >= 213 and status = 'SAIDA_HOLDING';

notify pgrst, 'reload schema';
