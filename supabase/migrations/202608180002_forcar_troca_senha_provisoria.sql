-- Obriga quem recebeu senha provisória (conta sem e-mail próprio) a trocar
-- a senha no primeiro login, antes de acessar o resto do sistema.

alter table public.usuarios
  add column deve_trocar_senha boolean not null default false;

-- Só o próprio usuário logado pode limpar a própria flag (auth.uid(), não
-- aceita id de fora) — chamado por redefinir-senha.html depois de trocar a
-- senha com sucesso. Não existe policy de UPDATE em usuarios pra usuário
-- comum, por isso precisa dessa ponte.
create or replace function public.limpar_flag_trocar_senha()
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  update public.usuarios set deve_trocar_senha = false where id = auth.uid();
$function$;

revoke all on function public.limpar_flag_trocar_senha() from public;
grant execute on function public.limpar_flag_trocar_senha() to authenticated;

notify pgrst, 'reload schema';
