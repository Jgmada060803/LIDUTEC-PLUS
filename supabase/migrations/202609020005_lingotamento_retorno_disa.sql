-- Etapa 9 do roadmap da Fusão: lingotamento da sobra do vazamento. Mesmo
-- mecanismo da panela rejeitada — quem decide o destino (forno ou "BLOCO",
-- quando não volta pra nenhum forno) é o operador da Fusão, não o do
-- Vazamento — só que aqui ele também informa o peso real que sobrou,
-- porque (diferente da rejeição) não é o peso da panela inteira.
-- Consumo teórico e perda ficam gravados (nunca só a diferença), pra
-- auditoria: teórico = peso da panela − moldes vazados × peso do cacho.

alter table public.panelas_holding
  add column peso_retorno_teorico_kg numeric,
  add column peso_lingote_real_kg numeric,
  add column peso_lingote_perda_kg numeric,
  add column lingote_forno_destino_id bigint references public.fornos_fusao(id),
  add column lingote_corrida_destino_id bigint references public.corridas_fusao(id),
  add column lingote_definido_em timestamptz,
  add column lingote_definido_por uuid;

-- Panelas vazadas aguardando o operador da Fusão definir o lingotamento.
create or replace function public.panelas_aguardando_lingotamento()
returns table (
  id bigint, sequencial integer, sequencial_vazamento integer, peso_kg numeric,
  quantidade_moldes integer, peso_retorno_teorico_kg numeric,
  produto_codigo text, holding_codigo text, corrida_codigo text
)
language sql stable
set search_path=pg_catalog,public as $$
  select
    p.id, p.sequencial, p.sequencial_vazamento, p.peso_kg, p.quantidade_moldes,
    p.peso_kg - coalesce(p.quantidade_moldes, 0) * coalesce(pr.peso_cacho_kg, 0) as peso_retorno_teorico_kg,
    pr.codigo, f.codigo, c.codigo
  from public.panelas_holding p
  join public.produtos pr on pr.id = p.produto_id
  join public.corridas_fusao c on c.id = p.holding_corrida_id
  join public.fornos_fusao f on f.id = c.forno_id
  where p.status = 'VAZADA' and p.lingote_definido_em is null
  order by p.hora_fim_vazamento asc;
$$;

grant execute on function public.panelas_aguardando_lingotamento() to authenticated;

-- Registra o lingotamento: recalcula o teórico no servidor (não confia no
-- que o cliente mandou), grava o peso real e a perda, e credita o saldo
-- do forno destino quando não for "BLOCO" — mesma lógica de
-- registrar_retorno_panela_holding, só que sem mudar o status da panela
-- (ela continua VAZADA; o lingotamento é um fato a mais sobre ela, não
-- uma transição de status).
create or replace function public.registrar_lingotamento_panela(
  p_panela_id bigint, p_peso_real numeric, p_forno_destino_id bigint default null
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_peso_cacho numeric;
  v_teorico numeric;
  v_forno record;
  v_corrida_destino bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para definir o destino do lingotamento.';
  end if;
  if p_peso_real is null or p_peso_real < 0 then raise exception 'Informe o peso real do lingote.'; end if;

  select * into v_panela from public.panelas_holding where id = p_panela_id for update;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status <> 'VAZADA' then raise exception 'Só é possível lingotar uma panela já vazada.'; end if;
  if v_panela.lingote_definido_em is not null then raise exception 'O lingotamento desta panela já foi definido.'; end if;

  select peso_cacho_kg into v_peso_cacho from public.produtos where id = v_panela.produto_id;
  v_teorico := v_panela.peso_kg - coalesce(v_panela.quantidade_moldes, 0) * coalesce(v_peso_cacho, 0);

  if p_forno_destino_id is not null then
    select * into v_forno from public.fornos_fusao where id = p_forno_destino_id and ativo;
    if not found then raise exception 'Forno de destino inválido.'; end if;
    select id into v_corrida_destino from public.corridas_fusao where forno_id = p_forno_destino_id and status = 'ABERTA';
    if v_corrida_destino is null then raise exception 'O forno destino não tem corrida aberta.'; end if;
  end if;

  update public.panelas_holding
  set peso_retorno_teorico_kg = v_teorico,
    peso_lingote_real_kg = p_peso_real,
    peso_lingote_perda_kg = v_teorico - p_peso_real,
    lingote_forno_destino_id = p_forno_destino_id,
    lingote_corrida_destino_id = v_corrida_destino,
    lingote_definido_em = now(), lingote_definido_por = auth.uid(),
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  if p_forno_destino_id is not null then
    insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
    values (v_corrida_destino, auth.uid(), format(
      'recebeu lingotamento da panela Nº %s (Vazamento V%s, %s kg)',
      v_panela.sequencial, v_panela.sequencial_vazamento, p_peso_real
    ));
  end if;
end;
$$;

grant execute on function public.registrar_lingotamento_panela(bigint,numeric,bigint) to authenticated;

-- Credita o saldo do forno com o lingotamento (mesma ideia do retorno de
-- panela rejeitada — "afinal é a mesma coisa").
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
      where panela.retorno_forno_id = p_forno_id and panela.status = 'RETORNADA'
    ), 0)
    + coalesce((
      select sum(panela.peso_lingote_real_kg)
      from public.panelas_holding panela
      where panela.lingote_forno_destino_id = p_forno_id
    ), 0);
$$;
