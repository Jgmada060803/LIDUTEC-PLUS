-- volume_atual_forno_fusao escolhia "a corrida mais recente do forno" pelo
-- horario de inicio (inicio desc) -- fragil contra corrida com inicio
-- digitado errado/atrasado: encontrado um caso real (F1.053.277, fechada,
-- inicio 05/09 01:24) com inicio mais recente que a corrida REALMENTE
-- aberta (F1.053.278, inicio 04/09 06:10, criada depois no sistema),
-- fazendo a funcao pegar a corrida errada e travar uma transferencia real.
--
-- Corrigido pra usar a regra que ja e garantida pelo proprio sistema: só
-- existe 1 corrida ABERTA por forno por vez -- se existir, usa ela sempre,
-- sem depender do horario de inicio. Só cai pra "a mais recente" quando
-- nao ha nenhuma aberta (ex.: momento entre fechar uma corrida e abrir a
-- proxima), e nesse caso usa criado_em (gerado pelo servidor, nunca pode
-- ser digitado errado) em vez de inicio.
create or replace function public.volume_atual_forno_fusao(p_forno_id bigint)
returns numeric language plpgsql stable set search_path = pg_catalog, public as $$
declare
  v_corrida record;
begin
  select * into v_corrida from public.corridas_fusao
  where forno_id = p_forno_id
  order by (status = 'ABERTA') desc, criado_em desc, id desc
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
