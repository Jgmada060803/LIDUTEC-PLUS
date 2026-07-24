const productionPage = document.body.dataset.productionPage;
const productionState = { user:null, permissions:new Set(), products:[], records:[], stops:[] };
const q = (selector) => document.querySelector(selector);
const esc = (value="") => String(value).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number = (value) => Number(value || 0);
const formatDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const formatMinutes = (value) => `${Math.floor(number(value)/60)}h ${String(number(value)%60).padStart(2,"0")}min`;
function message(text,type="success"){const el=q("#production-message");if(!el)return;el.textContent=text;el.className=`form-message ${type}`;el.hidden=false}
async function loadSupport(){
  const [products,lines,categories]=await Promise.all([
    window.supabaseClient.from("produtos").select("id,codigo,nome").eq("status","ATIVO").order("codigo"),
    window.supabaseClient.from("linhas_maquinas_producao").select("id,codigo,nome").eq("ativo",true).order("codigo"),
    window.supabaseClient.from("categorias_parada_producao").select("id,codigo,nome").eq("ativo",true).order("nome")
  ]);
  if(products.error)throw products.error;
  productionState.products=products.data||[];
  for(const select of document.querySelectorAll("[data-products]"))select.insertAdjacentHTML("beforeend",productionState.products.map(p=>`<option value="${p.id}">${esc(p.codigo)} — ${esc(p.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-lines]"))select.insertAdjacentHTML("beforeend",(lines.data||[]).map(x=>`<option value="${x.id}">${esc(x.codigo)} — ${esc(x.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-categories]"))select.insertAdjacentHTML("beforeend",(categories.data||[]).map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join(""));
}
async function loadProductionData(){
  const [records,stops]=await Promise.all([
    window.supabaseClient.from("registros_producao_moldes").select("*,produtos(codigo,nome),linhas_maquinas_producao(codigo,nome)").order("data_operacional",{ascending:false}).limit(500),
    window.supabaseClient.from("paradas_producao_moldes").select("*,produtos(codigo,nome),linhas_maquinas_producao(codigo,nome),categorias_parada_producao(nome)").order("inicio",{ascending:false}).limit(500)
  ]);
  if(records.error)throw records.error;if(stops.error)throw stops.error;
  productionState.records=records.data||[];productionState.stops=stops.data||[];
}
function productionTotals(records=productionState.records,stops=productionState.stops){
  const planned=records.reduce((sum,x)=>sum+number(x.quantidade_planejada),0);
  const produced=records.reduce((sum,x)=>sum+number(x.quantidade_produzida),0);
  const approved=records.reduce((sum,x)=>sum+number(x.quantidade_aprovada),0);
  const scrap=records.reduce((sum,x)=>sum+number(x.quantidade_refugada),0);
  const stopMinutes=stops.reduce((sum,x)=>sum+number(x.duracao_minutos),0);
  const scheduled=[...new Set(records.map(x=>`${x.data_operacional}|${x.turno}`))].reduce((sum,key)=>sum+window.LIDUTEC_TURNOS.shifts[key.split("|")[1]].minutos,0);
  const worked=window.LIDUTEC_TURNOS.effectiveMinutes(scheduled,stopMinutes);
  return{planned,produced,approved,scrap,stopMinutes,worked,attendance:window.LIDUTEC_TURNOS.planAttendance(produced,planned),scrapRate:window.LIDUTEC_TURNOS.scrapPercentage(scrap,produced),productivity:worked?Number((produced/(worked/60)).toFixed(2)):0};
}
function renderDashboard(){
  const today=window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  const records=productionState.records.filter(x=>x.data_operacional===today);
  const stops=productionState.stops.filter(x=>x.data_operacional===today);
  const t=productionTotals(records,stops);
  const values={produced:t.produced,planned:t.planned,attendance:`${t.attendance}%`,stops:formatMinutes(t.stopMinutes),worked:formatMinutes(t.worked),productivity:t.productivity,scrap:t.scrap,scrapRate:`${t.scrapRate}%`};
  for(const [key,value] of Object.entries(values)){const el=q(`[data-metric="${key}"]`);if(el)el.textContent=value}
  renderBars(records,"#shift-chart",x=>x.turno,x=>x.quantidade_produzida);
}
function renderBars(rows,selector,keyFn,valueFn){
  const grouped=new Map();for(const row of rows)grouped.set(keyFn(row),(grouped.get(keyFn(row))||0)+number(valueFn(row)));
  const max=Math.max(1,...grouped.values());q(selector).innerHTML=[...grouped].map(([key,value])=>`<div class="production-bar"><strong>${esc(key.replaceAll("_"," "))}</strong><div class="production-bar-track"><div class="production-bar-fill" style="width:${value/max*100}%"></div></div><span>${value}</span></div>`).join("")||'<p class="production-muted">Sem dados no período.</p>';
}
function renderRecords(){
  q("#production-records").innerHTML=productionState.records.map(x=>`<tr><td>${esc(x.data_operacional)}</td><td>${esc(x.turno)}</td><td>${esc(x.produtos?.codigo||"—")}</td><td>${esc(x.linhas_maquinas_producao?.codigo||"—")}</td><td>${x.quantidade_planejada}</td><td>${x.quantidade_produzida}</td><td>${x.quantidade_aprovada}</td><td>${x.quantidade_refugada}</td></tr>`).join("");
  q("#production-empty").hidden=productionState.records.length>0;q("#production-table").hidden=!productionState.records.length;
}
function renderStops(){
  q("#stop-records").innerHTML=productionState.stops.map(x=>`<tr><td>${esc(x.data_operacional)}</td><td>${esc(x.turno)}</td><td>${esc(x.categorias_parada_producao?.nome||"—")}</td><td>${esc(x.motivo)}</td><td>${formatDateTime(x.inicio)}</td><td>${formatDateTime(x.fim)}</td><td>${formatMinutes(x.duracao_minutos)}</td></tr>`).join("");
}
function renderCharts(){
  renderBars(productionState.records,"#daily-chart",x=>x.data_operacional,x=>x.quantidade_produzida);
  renderBars(productionState.records,"#product-chart",x=>x.produtos?.codigo||"—",x=>x.quantidade_produzida);
  renderBars(productionState.stops,"#stop-chart",x=>x.categorias_parada_producao?.nome||"—",x=>x.duracao_minutos);
}
async function submitProduction(event){
  event.preventDefault();const form=event.currentTarget;const button=event.submitter;button.disabled=true;
  try{const payload=Object.fromEntries(new FormData(form));for(const key of["quantidade_planejada","quantidade_produzida","quantidade_aprovada","quantidade_refugada"])payload[key]=number(payload[key]);payload.produto_id=number(payload.produto_id);payload.linha_maquina_id=payload.linha_maquina_id?number(payload.linha_maquina_id):null;payload.criado_por=productionState.user.id;
    const{error}=await window.supabaseClient.from("registros_producao_moldes").insert(payload);if(error)throw error;form.reset();applyCurrentShift(form);message("Produção registrada com sucesso.");
  }catch(error){message(error.message,"error")}finally{button.disabled=false}
}
async function submitStop(event){
  event.preventDefault();const form=event.currentTarget;const button=event.submitter;button.disabled=true;
  try{const payload=Object.fromEntries(new FormData(form));const shift=window.LIDUTEC_TURNOS.determineShift(payload.inicio);payload.data_operacional=shift.dataOperacional;payload.turno=shift.codigo;payload.produto_id=payload.produto_id?number(payload.produto_id):null;payload.linha_maquina_id=payload.linha_maquina_id?number(payload.linha_maquina_id):null;payload.categoria_id=number(payload.categoria_id);payload.duracao_minutos=window.LIDUTEC_TURNOS.stopDurationMinutes(payload.inicio,payload.fim);payload.criado_por=productionState.user.id;
    const{error}=await window.supabaseClient.from("paradas_producao_moldes").insert(payload);if(error)throw error;form.reset();message(`Parada registrada: ${formatMinutes(payload.duracao_minutos)}.`);
  }catch(error){message(error.message,"error")}finally{button.disabled=false}
}
function applyCurrentShift(form){const shift=window.LIDUTEC_TURNOS.determineShift();form.querySelector('[name="data_operacional"]')?.setAttribute("value",shift.dataOperacional);const select=form.querySelector('[name="turno"]');if(select)select.value=shift.codigo}
async function initializeProduction(){
  const user=await window.LIDUTEC_APP.requireAuthenticatedUser();if(!user)return;
  const[profile,permissions]=await Promise.all([window.LIDUTEC_APP.getCurrentUserProfile(user.id),window.LIDUTEC_APP.getUserPermissions(user.id)]);
  if(!profile||profile.status!=="ATIVO"){alert("Seu usuário não possui acesso ativo.");await window.LIDUTEC_APP.signOut();return}
  if(!permissions.has("producao_moldes.visualizar")){location.replace("../dashboard.html");return}
  productionState.user=user;productionState.permissions=permissions;window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  q("#user-name").textContent=profile.nome;q("#user-profile").textContent=profile.perfil||"Usuário";q("#user-avatar").textContent=profile.nome.slice(0,1).toUpperCase();
  await loadSupport();await loadProductionData();q("#production-loading")?.setAttribute("hidden","");
  if(productionPage==="dashboard")renderDashboard();if(productionPage==="records")renderRecords();if(productionPage==="stops")renderStops();if(productionPage==="charts")renderCharts();
  const productionForm=q("#production-form");if(productionForm){applyCurrentShift(productionForm);productionForm.addEventListener("submit",submitProduction)}
  q("#stop-form")?.addEventListener("submit",submitStop);
}
q("#menu-button")?.addEventListener("click",()=>q("#sidebar").classList.toggle("open"));q("#logout-button")?.addEventListener("click",()=>window.LIDUTEC_APP.signOut());
initializeProduction().catch(error=>{console.error(error);q("#production-loading").textContent=`Erro: ${error.message}`});
