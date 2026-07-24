begin;
insert into public.permissoes (codigo,nome,descricao,modulo,ativo)
select codigo,nome,descricao,'ADMINISTRACAO',true from (values
 ('usuarios.criar','Cadastrar usuários','Convida novos usuários para o LIDUTEC+.'),
 ('usuarios.gerenciar_acessos','Gerenciar acessos','Altera status e perfis de acesso.')
) p(codigo,nome,descricao)
where not exists(select 1 from public.permissoes x where x.codigo=p.codigo);
insert into public.perfil_permissoes(perfil_id,permissao_id)
select pf.id,pe.id from public.perfis pf cross join public.permissoes pe
where (upper(pf.codigo) in('ADMIN','ADMINISTRADOR') or upper(pf.nome)='ADMINISTRADOR')
and pe.codigo in('usuarios.criar','usuarios.gerenciar_acessos')
and not exists(select 1 from public.perfil_permissoes pp where pp.perfil_id=pf.id and pp.permissao_id=pe.id);
commit;
