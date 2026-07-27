begin;

-- As permissões foram criadas no fluxo de importação, mas não foram
-- vinculadas aos perfis responsáveis pelas decisões.
insert into public.perfil_permissoes (perfil_id, permissao_id)
select perfil.id, permissao.id
from public.perfis perfil
join public.permissoes permissao
  on (
    permissao.codigo = 'ficha.aprovar_engenharia'
    and upper(perfil.codigo) in (
      'ADMIN',
      'ADMINISTRADOR',
      'GERENTE_GERAL',
      'GERENTE_ENGENHARIA'
    )
  ) or (
    permissao.codigo = 'ficha.aprovar_producao'
    and upper(perfil.codigo) in (
      'ADMIN',
      'ADMINISTRADOR',
      'GERENTE_GERAL',
      'GERENTE_PRODUCAO',
      'COORDENADOR_PRODUCAO'
    )
  )
where perfil.ativo = true
  and permissao.ativo = true
  and not exists (
    select 1
    from public.perfil_permissoes perfil_permissao
    where perfil_permissao.perfil_id = perfil.id
      and perfil_permissao.permissao_id = permissao.id
  );

commit;
