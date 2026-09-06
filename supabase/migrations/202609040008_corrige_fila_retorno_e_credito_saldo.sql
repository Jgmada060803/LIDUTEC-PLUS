-- Mesma pegadinha da fila do Vazamento: "panelasRejeitadasAguardandoRetorno"
-- lista TODA panela com status='REJEITADA' (mais antiga primeiro), sem
-- filtro de data. As 1.808 panelas históricas que acabaram de virar
-- REJEITADA (migration anterior) não têm forno de retorno real conhecido
-- e nunca serão processadas — ficariam pra sempre no topo dessa fila.
-- Não dá pra inventar um forno de destino, então vai como RETORNADA com
-- destino em branco: sai da fila de pendências, mas continua rastreável
-- no histórico (panelasDevolvidasRecentes) como "resolvida sem destino
-- conhecido".
update public.panelas_holding
set status = 'RETORNADA', retorno_forno_id = null
where status = 'REJEITADA' and motivo_rejeicao like 'Sem dados de vazamento no histórico importado%';

-- A correção anterior de volume_atual_forno_fusao (migration 202609040007)
-- passou a olhar só a corrida mais recente do forno, mas esqueceu do
-- crédito de panela rejeitada que retornou pra este forno (regra
-- introduzida em 202608310006). Credita só os retornos registrados DEPOIS
-- do início da corrida mais recente (o saldo de retornos anteriores a isso
-- já foi herdado via sobra_inicial_kg na hora em que aquela corrida foi
-- criada — somar de novo aqui contaria em dobro).
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
    - coalesce((select sum(p.peso_kg) from public.panelas_holding p where p.holding_corrida_id = v_corrida.id), 0)
    + coalesce((
        select sum(p.peso_kg) from public.panelas_holding p
        where p.status = 'RETORNADA' and p.retorno_forno_id = p_forno_id and p.atualizado_em >= v_corrida.inicio
      ), 0);
end;
$$;

notify pgrst, 'reload schema';
