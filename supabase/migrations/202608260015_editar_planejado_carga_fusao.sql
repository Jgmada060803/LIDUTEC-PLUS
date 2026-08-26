begin;

-- Deixa corrigir a quantidade planejada de um item enquanto a corrida
-- estiver aberta (pedido explícito) — decisão do supervisor, independe de
-- quem pesa o real (Ponte ou direto).
create or replace function public.atualizar_planejado_carga_fusao(
  p_corrida_id bigint, p_item_id bigint, p_quantidade_planejada_kg numeric
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível editar o planejado de uma corrida aberta.'; end if;
  if coalesce(p_quantidade_planejada_kg, -1) < 0 then raise exception 'Quantidade planejada inválida.'; end if;
  update public.corridas_fusao_carga_itens
  set quantidade_planejada_kg = p_quantidade_planejada_kg, atualizado_por = auth.uid(), atualizado_em = now()
  where corrida_id = p_corrida_id and id = p_item_id;
  if not found then raise exception 'Item de carga não encontrado nesta corrida.'; end if;
end;
$$;
revoke all on function public.atualizar_planejado_carga_fusao(bigint,bigint,numeric) from public,anon;
grant execute on function public.atualizar_planejado_carga_fusao(bigint,bigint,numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
