-- Suporte a contas de operador sem e-mail próprio: o administrador define
-- uma senha provisória na hora do cadastro (em vez de mandar convite por
-- e-mail) e o endereço @metalsider.com.br fica só como identificador de
-- login. Precisamos marcar essas contas pra que o fluxo de "esqueci minha
-- senha" (que depende de e-mail chegar em algum lugar) não tente mandar um
-- link que nunca vai ser visto — em vez disso, avisa pra procurar o
-- administrador.

alter table public.usuarios
  add column sem_email_proprio boolean not null default false;

-- Callable por anon (a pessoa ainda não está logada na tela de "esqueci
-- minha senha"). Não confirma se a conta existe ou não pra quem não tem
-- sem_email_proprio=true — só sinaliza quando sabe, com certeza, que é uma
-- conta sem e-mail de verdade. Pra qualquer outro caso (conta normal ou
-- e-mail desconhecido) retorna true, mantendo a mensagem genérica atual.
create or replace function public.usuario_tem_email_proprio(p_email text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(
    (select not sem_email_proprio from public.usuarios where lower(email) = lower(p_email) limit 1),
    true
  );
$function$;

revoke all on function public.usuario_tem_email_proprio(text) from public;
grant execute on function public.usuario_tem_email_proprio(text) to anon, authenticated;

notify pgrst, 'reload schema';
