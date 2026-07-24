const $ = (selector) => document.querySelector(selector);
const state = { user: null, permissions: new Set(), complaints: [], current: null };
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
const formatDate = (value) => value ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}`.slice(0,10) + "T12:00:00")) : "—";
const label = (value) => ({ABERTA:"Aberta",EM_ANALISE:"Em análise",EM_ACAO:"Em ação",CONCLUIDA:"Concluída",CANCELADA:"Cancelada",CRITICA:"Crítica",ALTA:"Alta",MEDIA:"Média",BAIXA:"Baixa",PENDENTE:"Pendente",EM_ANDAMENTO:"Em andamento"}[value] || value);
function show(view) { ["list","create","detail"].forEach((name) => $(`#${name}-view`).classList.toggle("is-hidden", name !== view)); }
function showFormMessage(message, type = "error") {
  const element = $("#form-message");
  element.textContent = message;
  element.className = `form-message ${type}`;
  element.hidden = false;
}
function renderList(rows = state.complaints) {
  $("#complaint-empty").hidden = rows.length > 0;
  $("#complaint-grid").innerHTML = rows.map((item) => `<article class="panel complaint-card" data-id="${item.id}">
    <div class="complaint-card-head"><strong>${escapeHtml(item.codigo)}</strong><span class="complaint-tag ${item.prioridade.toLowerCase()}">${label(item.prioridade)}</span></div>
    <h3>${escapeHtml(item.titulo)}</h3><p>${escapeHtml(item.cliente_nome)} · ${formatDate(item.data_ocorrencia)}</p>
    <div class="complaint-tags"><span class="complaint-tag">${label(item.status)}</span>${item.produtos ? `<span class="complaint-tag">${escapeHtml(item.produtos.codigo)}</span>`:""}</div></article>`).join("");
  $("#count-total").textContent = state.complaints.length;
  $("#count-open").textContent = state.complaints.filter((x) => ["ABERTA","EM_ANALISE"].includes(x.status)).length;
  $("#count-action").textContent = state.complaints.filter((x) => x.status === "EM_ACAO").length;
  $("#count-critical").textContent = state.complaints.filter((x) => x.prioridade === "CRITICA").length;
}
async function loadComplaints() {
  const { data, error } = await window.supabaseClient.from("reclamacoes_cliente").select("*, produtos(codigo,nome)").order("criado_em",{ascending:false});
  $("#complaint-loading").hidden = true;
  if (error) throw error;
  state.complaints = data || []; renderList();
}
async function loadProducts() {
  const { data } = await window.supabaseClient.from("produtos").select("id,codigo,nome").eq("status","ATIVO").order("codigo");
  $("#product-select").insertAdjacentHTML("beforeend", (data || []).map((p) => `<option value="${p.id}">${escapeHtml(p.codigo)} — ${escapeHtml(p.nome)}</option>`).join(""));
}
async function uploadEvidence(complaintId, files) {
  for (const file of files) {
    if (!/^(image|video)\//.test(file.type) || file.size > 52428800) throw new Error(`Arquivo inválido ou maior que 50 MB: ${file.name}`);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const path = `${complaintId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await window.supabaseClient.storage.from("reclamacoes-cliente").upload(path,file);
    if (error) throw error;
    const result = await window.supabaseClient.from("reclamacoes_anexos").insert({reclamacao_id:complaintId,nome_original:file.name,storage_path:path,mime_type:file.type,tamanho_bytes:file.size});
    if (result.error) throw result.error;
  }
}
async function openDetail(id) {
  const complaint = state.complaints.find((x) => String(x.id) === String(id)); if (!complaint) return;
  state.current = complaint; show("detail");
  $("#detail-code").textContent = complaint.codigo; $("#detail-title").textContent = complaint.titulo; $("#detail-description").textContent = complaint.descricao;
  $("#detail-meta").innerHTML = `<p><strong>Cliente:</strong> ${escapeHtml(complaint.cliente_nome)}</p><p><strong>Produto:</strong> ${escapeHtml(complaint.produtos?.nome || "—")}</p><p><strong>Prioridade:</strong> ${label(complaint.prioridade)}</p><p><strong>Ocorrência:</strong> ${formatDate(complaint.data_ocorrencia)}</p>`;
  $("#status-form [name=status]").value = complaint.status;
  const [attachments,comments,actions] = await Promise.all([
    window.supabaseClient.from("reclamacoes_anexos").select("*").eq("reclamacao_id",id).order("criado_em"),
    window.supabaseClient.from("reclamacoes_comentarios").select("*").eq("reclamacao_id",id).order("criado_em"),
    window.supabaseClient.from("reclamacoes_acoes").select("*").eq("reclamacao_id",id).order("criado_em")
  ]);
  const media = await Promise.all((attachments.data || []).map(async (a) => ({...a,url:(await window.supabaseClient.storage.from("reclamacoes-cliente").createSignedUrl(a.storage_path,3600)).data?.signedUrl})));
  $("#evidence-gallery").innerHTML = media.length ? media.map((a) => a.mime_type.startsWith("video/") ? `<video class="complaint-media" controls src="${a.url}"></video>` : `<img class="complaint-media" loading="lazy" src="${a.url}" alt="${escapeHtml(a.nome_original)}">`).join("") : '<p class="complaint-muted">Nenhuma evidência anexada.</p>';
  $("#comments-list").innerHTML = (comments.data || []).map((c) => `<div class="timeline-item">${escapeHtml(c.comentario)}<small>${new Date(c.criado_em).toLocaleString("pt-BR")}</small></div>`).join("") || '<p class="complaint-muted">Nenhum comentário.</p>';
  $("#actions-list").innerHTML = (actions.data || []).map((a) => `<div class="action-item"><strong>${escapeHtml(a.titulo)}</strong><p>${escapeHtml(a.descricao || "")}</p><small>${label(a.tipo)} · ${escapeHtml(a.responsavel || "Sem responsável")} · ${formatDate(a.prazo)} · ${label(a.status)}</small></div>`).join("") || '<p class="complaint-muted">Nenhuma ação proposta.</p>';
}
async function deleteCurrentComplaint() {
  if (!state.current || !state.permissions.has("reclamacao.gerenciar")) {
    alert("Seu usuário não possui permissão para remover reclamações.");
    return;
  }
  const confirmed = window.confirm(
    `Remover definitivamente a reclamação ${state.current.codigo}?\n\nFotos, vídeos, comentários e ações também serão excluídos. Esta operação não pode ser desfeita.`
  );
  if (!confirmed) return;
  const button = $("#delete-complaint");
  button.disabled = true;
  button.textContent = "Removendo...";
  try {
    const { data: attachments, error: attachmentError } =
      await window.supabaseClient
        .from("reclamacoes_anexos")
        .select("storage_path")
        .eq("reclamacao_id", state.current.id);
    if (attachmentError) throw attachmentError;
    const paths = (attachments || []).map((item) => item.storage_path);
    if (paths.length) {
      const { error: storageError } = await window.supabaseClient.storage
        .from("reclamacoes-cliente")
        .remove(paths);
      if (storageError) throw storageError;
    }
    const { error } = await window.supabaseClient
      .from("reclamacoes_cliente")
      .delete()
      .eq("id", state.current.id);
    if (error) throw error;
    state.current = null;
    await loadComplaints();
    show("list");
  } catch (error) {
    console.error("Erro ao remover reclamação:", error);
    alert(`Não foi possível remover a reclamação: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Remover reclamação";
  }
}
$("#complaint-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const complaintForm = event.currentTarget;
  $("#form-message").hidden = true;
  if (!state.permissions.has("reclamacao.criar")) {
    showFormMessage("Seu usuário não possui a permissão reclamacao.criar.");
    return;
  }
  const submitButton = complaintForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Registrando...";
  try {
    const form = new FormData(complaintForm);
    const code = `RC-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const payload = Object.fromEntries(["titulo","cliente_nome","descricao","prioridade","data_ocorrencia","produto_id"].map((key) => [key,form.get(key) || null]));
    payload.codigo = code;
    const { data, error } = await window.supabaseClient.from("reclamacoes_cliente").insert(payload).select("id").single();
    if (error) throw error;
    try {
      await uploadEvidence(data.id,$("#evidence-files").files);
    } catch (errorUpload) {
      showFormMessage(`A reclamação ${code} foi criada, mas o anexo falhou: ${errorUpload.message}`, "warning");
      await loadComplaints();
      return;
    }
    complaintForm.reset();
    await loadComplaints();
    show("list");
  } catch (error) {
    console.error("Erro ao registrar reclamação:", error);
    const details = [error.message, error.details, error.hint, error.code ? `Código: ${error.code}` : null].filter(Boolean).join(" — ");
    showFormMessage(`Não foi possível registrar: ${details}`);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Registrar reclamação";
  }
});
$("#comment-form").addEventListener("submit", async (event) => { event.preventDefault(); const text=new FormData(event.currentTarget).get("comentario"); const {error}=await window.supabaseClient.from("reclamacoes_comentarios").insert({reclamacao_id:state.current.id,comentario:text}); if(error)return alert(error.message); event.currentTarget.reset(); openDetail(state.current.id); });
$("#action-form").addEventListener("submit", async (event) => { event.preventDefault(); const payload=Object.fromEntries(new FormData(event.currentTarget)); payload.reclamacao_id=state.current.id; const {error}=await window.supabaseClient.from("reclamacoes_acoes").insert(payload); if(error)return alert(error.message); event.currentTarget.reset(); openDetail(state.current.id); });
$("#status-form").addEventListener("submit", async (event) => { event.preventDefault(); const status=new FormData(event.currentTarget).get("status"); const {error}=await window.supabaseClient.from("reclamacoes_cliente").update({status,atualizado_em:new Date().toISOString()}).eq("id",state.current.id); if(error)return alert(error.message); await loadComplaints(); openDetail(state.current.id); });
$("#new-complaint").addEventListener("click",() => show("create"));
$("#delete-complaint").addEventListener("click", deleteCurrentComplaint);
document.addEventListener("click",(event) => { const card=event.target.closest("[data-id]"); if(card) openDetail(card.dataset.id); if(event.target.closest("[data-back]")) show("list"); });
$("#complaint-search").addEventListener("input",(event) => { const term=event.target.value.toLowerCase(); renderList(state.complaints.filter((x) => `${x.codigo} ${x.titulo} ${x.cliente_nome}`.toLowerCase().includes(term))); });
$("#menu-button").addEventListener("click",() => $("#sidebar").classList.toggle("open"));
$("#logout-button").addEventListener("click",() => window.LIDUTEC_APP.signOut());
(async function init() {
  const user=await window.LIDUTEC_APP.requireAuthenticatedUser(); if(!user)return; state.user=user;
  const [profile,permissions]=await Promise.all([window.LIDUTEC_APP.getCurrentUserProfile(user.id),window.LIDUTEC_APP.getUserPermissions(user.id)]);
  if(!profile || !permissions.has("reclamacao.visualizar")) return window.location.replace("../dashboard.html");
  state.permissions=permissions; window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  $("#user-name").textContent=profile.nome; $("#user-profile").textContent=profile.perfil || "Usuário"; $("#user-avatar").textContent=profile.nome.split(/\s+/).slice(0,2).map((x)=>x[0]).join("").toUpperCase();
  await Promise.all([loadComplaints(),loadProducts()]);
})().catch((error) => { $("#complaint-loading").textContent=`Erro: ${error.message}`; });
