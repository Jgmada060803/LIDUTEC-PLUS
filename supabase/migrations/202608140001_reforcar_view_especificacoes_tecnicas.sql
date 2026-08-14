begin;

-- Advisor de segurança do Supabase apontou "Security Definer View": esta view
-- roda com os privilégios do dono (postgres, superusuário), ignorando RLS por
-- completo — a única trava era o WHERE com usuario_tem_permissao_ficha().
-- O anon tinha SELECT concedido nela (só não vazava nada hoje porque a função
-- retorna false sem usuário logado). Revoga o acesso do anon e faz a view
-- rodar com os privilégios de quem consulta (security_invoker), não do dono,
-- pra não depender só dessa checagem interna.
revoke select on public.export_especificacoes_tecnicas from anon;

alter view public.export_especificacoes_tecnicas set (security_invoker = true);

commit;
