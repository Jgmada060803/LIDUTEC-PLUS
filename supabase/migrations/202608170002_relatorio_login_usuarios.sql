-- Relatório de login (data/hora, IP, dispositivo) por usuário, restrito a
-- quem tem a permissão de administrador (usuarios.gerenciar_acessos, a mesma
-- já usada em "Áreas operacionais"). auth.sessions não é exposta via
-- PostgREST diretamente, por isso a ponte via função no schema public.

create or replace function public.relatorio_login_usuarios(
  p_desde timestamptz default null,
  p_ate timestamptz default null
)
returns table (
  usuario_id uuid,
  nome text,
  email text,
  login_em timestamptz,
  ip text,
  user_agent text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not public.usuario_tem_permissao_sistema('usuarios.gerenciar_acessos') then
    raise exception 'Usuário sem permissão para ver o relatório de login.';
  end if;

  return query
  select u.id, u.nome, u.email, s.created_at, s.ip::text, s.user_agent
  from auth.sessions s
  join public.usuarios u on u.id = s.user_id
  where (p_desde is null or s.created_at >= p_desde)
    and (p_ate is null or s.created_at <= p_ate)
  order by s.created_at desc
  limit 2000;
end;
$function$;

revoke all on function public.relatorio_login_usuarios(timestamptz, timestamptz) from public;
grant execute on function public.relatorio_login_usuarios(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
