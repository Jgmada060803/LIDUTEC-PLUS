begin;

-- Cor da mensagem depende de onde foi digitada — Ponte (operador da ponte
-- rolante) ou Supervisor (card do forno / corrida.html). Guardado na hora
-- de enviar, não inferido pelo perfil do usuário (o mesmo usuário pode
-- acessar as duas telas).
alter table public.corridas_fusao_mensagens
  add column if not exists origem text not null default 'SUPERVISOR' check (origem in ('PONTE','SUPERVISOR'));

create or replace function public.enviar_mensagem_corrida_fusao(p_corrida_id bigint, p_mensagem text, p_origem text default 'SUPERVISOR')
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id bigint;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_ponte')) then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if not exists(select 1 from public.corridas_fusao where id = p_corrida_id) then
    raise exception 'Corrida não encontrada.';
  end if;
  if coalesce(trim(p_mensagem), '') = '' then raise exception 'Escreva uma mensagem.'; end if;
  if p_origem not in ('PONTE','SUPERVISOR') then raise exception 'Origem de mensagem inválida.'; end if;
  insert into public.corridas_fusao_mensagens(corrida_id, autor_id, mensagem, origem)
  values (p_corrida_id, auth.uid(), trim(p_mensagem), p_origem)
  returning id into v_id;
  return v_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
