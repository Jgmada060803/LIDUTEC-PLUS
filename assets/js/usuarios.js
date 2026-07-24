const $=s=>document.querySelector(s);let users=[],profiles=[],allPermissions=[],permissions=new Set();
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function render(rows=users){$("#users-list").innerHTML=rows.map(u=>`<article class="user-row"><div><strong>${esc(u.nome)}</strong><small>${esc(u.email)}</small></div><span>${esc(u.perfil||"Sem perfil")}</span><span class="status-badge ${u.status==="ATIVO"?"ativo":"inativo"}">${esc(u.status)}</span>${permissions.has("usuarios.gerenciar_acessos")?`<button class="button button-secondary" data-status="${u.id}" data-next="${u.status==="ATIVO"?"INATIVO":"ATIVO"}">${u.status==="ATIVO"?"Inativar":"Ativar"}</button>`:""}</article>`).join("")}
async function load(){const [{data:u,error},{data:p}]=await Promise.all([window.supabaseClient.from("usuarios").select("id,nome,email,perfil,status").order("nome"),window.supabaseClient.from("perfis").select("id,nome,codigo").order("nome")]);if(error)throw error;users=u||[];profiles=p||[];render();$("#users-loading").hidden=true;const options=profiles.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join("");$("#profile-select").innerHTML='<option value="">Selecione</option>'+options;$("#access-profile").innerHTML='<option value="">Selecione um perfil</option>'+options}
async function invoke(body){
 const {data,error}=await window.supabaseClient.functions.invoke("gestao-usuarios",{body});
 if(error){
  const message=String(error.message||"");
  if(/failed to send|not found|404/i.test(message)){
   throw new Error("A Edge Function gestao-usuarios ainda não foi publicada no Supabase.");
  }
  throw error;
 }
 if(data?.error)throw new Error(data.error);
 return data
}
$("#new-user").onclick=()=>$("#user-form-panel").hidden=false;$("#cancel-user").onclick=()=>$("#user-form-panel").hidden=true;
$("#user-form").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await invoke({action:"invite",...Object.fromEntries(new FormData(e.currentTarget))});e.currentTarget.reset();$("#user-form-panel").hidden=true;await load();alert("Convite enviado com sucesso.")}catch(x){$("#user-message").textContent=x.message;$("#user-message").hidden=false}finally{b.disabled=false}};
document.addEventListener("click",async e=>{const b=e.target.closest("[data-status]");if(!b)return;if(!confirm(`Alterar o usuário para ${b.dataset.next}?`))return;await invoke({action:"status",usuario_id:b.dataset.status,status:b.dataset.next});await load()});
$("#user-search").oninput=e=>{const t=e.target.value.toLowerCase();render(users.filter(u=>`${u.nome} ${u.email} ${u.perfil}`.toLowerCase().includes(t)))};
async function loadProfilePermissions(profileId){
 if(!profileId){$("#access-form").hidden=true;$("#access-empty").hidden=false;return}
 $("#access-loading").hidden=false;$("#access-empty").hidden=true;$("#access-form").hidden=true;
 const [{data:catalog,error:catalogError},{data:assigned,error:assignedError}]=await Promise.all([
  window.supabaseClient.from("permissoes").select("id,codigo,nome,descricao,modulo,ativo").eq("ativo",true).order("modulo").order("nome"),
  window.supabaseClient.from("perfil_permissoes").select("permissao_id").eq("perfil_id",profileId)
 ]);
 if(catalogError||assignedError)throw catalogError||assignedError;
 allPermissions=catalog||[];const selected=new Set((assigned||[]).map(x=>String(x.permissao_id)));
 const groups=Object.groupBy?Object.groupBy(allPermissions,p=>p.modulo||"OUTROS"):allPermissions.reduce((a,p)=>{(a[p.modulo||"OUTROS"]??=[]).push(p);return a},{});
 $("#permission-matrix").innerHTML=Object.entries(groups).map(([module,items])=>`<section class="permission-module"><h4>${esc(module.replaceAll("_"," "))}</h4><div class="permission-list">${items.map(p=>`<label class="permission-option"><input type="checkbox" name="permissao_id" value="${p.id}" ${selected.has(String(p.id))?"checked":""}><span><strong>${esc(p.nome)}</strong><small>${esc(p.descricao||p.codigo)}</small><small>${esc(p.codigo)}</small></span></label>`).join("")}</div></section>`).join("");
 $("#access-loading").hidden=true;$("#access-form").hidden=false;
}
$("#access-profile").onchange=e=>loadProfilePermissions(e.target.value).catch(x=>{alert(x.message);$("#access-loading").hidden=true});
$("#select-all-permissions").onclick=()=>document.querySelectorAll('#permission-matrix input[type="checkbox"]').forEach(x=>x.checked=true);
$("#clear-all-permissions").onclick=()=>document.querySelectorAll('#permission-matrix input[type="checkbox"]').forEach(x=>x.checked=false);
$("#access-form").onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const ids=[...document.querySelectorAll('#permission-matrix input:checked')].map(x=>Number(x.value));await invoke({action:"set_profile_permissions",perfil_id:Number($("#access-profile").value),permissao_ids:ids});$("#access-message").textContent=`Acessos atualizados: ${ids.length} permissões concedidas.`;$("#access-message").className="form-message success";$("#access-message").hidden=false}catch(x){$("#access-message").textContent=x.message;$("#access-message").className="form-message error";$("#access-message").hidden=false}finally{button.disabled=false}};
$("#menu-button").onclick=()=>$("#sidebar").classList.toggle("open");$("#logout-button").onclick=()=>window.LIDUTEC_APP.signOut();
(async()=>{const user=await window.LIDUTEC_APP.requireAuthenticatedUser();if(!user)return;const [profile,p]=await Promise.all([window.LIDUTEC_APP.getCurrentUserProfile(user.id),window.LIDUTEC_APP.getUserPermissions(user.id)]);permissions=p;if(!profile||profile.status!=="ATIVO"){alert("Seu usuário não possui acesso ativo.");await window.LIDUTEC_APP.signOut();return}if(!p.has("usuarios.visualizar"))return location.replace("../dashboard.html");window.LIDUTEC_APP.applyPermissionVisibility(p);$("#user-name").textContent=profile.nome;$("#user-profile").textContent=profile.perfil;$("#user-avatar").textContent=profile.nome.slice(0,1);await load()})().catch(e=>$("#users-loading").textContent=e.message);
