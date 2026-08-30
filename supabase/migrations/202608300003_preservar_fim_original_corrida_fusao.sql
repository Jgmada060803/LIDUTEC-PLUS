begin;

-- Pedido explícito: o horário de fechamento é sempre o primeiro informado.
-- Se o operador reabrir a corrida pra corrigir algo e fechar de novo, o
-- novo clique não deve trocar o "Fim" já registrado.
create or replace function public.fechar_corrida_fusao(
  p_corrida_id bigint, p_versao bigint, p_fim timestamp with time zone
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_movimentado numeric;
  v_saldo numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_fim is null then raise exception 'Informe o horário de fim.'; end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.versao <> p_versao then
    raise exception 'CONFLITO_RASCUNHO: a corrida foi atualizada por outro usuário.' using errcode = '40001';
  end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Esta corrida não está aberta.'; end if;

  select
    coalesce((select sum(quantidade_realizada_kg) from public.corridas_fusao_carga_itens where corrida_id = p_corrida_id), 0)
    + coalesce((select sum(quantidade_kg) from public.transferencias_fusao where corrida_destino_id = p_corrida_id), 0)
    + coalesce((select sum(quantidade_kg) from public.transferencias_fusao where corrida_origem_id = p_corrida_id), 0)
  into v_movimentado;
  if v_movimentado <= 10000 then
    raise exception 'É preciso movimentar mais de 10.000 kg (carregado + transferido) antes de fechar a corrida. Movimentado até agora: % kg.', v_movimentado;
  end if;

  v_saldo := public.volume_atual_forno_fusao(v_corrida.forno_id);

  update public.corridas_fusao
  set status = 'FECHADA', fim = coalesce(v_corrida.fim, p_fim), saldo_forno_no_fechamento_kg = v_saldo,
    versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
