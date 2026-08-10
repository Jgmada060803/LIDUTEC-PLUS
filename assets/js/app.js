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
    window.location.pathname.includes("/producao-acabamento/") ||
    window.location.pathname.includes("/qualidade/") ||
    window.location.pathname.includes("/reclamacoes/") ||
    window.location.pathname.includes("/clientes/") ||
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

  // As duas consultas são independentes entre si — só a ordem de MERGE abaixo
  // importa (individual sobrescreve perfil), não a ordem de chegada da rede —
  // então buscamos as duas ao mesmo tempo em vez de uma depois da outra.
  const [
    { data: profilePermissions, error: profileError },
    { data: individualPermissions, error: individualError }
  ] = await Promise.all([
    window.supabaseClient
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
      .eq("usuario_id", userId),
    window.supabaseClient
      .from("usuario_permissoes")
      .select(`
        permitido,
        permissoes (
          codigo
        )
      `)
      .eq("usuario_id", userId)
  ]);

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

  const resolvedPermissions = new Set(
    [...permissions.entries()]
      .filter(([, allowed]) => allowed)
      .map(([code]) => code)
  );

  if (resolvedPermissions.has("ficha.visualizar")) {
    resolvedPermissions.add("it.visualizar");
  }

  if (
    resolvedPermissions.has("ficha.criar") ||
    resolvedPermissions.has("ficha.editar_rascunho")
  ) {
    resolvedPermissions.add("it.gerenciar");
  }

  return resolvedPermissions;
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
  const isHome = pathname.endsWith("/pages/inicio.html");
  const isProcessDashboard = pathname.endsWith("/pages/dashboard-processo.html");
  const prefix = isDashboard || isHome || isProcessDashboard ? "./" : "../";
  const isActive = (section, page = "") => {
    if (section === "dashboard") {
      return isDashboard;
    }

    return pathname.includes(`/pages/${section}/`) &&
      (!page || pathname.endsWith(`/${page}`));
  };
  const activeClass = (active) =>
    `nav-link${active ? " active" : ""}`;
  const slugify = (text) =>
    text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const navSection = (title, linksHtml) => {
    const slug = slugify(title);
    return `
    <div class="nav-section" data-section="${slug}">
      <button type="button" class="nav-title nav-section-toggle" data-section-toggle="${slug}" aria-expanded="false">
        <span>${title}</span><span class="nav-section-icon" aria-hidden="true">›</span>
      </button>
      <div class="nav-section-links" data-section-links="${slug}" hidden>${linksHtml}</div>
    </div>`;
  };

  navigation.innerHTML = `
    <a href="${prefix}inicio.html"
       class="${activeClass(isHome)}">
      Início
    </a>
    <a href="${prefix}dashboard.html"
       class="${activeClass(isActive("dashboard"))}">
      Dashboard
    </a>

    ${navSection("Engenharia", `
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
      <a href="${prefix}clientes/index.html"
         class="${activeClass(isActive("clientes"))}"
         data-permission="clientes.visualizar,clientes.gerenciar">
        Clientes
      </a>
      <a href="${prefix}produtos/importar-ficha.html"
         class="${activeClass(
           isActive("produtos", "importar-ficha.html")
         )}"
         data-permission="ficha.importar,ficha.conferir_importacao,ficha.validar_importacao">
        Importar PDF
      </a>
    `)}

    ${navSection("Controle de Processo", `
      <a href="${prefix}controle-processo/lista.html"
         class="${activeClass(isActive("controle-processo"))}"
         data-permission="controle_processo.visualizar,checklist.visualizar,it.visualizar">
        Controle de Processo
      </a>
    `)}

    ${navSection("Produção", `
      <a href="${prefix}producao-moldes/index.html"
         class="${activeClass(isActive("producao-moldes") && !isActive("producao-moldes", "paradas.html"))}"
         data-permission="producao_moldes.visualizar">
        DISA
      </a>
      <a href="${prefix}producao-moldes/paradas.html"
         class="${activeClass(isActive("producao-moldes", "paradas.html"))}"
         data-permission="producao_moldes.visualizar">
        Paradas de Produção
      </a>
      <a href="${prefix}producao-acabamento/index.html"
         class="${activeClass(isActive("producao-acabamento") && !isActive("producao-acabamento", "paradas.html"))}"
         data-permission="producao_acabamento.visualizar">
        Acabamento
      </a>
      <a href="${prefix}producao-acabamento/paradas.html"
         class="${activeClass(isActive("producao-acabamento", "paradas.html"))}"
         data-permission="producao_acabamento.visualizar">
        Paradas de Acabamento
      </a>
    `)}

    ${navSection("Manutenção", `
      <a href="${prefix}reclamacoes/index.html"
         class="${activeClass(isActive("reclamacoes"))}"
         data-permission="reclamacao.visualizar">
        Solicitações de Manutenção
      </a>
      <a href="${prefix}manutencao/paradas-programadas.html"
         class="${activeClass(isActive("manutencao"))}"
         data-permission="metas.visualizar,metas.gerenciar,paradas_programadas.criar,paradas_programadas.encerrar">
        Paradas Programadas
      </a>
    `)}

    ${navSection("Administração", `
      <a href="${prefix}administracao/usuarios.html"
         class="${activeClass(isActive("administracao"))}"
         data-permission="usuarios.visualizar">
        Usuários e acessos
      </a>
      <a href="${prefix}administracao/areas-operacionais.html"
         class="${activeClass(isActive("administracao", "areas-operacionais.html"))}"
         data-permission="usuarios.gerenciar_acessos">
        Áreas operacionais
      </a>
      <a href="${prefix}administracao/metas-gerenciais.html"
         class="${activeClass(isActive("administracao", "metas-gerenciais.html"))}"
         data-permission="metas.gerenciar">
        Metas gerenciais
      </a>
      <a href="${prefix}administracao/codigos-parada.html"
         class="${activeClass(isActive("administracao", "codigos-parada.html"))}"
         data-permission="paradas.configurar_codigos">
        Códigos de parada
      </a>
      <a href="${prefix}administracao/calendario-operacional.html"
         class="${activeClass(isActive("administracao", "calendario-operacional.html"))}"
         data-permission="calendario_operacional.gerenciar">
        Calendário operacional
      </a>
    `)}
  `;

  applySidebarSectionState(navigation);
}

function sidebarOpenSectionsKey() {
  return "lidutec:sidebar:open-sections";
}

function applySidebarSectionState(navigation) {
  let openSections;
  try {
    openSections = new Set(JSON.parse(localStorage.getItem(sidebarOpenSectionsKey()) || "null"));
  } catch {
    openSections = new Set();
  }

  const activeLink = navigation.querySelector(".nav-link.active");
  const activeSection = activeLink?.closest(".nav-section")?.dataset.section;
  if (activeSection && !openSections.has(activeSection)) {
    openSections.add(activeSection);
    localStorage.setItem(sidebarOpenSectionsKey(), JSON.stringify([...openSections]));
  }

  for (const section of navigation.querySelectorAll(".nav-section")) {
    const slug = section.dataset.section;
    const toggle = section.querySelector(".nav-section-toggle");
    const links = section.querySelector(".nav-section-links");
    const open = openSections.has(slug);
    links.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector(".nav-section-icon").textContent = open ? "⌄" : "›";
  }

  if (navigation.dataset.sectionToggleBound) return;
  navigation.dataset.sectionToggleBound = "1";
  navigation.addEventListener("click", (event) => {
    const toggle = event.target.closest(".nav-section-toggle");
    if (!toggle) return;
    const slug = toggle.dataset.sectionToggle;
    const links = toggle.nextElementSibling;
    const open = links.hidden;
    links.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector(".nav-section-icon").textContent = open ? "⌄" : "›";
    let stored;
    try { stored = new Set(JSON.parse(localStorage.getItem(sidebarOpenSectionsKey()) || "null")); } catch { stored = new Set(); }
    if (open) stored.add(slug); else stored.delete(slug);
    localStorage.setItem(sidebarOpenSectionsKey(), JSON.stringify([...stored]));
  });
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

if (window.location.pathname.replace(/\\/g, "/").includes("/pages/controle-processo/")) {
  const userBox = document.querySelector(".topbar .user-box");

  if (userBox && !document.querySelector("#return-to-shift-entry")) {
    const returnToShift = document.createElement("a");
    returnToShift.id = "return-to-shift-entry";
    returnToShift.className = "topbar-return-shift";
    const currentParams = new URLSearchParams(window.location.search);
    const forwardParams = new URLSearchParams();
    for (const key of ["data", "turno", "editar"]) {
      if (currentParams.get(key)) forwardParams.set(key, currentParams.get(key));
    }
    const query = forwardParams.toString();
    returnToShift.href = `../producao-moldes/lancamento.html${query ? `?${query}` : ""}`;
    returnToShift.dataset.permission = "producao_moldes.lancar";
    returnToShift.textContent = "Voltar ao apontamento";
    userBox.before(returnToShift);
  }
}

if (window.location.pathname.endsWith("/administracao/codigos-parada.html")) {
  const importScript = document.createElement("script");
  importScript.src = "../../assets/js/codigos-parada-import.js";
  document.head.append(importScript);
}

// O apontamento de Moldagem já tem seu próprio alerta embutido
// (producao-checklist-alerts.js), cobrindo inclusive os checklists de setup
// que o widget flutuante abaixo não sabe calcular — por isso fica de fora
// daqui, senão os dois mecanismos disputam a mesma tela e duplicam alertas.
const checklistAlertPagePath = window.location.pathname.replace(/\\/g, "/");
const isChecklistAlertPage = /\/pages\/(producao-moldes|producao-acabamento|controle-processo)\//.test(
  checklistAlertPagePath
) && !/\/pages\/producao-moldes\/lancamento\.html$/.test(checklistAlertPagePath);

if (document.body?.classList.contains("app-page") && isChecklistAlertPage) {
  const globalChecklistScript = document.createElement("script");
  globalChecklistScript.src = new URL(
    "global-checklist-alerts.js",
    document.currentScript.src
  ).href;
  document.head.append(globalChecklistScript);
}
