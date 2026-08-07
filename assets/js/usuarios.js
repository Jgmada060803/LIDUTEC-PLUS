const $=s=>document.querySelector(s);let users=[],profiles=[],allPermissions=[],permissions=new Set(),operationalAreas=[];
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isPending=u=>u.status==="PENDENTE";
function render(rows=users){$("#users-list").innerHTML=rows.map(u=>`<article class="user-row"><div><strong>${esc(u.nome)}</strong><small>${esc(u.email)}</small></div><span>${esc(u.perfil||"Sem perfil")}</span><span class="status-badge ${u.status==="ATIVO"?"ativo":"inativo"}">${u.status==="ATIVO"?"ATIVO":isPending(u)?"AGUARDANDO LIBERAÇÃO":"INATIVO"}</span>${permissions.has("usuarios.gerenciar_acessos")?(u.status==="ATIVO"?`<button class="button button-secondary" data-status="${u.id}" data-next="INATIVO">Inativar</button>`:`<button class="button button-primary" data-config-user="${u.id}">Configurar acesso</button>`):""}</article>`).join("")}
function renderPending(){
 const pending=users.filter(isPending);
 $("#pending-count").textContent=pending.length;
 $("#pending-empty").hidden=pending.length>0;
 $("#pending-list").innerHTML=pending.map(u=>`<article class="pending-row"><div><strong>${esc(u.nome)}</strong><small>${esc(u.email)}</small></div><div class="pending-actions"><button class="button button-secondary" data-reject-user="${u.id}" data-reject-name="${esc(u.nome)}">Negar</button><button class="button button-primary" data-config-user="${u.id}">Conceder acesso</button></div></article>`).join("");
}
async function load(){const [{data:u,error},{data:p}]=await Promise.all([window.supabaseClient.from("usuarios").select("id,nome,email,perfil,status").order("nome"),window.supabaseClient.from("perfis").select("id,nome,codigo").order("nome")]);if(error)throw error;users=u||[];profiles=p||[];render();renderPending();$("#users-loading").hidden=true;const options=profiles.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join("");$("#profile-select").innerHTML='<option value="">Selecione</option>'+options;$("#access-profile").innerHTML='<option value="">Selecione um perfil</option>'+options;$("#user-access-profile").innerHTML='<option value="">Selecione um perfil</option>'+options;$("#user-access-user").innerHTML='<option value="">Selecione um usuário</option>'+users.map(x=>`<option value="${x.id}">${esc(x.nome)} — ${esc(x.email)}</option>`).join("")}
async function invoke(body){
 const {data,error}=await window.supabaseClient.functions.invoke("gestao-usuarios",{body});
 if(error){
  const message=String(error.message||"");
  let details;
  try{
   details=await error.context?.json();
  }catch{
   details=null;
  }
  if(/failed to send|not found|404/i.test(message)){
   throw new Error("A Edge Function gestao-usuarios ainda não foi publicada no Supabase.");
  }
  throw new Error(details?.error||message||"Não foi possível concluir a operação.");
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
function renderUserPermissionMatrix(selected){
 const groups=Object.groupBy?Object.groupBy(allPermissions,p=>p.modulo||"OUTROS"):allPermissions.reduce((a,p)=>{(a[p.modulo||"OUTROS"]??=[]).push(p);return a},{});
 $("#user-permission-matrix").innerHTML=Object.entries(groups).map(([module,items])=>`<section class="permission-module"><h4>${esc(module.replaceAll("_"," "))}</h4><div class="permission-list">${items.map(p=>`<label class="permission-option"><input type="checkbox" name="permissao_id" value="${p.id}" ${selected.has(String(p.id))?"checked":""}><span><strong>${esc(p.nome)}</strong><small>${esc(p.descricao||p.codigo)}</small><small>${esc(p.codigo)}</small></span></label>`).join("")}</div></section>`).join("");
}
async function getPermissionCatalog(){
 if(allPermissions.length)return allPermissions;
 const{data,error}=await window.supabaseClient.from("permissoes").select("id,codigo,nome,descricao,modulo,ativo").eq("ativo",true).order("modulo").order("nome");
 if(error)throw error;allPermissions=data||[];return allPermissions;
}
async function getOperationalAreas(){
 if(operationalAreas.length)return operationalAreas;
 const{data,error}=await window.supabaseClient.from("areas_checklist").select("id,codigo,nome").order("ordem");
 if(error)throw error;operationalAreas=data||[];return operationalAreas;
}
function renderUserAreaMatrix(selected){
 $("#user-area-matrix").innerHTML=operationalAreas.map(a=>`<label class="permission-option"><input type="checkbox" name="area_id" value="${a.id}" ${selected.has(String(a.id))?"checked":""}><span><strong>${esc(a.nome)}</strong><small>Área operacional · ${esc(a.codigo)}</small></span></label>`).join("")||"<p>Nenhuma área operacional cadastrada.</p>";
}
async function loadUserAccess(userId){
 if(!userId){$("#user-access-form").hidden=true;$("#user-access-empty").hidden=false;return}
 $("#user-access-loading").hidden=false;$("#user-access-empty").hidden=true;$("#user-access-form").hidden=true;
 await getPermissionCatalog();await getOperationalAreas();
 const[{data:relations,error:relationError},{data:individual,error:individualError},{data:userAreas,error:userAreasError}]=await Promise.all([
  window.supabaseClient.from("usuario_perfis").select("perfil_id").eq("usuario_id",userId),
  window.supabaseClient.from("usuario_permissoes").select("permissao_id,permitido").eq("usuario_id",userId),
  window.supabaseClient.from("usuario_areas_operacionais").select("area_id").eq("usuario_id",userId)
 ]);
 if(relationError||individualError||userAreasError)throw relationError||individualError||userAreasError;
 const profileId=relations?.[0]?.perfil_id||"";
 $("#user-access-profile").value=profileId;
 let selected;
 if(individual?.length){
  selected=new Set(individual.filter(x=>x.permitido).map(x=>String(x.permissao_id)));
 }else if(profileId){
  const{data,error}=await window.supabaseClient.from("perfil_permissoes").select("permissao_id").eq("perfil_id",profileId);
  if(error)throw error;selected=new Set((data||[]).map(x=>String(x.permissao_id)));
 }else selected=new Set();
 renderUserPermissionMatrix(selected);
 renderUserAreaMatrix(new Set((userAreas||[]).map(x=>String(x.area_id))));
 $("#user-access-loading").hidden=true;$("#user-access-form").hidden=false;
}
async function loadUserProfileDefaults(profileId){
 await getPermissionCatalog();
 if(!profileId){renderUserPermissionMatrix(new Set());return}
 const{data,error}=await window.supabaseClient.from("perfil_permissoes").select("permissao_id").eq("perfil_id",profileId);
 if(error)throw error;renderUserPermissionMatrix(new Set((data||[]).map(x=>String(x.permissao_id))));
}
$("#access-profile").onchange=e=>loadProfilePermissions(e.target.value).catch(x=>{alert(x.message);$("#access-loading").hidden=true});
$("#select-all-permissions").onclick=()=>document.querySelectorAll('#permission-matrix input[type="checkbox"]').forEach(x=>x.checked=true);
$("#clear-all-permissions").onclick=()=>document.querySelectorAll('#permission-matrix input[type="checkbox"]').forEach(x=>x.checked=false);
$("#access-form").onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const ids=[...document.querySelectorAll('#permission-matrix input:checked')].map(x=>Number(x.value));await invoke({action:"set_profile_permissions",perfil_id:Number($("#access-profile").value),permissao_ids:ids});$("#access-message").textContent=`Acessos atualizados: ${ids.length} permissões concedidas.`;$("#access-message").className="form-message success";$("#access-message").hidden=false}catch(x){$("#access-message").textContent=x.message;$("#access-message").className="form-message error";$("#access-message").hidden=false}finally{button.disabled=false}};
$("#user-access-user").onchange=e=>loadUserAccess(e.target.value).catch(x=>{alert(x.message);$("#user-access-loading").hidden=true});
$("#user-access-profile").onchange=e=>loadUserProfileDefaults(e.target.value).catch(x=>alert(x.message));
$("#user-select-all").onclick=()=>document.querySelectorAll('#user-permission-matrix input[type="checkbox"]').forEach(x=>x.checked=true);
$("#user-clear-all").onclick=()=>document.querySelectorAll('#user-permission-matrix input[type="checkbox"]').forEach(x=>x.checked=false);
$("#user-access-form").onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const message=$("#user-access-message");try{const userId=$("#user-access-user").value,profileId=Number($("#user-access-profile").value);if(!userId||!profileId)throw new Error("Selecione o usuário e o perfil.");const ids=[...document.querySelectorAll('#user-permission-matrix input:checked')].map(x=>Number(x.value));await invoke({action:"set_user_access",usuario_id:userId,perfil_id:profileId,permissao_ids:ids});const areaIds=new Set([...document.querySelectorAll('#user-area-matrix input:checked')].map(x=>Number(x.value)));const{data:currentAreas,error:currentAreasError}=await window.supabaseClient.from("usuario_areas_operacionais").select("area_id").eq("usuario_id",userId);if(currentAreasError)throw currentAreasError;const currentAreaIds=new Set((currentAreas||[]).map(x=>Number(x.area_id)));const toAdd=[...areaIds].filter(id=>!currentAreaIds.has(id));const toRemove=[...currentAreaIds].filter(id=>!areaIds.has(id));if(toAdd.length){const{error}=await window.supabaseClient.from("usuario_areas_operacionais").insert(toAdd.map(area_id=>({usuario_id:userId,area_id})));if(error)throw error}for(const area_id of toRemove){const{error}=await window.supabaseClient.from("usuario_areas_operacionais").delete().eq("usuario_id",userId).eq("area_id",area_id);if(error)throw error}message.textContent=`Acesso liberado com ${ids.length} permissões e ${areaIds.size} área${areaIds.size===1?"":"s"} operacional${areaIds.size===1?"":"is"}.`;message.className="form-message success";message.hidden=false;await load();$("#user-access-user").value=userId}catch(x){message.textContent=x.message;message.className="form-message error";message.hidden=false}finally{button.disabled=false}};
document.addEventListener("click",e=>{const button=e.target.closest("[data-config-user]");if(!button)return;$("#user-access-user").value=button.dataset.configUser;$("#user-access-user").dispatchEvent(new Event("change"));$("#user-access-user").scrollIntoView({behavior:"smooth",block:"center"})});
document.addEventListener("click",async e=>{const button=e.target.closest("[data-reject-user]");if(!button)return;if(!confirm(`Negar e remover a solicitação de ${button.dataset.rejectName}?`))return;button.disabled=true;try{await invoke({action:"reject_access",usuario_id:button.dataset.rejectUser});await load()}catch(error){alert(error.message);button.disabled=false}});
$("#menu-button").onclick=()=>$("#sidebar").classList.toggle("open");$("#logout-button").onclick=()=>window.LIDUTEC_APP.signOut();
(async()=>{const user=await window.LIDUTEC_APP.requireAuthenticatedUser();if(!user)return;const [profile,p]=await Promise.all([window.LIDUTEC_APP.getCurrentUserProfile(user.id),window.LIDUTEC_APP.getUserPermissions(user.id)]);permissions=p;if(!profile||profile.status!=="ATIVO"){alert("Seu usuário não possui acesso ativo.");await window.LIDUTEC_APP.signOut();return}if(!p.has("usuarios.visualizar"))return location.replace("../dashboard.html");window.LIDUTEC_APP.applyPermissionVisibility(p);$("#user-name").textContent=profile.nome;$("#user-profile").textContent=profile.perfil;$("#user-avatar").textContent=profile.nome.slice(0,1);await load()})().catch(e=>$("#users-loading").textContent=e.message);
