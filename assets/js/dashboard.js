const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const currentDate = document.querySelector("#current-date");
const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");
const welcomeMessage = document.querySelector("#welcome-message");

const metricProducts = document.querySelector("#metric-products");
const metricCe = document.querySelector("#metric-ce");
const metricApprovals = document.querySelector("#metric-approvals");
const metricNotifications =
  document.querySelector("#metric-notifications");

const latestCeBody = document.querySelector("#latest-ce-body");

let dashboardInitializing = false;

function formatCurrentDate() {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full"
  }).format(new Date());
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Bom dia";
  }

  if (hour < 18) {
    return "Boa tarde";
  }

  return "Boa noite";
}

function getInitials(name = "Usuário") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getStartOfTodayIso() {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today.toISOString();
}

function setMetricValue(element, value) {
  if (!element) {
    return;
  }

  element.textContent = value ?? 0;
}

async function loadMetrics(userId) {
  const [
    productsResult,
    controlResult,
    approvalsResult,
    notificationsResult
  ] = await Promise.all([
    window.supabaseClient
      .from("produtos")
      .select("*", {
        count: "exact",
        head: true
      })
      .eq("status", "ATIVO"),

    window.supabaseClient
      .from("registros_controle")
      .select("*", {
        count: "exact",
        head: true
      })
      .gte("registrado_em", getStartOfTodayIso()),

    window.supabaseClient
      .from("aprovacoes_ficha")
      .select("*", {
        count: "exact",
        head: true
      })
      .eq("status", "PENDENTE"),

    window.supabaseClient
      .from("notificacoes")
      .select("*", {
        count: "exact",
        head: true
      })
      .eq("usuario_id", userId)
      .eq("lida", false)
  ]);

  if (productsResult.error) {
    console.error(
      "Erro ao carregar quantidade de produtos:",
      productsResult.error
    );
  }

  if (controlResult.error) {
    console.error(
      "Erro ao carregar registros de controle:",
      controlResult.error
    );
  }

  if (approvalsResult.error) {
    console.error(
      "Erro ao carregar aprovações:",
      approvalsResult.error
    );
  }

  if (notificationsResult.error) {
    console.error(
      "Erro ao carregar notificações:",
      notificationsResult.error
    );
  }

  setMetricValue(
    metricProducts,
    productsResult.count
  );

  setMetricValue(
    metricCe,
    controlResult.count
  );

  setMetricValue(
    metricApprovals,
    approvalsResult.count
  );

  setMetricValue(
    metricNotifications,
    notificationsResult.count
  );
}

async function loadLatestControlRecords() {
  if (!latestCeBody) {
    return;
  }

  const { data, error } = await window.supabaseClient
    .from("registros_controle")
    .select(`
      id,
      registrado_em,
      status,
      produtos (
        codigo
      ),
      planos_controle (
        nome
      )
    `)
    .order("registrado_em", {
      ascending: false
    })
    .limit(6);

  if (error) {
    console.error(
      "Erro ao carregar últimos controles:",
      error
    );

    latestCeBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          Não foi possível carregar os registros.
        </td>
      </tr>
    `;

    return;
  }

  if (!data?.length) {
    latestCeBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          Nenhum registro encontrado.
        </td>
      </tr>
    `;

    return;
  }

  latestCeBody.innerHTML = data
    .map((record) => {
      const time =
        new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit"
        }).format(new Date(record.registrado_em));

      const productCode =
        record.produtos?.codigo ?? "—";

      const planName =
        record.planos_controle?.nome ?? "—";

      const status =
        record.status ?? "—";

      return `
        <tr>
          <td>${time}</td>
          <td>${productCode}</td>
          <td>${planName}</td>
          <td>${status}</td>
        </tr>
      `;
    })
    .join("");
}

async function initializeDashboard() {
  if (dashboardInitializing) {
    return;
  }

  dashboardInitializing = true;

  try {
    const user =
      await window.LIDUTEC_APP.requireAuthenticatedUser();

    if (!user) {
      return;
    }

    const profile =
      await window.LIDUTEC_APP.getCurrentUserProfile(
        user.id
      );

    if (!profile) {
  console.error(
    "Perfil público não foi carregado:",
    {
      id: user.id,
      email: user.email
    }
  );

  alert(
    "Seu login está ativo, mas não foi possível carregar " +
    "os dados do usuário. Verifique o Console do navegador."
  );

  return;
}

    if (profile.status !== "ATIVO") {
      alert(
        "Seu acesso ao Metalsider ainda não está ativo."
      );

      await window.LIDUTEC_APP.signOut();
      return;
    }

    const permissions =
      await window.LIDUTEC_APP.getUserPermissions(
        user.id
      );

    window.LIDUTEC_APP.applyPermissionVisibility(
      permissions
    );

    if (currentDate) {
      currentDate.textContent = formatCurrentDate();
    }

    if (userName) {
      userName.textContent = profile.nome;
    }

    if (userProfile) {
      userProfile.textContent =
        profile.perfil ?? "Usuário";
    }

    if (userAvatar) {
      userAvatar.textContent =
        getInitials(profile.nome);
    }

    if (welcomeMessage) {
      const firstName =
        profile.nome?.split(" ")[0] ?? "Usuário";

      welcomeMessage.textContent =
        `${getGreeting()}, ${firstName}`;
    }

    await Promise.all([
      loadMetrics(user.id),
      loadLatestControlRecords()
    ]);
  } catch (error) {
    console.error(
      "Falha ao iniciar o dashboard:",
      error
    );

    alert(
      "Não foi possível carregar o dashboard. " +
      "Abra o console do navegador para conferir o erro."
    );
  } finally {
    dashboardInitializing = false;
  }
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});

logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

initializeDashboard();
