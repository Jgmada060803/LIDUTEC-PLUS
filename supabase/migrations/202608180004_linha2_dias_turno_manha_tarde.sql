-- A Linha 2 do Acabamento não roda os 3 turnos todos os dias da semana:
-- Manhã segunda a sábado (não domingo), Tarde segunda a sexta (não sábado
-- nem domingo), Noite segunda a quinta (não sexta, sábado nem domingo —
-- já corrigido em 202608180003, aqui só estende pra Manhã e Tarde também).
create or replace function public.linha_2_ativa_acabamento(p_data_operacional date, p_turno text)
returns boolean
language sql
stable
as $function$
  select case p_turno
    when 'MANHA' then extract(dow from p_data_operacional)::int not in (0)
    when 'TARDE' then extract(dow from p_data_operacional)::int not in (0,6)
    when 'NOITE' then extract(dow from p_data_operacional)::int not in (0,5,6)
    else true
  end
$function$;
