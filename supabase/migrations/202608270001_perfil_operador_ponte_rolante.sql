begin;

-- Novo perfil "OP. Ponte Rolante" — acesso restrito só à tela da Ponte
-- (pesagem de entregas); não visualiza nem lança nada nas outras telas do
-- módulo (planejamento, corrida, troca de refratário).
alter table public.usuarios drop constraint if exists usuarios_perfil_check;
alter table public.usuarios add constraint usuarios_perfil_check
  check (perfil = any (array[
    'ADMINISTRADOR','GERENTE_ENGENHARIA','GERENTE_PRODUCAO','GERENTE_QUALIDADE',
    'GERENTE_MANUTENCAO','GERENTE_GERAL','TECNICO_ENGENHARIA','COORDENADOR_PRODUCAO',
    'PCM','FUSAO','MOLDAGEM','VAZAMENTO','MACHARIA','ACABAMENTO','REFUGO',
    'ASSISTENTE_TECNICO','CLIENTE','OP_PONTE_ROLANTE'
  ]));

insert into public.perfis(codigo,nome,descricao,ativo)
values ('OP_PONTE_ROLANTE','OP. Ponte Rolante','Operador de ponte rolante — lança pesagem só na tela da Ponte da Fusão.',true)
on conflict(codigo) do update set nome=excluded.nome, descricao=excluded.descricao, ativo=true;

-- Permissão nova e restrita: só pesa na Ponte — não abre/fecha/cancela/
-- transfere corrida, não edita planejado, não inclui material.
insert into public.permissoes(codigo,nome,descricao,modulo,ativo)
select 'producao_fusao.lancar_ponte','Lançar pesagem na Ponte (Fusão)',
  'Só registra entrega de material na tela da Ponte — não acessa planejamento, corrida nem transferência.','PRODUCAO',true
where not exists(select 1 from public.permissoes where codigo='producao_fusao.lancar_ponte');

insert into public.perfil_permissoes(perfil_id,permissao_id)
select perfil.id, permissao.id
from public.perfis perfil, public.permissoes permissao
where perfil.codigo='OP_PONTE_ROLANTE' and permissao.codigo='producao_fusao.lancar_ponte'
on conflict do nothing;

-- RPC de pesagem passa a aceitar a permissão restrita também.
create or replace function public.adicionar_pesagem_carga_fusao(
  p_corrida_id bigint, p_material_id bigint, p_quantidade_kg numeric
) returns numeric language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_total numeric;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_ponte')) then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_quantidade_kg, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  update public.corridas_fusao_carga_itens
  set quantidade_realizada_kg = coalesce(quantidade_realizada_kg, 0) + p_quantidade_kg,
    atualizado_por = auth.uid(), atualizado_em = now()
  where corrida_id = p_corrida_id and id = p_material_id
  returning quantidade_realizada_kg into v_total;
  if not found then raise exception 'Item de carga não encontrado nesta corrida.'; end if;
  insert into public.corridas_fusao_pesagens_ponte_log(item_id, corrida_id, quantidade_kg, registrado_por)
  values (p_material_id, p_corrida_id, p_quantidade_kg, auth.uid());
  return v_total;
end;
$$;

-- Log de entregas da Ponte precisa ser legível por quem só tem a
-- permissão restrita (senão a lista "quem lançou" fica sempre vazia pra
-- esse perfil).
drop policy if exists corridas_fusao_pesagens_ponte_log_select on public.corridas_fusao_pesagens_ponte_log;
create policy corridas_fusao_pesagens_ponte_log_select on public.corridas_fusao_pesagens_ponte_log
  for select to authenticated using (
    public.usuario_tem_permissao_producao_fusao('producao_fusao.visualizar')
    or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_ponte')
  );

notify pgrst, 'reload schema';

commit;
