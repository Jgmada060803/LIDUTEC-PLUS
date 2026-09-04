-- Resolve alerta "Security Definer View" do Supabase (Critical). Views
-- rodam por padrão com o privilégio de quem criou, não de quem consulta.
-- Aqui não muda comportamento nenhum: a RLS de fornos_fusao já é
-- "auth.uid() is not null" (qualquer usuário logado vê tudo), então
-- rodar com o privilégio de quem consulta dá o mesmo resultado.
alter view public.fornos_fusao_volume_atual set (security_invoker = true);
