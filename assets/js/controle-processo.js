const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const plansGrid = document.querySelector("#plans-grid");
const plansLoading = document.querySelector("#plans-loading");
const plansEmpty = document.querySelector("#plans-empty");
const planSearch = document.querySelector("#plan-search");

const activePlansCount =
  document.querySelector("#active-plans-count");

const todayRecordsCount =
  document.querySelector("#today-records-count");

const nonconformingCount =
  document.querySelector("#nonconforming-count");

let allPlans = [];
let currentPermissions = new Set();

function getInitials(name = "Usuário") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function startOfTodayIso() {
  const date = new Date();

  date.setHours(0, 0, 0, 0);

  return date.toISOString();
}

function createRequirements(plan) {
  const requirements = [];

  if (plan.produto_obrigatorio) {
    requirements.push("Produto obrigatório");
  }

  if (plan.maquina_obrigatoria) {
    requirements.push("Máquina obrigatória");
  }

  if (plan.panela_obrigatoria) {
    requirements.push("Panela obrigatória");
  }

  if (!requirements.length) {
    requirements.push("Cadastro simplificado");
  }

  return requirements
    .map(
      (requirement) => `
        <span class="requirement-tag">
          ${requirement}
        </span>
      `
    )
    .join("");
}

function renderPlans(plans) {
  plansGrid.innerHTML = "";

  if (!plans.length) {
    plansEmpty.hidden = false;
    return;
  }

  plansEmpty.hidden = true;

  plansGrid.innerHTML = plans
    .map((plan) => {
      const canLaunch =
        currentPermissions.has(
          "controle_processo.lancar"
        );

      return `
        <article class="plan-card">

          <div class="plan-card-header">
            <span class="plan-code">
              ${plan.codigo}
            </span>

            <span class="plan-status active">
              ATIVO
            </span>
          </div>

          <h4>${plan.nome}</h4>

          <p class="plan-description">
            ${plan.descricao || "Plano de controle de processo."}
          </p>

          <div class="plan-requirements">
            ${createRequirements(plan)}
          </div>

          <div class="plan-actions">

            <a
              href="./registros.html?plano=${plan.id}"
              class="plan-action"
            >
              Consultar
            </a>

            ${
              canLaunch
                ? `
                  <a
                    href="./lancamento.html?plano=${plan.id}"
                    class="plan-action primary"
                  >
                    Lançar
                  </a>
                `
                : ""
            }

          </div>

        </article>
      `;
    })
    .join("");
}

function filterPlans() {
  const term = planSearch.value
    .trim()
    .toLowerCase();

  const filteredPlans = allPlans.filter((plan) => {
    return (
      plan.nome.toLowerCase().includes(term) ||
      plan.codigo.toLowerCase().includes(term) ||
      plan.descricao?.toLowerCase().includes(term)
    );
  });

  renderPlans(filteredPlans);
}

async function loadPlans() {
  plansLoading.hidden = false;

  const { data, error } = await window.supabaseClient
    .from("planos_controle")
    .select(`
      id,
      codigo,
      nome,
      descricao,
      produto_obrigatorio,
      maquina_obrigatoria,
      panela_obrigatoria,
      ativo
    `)
    .eq("ativo", true)
    .order("nome");

  plansLoading.hidden = true;

  if (error) {
    console.error(
      "Erro ao carregar planos de controle:",
      error
    );

    plansEmpty.hidden = false;
    plansEmpty.querySelector("strong").textContent =
      "Erro ao carregar os planos";

    plansEmpty.querySelector("span").textContent =
      error.message;

    return;
  }

  allPlans = data ?? [];

  activePlansCount.textContent = allPlans.length;

  renderPlans(allPlans);
}

async function loadSummary() {
  const [todayResult, nonconformingResult] =
    await Promise.all([
      window.supabaseClient
        .from("registros_controle")
        .select("*", {
          count: "exact",
          head: true
        })
        .gte("registrado_em", startOfTodayIso()),

      window.supabaseClient
        .from("registros_controle")
        .select("*", {
          count: "exact",
          head: true
        })
        .eq("status", "FORA_ESPECIFICACAO")
    ]);

  todayRecordsCount.textContent =
    todayResult.count ?? 0;

  nonconformingCount.textContent =
    nonconformingResult.count ?? 0;
}

async function initializeControlProcess() {
  const user =
    await window.LIDUTEC_APP.requireAuthenticatedUser();

  if (!user) {
    return;
  }

  const profile =
    await window.LIDUTEC_APP.getCurrentUserProfile(
      user.id
    );

  if (!profile || profile.status !== "ATIVO") {
    alert("Seu usuário não possui acesso ativo.");

    await window.LIDUTEC_APP.signOut();
    return;
  }

  currentPermissions =
    await window.LIDUTEC_APP.getUserPermissions(
      user.id
    );

  if (
    !currentPermissions.has(
      "controle_processo.visualizar"
    )
  ) {
    alert(
      "Você não possui permissão para acessar o Controle de Processo."
    );

    window.location.replace("../dashboard.html");
    return;
  }

  window.LIDUTEC_APP.applyPermissionVisibility(
    currentPermissions
  );

  userName.textContent = profile.nome;

  userProfile.textContent =
    profile.perfil ?? "Usuário";

  userAvatar.textContent =
    getInitials(profile.nome);

  await Promise.all([
    loadPlans(),
    loadSummary()
  ]);
}

menuButton.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

logoutButton.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

planSearch.addEventListener("input", filterPlans);

document
  .querySelector("#new-plan-button")
  ?.addEventListener("click", () => {
    alert(
      "O cadastro de planos será criado na próxima etapa."
    );
  });

initializeControlProcess();