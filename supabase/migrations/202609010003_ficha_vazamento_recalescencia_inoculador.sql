-- Alinha o Vazamento com a ficha de papel "Controle do Processo de
-- Vazamento": faltavam 2 pontos de análise térmica (Recalescência
-- Eutética/TRE e Temperatura Final/TF) e o inoculador aplicado por molde
-- (MV01 ou MV02, em gramas). Como a análise térmica é uma medição "vale
-- até a próxima" (não por panela), os 4 pontos que aparecem na ficha por
-- linha (TL/TSE/TRE/TF) são congelados na própria panela no momento do
-- vazamento — mesma lógica que o CE já usa (ce_medido_nesta_panela) — pra
-- o histórico não mudar retroativamente quando uma análise nova é feita.

alter table public.analises_termicas_vazamento
  add column temp_recalescencia_eutetica numeric,
  add column temp_final numeric;

alter table public.panelas_holding
  add column temp_liquidus_vazamento numeric,
  add column temp_solidus_vazamento numeric,
  add column temp_recalescencia_eutetica_vazamento numeric,
  add column temp_final_vazamento numeric,
  add column inoculador_vazamento text,
  add column inoculante_vazamento_g numeric,
  add constraint panelas_holding_inoculador_vazamento_check
    check (inoculador_vazamento is null or inoculador_vazamento in ('MV01', 'MV02'));

drop function if exists public.registrar_analise_termica_vazamento(numeric, numeric, numeric, numeric, numeric);
create or replace function public.registrar_analise_termica_vazamento(
  p_carbono_equivalente numeric, p_carbono numeric, p_delta_t numeric, p_temp_liquidus numeric, p_temp_solidus numeric,
  p_temp_recalescencia_eutetica numeric default null, p_temp_final numeric default null
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_id bigint;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;
  insert into public.analises_termicas_vazamento(
    carbono_equivalente, carbono, delta_t, temp_liquidus, temp_solidus,
    temp_recalescencia_eutetica, temp_final, autor_id
  )
  values (
    p_carbono_equivalente, p_carbono, p_delta_t, p_temp_liquidus, p_temp_solidus,
    p_temp_recalescencia_eutetica, p_temp_final, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.apontar_vazamento_panela(bigint, timestamptz, timestamptz, numeric, integer, integer, numeric);
create or replace function public.apontar_vazamento_panela(
  p_panela_id bigint, p_inicio timestamptz, p_fim timestamptz, p_temperatura_c numeric,
  p_molde_inicial integer, p_molde_final integer, p_ce_medido numeric default null,
  p_inoculador text default null, p_inoculante_g numeric default null
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_corrida record;
  v_analise record;
  v_sequencia integer;
  v_dia date;
  v_codigo_mascarado text;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;
  if p_inicio is null or p_fim is null then raise exception 'Informe início e fim do vazamento.'; end if;
  if p_molde_inicial is null or p_molde_final is null then raise exception 'Informe o molde inicial e o final.'; end if;
  if p_molde_final < p_molde_inicial then raise exception 'O molde final não pode ser menor que o inicial.'; end if;
  if p_inoculador is not null and p_inoculador not in ('MV01', 'MV02') then
    raise exception 'Inoculador inválido.';
  end if;

  select * into v_panela from public.panelas_holding where id = p_panela_id for update;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status not in ('SAIDA_HOLDING','EM_TRANSITO') then
    raise exception 'Esta panela não está mais aguardando vazamento.';
  end if;

  select * into v_corrida from public.corridas_fusao where id = v_panela.holding_corrida_id;
  select * into v_analise from public.analises_termicas_vazamento order by medido_em desc limit 1;

  v_dia := p_inicio::date;
  select coalesce(max(sequencial_vazamento), 0) + 1 into v_sequencia
  from public.panelas_holding where vazamento_dia = v_dia;

  v_codigo_mascarado := case
    when length(v_corrida.codigo) <= 6 then v_corrida.codigo
    else left(v_corrida.codigo, length(v_corrida.codigo) - 6)
      || '.' || substr(v_corrida.codigo, length(v_corrida.codigo) - 5, 3)
      || '.' || right(v_corrida.codigo, 3)
  end;

  update public.panelas_holding
  set status = 'VAZADA', sequencial_vazamento = v_sequencia, vazamento_dia = v_dia,
    hora_inicio_vazamento = p_inicio, hora_fim_vazamento = p_fim,
    temperatura_vazamento_c = p_temperatura_c,
    molde_inicial = p_molde_inicial, molde_final = p_molde_final,
    quantidade_moldes = p_molde_final - p_molde_inicial + 1,
    carbono_equivalente = coalesce(p_ce_medido, carbono_equivalente),
    ce_medido_nesta_panela = ce_medido_nesta_panela or (p_ce_medido is not null),
    temp_liquidus_vazamento = v_analise.temp_liquidus,
    temp_solidus_vazamento = v_analise.temp_solidus,
    temp_recalescencia_eutetica_vazamento = v_analise.temp_recalescencia_eutetica,
    temp_final_vazamento = v_analise.temp_final,
    inoculador_vazamento = p_inoculador, inoculante_vazamento_g = p_inoculante_g,
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format(
    'vazou a panela Nº %s do Holding (%s-V%s) — moldes %s a %s (%s moldes)',
    v_panela.sequencial, v_codigo_mascarado, v_sequencia, p_molde_inicial, p_molde_final, p_molde_final - p_molde_inicial + 1
  ));
end;
$$;

grant execute on function public.registrar_analise_termica_vazamento(numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.apontar_vazamento_panela(bigint,timestamptz,timestamptz,numeric,integer,integer,numeric,text,numeric) to authenticated;
