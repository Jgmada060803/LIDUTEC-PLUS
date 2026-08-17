(async function initializeLoginReport() {
  const q = (selector) => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = async (request) => { const response = await request; if (response.error) throw response.error; return response.data ?? []; };

  const user = await LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([LIDUTEC_APP.getCurrentUserProfile(user.id), LIDUTEC_APP.getUserPermissions(user.id)]);
  if (!permissions.has("usuarios.gerenciar_acessos")) throw new Error("Usuário sem permissão para ver o relatório de login.");

  const message = (text, type = "error") => { const el = q("#login-report-message"); el.textContent = text; el.className = `form-message ${type}`; el.hidden = false; };

  function deviceLabel(userAgent = "") {
    const ua = String(userAgent || "");
    const platform = /iPhone|iPad/i.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "—";
    const browser = /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : /Firefox\//i.test(ua) ? "Firefox" : "";
    return [platform, browser].filter(Boolean).join(" · ") || "—";
  }

  let rows = [];

  function render() {
    const term = q("#login-report-search").value.trim().toLowerCase();
    const filtered = term
      ? rows.filter((row) => `${row.nome} ${row.email}`.toLowerCase().includes(term))
      : rows;
    q("#login-report-rows").innerHTML = filtered.map((row) => `<tr>
      <td><strong>${esc(row.nome)}</strong></td>
      <td>${esc(row.email)}</td>
      <td>${new Date(row.login_em).toLocaleString("pt-BR")}</td>
      <td>${esc(row.ip || "—")}</td>
      <td>${esc(deviceLabel(row.user_agent))}</td>
    </tr>`).join("");
    q("#login-report-empty").hidden = filtered.length > 0;
  }

  async function load() {
    q("#login-report-loading").hidden = false;
    q("#login-report-message").hidden = true;
    try {
      const from = q("#login-report-from").value, to = q("#login-report-to").value;
      rows = await call(supabaseClient.rpc("relatorio_login_usuarios", {
        p_desde: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        p_ate: to ? new Date(`${to}T23:59:59`).toISOString() : null
      }));
      render();
    } catch (error) {
      message(error.message);
    } finally {
      q("#login-report-loading").hidden = true;
    }
  }

  q("#login-report-from").addEventListener("change", load);
  q("#login-report-to").addEventListener("change", load);
  q("#login-report-search").addEventListener("input", render);
  q("#menu-button").addEventListener("click", () => q("#sidebar").classList.toggle("open"));
  q("#logout-button").addEventListener("click", () => LIDUTEC_APP.signOut());

  LIDUTEC_APP.applyPermissionVisibility(permissions);
  q("#user-name").textContent = profile.nome;
  q("#user-profile").textContent = profile.perfil || "Usuário";
  q("#user-avatar").textContent = profile.nome.slice(0, 1).toUpperCase();
  await load();
})().catch((error) => {
  console.error(error);
  const element = document.querySelector("#login-report-message");
  if (element) { element.textContent = error.message; element.className = "form-message error"; element.hidden = false; }
  else alert(error.message);
});
