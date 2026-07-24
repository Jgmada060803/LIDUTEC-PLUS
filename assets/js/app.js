function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getLoginPath() {
  const isInsideSubfolder =
    window.location.pathname.includes("/controle-processo/") ||
    window.location.pathname.includes("/produtos/") ||
    window.location.pathname.includes("/producao/") ||
    window.location.pathname.includes("/producao-moldes/") ||
    window.location.pathname.includes("/qualidade/") ||
    window.location.pathname.includes("/reclamacoes/") ||
    window.location.pathname.includes("/administracao/");

  return isInsideSubfolder
    ? "../login.html"
    : "./login.html";
}

async function requireAuthenticatedUser() {
  const {
    data: { user },
    error
  } = await window.supabaseClient.auth.getUser();

  if (error) {
    console.error("Erro ao verificar usuário autenticado:", error);
  }

  if (!user) {
    window.location.replace(getLoginPath());
    return null;
  }

  return user;
}

async function getCurrentUserProfile(userId) {
  if (!userId) {
    console.error("UUID do usuário não foi informado.");
    return null;
  }

  const maximumAttempts = 5;

  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt += 1
  ) {
    const { data, error } = await window.supabaseClient
      .from("usuarios")
      .select("id, nome, email, perfil, status")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error(
        `Erro ao consultar public.usuarios — tentativa ${attempt}:`,
        error
      );
    }

    if (data) {
      return data;
    }

    if (attempt < maximumAttempts) {
      await wait(400);
    }
  }

  console.error(
    "Usuário autenticado, mas não encontrado em public.usuarios:",
    userId
  );

  return null;
}

async function getUserPermissions(userId) {
  const permissions = new Map();

  if (!userId) {
    return new Set();
  }

  const {
    data: profilePermissions,
    error: profileError
  } = await window.supabaseClient
    .from("usuario_perfis")
    .select(`
      perfis (
        perfil_permissoes (
          permissoes (
            codigo
          )
        )
      )
    `)
    .eq("usuario_id", userId);

  if (profileError) {
    console.error(
      "Erro ao carregar permissões dos perfis:",
      profileError
    );
  }

  for (const relation of profilePermissions ?? []) {
    const profile = relation.perfis;

    for (const item of profile?.perfil_permissoes ?? []) {
      const code = item.permissoes?.codigo;

      if (code) {
        permissions.set(code, true);
      }
    }
  }

  const {
    data: individualPermissions,
    error: individualError
  } = await window.supabaseClient
    .from("usuario_permissoes")
    .select(`
      permitido,
      permissoes (
        codigo
      )
    `)
    .eq("usuario_id", userId);

  if (individualError) {
    console.error(
      "Erro ao carregar permissões individuais:",
      individualError
    );
  }

  for (const item of individualPermissions ?? []) {
    const code = item.permissoes?.codigo;

    if (code) {
      permissions.set(code, item.permitido);
    }
  }

  return new Set(
    [...permissions.entries()]
      .filter(([, allowed]) => allowed)
      .map(([code]) => code)
  );
}

function userHasAnyPermission(
  userPermissions,
  requiredText
) {
  if (!requiredText) {
    return true;
  }

  const requiredPermissions = requiredText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return requiredPermissions.some((permission) =>
    userPermissions.has(permission)
  );
}

function syncSidebarNavigation() {
  const navigation = document.querySelector(".sidebar-nav");

  if (!navigation) {
    return;
  }

  const pathname = window.location.pathname.replace(/\\/g, "/");
  const isDashboard = pathname.endsWith("/pages/dashboard.html");
  const prefix = isDashboard ? "./" : "../";
  const isActive = (section, page = "") => {
    if (section === "dashboard") {
      return isDashboard;
    }

    return pathname.includes(`/pages/${section}/`) &&
      (!page || pathname.endsWith(`/${page}`));
  };
  const activeClass = (active) =>
    `nav-link${active ? " active" : ""}`;

  navigation.innerHTML = `
    <a href="${prefix}dashboard.html"
       class="${activeClass(isActive("dashboard"))}">
      Dashboard
    </a>

    <div class="nav-section">
      <span class="nav-title">Engenharia</span>
      <a href="${prefix}produtos/lista.html"
         class="${activeClass(
           isActive("produtos") &&
           !isActive("produtos", "importar-ficha.html") &&
           !isActive("produtos", "revisoes.html")
         )}"
         data-permission="produto.visualizar">
        Produtos
      </a>
      <a href="${prefix}produtos/revisoes.html"
         class="${activeClass(isActive("produtos", "revisoes.html"))}"
         data-permission="revisao.visualizar_historico">
        Revisões
      </a>
      <a href="${prefix}produtos/importar-ficha.html"
         class="${activeClass(
           isActive("produtos", "importar-ficha.html")
         )}"
         data-permission="ficha.importar,ficha.conferir_importacao,ficha.validar_importacao">
        Importar PDF
      </a>
    </div>

    <div class="nav-section">
      <span class="nav-title">Produção</span>
      <a href="${prefix}controle-processo/lista.html"
         class="${activeClass(isActive("controle-processo"))}"
         data-permission="controle_processo.visualizar">
        Controle de Processo
      </a>
      <a href="${prefix}producao-moldes/index.html"
         class="${activeClass(isActive("producao-moldes"))}"
         data-permission="producao_moldes.visualizar">
        Produção de Moldes
      </a>
    </div>

    <div class="nav-section">
      <span class="nav-title">Qualidade</span>
      <a href="${prefix}reclamacoes/index.html"
         class="${activeClass(isActive("reclamacoes"))}"
         data-permission="reclamacao.visualizar">
        Reclamações do Cliente
      </a>
    </div>

    <div class="nav-section">
      <span class="nav-title">Administração</span>
      <a href="${prefix}administracao/usuarios.html"
         class="${activeClass(isActive("administracao"))}"
         data-permission="usuarios.visualizar">
        Usuários e acessos
      </a>
    </div>
  `;
}

function applyPermissionVisibility(userPermissions) {
  syncSidebarNavigation();

  const protectedElements =
    document.querySelectorAll("[data-permission]");

  for (const element of protectedElements) {
    const requiredText = element.dataset.permission;

    const hasPermission = userHasAnyPermission(
      userPermissions,
      requiredText
    );

    element.hidden = !hasPermission;
  }
}

async function signOut() {
  const { error } =
    await window.supabaseClient.auth.signOut();

  if (error) {
    console.error("Erro ao sair:", error);
  }

  window.location.replace(getLoginPath());
}

window.LIDUTEC_APP = {
  requireAuthenticatedUser,
  getCurrentUserProfile,
  getUserPermissions,
  userHasAnyPermission,
  applyPermissionVisibility,
  signOut
};
