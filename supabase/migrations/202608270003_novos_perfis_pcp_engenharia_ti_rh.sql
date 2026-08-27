begin;

-- Novos perfis de usuário: PCP, Engenharia, TI e RH. Sem permissão
-- nenhuma pré-anexada (mesmo padrão de perfil novo) — o acesso de cada
-- usuário se configura normalmente pela tela Administração → Usuários →
-- "Configurar acesso".
alter table public.usuarios drop constraint if exists usuarios_perfil_check;
alter table public.usuarios add constraint usuarios_perfil_check
  check (perfil = any (array[
    'ADMINISTRADOR','GERENTE_ENGENHARIA','GERENTE_PRODUCAO','GERENTE_QUALIDADE',
    'GERENTE_MANUTENCAO','GERENTE_GERAL','TECNICO_ENGENHARIA','COORDENADOR_PRODUCAO',
    'PCM','FUSAO','MOLDAGEM','VAZAMENTO','MACHARIA','ACABAMENTO','REFUGO',
    'ASSISTENTE_TECNICO','CLIENTE','OP_PONTE_ROLANTE','PCP','ENGENHARIA','TI','RH'
  ]));

insert into public.perfis(codigo,nome,descricao,ativo) values
  ('PCP','PCP','Planejamento e Controle da Produção.',true),
  ('ENGENHARIA','Engenharia','Equipe de Engenharia.',true),
  ('TI','TI','Tecnologia da Informação.',true),
  ('RH','RH','Recursos Humanos.',true)
on conflict(codigo) do update set nome=excluded.nome, descricao=excluded.descricao, ativo=true;

notify pgrst, 'reload schema';

commit;
