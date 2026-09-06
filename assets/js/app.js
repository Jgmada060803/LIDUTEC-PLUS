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
    window.location.pathname.includes("/producao-macharia/") ||
    window.location.pathname.includes("/producao-fusao/") ||
    window.location.pathname.includes("/qualidade/") ||
    window.location.pathname.includes("/reclamacoes/") ||
    window.location.pathname.includes("/clientes/") ||
    window.location.pathname.includes("/administracao/") ||
    window.location.pathname.includes("/sgi/");

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
  const isActive = (section, page = "") =>
    pathname.includes(`/pages/${section}/`) &&
    (!page || pathname.endsWith(`/${page}`));
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
    <a href="${prefix}redefinir-senha.html" class="nav-link">
      Trocar minha senha
    </a>
    ${navSection("Ajuda", `
      <a href="https://claude.ai/code/artifact/b78413c4-e296-4cda-b6fd-ed4c7791944a" class="nav-link" target="_blank" rel="noopener">
        Treinamento — Engenharia
      </a>
      <a href="https://claude.ai/code/artifact/cecb834d-7032-4945-8237-2bdfe7bb9146" class="nav-link" target="_blank" rel="noopener">
        Treinamento — Moldagem e Vazamento
      </a>
    `)}

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
      <a href="${prefix}producao-macharia/ficha-macho.html"
         class="${activeClass(isActive("producao-macharia", "ficha-macho.html"))}"
         data-permission="produto.editar,producao_macharia.avaliar_ficha_macho">
        Ficha de Macho
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
         class="${activeClass(isActive("producao-moldes"))}"
         data-permission="producao_moldes.visualizar">
        DISA
      </a>
      <a href="${prefix}producao-acabamento/index.html"
         class="${activeClass(isActive("producao-acabamento"))}"
         data-permission="producao_acabamento.visualizar">
        Acabamento
      </a>
      <a href="${prefix}producao-macharia/index.html"
         class="${activeClass(isActive("producao-macharia") && !isActive("producao-macharia", "ficha-macho.html"))}"
         data-permission="producao_macharia.visualizar">
        Macharia
      </a>
      <a href="${prefix}producao-fusao/index.html"
         class="${activeClass(isActive("producao-fusao") && !isActive("producao-fusao", "ponte.html") && !isActive("producao-fusao", "holding.html") && !isActive("producao-fusao", "vazamento.html"))}"
         data-permission="producao_fusao.visualizar">
        Fusão
      </a>
      <a href="${prefix}producao-fusao/holding.html"
         class="${activeClass(isActive("producao-fusao", "holding.html"))}"
         data-permission="producao_fusao.visualizar">
        Holding (Fusão)
      </a>
      <a href="${prefix}producao-fusao/ponte.html"
         class="${activeClass(isActive("producao-fusao", "ponte.html"))}"
         data-permission="producao_fusao.visualizar,producao_fusao.lancar_ponte">
        Ponte (Fusão)
      </a>
      <a href="${prefix}producao-fusao/vazamento.html"
         class="${activeClass(isActive("producao-fusao", "vazamento.html"))}"
         data-permission="producao_fusao.visualizar,producao_fusao.lancar_vazamento">
        Vazamento (Fusão)
      </a>
    `)}

    ${navSection("SGI", `
      <a href="${prefix}sgi/index.html"
         class="${activeClass(isActive("sgi"))}"
         data-permission="sgi.visualizar">
        Documentos Controlados
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
      <a href="${prefix}administracao/linha-dias-operacao.html"
         class="${activeClass(isActive("administracao", "linha-dias-operacao.html"))}"
         data-permission="metas.gerenciar">
        Dias de operação por linha
      </a>
      <a href="${prefix}administracao/codigos-parada.html"
         class="${activeClass(isActive("administracao", "codigos-parada.html"))}"
         data-permission="paradas.configurar_codigos">
        Códigos de parada
      </a>
      <a href="${prefix}administracao/fusao-cadastros.html"
         class="${activeClass(isActive("administracao", "fusao-cadastros.html"))}"
         data-permission="producao_fusao.configurar">
        Materiais e fornos (Fusão)
      </a>
      <a href="${prefix}administracao/calendario-operacional.html"
         class="${activeClass(isActive("administracao", "calendario-operacional.html"))}"
         data-permission="calendario_operacional.gerenciar">
        Calendário operacional
      </a>
      <a href="${prefix}administracao/relatorio-login.html"
         class="${activeClass(isActive("administracao", "relatorio-login.html"))}"
         data-permission="usuarios.gerenciar_acessos">
        Relatório de login
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

// ---------------------------------------------------------------------------
// Typeahead genérico — campo de texto com sugestões em dropdown no lugar de
// <select> longos. Um registro por "kind" (produto_id, setor_id,
// categoria_id, macho_id...) guarda de onde vêm os itens e como
// pesquisar/exibir; o HTML e a interação (digitar, teclado, clique,
// restaurar) são únicos e compartilhados entre módulos. Delegado em
// document — funciona mesmo quando uma tela recria uma tabela/grade inteira
// via innerHTML, sem precisar re-anexar listeners por campo.
// ---------------------------------------------------------------------------
const typeaheadRegistry = new Map();
let typeaheadPortalEl = null;
let activeTypeaheadField = null;

function normalizeTypeaheadText(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
function normalizeTypeaheadIncludes(fields, normalizedSearch) {
  return normalizeTypeaheadText(fields.filter(Boolean).join(" ")).includes(normalizedSearch);
}
function escapeTypeaheadHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function registerTypeahead(kind, config) {
  // config: { items: () => array, match: (item, normalizedSearch) => bool,
  //           label: (item) => string, secondary?: (item) => string, id: (item) => string|number }
  typeaheadRegistry.set(kind, config);
}

function typeaheadFieldHtml(kind, hiddenAttributesHtml, placeholder, ariaLabel = placeholder, disabled = false) {
  return `<span class="typeahead-field" data-typeahead="${kind}">
    <input type="search" class="typeahead-input" placeholder="${escapeTypeaheadHtml(placeholder)}"
      aria-label="${escapeTypeaheadHtml(ariaLabel)}" autocomplete="off" role="combobox"
      aria-expanded="false" aria-autocomplete="list"${disabled ? " disabled" : ""}>
    <input type="hidden" ${hiddenAttributesHtml}>
  </span>`;
}

function typeaheadFieldFromInput(input) {
  const fieldEl = input.closest(".typeahead-field");
  const config = fieldEl && typeaheadRegistry.get(fieldEl.dataset.typeahead);
  if (!fieldEl || !config) return null;
  return { fieldEl, inputEl: input, hiddenEl: fieldEl.querySelector('input[type="hidden"]'), config };
}

function syncTypeaheadField(fieldEl) {
  const config = typeaheadRegistry.get(fieldEl.dataset.typeahead);
  const input = fieldEl.querySelector(".typeahead-input");
  const hidden = fieldEl.querySelector('input[type="hidden"]');
  if (!config || !input || !hidden) return;
  const item = hidden.value ? config.items().find((c) => String(config.id(c)) === String(hidden.value)) : null;
  input.value = item ? config.label(item) : "";
}
function syncAllTypeaheadFields(root = document) {
  for (const fieldEl of root.querySelectorAll(".typeahead-field")) syncTypeaheadField(fieldEl);
}

function typeaheadPortal() {
  if (!typeaheadPortalEl) {
    typeaheadPortalEl = document.createElement("ul");
    typeaheadPortalEl.className = "typeahead-results";
    typeaheadPortalEl.hidden = true;
    typeaheadPortalEl.setAttribute("role", "listbox");
    document.body.append(typeaheadPortalEl);
  }
  return typeaheadPortalEl;
}
function positionTypeaheadPortal(input) {
  const rect = input.getBoundingClientRect();
  const portal = typeaheadPortal();
  portal.style.left = `${Math.max(4, rect.left)}px`;
  portal.style.top = `${rect.bottom + 4}px`;
  portal.style.minWidth = `${Math.max(rect.width, 240)}px`;
}
function closeTypeahead() {
  const portal = typeaheadPortal();
  portal.hidden = true;
  portal.replaceChildren();
  activeTypeaheadField?.inputEl.setAttribute("aria-expanded", "false");
  activeTypeaheadField = null;
}
function selectTypeaheadMatch(field, item) {
  field.hiddenEl.value = String(field.config.id(item));
  field.inputEl.value = field.config.label(item);
  field.hiddenEl.dispatchEvent(new Event("change", { bubbles: true }));
  field.inputEl.dispatchEvent(new Event("change", { bubbles: true }));
  closeTypeahead();
}
function highlightTypeaheadMatch(index) {
  const portal = typeaheadPortal();
  [...portal.children].forEach((li, i) => li.classList.toggle("active", i === index));
  activeTypeaheadField.activeIndex = index;
}
function openTypeaheadSuggestions(field, matches) {
  const portal = typeaheadPortal();
  activeTypeaheadField = { ...field, matches, activeIndex: 0 };
  portal.innerHTML = matches.length
    ? matches.slice(0, 20).map((item, index) => `
        <li role="option" data-index="${index}">
          <span class="typeahead-primary">${escapeTypeaheadHtml(field.config.label(item))}</span>
          ${field.config.secondary ? `<span class="typeahead-secondary">${escapeTypeaheadHtml(field.config.secondary(item) || "")}</span>` : ""}
        </li>`).join("")
    : `<li class="typeahead-empty" role="presentation">Nenhum resultado encontrado</li>`;
  positionTypeaheadPortal(field.inputEl);
  portal.hidden = false;
  field.inputEl.setAttribute("aria-expanded", "true");
  if (matches.length) highlightTypeaheadMatch(0);
}

// Se o usuário sair do campo sem ter clicado numa sugestão válida, os dois
// campos (texto + id oculto) voltam a vazio — nunca fica texto livre sem id
// vinculado, mesmo que já houvesse uma seleção válida antes (evita salvar
// uma referência que não corresponde ao texto exibido).
function resolveTypeaheadOnBlur(field) {
  const text = field.inputEl.value.trim();
  const current = field.hiddenEl.value
    ? field.config.items().find((i) => String(field.config.id(i)) === field.hiddenEl.value)
    : null;
  if (current && field.config.label(current) === text) return;
  field.inputEl.value = "";
  field.hiddenEl.value = "";
  field.hiddenEl.dispatchEvent(new Event("change", { bubbles: true }));
}

document.addEventListener("input", (event) => {
  const input = event.target.closest(".typeahead-input");
  if (!input) return;
  const field = typeaheadFieldFromInput(input);
  if (!field) return;
  const search = normalizeTypeaheadText(input.value.trim());
  if (!search) { closeTypeahead(); return; }
  openTypeaheadSuggestions(field, field.config.items().filter((item) => field.config.match(item, search)));
});
document.addEventListener("focusin", (event) => {
  const input = event.target.closest(".typeahead-input");
  if (!input) return;
  const field = typeaheadFieldFromInput(input);
  if (!field) return;
  const search = normalizeTypeaheadText(input.value.trim());
  if (!search) return;
  openTypeaheadSuggestions(field, field.config.items().filter((item) => field.config.match(item, search)));
});
document.addEventListener("keydown", (event) => {
  if (!activeTypeaheadField || !event.target.closest(".typeahead-input")) return;
  const portal = typeaheadPortal();
  if (event.key === "Escape") { closeTypeahead(); return; }
  if (portal.hidden) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const count = activeTypeaheadField.matches.length;
    if (!count) return;
    highlightTypeaheadMatch((activeTypeaheadField.activeIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    return;
  }
  if (event.key === "Enter") {
    const item = activeTypeaheadField.matches[activeTypeaheadField.activeIndex];
    if (item) { event.preventDefault(); selectTypeaheadMatch(activeTypeaheadField, item); }
  }
});
// pointerdown (não click) + preventDefault: em toque, o click da sugestão
// costuma chegar depois do focusout/limpeza de 150ms do campo (ver abaixo),
// fazendo o toque "não pegar" no tablet. pointerdown com preventDefault
// evita que o campo perca o foco ao tocar na sugestão, então o focusout
// nem dispara — elimina a corrida em vez de tentar vencer ela no tempo.
document.addEventListener("pointerdown", (event) => {
  const li = event.target.closest(".typeahead-results li[data-index]");
  if (!li || !activeTypeaheadField) return;
  event.preventDefault();
  selectTypeaheadMatch(activeTypeaheadField, activeTypeaheadField.matches[Number(li.dataset.index)]);
});
document.addEventListener("focusout", (event) => {
  const input = event.target.closest(".typeahead-input");
  if (!input) return;
  const field = typeaheadFieldFromInput(input);
  if (!field) return;
  setTimeout(() => {
    if (document.activeElement === input || typeaheadPortal().contains(document.activeElement)) return;
    resolveTypeaheadOnBlur(field);
    // Só fecha se o dropdown ativo ainda for deste campo — evita que o
    // fechamento atrasado de um campo perdido derrube as sugestões recém
    // abertas de outro campo que ganhou foco rapidamente em seguida (comum
    // em telas com vários typeaheads lado a lado, ex. produto + setor).
    if (activeTypeaheadField?.fieldEl === field.fieldEl) closeTypeahead();
  }, 150);
});

window.LIDUTEC_TYPEAHEAD = {
  register: registerTypeahead,
  fieldHtml: typeaheadFieldHtml,
  syncField: syncTypeaheadField,
  syncAll: syncAllTypeaheadFields
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

// O apontamento de Moldagem não deve exibir nenhum alerta de checklist
// (removido a pedido do usuário) — por isso fica de fora daqui, senão o
// widget flutuante volta a aparecer nessa tela.
const checklistAlertPagePath = window.location.pathname.replace(/\\/g, "/");
const isChecklistAlertPage = /\/pages\/(producao-moldes|producao-acabamento|producao-macharia|controle-processo)\//.test(
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
