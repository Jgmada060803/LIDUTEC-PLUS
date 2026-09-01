-- Bug: retorno de panela rejeitada creditava o saldo do forno destino
-- (volume_atual_forno_fusao) mas não tinha onde aparecer no card quando
-- esse forno não tinha corrida aberta no momento — o operador via o saldo
-- mudar sem explicação nenhuma ("o retorno não está aparecendo no card do
-- Fusor!"). A causa raiz: retorno_forno_id só aponta pro FORNO, não pra
-- uma corrida específica, então não dava pra saber em qual card (se algum)
-- mostrar a linha sem correr o risco de contar o mesmo retorno duas vezes
-- (uma vez "solto" e de novo já embutido no peso_inicial da próxima
-- corrida, que já nasce = volume_atual_forno_fusao no momento da criação).
-- Correção: retorno passa a exigir corrida aberta no destino, igual já
-- funciona pra transferência — assim sempre tem uma corrida certa (e só
-- uma) pra exibir a linha, sem ambiguidade nem contagem dupla.
alter table public.panelas_holding
  add column retorno_corrida_destino_id bigint references public.corridas_fusao(id);

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

  select id into v_corrida_destino_aberta from public.corridas_fusao where forno_id = p_forno_destino_id and status = 'ABERTA';
  if v_corrida_destino_aberta is null then
    raise exception 'O forno destino não tem corrida aberta.';
  end if;

  update public.panelas_holding
  set status = 'RETORNADA', retorno_forno_id = p_forno_destino_id, retorno_corrida_destino_id = v_corrida_destino_aberta,
      atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format(
    'Panela Nº %s (rejeitada) retornou para o forno %s (%s kg)', v_panela.sequencial, v_forno.codigo, v_panela.peso_kg
  ));

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_corrida_destino_aberta, auth.uid(), format(
    'recebeu retorno de panela rejeitada (Nº %s, %s kg)', v_panela.sequencial, v_panela.peso_kg
  ));
end;
$$;
