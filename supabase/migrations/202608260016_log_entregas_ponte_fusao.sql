begin;

-- Pedido explícito: na tela da Ponte precisa aparecer quem lançou cada
-- entrega, quanto e a que horas — accumulado sozinho não basta pra
-- rastrear quem fez o quê. Cada chamada de adicionar_pesagem_carga_fusao
-- (uma "entrega" pesada na ponte) agora grava uma linha de histórico,
-- além de somar no acumulado como já fazia.
create table if not exists public.corridas_fusao_pesagens_ponte_log (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.corridas_fusao_carga_itens(id) on delete cascade,
  corrida_id bigint not null references public.corridas_fusao(id) on delete cascade,
  quantidade_kg numeric not null,
  registrado_por uuid references public.usuarios(id),
  registrado_em timestamptz not null default now()
);
create index if not exists corridas_fusao_pesagens_ponte_log_item_idx
  on public.corridas_fusao_pesagens_ponte_log(item_id, registrado_em desc);

alter table public.corridas_fusao_pesagens_ponte_log enable row level security;
create policy corridas_fusao_pesagens_ponte_log_select on public.corridas_fusao_pesagens_ponte_log
  for select to authenticated using (public.usuario_tem_permissao_producao_fusao('producao_fusao.visualizar'));

create or replace function public.adicionar_pesagem_carga_fusao(
  p_corrida_id bigint, p_material_id bigint, p_quantidade_kg numeric
) returns numeric language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_total numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
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

notify pgrst, 'reload schema';

commit;
