begin;

-- Correção: sequencial da vazadora reinicia por dia (não é mais global) —
-- e passa a formar o identificador junto com o código da corrida, ex.:
-- "H1.052.085-V1". Continua só contando panela efetivamente vazada
-- (rejeitada nunca chega a passar por aqui, já que só apontar_vazamento_
-- panela grava esses campos, e ela exige status aguardando).
alter table public.panelas_holding drop constraint if exists panelas_holding_sequencial_vazamento_key;
alter table public.panelas_holding add column if not exists vazamento_dia date;

update public.panelas_holding
set vazamento_dia = hora_inicio_vazamento::date
where status = 'VAZADA' and vazamento_dia is null and hora_inicio_vazamento is not null;

alter table public.panelas_holding add constraint panelas_holding_sequencial_vazamento_dia_key
  unique (vazamento_dia, sequencial_vazamento);

create or replace function public.apontar_vazamento_panela(
  p_panela_id bigint, p_inicio timestamptz, p_fim timestamptz, p_temperatura_c numeric,
  p_molde_inicial integer, p_molde_final integer, p_ce_medido numeric default null
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
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

  select * into v_panela from public.panelas_holding where id = p_panela_id for update;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status not in ('SAIDA_HOLDING','EM_TRANSITO') then
    raise exception 'Esta panela não está mais aguardando vazamento.';
  end if;

  select * into v_corrida from public.corridas_fusao where id = v_panela.holding_corrida_id;

  v_dia := p_inicio::date;
  select coalesce(max(sequencial_vazamento), 0) + 1 into v_sequencia
  from public.panelas_holding where vazamento_dia = v_dia;

  -- Mesma máscara já usada no front (fusaoCodigoCorridaMascarado):
  -- forno+ciclo(3)+sequência(3) -> "forno.ciclo.sequência".
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
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format(
    'vazou a panela Nº %s do Holding (%s-V%s) — moldes %s a %s (%s moldes)',
    v_panela.sequencial, v_codigo_mascarado, v_sequencia, p_molde_inicial, p_molde_final, p_molde_final - p_molde_inicial + 1
  ));
end;
$$;

notify pgrst, 'reload schema';

commit;
