begin;

-- Remover material planejado que ainda não foi pesado — pedido explícito
-- pra corrigir um lançamento errado sem precisar zerar o real manualmente.
-- Só permite enquanto a corrida está aberta e nada foi pesado ainda pro
-- item (senão fica preso ao histórico, igual planejado/real já editados).
create or replace function public.remover_item_carga_fusao(p_corrida_id bigint, p_item_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_item record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível remover material de uma corrida aberta.'; end if;

  select * into v_item from public.corridas_fusao_carga_itens where id = p_item_id and corrida_id = p_corrida_id;
  if not found then raise exception 'Item não encontrado nesta corrida.'; end if;
  if coalesce(v_item.quantidade_realizada_kg, 0) > 0 then
    raise exception 'Só é possível remover material que ainda não foi pesado.';
  end if;

  delete from public.corridas_fusao_carga_itens where id = p_item_id;
end;
$$;

revoke all on function public.remover_item_carga_fusao(bigint,bigint) from public,anon;
grant execute on function public.remover_item_carga_fusao(bigint,bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
