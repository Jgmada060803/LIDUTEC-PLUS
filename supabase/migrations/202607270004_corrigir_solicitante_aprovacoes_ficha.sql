begin;

alter table public.aprovacoes_ficha
  alter column solicitante_id set default auth.uid();

create or replace function public.preencher_solicitante_aprovacao()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
begin
  new.solicitante_id:=coalesce(new.solicitante_id,auth.uid());
  if new.solicitante_id is null then
    raise exception 'Não foi possível identificar o solicitante autenticado.'
      using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists preencher_solicitante_aprovacao
  on public.aprovacoes_ficha;
create trigger preencher_solicitante_aprovacao
before insert on public.aprovacoes_ficha
for each row execute function public.preencher_solicitante_aprovacao();

revoke all on function public.preencher_solicitante_aprovacao()
  from public,anon,authenticated;

commit;
