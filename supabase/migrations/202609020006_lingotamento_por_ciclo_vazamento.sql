-- Correção de modelo: lingotamento não é por panela, é por CICLO de
-- vazamento (várias panelas tratadas se misturam na mesma panela
-- vazadora, num processo contínuo). O operador do Vazamento decide A
-- HORA de lingotar (quando um problema interrompe o ciclo) — nesse
-- momento o sistema calcula sozinho o peso teórico que sobrou (enviado
-- desde o último lingotamento − consumo teórico das panelas vazadas
-- nesse intervalo) e avisa a Fusão. A Fusão define o forno destino (ou
-- "BLOCO") e o peso REAL lingotado (medido depois).
-- Desfaz o modelo por-panela da migração anterior (sem dados reais ainda).

drop function if exists public.registrar_lingotamento_panela(bigint, numeric, bigint);
drop function if exists public.panelas_aguardando_lingotamento();

alter table public.panelas_holding
  drop column if exists peso_retorno_teorico_kg,
  drop column if exists peso_lingote_real_kg,
  drop column if exists peso_lingote_perda_kg,
  drop column if exists lingote_forno_destino_id,
  drop column if exists lingote_corrida_destino_id,
  drop column if exists lingote_definido_em,
  drop column if exists lingote_definido_por;

create table public.lingotamentos_vazamento (
  id bigint generated always as identity primary key,
  ciclo_inicio timestamptz not null,
  ciclo_fim timestamptz not null,
  peso_enviado_kg numeric not null,
  peso_consumido_teorico_kg numeric not null,
  peso_teorico_kg numeric not null,
  peso_real_kg numeric,
  forno_destino_id bigint references public.fornos_fusao(id),
  corrida_destino_id bigint references public.corridas_fusao(id),
  definido_em timestamptz,
  definido_por uuid,
  criado_em timestamptz not null default now(),
  criado_por uuid not null
);

alter table public.lingotamentos_vazamento enable row level security;
create policy lingotamentos_vazamento_select on public.lingotamentos_vazamento
  for select using (auth.uid() is not null);

-- Fecha o ciclo atual: soma peso enviado (panelas vazadas desde o fim do
-- último ciclo) e o consumo teórico (moldes × peso do cacho) delas,
-- grava a diferença como o teórico do lingote e devolve pro Vazamento
-- já mostrar na hora.
create or replace function public.iniciar_lingotamento_vazamento()
returns table(id bigint, ciclo_inicio timestamptz, ciclo_fim timestamptz, peso_enviado_kg numeric, peso_consumido_teorico_kg numeric, peso_teorico_kg numeric)
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_ciclo_inicio timestamptz;
  v_ciclo_fim timestamptz := now();
  v_enviado numeric;
  v_consumido numeric;
  v_id bigint;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;

  select coalesce(max(l.ciclo_fim), '-infinity'::timestamptz) into v_ciclo_inicio
  from public.lingotamentos_vazamento l;

  select coalesce(sum(p.peso_kg), 0), coalesce(sum(p.quantidade_moldes * pr.peso_cacho_kg), 0)
  into v_enviado, v_consumido
  from public.panelas_holding p
  join public.produtos pr on pr.id = p.produto_id
  where p.status = 'VAZADA' and p.hora_fim_vazamento > v_ciclo_inicio and p.hora_fim_vazamento <= v_ciclo_fim;

  if coalesce(v_enviado, 0) = 0 then
    raise exception 'Nenhuma panela vazada desde o último lingotamento — nada para lingotar.';
  end if;

  insert into public.lingotamentos_vazamento(
    ciclo_inicio, ciclo_fim, peso_enviado_kg, peso_consumido_teorico_kg, peso_teorico_kg, criado_por
  ) values (
    v_ciclo_inicio, v_ciclo_fim, v_enviado, v_consumido, v_enviado - v_consumido, auth.uid()
  ) returning lingotamentos_vazamento.id into v_id;

  return query select l.id, l.ciclo_inicio, l.ciclo_fim, l.peso_enviado_kg, l.peso_consumido_teorico_kg, l.peso_teorico_kg
    from public.lingotamentos_vazamento l where l.id = v_id;
end;
$$;

grant execute on function public.iniciar_lingotamento_vazamento() to authenticated;

-- Lingotamentos aguardando o operador da Fusão definir forno (ou BLOCO) e
-- o peso real medido.
create or replace function public.lingotamentos_aguardando_definicao()
returns table(id bigint, ciclo_inicio timestamptz, ciclo_fim timestamptz, peso_enviado_kg numeric, peso_consumido_teorico_kg numeric, peso_teorico_kg numeric)
language sql stable
set search_path=pg_catalog,public as $$
  select id, ciclo_inicio, ciclo_fim, peso_enviado_kg, peso_consumido_teorico_kg, peso_teorico_kg
  from public.lingotamentos_vazamento
  where definido_em is null
  order by ciclo_fim asc;
$$;

grant execute on function public.lingotamentos_aguardando_definicao() to authenticated;

create or replace function public.registrar_lingotamento_vazamento(
  p_lingotamento_id bigint, p_peso_real numeric, p_forno_destino_id bigint default null
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_lingotamento record;
  v_forno record;
  v_corrida_destino bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para definir o destino do lingotamento.';
  end if;
  if p_peso_real is null or p_peso_real < 0 then raise exception 'Informe o peso real lingotado.'; end if;

  select * into v_lingotamento from public.lingotamentos_vazamento where id = p_lingotamento_id for update;
  if not found then raise exception 'Lingotamento não encontrado.'; end if;
  if v_lingotamento.definido_em is not null then raise exception 'Este lingotamento já foi definido.'; end if;

  if p_forno_destino_id is not null then
    select * into v_forno from public.fornos_fusao where id = p_forno_destino_id and ativo;
    if not found then raise exception 'Forno de destino inválido.'; end if;
    select id into v_corrida_destino from public.corridas_fusao where forno_id = p_forno_destino_id and status = 'ABERTA';
    if v_corrida_destino is null then raise exception 'O forno destino não tem corrida aberta.'; end if;
  end if;

  update public.lingotamentos_vazamento
  set peso_real_kg = p_peso_real, forno_destino_id = p_forno_destino_id, corrida_destino_id = v_corrida_destino,
    definido_em = now(), definido_por = auth.uid()
  where id = p_lingotamento_id;

  if p_forno_destino_id is not null then
    insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
    values (v_corrida_destino, auth.uid(), format(
      'recebeu lingotamento do Vazamento (ciclo %s–%s, %s kg)',
      to_char(v_lingotamento.ciclo_inicio, 'HH24:MI'), to_char(v_lingotamento.ciclo_fim, 'HH24:MI'), p_peso_real
    ));
  end if;
end;
$$;

grant execute on function public.registrar_lingotamento_vazamento(bigint,numeric,bigint) to authenticated;

-- Histórico de lingotamentos, pro Vazamento acompanhar (horário, teórico,
-- real, forno destino) — leitura, quem decide é sempre a Fusão.
create or replace function public.lingotamentos_recentes(p_limite integer default 20)
returns table(
  id bigint, ciclo_inicio timestamptz, ciclo_fim timestamptz, peso_teorico_kg numeric,
  peso_real_kg numeric, definido_em timestamptz, forno_destino_codigo text
)
language sql stable
set search_path=pg_catalog,public as $$
  select l.id, l.ciclo_inicio, l.ciclo_fim, l.peso_teorico_kg, l.peso_real_kg, l.definido_em, f.codigo
  from public.lingotamentos_vazamento l
  left join public.fornos_fusao f on f.id = l.forno_destino_id
  order by l.ciclo_fim desc
  limit p_limite;
$$;

grant execute on function public.lingotamentos_recentes(integer) to authenticated;

-- Retorno Disa: credita o saldo do forno com o lingotamento definido pra
-- ele — mesma ideia do retorno de panela rejeitada.
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
      select sum(l.peso_real_kg)
      from public.lingotamentos_vazamento l
      where l.forno_destino_id = p_forno_id
    ), 0);
$$;
