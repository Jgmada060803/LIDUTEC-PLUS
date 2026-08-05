begin;

create table if not exists public.backup_registros_producao_sem_data_20260805
(like public.registros_producao_moldes including all);

insert into public.backup_registros_producao_sem_data_20260805
select * from public.registros_producao_moldes
where data_operacional is null
   or inicio is null
   or fim is null
on conflict (id) do nothing;

delete from public.registros_producao_moldes
where data_operacional is null
   or inicio is null
   or fim is null;

alter table public.registros_producao_moldes
  alter column inicio set not null,
  alter column fim set not null;

commit;
