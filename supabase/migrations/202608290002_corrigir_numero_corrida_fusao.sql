begin;

-- Correção manual pontual do número de uma corrida (o número normal
-- continua 100% automático — isso é só pra um usuário autorizado corrigir
-- um erro depois). Bloqueia duplicidade real (mesmo número no mesmo ciclo
-- do forno); avisos de "pulou número" ficam a cargo do front antes de
-- chamar (confirmação com o operador). Registra a troca em
-- corridas_fusao_alteracoes (auditoria: número anterior, novo, motivo).
create or replace function public.corrigir_numero_corrida_fusao(
  p_corrida_id bigint, p_novo_numero integer, p_motivo text
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_forno record;
  v_ciclo record;
  v_numero_anterior integer;
  v_novo_codigo text;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.editar') then
    raise exception 'Usuário sem permissão para corrigir corridas de fusão.';
  end if;
  if p_novo_numero is null or p_novo_numero <= 0 then
    raise exception 'Informe um número de corrida válido.';
  end if;

  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;

  if v_corrida.numero_sequencia = p_novo_numero then return; end if;

  if exists(
    select 1 from public.corridas_fusao
    where ciclo_refratario_id = v_corrida.ciclo_refratario_id
      and numero_sequencia = p_novo_numero and id <> p_corrida_id
  ) then
    raise exception 'Já existe uma corrida com esse número neste ciclo do forno.';
  end if;

  select * into v_forno from public.fornos_fusao where id = v_corrida.forno_id;
  select * into v_ciclo from public.ciclos_refratario_fusao where id = v_corrida.ciclo_refratario_id;

  v_numero_anterior := v_corrida.numero_sequencia;
  v_novo_codigo := v_forno.codigo || lpad(v_ciclo.numero_ciclo::text, 3, '0') || lpad(p_novo_numero::text, 3, '0');

  update public.corridas_fusao
  set numero_sequencia = p_novo_numero, codigo = v_novo_codigo,
    versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (p_corrida_id, auth.uid(), format('corrigiu o número da corrida de %s para %s%s',
    v_numero_anterior, p_novo_numero,
    case when p_motivo is not null and length(trim(p_motivo)) > 0 then ' — motivo: ' || trim(p_motivo) else '' end));
end;
$$;

revoke all on function public.corrigir_numero_corrida_fusao(bigint,integer,text) from public, anon;
grant execute on function public.corrigir_numero_corrida_fusao(bigint,integer,text) to authenticated;

notify pgrst, 'reload schema';

commit;
