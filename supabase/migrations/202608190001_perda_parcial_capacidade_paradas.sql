begin;

-- ==========================================================================
-- Perda parcial de capacidade (Macharia e Jato/Acabamento)
-- ==========================================================================
-- Hoje toda parada representa 100% de perda no intervalo. Passa a existir um
-- segundo tipo de ocorrência: PARCIAL, quando só parte dos componentes do
-- equipamento (estações da Macharia, turbinas do Jato) fica indisponível — a
-- máquina continua produzindo, então o tempo perdido usado nos indicadores é
-- só a fração equivalente, não o intervalo inteiro.
--
-- duracao_minutos continua guardando a duração REAL do intervalo (inicio/fim)
-- como sempre guardou — histórico não muda. O novo
-- tempo_perdido_equivalente_minutos é o valor que os indicadores (disponibi-
-- lidade/OEE) devem somar no lugar de duracao_minutos. Para ocorrências TOTAL
-- (todo registro existente, e todo registro novo que não usar a opção) os
-- dois valores são iguais — comportamento atual preservado.
--
-- O total de componentes NÃO é duplicado por parada: é lido do próprio
-- equipamento (linhas_maquinas_producao.numero_estacoes já existe pra
-- Macharia; postos_equipamentos_acabamento ganha numero_turbinas aqui pro
-- Jato) no momento do fechamento/edição do turno, junto com o cálculo —
-- mesma arquitetura já usada por duracao_minutos (calculado no INSERT das
-- RPCs de fechar/editar turno, não em trigger nem em JS).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Número de turbinas por equipamento avulso do Acabamento (só onde aplicável
-- — Jato 1 e Jato 2 têm 4 turbinas cada, Jato Gancheira tem 3; correias e VS
-- automática ficam null, ou seja, sem opção de capacidade reduzida).
-- --------------------------------------------------------------------------
alter table public.postos_equipamentos_acabamento
  add column if not exists numero_turbinas integer check (numero_turbinas is null or numero_turbinas > 0);

update public.postos_equipamentos_acabamento set numero_turbinas = 4 where codigo in ('JATO_1','JATO_2');
update public.postos_equipamentos_acabamento set numero_turbinas = 3 where codigo = 'JATO_GANCHEIRA';

-- --------------------------------------------------------------------------
-- Função única que calcula o tempo perdido equivalente — reutilizada pelas
-- RPCs de Macharia e Acabamento, é a única fonte da fórmula matemática
-- (duração × indisponíveis / totais). TOTAL (ou dados incompletos) sempre
-- cai no comportamento atual: 100% da duração perdida.
-- --------------------------------------------------------------------------
create or replace function public.parada_tempo_perdido_equivalente(
  p_duracao_minutos integer,
  p_tipo_ocorrencia text,
  p_componentes_indisponiveis integer,
  p_componentes_totais integer
) returns integer
language sql immutable
as $$
  select case
    when p_tipo_ocorrencia = 'PARCIAL'
      and p_componentes_totais is not null and p_componentes_totais > 0
      and p_componentes_indisponiveis is not null and p_componentes_indisponiveis > 0
    then round((coalesce(p_duracao_minutos,0)::numeric * p_componentes_indisponiveis) / p_componentes_totais)::integer
    else coalesce(p_duracao_minutos, 0)
  end
$$;

-- --------------------------------------------------------------------------
-- paradas_producao_macharia — novas colunas + backfill (registros antigos
-- viram TOTAL com tempo perdido = duração real, igual ao comportamento
-- histórico já aplicado a eles).
-- --------------------------------------------------------------------------
alter table public.paradas_producao_macharia
  add column if not exists tipo_ocorrencia text not null default 'TOTAL',
  add column if not exists componentes_indisponiveis integer,
  add column if not exists tempo_perdido_equivalente_minutos integer;

-- O backfill é um UPDATE em massa rodado como migração, sem auth.uid() de um
-- usuário real logado — desabilita o trigger de validação de acesso à área
-- só para esse UPDATE, mesmo padrão já usado na migração de 2026-08-17.
alter table public.paradas_producao_macharia disable trigger validar_area_parada_macharia;
update public.paradas_producao_macharia
  set tempo_perdido_equivalente_minutos = duracao_minutos
  where tempo_perdido_equivalente_minutos is null;
alter table public.paradas_producao_macharia enable trigger validar_area_parada_macharia;

alter table public.paradas_producao_macharia
  alter column tempo_perdido_equivalente_minutos set not null;

alter table public.paradas_producao_macharia
  add constraint paradas_macharia_tipo_ocorrencia_check check (tipo_ocorrencia in ('TOTAL','PARCIAL')),
  add constraint paradas_macharia_componentes_indisponiveis_check check (componentes_indisponiveis is null or componentes_indisponiveis > 0),
  add constraint paradas_macharia_tipo_componentes_check check (
    (tipo_ocorrencia = 'TOTAL' and componentes_indisponiveis is null) or
    (tipo_ocorrencia = 'PARCIAL' and componentes_indisponiveis is not null)
  ),
  add constraint paradas_macharia_tempo_perdido_check check (tempo_perdido_equivalente_minutos >= 0);

-- --------------------------------------------------------------------------
-- paradas_producao_acabamento — mesmas 3 colunas + backfill.
-- --------------------------------------------------------------------------
alter table public.paradas_producao_acabamento
  add column if not exists tipo_ocorrencia text not null default 'TOTAL',
  add column if not exists componentes_indisponiveis integer,
  add column if not exists tempo_perdido_equivalente_minutos integer;

alter table public.paradas_producao_acabamento disable trigger validar_area_parada_acabamento;
update public.paradas_producao_acabamento
  set tempo_perdido_equivalente_minutos = duracao_minutos
  where tempo_perdido_equivalente_minutos is null;
alter table public.paradas_producao_acabamento enable trigger validar_area_parada_acabamento;

alter table public.paradas_producao_acabamento
  alter column tempo_perdido_equivalente_minutos set not null;

alter table public.paradas_producao_acabamento
  add constraint paradas_acabamento_tipo_ocorrencia_check check (tipo_ocorrencia in ('TOTAL','PARCIAL')),
  add constraint paradas_acabamento_componentes_indisponiveis_check check (componentes_indisponiveis is null or componentes_indisponiveis > 0),
  add constraint paradas_acabamento_tipo_componentes_check check (
    (tipo_ocorrencia = 'TOTAL' and componentes_indisponiveis is null) or
    (tipo_ocorrencia = 'PARCIAL' and componentes_indisponiveis is not null)
  ),
  add constraint paradas_acabamento_tempo_perdido_check check (tempo_perdido_equivalente_minutos >= 0);

-- ==========================================================================
-- RPCs — mesma assinatura de sempre (nada muda pro chamador que não usar os
-- campos novos dentro de cada item de p_paradas); só o INSERT em
-- paradas_producao_* passa a gravar tipo_ocorrencia/componentes_indisponiveis
-- vindos do JSON e a calcular tempo_perdido_equivalente_minutos via
-- public.parada_tempo_perdido_equivalente(...), com o total de componentes
-- lido do próprio equipamento (linha.numero_estacoes / posto.numero_turbinas).
-- Uma parada PARCIAL sem componentes válidos (fora de 1..totais-1, ou
-- equipamento sem suporte a capacidade reduzida) é rejeitada como inválida —
-- mesmo padrão de validação já usado pras demais colunas destas RPCs.
-- ==========================================================================

create or replace function public.fechar_turno_producao_macharia(
  p_data_operacional date, p_turno text, p_linha_maquina_id bigint,
  p_producoes jsonb default '[]'::jsonb, p_paradas jsonb default '[]'::jsonb,
  p_descartes jsonb default '[]'::jsonb, p_versao bigint default null::bigint
)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_turno public.turnos_producao_macharia%rowtype;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_macharia('producao_macharia.lancar') then
    raise exception 'Usuário sem permissão para fechar o turno.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if not exists (
    select 1 from public.linhas_maquinas_producao lm
    join public.areas_checklist a on a.id = lm.area_id
    where lm.id = p_linha_maquina_id and a.codigo = 'MACHARIA' and lm.ativo
  ) then
    raise exception 'Máquina inválida ou fora da área de Macharia.';
  end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos um lançamento de sopro.'; end if;

  insert into public.turnos_producao_macharia(data_operacional,turno,linha_maquina_id,status,criado_por)
  values(p_data_operacional,p_turno,p_linha_maquina_id,'ABERTO',auth.uid())
  on conflict(data_operacional,turno,linha_maquina_id) do nothing;

  select * into v_turno from public.turnos_producao_macharia
  where data_operacional=p_data_operacional and turno=p_turno and linha_maquina_id=p_linha_maquina_id for update;
  if v_turno.status='FECHADO' then raise exception 'Este turno já foi fechado.'; end if;
  if p_versao is not null and p_versao<>v_turno.versao then
    raise exception 'CONFLITO_RASCUNHO: o turno foi atualizado por outro usuário.' using errcode='40001';
  end if;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_macharia(turno_producao_id,linha_maquina_id,estacao,data_operacional,turno,horario_previsto,macho_id,quantidade_sopros,criado_por)
  select v_turno.id,item.linha_id,item.estacao,p_data_operacional,p_turno,item.horario_previsto,item.macho_id,item.quantidade_sopros,auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(linha_id bigint,estacao integer,horario_previsto timestamptz,macho_id bigint,quantidade_sopros integer)
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id and item.estacao between 1 and linha.numero_estacoes
  join public.machos_macharia macho on macho.id=item.macho_id and macho.status='APROVADO'
  where coalesce(item.quantidade_sopros,0)>=0 and item.horario_previsto is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Um ou mais lançamentos são inválidos (máquina, estação ou macho).'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_macharia(
    turno_producao_id,linha_maquina_id,data_operacional,turno,categoria_id,setor_responsavel_id,motivo,
    inicio,fim,duracao_minutos,tipo_ocorrencia,componentes_indisponiveis,tempo_perdido_equivalente_minutos,
    observacao,criado_por
  )
  select v_turno.id,sub.linha_id,p_data_operacional,p_turno,sub.categoria_id,sub.setor_id,sub.categoria_nome,
    sub.inicio,sub.fim,sub.duracao_minutos,sub.tipo_ocorrencia,
    case when sub.tipo_ocorrencia='PARCIAL' then sub.componentes_indisponiveis else null end,
    public.parada_tempo_perdido_equivalente(sub.duracao_minutos,sub.tipo_ocorrencia,sub.componentes_indisponiveis,sub.numero_estacoes),
    nullif(trim(sub.observacao),''),auth.uid()
  from (
    select item.linha_id,item.inicio,item.fim,item.setor_id,item.categoria_id,categoria.nome as categoria_nome,item.observacao,
      coalesce(item.tipo_ocorrencia,'TOTAL') as tipo_ocorrencia,item.componentes_indisponiveis,
      round(extract(epoch from(item.fim-item.inicio))/60)::integer as duracao_minutos,linha.numero_estacoes
    from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
      linha_id bigint,inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,observacao text,
      tipo_ocorrencia text,componentes_indisponiveis integer
    )
    join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
    join public.linhas_maquinas_producao linha on linha.id=item.linha_id
    where item.inicio is not null and item.fim is not null and item.fim>=item.inicio and item.setor_id is not null
  ) sub
  where sub.tipo_ocorrencia in ('TOTAL','PARCIAL')
    and (sub.tipo_ocorrencia='TOTAL' or (sub.componentes_indisponiveis between 1 and greatest(sub.numero_estacoes-1,0)));
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados ou horários inválidos, ou a condição de capacidade reduzida é inválida para a máquina.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_descartes,'[]'::jsonb));
  insert into public.descartes_producao_macharia(turno_producao_id,linha_maquina_id,data_operacional,turno,macho_id,quantidade_descartada,observacao,criado_por)
  select v_turno.id,item.linha_id,p_data_operacional,p_turno,item.macho_id,item.quantidade_descartada,nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_descartes,'[]'::jsonb)) as item(linha_id bigint,macho_id bigint,quantidade_descartada integer,observacao text)
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  join public.machos_macharia macho on macho.id=item.macho_id
  where coalesce(item.quantidade_descartada,0)>0;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Um ou mais descartes possuem máquina ou macho inválidos.'; end if;

  update public.turnos_producao_macharia set
    status='FECHADO',fechado_por=auth.uid(),fechado_em=now(),
    rascunho_producoes='[]'::jsonb,rascunho_paradas='[]'::jsonb,rascunho_descartes='[]'::jsonb,
    versao=versao+1,atualizado_por=auth.uid(),atualizado_em=now()
  where id=v_turno.id;
  return v_turno.id;
end;
$function$;

create or replace function public.editar_turno_producao_macharia(
  p_turno_id bigint,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb,
  p_descartes jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_macharia%rowtype;
  v_anteriores jsonb;
  v_novos jsonb;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_macharia('producao_macharia.editar') then
    raise exception 'Usuário sem permissão para editar turnos fechados.';
  end if;
  select * into v_turno from public.turnos_producao_macharia where id=p_turno_id and status='FECHADO' for update;
  if not found then raise exception 'Turno fechado não encontrado.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos um lançamento de sopro.'; end if;

  select jsonb_build_object(
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'turno_producao_id'-'criado_por'-'criado_em' order by linha_maquina_id,estacao,horario_previsto) from public.registros_producao_macharia registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'turno_producao_id'-'criado_por'-'criado_em' order by linha_maquina_id,inicio) from public.paradas_producao_macharia parada where turno_producao_id=p_turno_id),'[]'::jsonb),
    'discards',coalesce((select jsonb_agg(to_jsonb(descarte)-'id'-'turno_producao_id'-'criado_por'-'criado_em' order by linha_maquina_id,macho_id) from public.descartes_producao_macharia descarte where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_anteriores;

  delete from public.registros_producao_macharia where turno_producao_id=p_turno_id;
  delete from public.paradas_producao_macharia where turno_producao_id=p_turno_id;
  delete from public.descartes_producao_macharia where turno_producao_id=p_turno_id;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_macharia(turno_producao_id,linha_maquina_id,estacao,data_operacional,turno,horario_previsto,macho_id,quantidade_sopros,criado_por)
  select v_turno.id,item.linha_id,item.estacao,v_turno.data_operacional,v_turno.turno,item.horario_previsto,item.macho_id,item.quantidade_sopros,auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(linha_id bigint,estacao integer,horario_previsto timestamptz,macho_id bigint,quantidade_sopros integer)
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id and item.estacao between 1 and linha.numero_estacoes
  join public.machos_macharia macho on macho.id=item.macho_id and macho.status='APROVADO'
  where coalesce(item.quantidade_sopros,0)>=0 and item.horario_previsto is not null;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Um ou mais lançamentos são inválidos (máquina, estação ou macho).'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_macharia(
    turno_producao_id,linha_maquina_id,data_operacional,turno,categoria_id,setor_responsavel_id,motivo,
    inicio,fim,duracao_minutos,tipo_ocorrencia,componentes_indisponiveis,tempo_perdido_equivalente_minutos,
    observacao,criado_por
  )
  select v_turno.id,sub.linha_id,v_turno.data_operacional,v_turno.turno,sub.categoria_id,sub.setor_id,sub.categoria_nome,
    sub.inicio,sub.fim,sub.duracao_minutos,sub.tipo_ocorrencia,
    case when sub.tipo_ocorrencia='PARCIAL' then sub.componentes_indisponiveis else null end,
    public.parada_tempo_perdido_equivalente(sub.duracao_minutos,sub.tipo_ocorrencia,sub.componentes_indisponiveis,sub.numero_estacoes),
    nullif(trim(sub.observacao),''),auth.uid()
  from (
    select item.linha_id,item.inicio,item.fim,item.setor_id,item.categoria_id,categoria.nome as categoria_nome,item.observacao,
      coalesce(item.tipo_ocorrencia,'TOTAL') as tipo_ocorrencia,item.componentes_indisponiveis,
      round(extract(epoch from(item.fim-item.inicio))/60)::integer as duracao_minutos,linha.numero_estacoes
    from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
      inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,linha_id bigint,observacao text,
      tipo_ocorrencia text,componentes_indisponiveis integer
    )
    join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
    join public.linhas_maquinas_producao linha on linha.id=item.linha_id
    where item.inicio is not null and item.fim is not null and item.fim>=item.inicio and item.setor_id is not null
  ) sub
  where sub.tipo_ocorrencia in ('TOTAL','PARCIAL')
    and (sub.tipo_ocorrencia='TOTAL' or (sub.componentes_indisponiveis between 1 and greatest(sub.numero_estacoes-1,0)));
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados ou horários inválidos, ou a condição de capacidade reduzida é inválida para a máquina.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_descartes,'[]'::jsonb));
  insert into public.descartes_producao_macharia(turno_producao_id,linha_maquina_id,data_operacional,turno,macho_id,quantidade_descartada,observacao,criado_por)
  select v_turno.id,item.linha_id,v_turno.data_operacional,v_turno.turno,item.macho_id,item.quantidade_descartada,nullif(trim(item.observacao),''),auth.uid()
  from jsonb_to_recordset(coalesce(p_descartes,'[]'::jsonb)) as item(linha_id bigint,macho_id bigint,quantidade_descartada integer,observacao text)
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  join public.machos_macharia macho on macho.id=item.macho_id
  where coalesce(item.quantidade_descartada,0)>0;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Um ou mais descartes possuem máquina ou macho inválidos.'; end if;

  select jsonb_build_object(
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'turno_producao_id'-'criado_por'-'criado_em' order by linha_maquina_id,estacao,horario_previsto) from public.registros_producao_macharia registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'turno_producao_id'-'criado_por'-'criado_em' order by linha_maquina_id,inicio) from public.paradas_producao_macharia parada where turno_producao_id=p_turno_id),'[]'::jsonb),
    'discards',coalesce((select jsonb_agg(to_jsonb(descarte)-'id'-'turno_producao_id'-'criado_por'-'criado_em' order by linha_maquina_id,macho_id) from public.descartes_producao_macharia descarte where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_novos;

  if v_anteriores=v_novos then raise exception 'Nenhuma alteração foi identificada.'; end if;

  update public.turnos_producao_macharia set atualizado_por=auth.uid(),atualizado_em=now() where id=v_turno.id;

  insert into public.historico_edicoes_turno_macharia(
    turno_producao_id,descricao,dados_anteriores,dados_novos,alterado_por
  ) values (
    p_turno_id,'os apontamentos do turno',v_anteriores,v_novos,auth.uid()
  );
  return p_turno_id;
end;
$$;

create or replace function public.fechar_turno_producao_acabamento(
  p_data_operacional date,
  p_turno text,
  p_linhas jsonb default '[]'::jsonb,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb,
  p_versao bigint default null
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_acabamento%rowtype;
  v_area_id bigint;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_acabamento('producao_acabamento.lancar') then
    raise exception 'Usuário sem permissão para fechar o turno.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos uma linha de produção.'; end if;
  if jsonb_array_length(coalesce(p_linhas,'[]'::jsonb))=0 then raise exception 'Informe os operadores presentes de ao menos uma linha.'; end if;

  select id into v_area_id from public.areas_checklist where codigo='ACABAMENTO';

  insert into public.turnos_producao_acabamento(data_operacional,turno,status,criado_por)
  values(p_data_operacional,p_turno,'ABERTO',auth.uid())
  on conflict(data_operacional,turno) do nothing;

  select * into v_turno from public.turnos_producao_acabamento
  where data_operacional=p_data_operacional and turno=p_turno for update;
  if v_turno.status='FECHADO' then raise exception 'Este turno já foi fechado.'; end if;
  if p_versao is not null and p_versao<>v_turno.versao then
    raise exception 'CONFLITO_RASCUNHO: o turno foi atualizado por outro usuário.' using errcode='40001';
  end if;

  insert into public.turnos_acabamento_linhas(turno_producao_id,linha_maquina_id,operadores_planejados,operadores_presentes)
  select v_turno.id,item.linha_id,
    public.meta_vigente(v_area_id,item.linha_id,p_turno,'OPERADORES_PLANEJADOS',p_data_operacional),
    item.operadores_presentes
  from jsonb_to_recordset(coalesce(p_linhas,'[]'::jsonb)) as item(linha_id bigint,operadores_presentes integer)
  on conflict(turno_producao_id,linha_maquina_id) do update set
    operadores_planejados=excluded.operadores_planejados,
    operadores_presentes=excluded.operadores_presentes;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_acabamento(turno_producao_id,linha_maquina_id,data_operacional,turno,produto_id,quantidade_liberada,quantidade_rejeitada,quantidade_retrabalhada,quantidade_refugada,criado_por)
  select v_turno.id,item.linha_id,p_data_operacional,p_turno,item.produto_id,item.quantidade_liberada,item.quantidade_rejeitada,item.quantidade_retrabalhada,item.quantidade_refugada,auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(linha_id bigint,produto_id bigint,quantidade_liberada integer,quantidade_rejeitada integer,quantidade_retrabalhada integer,quantidade_refugada integer)
  join public.produtos produto on produto.id=item.produto_id
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  where coalesce(item.quantidade_liberada,0)>=0 and coalesce(item.quantidade_rejeitada,0)>=0
    and coalesce(item.quantidade_retrabalhada,0)>=0 and coalesce(item.quantidade_refugada,0)>=0;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais linhas de produção são inválidas ou possuem produto/linha inexistente.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_acabamento(
    turno_producao_id,data_operacional,turno,setor_origem_id,categoria_id,posto_equipamento_id,
    inicio,fim,duracao_minutos,tipo_ocorrencia,componentes_indisponiveis,tempo_perdido_equivalente_minutos,
    observacao,criado_por
  )
  select v_turno.id,p_data_operacional,p_turno,sub.setor_id,sub.categoria_id,sub.posto_id,
    sub.inicio,sub.fim,sub.duracao_minutos,sub.tipo_ocorrencia,
    case when sub.tipo_ocorrencia='PARCIAL' then sub.componentes_indisponiveis else null end,
    public.parada_tempo_perdido_equivalente(sub.duracao_minutos,sub.tipo_ocorrencia,sub.componentes_indisponiveis,sub.numero_turbinas),
    nullif(trim(sub.observacao),''),auth.uid()
  from (
    select item.inicio,item.fim,item.setor_id,item.categoria_id,item.posto_id,item.observacao,
      coalesce(item.tipo_ocorrencia,'TOTAL') as tipo_ocorrencia,item.componentes_indisponiveis,
      round(extract(epoch from(item.fim-item.inicio))/60)::integer as duracao_minutos,posto.numero_turbinas
    from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
      inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,posto_id bigint,observacao text,
      tipo_ocorrencia text,componentes_indisponiveis integer
    )
    join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
    join public.setores_responsaveis_parada setor on setor.id=item.setor_id
    join public.postos_equipamentos_acabamento posto on posto.id=item.posto_id
    where item.inicio is not null and item.fim is not null and item.fim>=item.inicio
  ) sub
  where sub.tipo_ocorrencia in ('TOTAL','PARCIAL')
    and (sub.tipo_ocorrencia='TOTAL' or (sub.numero_turbinas is not null and sub.componentes_indisponiveis between 1 and greatest(sub.numero_turbinas-1,0)));
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados, horários ou posto/equipamento inválidos, ou a condição de capacidade reduzida é inválida para o equipamento.'; end if;

  update public.turnos_producao_acabamento set
    status='FECHADO',fechado_por=auth.uid(),fechado_em=now(),
    rascunho_producoes='[]'::jsonb,rascunho_paradas='[]'::jsonb,rascunho_linhas='[]'::jsonb,
    versao=versao+1,atualizado_por=auth.uid(),atualizado_em=now()
  where id=v_turno.id;
  return v_turno.id;
end;
$$;

create or replace function public.editar_turno_producao_acabamento(
  p_turno_id bigint,
  p_linhas jsonb default '[]'::jsonb,
  p_producoes jsonb default '[]'::jsonb,
  p_paradas jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_turno public.turnos_producao_acabamento%rowtype;
  v_anteriores jsonb;
  v_novos jsonb;
  v_esperado integer;
  v_inserido integer;
begin
  if not public.usuario_tem_permissao_producao_acabamento('producao_acabamento.editar') then
    raise exception 'Usuário sem permissão para editar turnos fechados.';
  end if;
  select * into v_turno from public.turnos_producao_acabamento where id=p_turno_id and status='FECHADO' for update;
  if not found then raise exception 'Turno fechado não encontrado.'; end if;
  if jsonb_array_length(coalesce(p_producoes,'[]'::jsonb))=0 then raise exception 'Informe ao menos uma linha de produção.'; end if;

  select jsonb_build_object(
    'linhas',coalesce((select jsonb_agg(jsonb_build_object('linha_id',linha_maquina_id,'operadores_presentes',operadores_presentes) order by linha_maquina_id) from public.turnos_acabamento_linhas where turno_producao_id=p_turno_id),'[]'::jsonb),
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by linha_maquina_id,produto_id) from public.registros_producao_acabamento registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.paradas_producao_acabamento parada where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_anteriores;

  delete from public.paradas_producao_acabamento where turno_producao_id=p_turno_id;
  delete from public.registros_producao_acabamento where turno_producao_id=p_turno_id;

  insert into public.turnos_acabamento_linhas(turno_producao_id,linha_maquina_id,operadores_planejados,operadores_presentes)
  select v_turno.id,item.linha_id,
    (select operadores_planejados from public.turnos_acabamento_linhas where turno_producao_id=v_turno.id and linha_maquina_id=item.linha_id),
    item.operadores_presentes
  from jsonb_to_recordset(coalesce(p_linhas,'[]'::jsonb)) as item(linha_id bigint,operadores_presentes integer)
  on conflict(turno_producao_id,linha_maquina_id) do update set operadores_presentes=excluded.operadores_presentes;

  v_esperado:=jsonb_array_length(coalesce(p_producoes,'[]'::jsonb));
  insert into public.registros_producao_acabamento(turno_producao_id,linha_maquina_id,data_operacional,turno,produto_id,quantidade_liberada,quantidade_rejeitada,quantidade_retrabalhada,quantidade_refugada,criado_por)
  select v_turno.id,item.linha_id,v_turno.data_operacional,v_turno.turno,item.produto_id,item.quantidade_liberada,item.quantidade_rejeitada,item.quantidade_retrabalhada,item.quantidade_refugada,auth.uid()
  from jsonb_to_recordset(coalesce(p_producoes,'[]'::jsonb)) as item(linha_id bigint,produto_id bigint,quantidade_liberada integer,quantidade_rejeitada integer,quantidade_retrabalhada integer,quantidade_refugada integer)
  join public.produtos produto on produto.id=item.produto_id
  join public.linhas_maquinas_producao linha on linha.id=item.linha_id
  where coalesce(item.quantidade_liberada,0)>=0 and coalesce(item.quantidade_rejeitada,0)>=0
    and coalesce(item.quantidade_retrabalhada,0)>=0 and coalesce(item.quantidade_refugada,0)>=0;
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais linhas de produção são inválidas ou possuem produto/linha inexistente.'; end if;

  v_esperado:=jsonb_array_length(coalesce(p_paradas,'[]'::jsonb));
  insert into public.paradas_producao_acabamento(
    turno_producao_id,data_operacional,turno,setor_origem_id,categoria_id,posto_equipamento_id,
    inicio,fim,duracao_minutos,tipo_ocorrencia,componentes_indisponiveis,tempo_perdido_equivalente_minutos,
    observacao,criado_por
  )
  select v_turno.id,v_turno.data_operacional,v_turno.turno,sub.setor_id,sub.categoria_id,sub.posto_id,
    sub.inicio,sub.fim,sub.duracao_minutos,sub.tipo_ocorrencia,
    case when sub.tipo_ocorrencia='PARCIAL' then sub.componentes_indisponiveis else null end,
    public.parada_tempo_perdido_equivalente(sub.duracao_minutos,sub.tipo_ocorrencia,sub.componentes_indisponiveis,sub.numero_turbinas),
    nullif(trim(sub.observacao),''),auth.uid()
  from (
    select item.inicio,item.fim,item.setor_id,item.categoria_id,item.posto_id,item.observacao,
      coalesce(item.tipo_ocorrencia,'TOTAL') as tipo_ocorrencia,item.componentes_indisponiveis,
      round(extract(epoch from(item.fim-item.inicio))/60)::integer as duracao_minutos,posto.numero_turbinas
    from jsonb_to_recordset(coalesce(p_paradas,'[]'::jsonb)) as item(
      inicio timestamptz,fim timestamptz,setor_id bigint,categoria_id bigint,posto_id bigint,observacao text,
      tipo_ocorrencia text,componentes_indisponiveis integer
    )
    join public.categorias_parada_producao categoria on categoria.id=item.categoria_id
    join public.setores_responsaveis_parada setor on setor.id=item.setor_id
    join public.postos_equipamentos_acabamento posto on posto.id=item.posto_id
    where item.inicio is not null and item.fim is not null and item.fim>=item.inicio
  ) sub
  where sub.tipo_ocorrencia in ('TOTAL','PARCIAL')
    and (sub.tipo_ocorrencia='TOTAL' or (sub.numero_turbinas is not null and sub.componentes_indisponiveis between 1 and greatest(sub.numero_turbinas-1,0)));
  get diagnostics v_inserido=row_count;
  if v_inserido<>v_esperado then raise exception 'Uma ou mais paradas possuem dados, horários ou posto/equipamento inválidos, ou a condição de capacidade reduzida é inválida para o equipamento.'; end if;

  select jsonb_build_object(
    'linhas',coalesce((select jsonb_agg(jsonb_build_object('linha_id',linha_maquina_id,'operadores_presentes',operadores_presentes) order by linha_maquina_id) from public.turnos_acabamento_linhas where turno_producao_id=p_turno_id),'[]'::jsonb),
    'productions',coalesce((select jsonb_agg(to_jsonb(registro)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by linha_maquina_id,produto_id) from public.registros_producao_acabamento registro where turno_producao_id=p_turno_id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(parada)-'id'-'turno_producao_id'-'criado_por'-'criado_em'-'atualizado_por'-'atualizado_em' order by inicio) from public.paradas_producao_acabamento parada where turno_producao_id=p_turno_id),'[]'::jsonb)
  ) into v_novos;

  if v_anteriores = v_novos then
    raise exception 'Nenhuma alteração foi identificada.';
  end if;

  update public.turnos_producao_acabamento set atualizado_por=auth.uid(),atualizado_em=now() where id=v_turno.id;

  insert into public.historico_edicoes_turno_acabamento(
    turno_producao_id,descricao,dados_anteriores,dados_novos,alterado_por
  ) values (
    p_turno_id,'os apontamentos do turno',v_anteriores,v_novos,auth.uid()
  );
  return p_turno_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
