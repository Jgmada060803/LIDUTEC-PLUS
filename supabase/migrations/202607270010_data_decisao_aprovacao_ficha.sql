begin;

alter table public.aprovacoes_ficha
  add column if not exists decidido_em timestamptz;

-- Instalações antigas não possuem necessariamente uma coluna de criação.
-- O preenchimento histórico usa a primeira coluna de data disponível.
do $$
declare
  v_coluna_data text;
begin
  select atributo.attname
  into v_coluna_data
  from pg_catalog.pg_attribute atributo
  where atributo.attrelid='public.aprovacoes_ficha'::regclass
    and atributo.attname in (
      'atualizado_em',
      'criado_em',
      'data_decisao',
      'data_aprovacao'
    )
    and atributo.attnum>0
    and not atributo.attisdropped
  order by case atributo.attname
    when 'atualizado_em' then 1
    when 'data_decisao' then 2
    when 'data_aprovacao' then 3
    else 4
  end
  limit 1;

  if v_coluna_data is not null then
    execute format(
      'update public.aprovacoes_ficha
       set decidido_em=%I
       where status<>''PENDENTE''
         and decidido_em is null',
      v_coluna_data
    );
  end if;
end;
$$;

create or replace function public.registrar_data_decisao_aprovacao()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if old.status='PENDENTE' and new.status<>'PENDENTE' then
    new.decidido_em:=coalesce(new.decidido_em,now());
  end if;
  return new;
end;
$$;

drop trigger if exists registrar_data_decisao_aprovacao
  on public.aprovacoes_ficha;
create trigger registrar_data_decisao_aprovacao
before update of status on public.aprovacoes_ficha
for each row execute function public.registrar_data_decisao_aprovacao();

revoke all on function public.registrar_data_decisao_aprovacao()
  from public,anon,authenticated;

commit;
