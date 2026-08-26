begin;

-- Nome já basta como identificação do material (pedido explícito) — remove
-- o campo código, que não tinha uso além de duplicar o nome nas telas.
alter table public.materiais_fusao drop column if exists codigo;
alter table public.materiais_fusao add constraint materiais_fusao_nome_uidx unique (nome);

create or replace function public.salvar_material_fusao(
  p_id bigint, p_nome text, p_tipo text, p_ativo boolean default true,
  p_pct_c numeric default null, p_pct_si numeric default null, p_pct_mn numeric default null,
  p_pct_p numeric default null, p_pct_cr numeric default null, p_pct_s numeric default null,
  p_pct_sn numeric default null, p_pct_cu numeric default null, p_pct_mo numeric default null,
  p_pct_al numeric default null, p_pct_pb numeric default null
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.configurar') then
    raise exception 'Usuário sem permissão para configurar cadastros de fusão.';
  end if;
  if p_tipo not in ('SUCATA','RETORNO','CANAL','LIGA_CORRECAO','OUTRO') then raise exception 'Tipo de material inválido.'; end if;
  if p_id is null then
    insert into public.materiais_fusao(
      nome,tipo,ativo,pct_c,pct_si,pct_mn,pct_p,pct_cr,pct_s,pct_sn,pct_cu,pct_mo,pct_al,pct_pb
    ) values(
      trim(p_nome),p_tipo,coalesce(p_ativo,true),
      p_pct_c,p_pct_si,p_pct_mn,p_pct_p,p_pct_cr,p_pct_s,p_pct_sn,p_pct_cu,p_pct_mo,p_pct_al,p_pct_pb
    )
    returning id into v_id;
  else
    update public.materiais_fusao set
      nome=trim(p_nome),tipo=p_tipo,ativo=coalesce(p_ativo,true),
      pct_c=p_pct_c,pct_si=p_pct_si,pct_mn=p_pct_mn,pct_p=p_pct_p,pct_cr=p_pct_cr,pct_s=p_pct_s,
      pct_sn=p_pct_sn,pct_cu=p_pct_cu,pct_mo=p_pct_mo,pct_al=p_pct_al,pct_pb=p_pct_pb
    where id=p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.salvar_material_fusao(bigint,text,text,boolean,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.salvar_material_fusao(bigint,text,text,boolean,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;
drop function if exists public.salvar_material_fusao(bigint,text,text,text,boolean,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric);

notify pgrst, 'reload schema';

commit;
