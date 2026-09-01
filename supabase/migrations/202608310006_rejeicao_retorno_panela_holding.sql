begin;

-- Etapa 8: rejeição e retorno de panela (itens 14/15). Aviso reaproveita
-- corridas_fusao_alteracoes (já visível/com beep no índice, Ponte e
-- corrida.html — Decisão 3 do plano); a ação de "Registrar retorno" fica
-- na própria tela do Vazamento, numa lista separada de rejeitadas
-- aguardando retorno (mais direto pro operador do que caçar num log).
alter table public.panelas_holding
  add column if not exists motivo_rejeicao text,
  add column if not exists retorno_forno_id bigint references public.fornos_fusao(id);

create or replace function public.rejeitar_panela_holding(p_panela_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_panela record;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Informe o motivo da rejeição.';
  end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id for update;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status not in ('SAIDA_HOLDING','EM_TRANSITO') then
    raise exception 'Esta panela não está mais aguardando vazamento.';
  end if;

  update public.panelas_holding
  set status = 'REJEITADA', motivo_rejeicao = trim(p_motivo), atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format(
    'Panela Nº %s rejeitada no Vazamento (%s kg) — motivo: %s', v_panela.sequencial, v_panela.peso_kg, trim(p_motivo)
  ));
end;
$$;

revoke all on function public.rejeitar_panela_holding(bigint,text) from public, anon;
grant execute on function public.rejeitar_panela_holding(bigint,text) to authenticated;

create or replace function public.registrar_retorno_panela_holding(p_panela_id bigint, p_forno_destino_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_forno record;
  v_corrida_destino_aberta bigint;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id for update;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status <> 'REJEITADA' then
    raise exception 'Só é possível registrar retorno de uma panela rejeitada.';
  end if;
  select * into v_forno from public.fornos_fusao where id = p_forno_destino_id and ativo;
  if not found then raise exception 'Forno de destino inválido.'; end if;

  update public.panelas_holding
  set status = 'RETORNADA', retorno_forno_id = p_forno_destino_id, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format(
    'Panela Nº %s (rejeitada) retornou para o forno %s (%s kg)', v_panela.sequencial, v_forno.codigo, v_panela.peso_kg
  ));

  -- Se o forno destino tiver corrida aberta, avisa lá também — senão o
  -- crédito no saldo (volume_atual_forno_fusao) já cobre o rastreamento,
  -- só não tem onde logar um aviso por corrida.
  select id into v_corrida_destino_aberta from public.corridas_fusao where forno_id = p_forno_destino_id and status = 'ABERTA';
  if v_corrida_destino_aberta is not null then
    insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
    values (v_corrida_destino_aberta, auth.uid(), format(
      'recebeu retorno de panela rejeitada (Nº %s, %s kg)', v_panela.sequencial, v_panela.peso_kg
    ));
  end if;
end;
$$;

revoke all on function public.registrar_retorno_panela_holding(bigint,bigint) from public, anon;
grant execute on function public.registrar_retorno_panela_holding(bigint,bigint) to authenticated;

-- Retorno credita o saldo do forno escolhido (saída na origem já é
-- descontada desde a criação da panela — o metal já tinha saído fisicamente).
create or replace function public.volume_atual_forno_fusao(p_forno_id bigint)
returns numeric language sql stable set search_path = pg_catalog, public as $$
  select
    coalesce((
      select sum(item.quantidade_realizada_kg)
      from public.corridas_fusao_carga_itens item
      join public.corridas_fusao corrida on corrida.id = item.corrida_id
      where corrida.forno_id = p_forno_id
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
      where corrida.forno_id = p_forno_id
    ), 0)
    - coalesce((
      select sum(panela.peso_kg)
      from public.panelas_holding panela
      join public.corridas_fusao corrida on corrida.id = panela.holding_corrida_id
      where corrida.forno_id = p_forno_id
    ), 0)
    + coalesce((
      select sum(panela.peso_kg)
      from public.panelas_holding panela
      where panela.status = 'RETORNADA' and panela.retorno_forno_id = p_forno_id
    ), 0);
$$;

notify pgrst, 'reload schema';

commit;
