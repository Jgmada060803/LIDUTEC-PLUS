-- A Linha 2 do Acabamento não opera o turno da Noite em sexta, sábado e
-- domingo. A função só excluía sexta (5) e domingo (0); faltava sábado (6).
create or replace function public.linha_2_ativa_acabamento(p_data_operacional date, p_turno text)
returns boolean
language sql
stable
as $function$
  select not (p_turno = 'NOITE' and extract(dow from p_data_operacional)::int in (0,5,6))
$function$;
