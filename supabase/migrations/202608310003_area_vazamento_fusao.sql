begin;

-- Etapa 7: área do Vazamento (fila + sequencial próprio + apontamento).
-- Reaproveita o perfil VAZAMENTO já cadastrado (hoje só com permissões de
-- checklist/IT) em vez de criar um perfil novo — mesmo padrão do
-- OP_PONTE_ROLANTE, só que concedendo a permissão pro perfil que já existe.
insert into public.permissoes(codigo,nome,descricao,modulo,ativo)
select 'producao_fusao.lancar_vazamento','Lançar vazamento (Fusão)',
  'Só vê a fila de panelas aguardando e registra o apontamento do vazamento — não acessa planejamento, corrida, Ponte nem Holding.','PRODUCAO',true
where not exists(select 1 from public.permissoes where codigo='producao_fusao.lancar_vazamento');

insert into public.perfil_permissoes(perfil_id, permissao_id)
select perfil.id, permissao.id
from public.perfis perfil, public.permissoes permissao
where perfil.codigo='VAZAMENTO' and permissao.codigo='producao_fusao.lancar_vazamento'
on conflict do nothing;

-- Sequencial próprio da vazadora (só preenchido no apontamento — panela
-- rejeitada antes do vazamento nunca chega a ganhar um número); dados do
-- apontamento em si; e a diferenciação "CE medido nesta panela" x
-- "último CE disponível" (referência herdada, nunca medida de fato aqui).
alter table public.panelas_holding
  add column if not exists sequencial_vazamento integer unique,
  add column if not exists ce_medido_nesta_panela boolean not null default false,
  add column if not exists hora_inicio_vazamento timestamptz,
  add column if not exists hora_fim_vazamento timestamptz,
  add column if not exists temperatura_vazamento_c numeric,
  add column if not exists molde_inicial integer,
  add column if not exists molde_final integer,
  add column if not exists quantidade_moldes integer;

create or replace function public.apontar_vazamento_panela(
  p_panela_id bigint, p_inicio timestamptz, p_fim timestamptz, p_temperatura_c numeric,
  p_molde_inicial integer, p_molde_final integer, p_ce_medido numeric default null
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_sequencia integer;
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

  select coalesce(max(sequencial_vazamento), 0) + 1 into v_sequencia from public.panelas_holding;

  update public.panelas_holding
  set status = 'VAZADA', sequencial_vazamento = v_sequencia,
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
    'vazou a panela Nº %s do Holding (sequencial vazamento %s) — moldes %s a %s (%s moldes)',
    v_panela.sequencial, v_sequencia, p_molde_inicial, p_molde_final, p_molde_final - p_molde_inicial + 1
  ));
end;
$$;

revoke all on function public.apontar_vazamento_panela(bigint,timestamptz,timestamptz,numeric,integer,integer,numeric) from public, anon;
grant execute on function public.apontar_vazamento_panela(bigint,timestamptz,timestamptz,numeric,integer,integer,numeric) to authenticated;

-- CE editado direto na tabela do Holding também conta como "medido" —
-- alguém digitou o valor de propósito, não é mais só a referência herdada.
create or replace function public.atualizar_campo_panela_holding(
  p_panela_id bigint, p_campo text, p_valor numeric
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_anterior numeric;
  v_label text;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if p_campo not in (
    'peso_kg','temperatura_c','carbono_equivalente','fesimg_liga1_kg','fesimg_liga4_kg',
    'inoculante_kg','silicio_kg','grafite_kg','sucata_cobertura_kg'
  ) then
    raise exception 'Campo inválido.';
  end if;
  if p_campo = 'peso_kg' and coalesce(p_valor, 0) <= 0 then
    raise exception 'Peso precisa ser maior que zero.';
  end if;

  v_label := case p_campo
    when 'peso_kg' then 'o peso'
    when 'temperatura_c' then 'a temperatura'
    when 'carbono_equivalente' then 'o CE'
    when 'fesimg_liga1_kg' then 'o FeSiMg Liga 1'
    when 'fesimg_liga4_kg' then 'o FeSiMg Liga 4'
    when 'inoculante_kg' then 'o inoculante'
    when 'silicio_kg' then 'o silício'
    when 'grafite_kg' then 'o grafite'
    else 'a sucata de cobertura'
  end;
  v_anterior := case p_campo
    when 'peso_kg' then v_panela.peso_kg
    when 'temperatura_c' then v_panela.temperatura_c
    when 'carbono_equivalente' then v_panela.carbono_equivalente
    when 'fesimg_liga1_kg' then v_panela.fesimg_liga1_kg
    when 'fesimg_liga4_kg' then v_panela.fesimg_liga4_kg
    when 'inoculante_kg' then v_panela.inoculante_kg
    when 'silicio_kg' then v_panela.silicio_kg
    when 'grafite_kg' then v_panela.grafite_kg
    else v_panela.sucata_cobertura_kg
  end;

  if p_campo = 'carbono_equivalente' then
    update public.panelas_holding
    set carbono_equivalente = p_valor, ce_medido_nesta_panela = true,
      atualizado_por = auth.uid(), atualizado_em = now()
    where id = p_panela_id;
  else
    execute format('update public.panelas_holding set %I = $1, atualizado_por = auth.uid(), atualizado_em = now() where id = $2', p_campo)
      using p_valor, p_panela_id;
  end if;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format('alterou %s da panela Nº %s de %s para %s',
    v_label, v_panela.sequencial, coalesce(v_anterior::text, '—'), coalesce(p_valor::text, '—')));
end;
$$;

notify pgrst, 'reload schema';

commit;
