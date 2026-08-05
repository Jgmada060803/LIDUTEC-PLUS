begin;

delete from public.registros_producao_moldes
where data_operacional is null
   or inicio is null
   or fim is null;

commit;
