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
    window.location.pathname.includes("/qualidade/") ||
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

function applyPermissionVisibility(userPermissions) {
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