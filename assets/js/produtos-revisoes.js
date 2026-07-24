const revisionElements = {
  sidebar: document.querySelector("#sidebar"),
  menu: document.querySelector("#menu-button"),
  logout: document.querySelector("#logout-button"),
  body: document.querySelector("#revision-body"),
  loading: document.querySelector("#revision-loading"),
  error: document.querySelector("#revision-error"),
  empty: document.querySelector("#revision-empty"),
  wrapper: document.querySelector("#revision-table-wrapper"),
  product: document.querySelector("#revision-product"),
  search: document.querySelector("#revision-search"),
  type: document.querySelector("#revision-type"),
  status: document.querySelector("#revision-status"),
  current: document.querySelector("#revision-current"),
  number: document.querySelector("#revision-number"),
  from: document.querySelector("#revision-from"),
  to: document.querySelector("#revision-to"),
  clear: document.querySelector("#revision-clear")
};
const revisionState = { rows: [], users: new Map() };
const escapeRevision = (value = "") => String(value).replace(
  /[&<>"']/g,
  (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[character]
);
const formatRevisionDate = (value, includeTime = false) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", includeTime
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "short" }).format(new Date(value));
};
const revisionLabel = (value) => String(value || "—")
  .replaceAll("_", " ")
  .toLowerCase()
  .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
function getDecision(row) {
  const decisions = row.aprovacoes_ficha || [];
  return decisions
    .filter((item) => item.status && item.status !== "PENDENTE")
    .sort((a, b) => new Date(b.atualizado_em || b.criado_em || 0) -
      new Date(a.atualizado_em || a.criado_em || 0))[0] || null;
}
function getSubmission(row) {
  const approvals = row.aprovacoes_ficha || [];
  return approvals
    .map((item) => item.criado_em)
    .filter(Boolean)
    .sort()[0] || row.submetido_em || null;
}
function getSheetUrl(row) {
  const page = row.tipo === "FUSAO_VAZAMENTO"
    ? "fusao-vazamento.html"
    : row.tipo === "MOLDAGEM" ? "moldagem.html" : "detalhes.html";
  return page === "detalhes.html"
    ? `./detalhes.html?id=${encodeURIComponent(row.produto_id)}`
    : `./${page}?produto=${encodeURIComponent(row.produto_id)}&ficha=${encodeURIComponent(row.id)}`;
}
function compareRevisions(a, b) {
  return Number(b.vigente && ["APROVADA", "IMPORTADA", "VIGENTE"].includes(b.status)) -
    Number(a.vigente && ["APROVADA", "IMPORTADA", "VIGENTE"].includes(a.status)) ||
    Number(b.numero_revisao || 0) - Number(a.numero_revisao || 0) ||
    new Date(b.criado_em || 0) - new Date(a.criado_em || 0) ||
    Number(b.id) - Number(a.id);
}
function filteredRevisions() {
  const term = revisionElements.search.value.trim().toLowerCase();
  return revisionState.rows.filter((row) => {
    const product = row.produtos || {};
    const created = String(row.criado_em || "").slice(0, 10);
    return (!revisionElements.product.value ||
      String(row.produto_id) === revisionElements.product.value) &&
      (!term || `${product.codigo} ${product.nome} ${product.clientes?.nome || ""}`
        .toLowerCase().includes(term)) &&
      (!revisionElements.type.value || row.tipo === revisionElements.type.value) &&
      (!revisionElements.status.value || row.status === revisionElements.status.value) &&
      (!revisionElements.current.value ||
        String(Boolean(row.vigente)) === revisionElements.current.value) &&
      (!revisionElements.number.value ||
        Number(row.numero_revisao) === Number(revisionElements.number.value)) &&
      (!revisionElements.from.value || created >= revisionElements.from.value) &&
      (!revisionElements.to.value || created <= revisionElements.to.value);
  }).sort(compareRevisions);
}
function renderRevisions() {
  const rows = filteredRevisions();
  revisionElements.empty.hidden = rows.length > 0;
  revisionElements.wrapper.hidden = rows.length === 0;
  document.querySelector("#revision-total").textContent = rows.length;
  document.querySelector("#revision-current-total").textContent =
    rows.filter((row) => row.vigente).length;
  document.querySelector("#revision-pending-total").textContent =
    rows.filter((row) => /PENDENTE/.test(row.status || "")).length;
  revisionElements.body.innerHTML = rows.map((row) => {
    const product = row.produtos || {};
    const decision = getDecision(row);
    const author = revisionState.users.get(row.elaborado_por) ||
      row.elaborado_por_texto || "—";
    const approver = decision?.nome_responsavel ||
      revisionState.users.get(decision?.usuario_id) || "—";
    const note = decision?.observacao || row.motivo_revisao || "—";
    return `<tr class="${row.vigente ? "revision-current-row" : ""}">
      <td><strong>${escapeRevision(product.codigo || "—")}</strong><span class="product-secondary">${escapeRevision(product.nome || "—")} · ${escapeRevision(product.clientes?.nome || "Sem cliente")}</span></td>
      <td>${escapeRevision(revisionLabel(row.tipo))}<span class="product-secondary">${escapeRevision(row.codigo_documento || "—")}</span></td>
      <td><strong>Rev. ${escapeRevision(row.numero_revisao ?? "—")}</strong>${row.vigente ? '<span class="status-badge ativo">Vigente</span>' : ""}</td>
      <td><span class="status-badge ${/REJEITADA|OBSOLETA/.test(row.status) ? "obsoleto" : /RASCUNHO|PENDENTE/.test(row.status) ? "desenvolvimento" : "ativo"}">${escapeRevision(revisionLabel(row.status))}</span></td>
      <td>${formatRevisionDate(row.criado_em, true)}<span class="product-secondary">${escapeRevision(author)}</span></td>
      <td>${formatRevisionDate(getSubmission(row), true)}</td>
      <td>${formatRevisionDate(decision?.atualizado_em || decision?.criado_em, true)}<span class="product-secondary">${escapeRevision(approver)}</span></td>
      <td class="revision-note">${escapeRevision(note)}</td>
      <td><a class="table-action" href="${getSheetUrl(row)}">Abrir</a></td>
    </tr>`;
  }).join("");
}
function populateRevisionFilters() {
  const products = [...new Map(revisionState.rows.map((row) => [
    String(row.produto_id), row.produtos
  ])).entries()].sort((a, b) => (a[1]?.codigo || "").localeCompare(b[1]?.codigo || ""));
  revisionElements.product.insertAdjacentHTML("beforeend", products.map(([id, product]) =>
    `<option value="${escapeRevision(id)}">${escapeRevision(product?.codigo || id)} — ${escapeRevision(product?.nome || "")}</option>`
  ).join(""));
  for (const [element, values] of [
    [revisionElements.type, new Set(revisionState.rows.map((row) => row.tipo))],
    [revisionElements.status, new Set(revisionState.rows.map((row) => row.status))]
  ]) {
    element.insertAdjacentHTML("beforeend", [...values].filter(Boolean).sort().map((value) =>
      `<option value="${escapeRevision(value)}">${escapeRevision(revisionLabel(value))}</option>`
    ).join(""));
  }
  const productId = new URLSearchParams(location.search).get("produto");
  if (productId) revisionElements.product.value = productId;
}
async function loadRevisionUsers(rows) {
  const ids = [...new Set(rows.flatMap((row) => [
    row.elaborado_por,
    ...(row.aprovacoes_ficha || []).map((item) => item.usuario_id)
  ]).filter(Boolean))];
  if (!ids.length) return;
  const { data } = await window.supabaseClient
    .from("usuarios").select("id,nome").in("id", ids);
  revisionState.users = new Map((data || []).map((user) => [user.id, user.nome]));
}
async function initializeRevisions() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") {
    alert("Seu usuário não possui acesso ativo.");
    await window.LIDUTEC_APP.signOut();
    return;
  }
  if (!permissions.has("revisao.visualizar_historico")) {
    location.replace("./lista.html");
    return;
  }
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  document.querySelector("#user-name").textContent = profile.nome;
  document.querySelector("#user-profile").textContent = profile.perfil || "Usuário";
  document.querySelector("#user-avatar").textContent = profile.nome.slice(0, 1).toUpperCase();
  const { data, error } = await window.supabaseClient
    .from("fichas_tecnicas")
    .select("*,produtos(id,codigo,nome,clientes(nome)),aprovacoes_ficha(*)");
  if (error) throw error;
  revisionState.rows = data || [];
  await loadRevisionUsers(revisionState.rows);
  populateRevisionFilters();
  revisionElements.loading.hidden = true;
  renderRevisions();
}
for (const element of [
  revisionElements.product, revisionElements.search, revisionElements.type,
  revisionElements.status, revisionElements.current, revisionElements.number,
  revisionElements.from, revisionElements.to
]) element.addEventListener("input", renderRevisions);
revisionElements.clear.addEventListener("click", () => {
  for (const element of [
    revisionElements.product, revisionElements.search, revisionElements.type,
    revisionElements.status, revisionElements.current, revisionElements.number,
    revisionElements.from, revisionElements.to
  ]) element.value = "";
  renderRevisions();
});
revisionElements.menu.addEventListener("click", () => revisionElements.sidebar.classList.toggle("open"));
revisionElements.logout.addEventListener("click", () => window.LIDUTEC_APP.signOut());
initializeRevisions().catch((error) => {
  console.error("Erro ao carregar revisões:", error);
  revisionElements.loading.hidden = true;
  revisionElements.error.textContent = `Não foi possível carregar o histórico: ${error.message}`;
  revisionElements.error.hidden = false;
});
