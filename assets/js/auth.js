const loginForm = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const senhaInput = document.querySelector("#senha");
const loginButton = document.querySelector("#login-button");
const loginMessage = document.querySelector("#login-message");
const togglePasswordButton =
  document.querySelector("#toggle-password");

function showLoginMessage(message, type = "error") {
  loginMessage.textContent = message;
  loginMessage.className = `form-message ${type}`;
  loginMessage.hidden = false;
}

function clearLoginMessage() {
  loginMessage.textContent = "";
  loginMessage.className = "form-message";
  loginMessage.hidden = true;
}

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.textContent =
    isLoading ? "Entrando..." : "Entrar";
}

async function redirectAuthenticatedUser() {
  const {
    data: { session },
    error
  } = await window.supabaseClient.auth.getSession();

  if (error) {
    console.error("Erro ao verificar sessão:", error);
    return;
  }

  if (session) {
    const { data: profile } = await window.supabaseClient
      .from("usuarios")
      .select("deve_trocar_senha")
      .eq("id", session.user.id)
      .maybeSingle();
    window.location.replace(
      profile?.deve_trocar_senha ? "./redefinir-senha.html" : "./inicio.html"
    );
  }
}

togglePasswordButton.addEventListener("click", () => {
  const isPassword =
    senhaInput.type === "password";

  senhaInput.type =
    isPassword ? "text" : "password";

  togglePasswordButton.textContent =
    isPassword ? "Ocultar" : "Mostrar";

  togglePasswordButton.setAttribute(
    "aria-label",
    isPassword ? "Ocultar senha" : "Exibir senha"
  );
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLoginMessage();

  const email = emailInput.value.trim();
  const password = senhaInput.value;

  if (!email || !password) {
    showLoginMessage(
      "Preencha o e-mail e a senha."
    );
    return;
  }

  try {
    setLoading(true);

    const { data, error } =
      await window.supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      throw error;
    }

    if (!data.session) {
      throw new Error(
        "Não foi possível iniciar a sessão."
      );
    }

    const { data: profile } = await window.supabaseClient
      .from("usuarios")
      .select("status,deve_trocar_senha")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile && profile.status !== "ATIVO") {
      await window.supabaseClient.auth.signOut();
      showLoginMessage(
        "E-mail confirmado. Seu acesso aguarda liberação do administrador.",
        "success"
      );
      return;
    }

    showLoginMessage(
      "Login realizado com sucesso.",
      "success"
    );

    if (profile?.deve_trocar_senha) {
      window.location.replace("./redefinir-senha.html");
      return;
    }

    window.location.replace("./inicio.html");
  } catch (error) {
    console.error("Erro no login:", error);

    const errorCode = String(error?.code ?? "").toLowerCase();
    const errorMessage = String(error?.message ?? "").toLowerCase();

    if (
      errorCode === "email_not_confirmed" ||
      errorMessage.includes("email not confirmed")
    ) {
      showLoginMessage(
        "Seu e-mail ainda não foi confirmado. Abra a mensagem enviada pelo sistema e clique no link de confirmação."
      );
    } else if (
      errorCode === "invalid_credentials" ||
      errorMessage.includes("invalid login credentials")
    ) {
      showLoginMessage("E-mail ou senha inválidos.");
    } else {
      const reason = error?.message || error?.code;
      showLoginMessage(
        reason
          ? `Não foi possível entrar. Motivo: ${reason}`
          : "Não foi possível entrar porque o serviço não informou o motivo."
      );
    }
  } finally {
    setLoading(false);
  }
});

redirectAuthenticatedUser();

if (
  new URLSearchParams(window.location.search)
    .has("email_confirmado")
) {
  showLoginMessage(
    "E-mail confirmado. Aguarde a liberação do administrador.",
    "success"
  );
}
