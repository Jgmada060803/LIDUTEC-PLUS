begin;

-- Ponte lança cada entrega como uma parcela que SOMA ao real acumulado
-- (em vez de sobrescrever) — pedido explícito, já que o material pode
-- chegar em mais de uma leva. atualizar_pesagem_carga_fusao continua
-- existindo à parte, pra correção direta (sobrescreve).
create or replace function public.adicionar_pesagem_carga_fusao(
  p_corrida_id bigint, p_material_id bigint, p_quantidade_kg numeric
) returns numeric language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_total numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_quantidade_kg, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  update public.corridas_fusao_carga_itens
  set quantidade_realizada_kg = coalesce(quantidade_realizada_kg, 0) + p_quantidade_kg,
    atualizado_por = auth.uid(), atualizado_em = now()
  where corrida_id = p_corrida_id and material_id = p_material_id
  returning quantidade_realizada_kg into v_total;
  if not found then raise exception 'Item de carga não encontrado nesta corrida.'; end if;
  return v_total;
end;
$$;
revoke all on function public.adicionar_pesagem_carga_fusao(bigint,bigint,numeric) from public,anon;
grant execute on function public.adicionar_pesagem_carga_fusao(bigint,bigint,numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
