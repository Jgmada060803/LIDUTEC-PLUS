-- Reformula a análise térmica do Vazamento: em vez de uma medição "da
-- estação" que valia pra frente até a próxima (o que fazia CE/TL/TSE/TRE/TF
-- aparecerem em panelas onde nenhuma análise foi de fato feita), agora é
-- uma ação por panela — o operador escolhe em qual linha da fila registra,
-- e o valor fica gravado só naquela panela. analises_termicas_vazamento
-- (tabela "rolling" da migração anterior) fica sem uso — não apago pra não
-- perder o que já foi registrado nela, só paro de gravar/ler dali.

alter table public.panelas_holding
  add column carbono_equivalente_vazamento numeric,
  add column carbono_vazamento numeric,
  add column delta_t_vazamento numeric,
  add column analise_vazamento_em timestamptz,
  add column analise_vazamento_por uuid;

alter table public.panelas_holding
  rename column inoculante_vazamento_g to inoculante_vazamento_g_s;

create or replace function public.registrar_analise_termica_panela_vazamento(
  p_panela_id bigint, p_carbono_equivalente numeric, p_carbono numeric, p_delta_t numeric,
  p_temp_liquidus numeric, p_temp_solidus numeric, p_temp_recalescencia_eutetica numeric, p_temp_final numeric
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;
  update public.panelas_holding
  set carbono_equivalente_vazamento = p_carbono_equivalente,
    carbono_vazamento = p_carbono,
    delta_t_vazamento = p_delta_t,
    temp_liquidus_vazamento = p_temp_liquidus,
    temp_solidus_vazamento = p_temp_solidus,
    temp_recalescencia_eutetica_vazamento = p_temp_recalescencia_eutetica,
    temp_final_vazamento = p_temp_final,
    analise_vazamento_em = now(), analise_vazamento_por = auth.uid(),
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;
  if not found then raise exception 'Panela não encontrada.'; end if;
end;
$$;

grant execute on function public.registrar_analise_termica_panela_vazamento(bigint,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;

-- Volta o apontamento do vazamento a só mexer no que é da própria
-- confirmação (início/fim/temperatura/moldes/inoculador) — CE e os demais
-- pontos térmicos saem daqui (viram a ação por panela acima).
drop function if exists public.apontar_vazamento_panela(bigint, timestamptz, timestamptz, numeric, integer, integer, numeric, text, numeric);
create or replace function public.apontar_vazamento_panela(
  p_panela_id bigint, p_inicio timestamptz, p_fim timestamptz, p_temperatura_c numeric,
  p_molde_inicial integer, p_molde_final integer,
  p_inoculador text default null, p_inoculante_g_s numeric default null
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_corrida record;
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
    inoculador_vazamento = p_inoculador, inoculante_vazamento_g_s = p_inoculante_g_s,
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format(
    'vazou a panela Nº %s do Holding (%s-V%s) — moldes %s a %s (%s moldes)',
    v_panela.sequencial, v_codigo_mascarado, v_sequencia, p_molde_inicial, p_molde_final, p_molde_final - p_molde_inicial + 1
  ));
end;
$$;

grant execute on function public.apontar_vazamento_panela(bigint,timestamptz,timestamptz,numeric,integer,integer,text,numeric) to authenticated;
