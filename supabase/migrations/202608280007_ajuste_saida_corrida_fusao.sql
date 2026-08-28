begin;

-- "Ajuste (saída)" ao lado de Escória/Lingote/Energia — mesma condição da
-- escória: abate o saldo do forno. Pedido explícito: botão OK que aparece
-- ao mexer nessa caixa e salva as quatro juntas (não espera o fechamento
-- da corrida, diferente de escória/lingote/energia).
alter table public.corridas_fusao
  add column if not exists ajuste_kg numeric;

drop function if exists public.atualizar_saidas_diversas_corrida_fusao(bigint, numeric, numeric, numeric);

create or replace function public.atualizar_saidas_diversas_corrida_fusao(
  p_corrida_id bigint, p_escoria_kg numeric, p_lingote_kg numeric, p_energia_kwh numeric, p_ajuste_kg numeric
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível informar isso numa corrida aberta.'; end if;
  if coalesce(p_escoria_kg, 0) < 0 or coalesce(p_lingote_kg, 0) < 0 or coalesce(p_energia_kwh, 0) < 0 or coalesce(p_ajuste_kg, 0) < 0 then
    raise exception 'Os valores não podem ser negativos.';
  end if;

  update public.corridas_fusao
  set escoria_kg = p_escoria_kg, lingote_kg = p_lingote_kg, energia_kwh = p_energia_kwh, ajuste_kg = p_ajuste_kg,
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (p_corrida_id, auth.uid(), format('atualizou escória (%s kg), lingote (%s kg), energia (%s kWh) e ajuste (%s kg)',
    coalesce(p_escoria_kg, 0), coalesce(p_lingote_kg, 0), coalesce(p_energia_kwh, 0), coalesce(p_ajuste_kg, 0)));
end;
$$;

revoke all on function public.atualizar_saidas_diversas_corrida_fusao(bigint,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.atualizar_saidas_diversas_corrida_fusao(bigint,numeric,numeric,numeric,numeric) to authenticated;

-- Ajuste entra como saída no cálculo do volume atual do forno, igual
-- escória/lingote.
create or replace function public.volume_atual_forno_fusao(p_forno_id bigint)
returns numeric language sql stable set search_path = pg_catalog, public as $$
  select
    coalesce((
      select sum(item.quantidade_realizada_kg)
      from public.corridas_fusao_carga_itens item
      join public.corridas_fusao corrida on corrida.id = item.corrida_id
      where corrida.forno_id = p_forno_id and corrida.status <> 'CANCELADA'
    ), 0)
    + coalesce((
      select sum(transferencia.quantidade_kg)
      from public.transferencias_fusao transferencia
      join public.corridas_fusao destino on destino.id = transferencia.corrida_destino_id
      where destino.forno_id = p_forno_id
    ), 0)
    - coalesce((
      select sum(transferencia.quantidade_kg)
      from public.transferencias_fusao transferencia
      join public.corridas_fusao origem on origem.id = transferencia.corrida_origem_id
      where origem.forno_id = p_forno_id
    ), 0)
    - coalesce((
      select sum(coalesce(corrida.escoria_kg, 0) + coalesce(corrida.lingote_kg, 0) + coalesce(corrida.ajuste_kg, 0))
      from public.corridas_fusao corrida
      where corrida.forno_id = p_forno_id and corrida.status <> 'CANCELADA'
    ), 0);
$$;

notify pgrst, 'reload schema';

commit;
