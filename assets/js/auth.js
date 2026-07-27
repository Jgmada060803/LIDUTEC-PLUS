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
    window.location.replace("./dashboard.html");
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
      .select("status")
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

    window.location.replace("./dashboard.html");
  } catch (error) {
    console.error("Erro no login:", error);

    const invalidCredentials =
      error.message
        ?.toLowerCase()
        .includes("invalid login credentials");

    showLoginMessage(
      invalidCredentials
        ? "E-mail ou senha inválidos."
        : "Não foi possível entrar. Tente novamente."
    );
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
