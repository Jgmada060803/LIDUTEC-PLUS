const authPage = document.body.dataset.authPage;
const accountForm = document.querySelector("#account-form");
const accountMessage = document.querySelector("#account-message");
const corporateEmailPattern = /^[^@\s]+@metalsider\.com\.br$/i;

function showAccountMessage(text, type = "error") {
  accountMessage.textContent = text;
  accountMessage.className = `form-message ${type}`;
  accountMessage.hidden = false;
}

function setAccountBusy(busy) {
  const button = accountForm?.querySelector('[type="submit"],button:not([type])');
  if (button) button.disabled = busy;
}

function corporateEmail(form) {
  const email = String(new FormData(form).get("email") || "")
    .trim()
    .toLowerCase();
  if (!corporateEmailPattern.test(email)) {
    throw new Error(
      "Use um e-mail corporativo terminado em @metalsider.com.br.",
    );
  }
  return email;
}

async function signUp(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const email = corporateEmail(form);
  const name = String(values.nome || "").trim();
  const password = String(values.senha || "");

  if (name.length < 3) throw new Error("Informe seu nome completo.");
  if (password.length < 8) {
    throw new Error("A senha deve possuir pelo menos 8 caracteres.");
  }
  if (password !== values.confirmacao) {
    throw new Error("As senhas informadas não coincidem.");
  }

  const redirect = new URL("./login.html?email_confirmado=1", location.href);
  const { data, error } = await window.supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { nome: name },
      emailRedirectTo: redirect.href,
    },
  });
  if (error) throw error;
  if (data.session) await window.supabaseClient.auth.signOut();
  form.reset();
  showAccountMessage(
    "Solicitação criada. Confirme seu e-mail e aguarde a liberação do administrador.",
    "success",
  );
}

async function requestRecovery(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = corporateEmail(form);
  const redirect = new URL("./redefinir-senha.html", location.href);
  const { error } = await window.supabaseClient.auth
    .resetPasswordForEmail(email, { redirectTo: redirect.href });
  if (error) throw error;
  form.reset();
  showAccountMessage(
    "Se a conta estiver cadastrada, o link de recuperação será enviado.",
    "success",
  );
}

async function updatePassword(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const password = String(values.senha || "");
  if (password.length < 8) {
    throw new Error("A senha deve possuir pelo menos 8 caracteres.");
  }
  if (password !== values.confirmacao) {
    throw new Error("As senhas informadas não coincidem.");
  }
  const { error } = await window.supabaseClient.auth.updateUser({
    password,
  });
  if (error) throw error;
  await window.supabaseClient.auth.signOut();
  showAccountMessage("Senha atualizada. Retornando ao login...", "success");
  setTimeout(() => location.replace("./login.html"), 1200);
}

async function validateRecoverySession() {
  const loading = document.querySelector("#recovery-loading");
  const { data: { session } } =
    await window.supabaseClient.auth.getSession();
  loading.hidden = true;
  if (!session) {
    showAccountMessage(
      "Link inválido ou expirado. Solicite uma nova recuperação de senha.",
    );
    return;
  }
  accountForm.hidden = false;
}

accountForm?.addEventListener("submit", async (event) => {
  accountMessage.hidden = true;
  setAccountBusy(true);
  try {
    if (authPage === "signup") await signUp(event);
    if (authPage === "recovery") await requestRecovery(event);
    if (authPage === "new-password") await updatePassword(event);
  } catch (error) {
    event.preventDefault();
    console.error("Erro no fluxo de conta:", error);
    showAccountMessage(error.message || "Não foi possível concluir.");
  } finally {
    setAccountBusy(false);
  }
});

if (authPage === "new-password") {
  validateRecoverySession().catch((error) => {
    document.querySelector("#recovery-loading").hidden = true;
    showAccountMessage(error.message);
  });
}
