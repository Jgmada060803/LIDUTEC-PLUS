begin;

-- Editar/remover transferência — pedido explícito, pra corrigir quantidade
-- errada ou desfazer uma transferência feita sem querer. Só permite
-- enquanto AMBAS as corridas envolvidas (origem e destino) ainda estão
-- abertas — mesma exigência já usada pra criar a transferência, evita
-- mexer no histórico de uma corrida já fechada.
create or replace function public.remover_transferencia_fusao(p_transferencia_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_transferencia record;
  v_origem record;
  v_destino record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_transferencia from public.transferencias_fusao where id = p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  select * into v_origem from public.corridas_fusao where id = v_transferencia.corrida_origem_id;
  select * into v_destino from public.corridas_fusao where id = v_transferencia.corrida_destino_id;
  if v_origem.status <> 'ABERTA' or v_destino.status <> 'ABERTA' then
    raise exception 'Só é possível remover a transferência enquanto a corrida de origem e a de destino estiverem abertas.';
  end if;
  delete from public.transferencias_fusao where id = p_transferencia_id;
end;
$$;

create or replace function public.editar_transferencia_fusao(p_transferencia_id bigint, p_quantidade_kg numeric)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_transferencia record;
  v_origem record;
  v_destino record;
  v_disponivel numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_quantidade_kg, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;

  select * into v_transferencia from public.transferencias_fusao where id = p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  select * into v_origem from public.corridas_fusao where id = v_transferencia.corrida_origem_id;
  select * into v_destino from public.corridas_fusao where id = v_transferencia.corrida_destino_id;
  if v_origem.status <> 'ABERTA' or v_destino.status <> 'ABERTA' then
    raise exception 'Só é possível editar a transferência enquanto a corrida de origem e a de destino estiverem abertas.';
  end if;

  -- O volume atual já desconta essa transferência (é saída do forno de
  -- origem); soma de volta a quantidade antiga antes de validar a nova.
  v_disponivel := public.volume_atual_forno_fusao(v_origem.forno_id) + v_transferencia.quantidade_kg;
  if p_quantidade_kg > v_disponivel then
    raise exception 'Quantidade maior que o volume disponível no forno (% kg).', v_disponivel;
  end if;

  update public.transferencias_fusao set quantidade_kg = p_quantidade_kg where id = p_transferencia_id;
end;
$$;

revoke all on function public.remover_transferencia_fusao(bigint) from public,anon;
grant execute on function public.remover_transferencia_fusao(bigint) to authenticated;
revoke all on function public.editar_transferencia_fusao(bigint,numeric) from public,anon;
grant execute on function public.editar_transferencia_fusao(bigint,numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
