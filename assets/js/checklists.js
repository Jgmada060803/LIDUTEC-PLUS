const checklistPage = document.body.dataset.checklistPage;
const checklistData = window.LIDUTEC_CHECKLISTS_DATA;
const checklistState = { user:null, profile:null, permissions:new Set(), areas:[], models:[], executions:[], currentShiftExists:false };
const cq = selector => document.querySelector(selector);
const cesc = (value="") => String(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));

function checklistOperationalContext(now=new Date()){
  if(window.LIDUTEC_TURNOS){
    const current=window.LIDUTEC_TURNOS.determineShift(now);
    return{date:current.dataOperacional,shift:current.codigo};
  }
  const localDate=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
  return{date:localDate,shift:""};
}
const formatDateTimeChecklist = value => value ? new Date(value).toLocaleString("pt-BR") : "—";
const statusLabels = {CONFORME:"Conforme",NAO_CONFORME:"Não conforme",AGUARDANDO_SUPERVISOR:"Aguardando supervisor",BLOQUEADO:"Bloqueado",LIBERADO:"Liberado",EM_PREENCHIMENTO:"Em preenchimento"};
const frequencyLabels = {INICIO_TURNO:"Início do turno",SETUP:"A cada setup",INTERVALO:"Verificação programada",CORRIDA:"Por corrida",DIARIO:"Diário",SEMANAL:"Semanal",EVENTO:"Quando ocorrer",ESPECIAL:"Fluxo especial"};

// Mantém o contexto de onde veio (data/turno/se estava editando um turno
// fechado) enquanto navega entre a lista de checklists, o preenchimento e a
// volta pro apontamento — sem isso, o apontamento perderia o modo de edição
// ao voltar do checklist.
function forwardedApontamentoParams(extra={}){
  const params=new URLSearchParams(location.search),forward=new URLSearchParams();
  for(const key of["data","turno","origem","editar"])if(params.get(key))forward.set(key,params.get(key));
  for(const[key,value]of Object.entries(extra))if(value!=null)forward.set(key,value);
  return forward;
}
function backToApontamentoUrl(){
  const params=new URLSearchParams(location.search);
  if(params.get("origem")!=="apontamento")return"./checklists.html";
  const forward=forwardedApontamentoParams();
  return `../producao-moldes/lancamento.html${forward.toString()?`?${forward}`:""}`;
}
// Desbloqueio de edição do check de um turno já fechado, direto na tela do
// próprio check (ex.: M02) — sem precisar navegar até o apontamento.
let checklistEditingClosedShift=false;
function checklistMessage(text,type="error") { const element=cq("#checklist-message"); if(!element)return;element.textContent=text;element.className=`form-message ${type}`;element.hidden=false; }
function checklistInitials(name="Usuário"){return name.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()).join("")}
function activeProfileArea(){const code=String(checklistState.profile?.perfil||"").toUpperCase();return["MOLDAGEM","VAZAMENTO","FUSAO","MACHARIA","ACABAMENTO"].includes(code)?code:null}
function updateUserHeader(){cq("#user-name").textContent=checklistState.profile.nome;cq("#user-profile").textContent=checklistState.profile.perfil||"Usuário";cq("#user-avatar").textContent=checklistInitials(checklistState.profile.nome)}
function modelFrequency(model){return model.intervalo_minutos?`A cada ${model.intervalo_minutos} minutos`:frequencyLabels[model.frequencia_tipo]||model.frequencia_tipo}
function statusBadge(status){return`<span class="checklist-status status-${cesc(status.toLowerCase())}">${cesc(statusLabels[status]||status)}</span>`}
async function refreshCurrentShiftExists(){
  const {date,shift}=checklistOperationalContext();
  if(!date||!shift){checklistState.currentShiftExists=false;return}
  try{
    const {data,error}=await window.supabaseClient.from("turnos_producao_moldes").select("status,rascunho_producoes,rascunho_paradas").eq("data_operacional",date).eq("turno",shift).limit(1);
    if(error)throw error;
    const row=(data||[])[0];
    checklistState.currentShiftExists=!!row&&(row.status==="FECHADO"||(row.rascunho_producoes||[]).some(item=>item.produto_id)||(row.rascunho_paradas||[]).some(item=>item.categoria_id||item.setor_id));
  }catch{checklistState.currentShiftExists=false}
}
function modelDeadline(model){if(model.areas_checklist?.codigo!=="MOLDAGEM"||model.frequencia_tipo!=="INTERVALO"||!model.intervalo_minutos||!window.LIDUTEC_TURNOS)return null;const current=window.LIDUTEC_TURNOS.determineShift();if(!checklistState.currentShiftExists&&!window.LIDUTEC_TURNOS.isScheduledShiftDay(current.dataOperacional,current.codigo))return null;const bounds=window.LIDUTEC_TURNOS.shiftBounds(current.dataOperacional,current.codigo),now=new Date(),executions=checklistState.executions.filter(row=>String(row.modelos_checklist?.id)===String(model.id)&&new Date(row.iniciado_em)>=bounds.start&&new Date(row.iniciado_em)<=now),status=window.LIDUTEC_TURNOS.checklistIntervalStatus(bounds.start,bounds.end,model.intervalo_minutos,executions.length,now);if(!status)return null;return{level:status.late?"late":"pending",label:status.missingCount>1?`${status.missingCount} atrasados`:status.late?"Atrasado":"Pendente",due:status.due}}
function applyDeadlineIndicators(areaCode){if(areaCode!=="MOLDAGEM")return;const models=checklistState.models.filter(model=>model.areas_checklist?.codigo===areaCode),cards=[...document.querySelectorAll("#checklist-models .checklist-model-card")];models.forEach((model,index)=>{const deadline=modelDeadline(model);if(!deadline)return;const holder=cards[index]?.querySelector(".checklist-model-top > span:last-child");if(holder)holder.innerHTML=`<span class="checklist-deadline ${deadline.level}" title="Horário previsto: ${deadline.due.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}"><i></i>${deadline.label}</span>`})}

async function initializeChecklistSession(){
  const user=await window.LIDUTEC_APP.requireAuthenticatedUser();if(!user)return false;
  const[profile,permissions]=await Promise.all([window.LIDUTEC_APP.getCurrentUserProfile(user.id),window.LIDUTEC_APP.getUserPermissions(user.id)]);
  if(!profile||profile.status!=="ATIVO"){alert("Seu usuário não possui acesso ativo.");await window.LIDUTEC_APP.signOut();return false}
  if(!permissions.has("checklist.visualizar")){throw new Error("Usuário sem permissão para visualizar checklists.")}
  checklistState.user=user;checklistState.profile=profile;checklistState.permissions=permissions;window.LIDUTEC_APP.applyPermissionVisibility(permissions);updateUserHeader();return true;
}

function renderAreaTabs(selected){
  cq("#area-tabs").innerHTML=checklistState.areas.map(area=>`<button type="button" class="checklist-area-tab${area.codigo===selected?" active":""}" data-area="${cesc(area.codigo)}" style="--area-color:${cesc(area.cor)}">${cesc(area.nome)}</button>`).join("");
}
function renderModels(areaCode){
  const models=checklistState.models.filter(model=>model.areas_checklist?.codigo===areaCode),canFill=checklistState.permissions.has("checklist.preencher");
  cq("#checklist-models").innerHTML=models.map(model=>`<article class="panel checklist-model-card" style="--area-color:${cesc(model.areas_checklist?.cor)}"><div class="checklist-model-top"><span class="checklist-model-code">${cesc(model.codigo)}</span><span>${cesc(modelFrequency(model))}</span></div><h3>${cesc(model.nome)}</h3><p>${cesc(model.descricao||"")}</p><div class="checklist-model-meta"><span>${cesc(model.instrucao_codigo||"Sem instrução vinculada")}</span>${model.produto_obrigatorio?"<span>Produto obrigatório</span>":""}${model.equipamento_obrigatorio?"<span>Equipamento obrigatório</span>":""}</div>${canFill?`<a class="button button-primary" href="./checklist.html?${forwardedApontamentoParams({modelo:model.id})}">Preencher</a>`:""}</article>`).join("");
  cq("#checklist-empty").hidden=models.length>0;
  applyDeadlineIndicators(areaCode);
}
async function decideChecklist(executionId,decision){
  const action=decision==="LIBERADO"?"liberar":"manter bloqueado";const justification=prompt(`Justificativa para ${action} este checklist:`);if(justification===null)return;if(justification.trim().length<3){alert("Informe uma justificativa válida.");return}
  await checklistData.decide(executionId,decision,justification.trim());await loadDashboardData();
}
function renderApprovals(rows){
  const panel=cq("#approval-panel");if(!checklistState.permissions.has("checklist.aprovar")||!rows.length){panel.hidden=true;return}panel.hidden=false;
  cq("#approval-list").innerHTML=rows.map(row=>{const deviations=(row.respostas_checklist||[]).filter(answer=>answer.resultado==="NAO_CONFORME"&&answer.itens_checklist?.critico);return`<article class="checklist-approval-card"><div><strong>${cesc(row.modelos_checklist?.codigo)} — ${cesc(row.modelos_checklist?.nome)}</strong><span>${cesc(row.modelos_checklist?.areas_checklist?.nome)} · ${formatDateTimeChecklist(row.iniciado_em)} · ${cesc(row.usuarios?.nome||"Operador")}</span></div><ul>${deviations.map(answer=>`<li><strong>${cesc(answer.itens_checklist?.descricao)}</strong><span>${cesc(answer.observacao)}</span><small>Ação: ${cesc(answer.acao_imediata)}</small></li>`).join("")}</ul><div class="checklist-approval-actions"><button class="button button-danger" data-decision="MANTIDO_BLOQUEADO" data-execution="${row.id}">Manter bloqueado</button><button class="button button-primary" data-decision="LIBERADO" data-execution="${row.id}">Liberar</button></div></article>`}).join("");
}
async function loadDashboardData(){
  const[areas,models,executions,approvals]=await Promise.all([checklistData.areas(),checklistData.models(),checklistData.executions(),checklistData.pendingApprovals(),refreshCurrentShiftExists()]);checklistState.areas=areas;checklistState.models=models;checklistState.executions=executions;
  const today=checklistOperationalContext().date;cq("#models-count").textContent=models.length;cq("#today-count").textContent=executions.filter(row=>row.data_operacional===today).length;cq("#approval-count").textContent=approvals.length;cq("#deviation-count").textContent=executions.filter(row=>["NAO_CONFORME","BLOQUEADO"].includes(row.status)).length;
  const paramArea=new URLSearchParams(location.search).get("area"),preferred=paramArea||activeProfileArea(),selected=checklistState.areas.some(area=>area.codigo===preferred)?preferred:checklistState.areas[0]?.codigo;renderAreaTabs(selected);renderModels(selected);renderApprovals(approvals);cq("#checklist-loading").hidden=true;
}
async function initializeDashboard(){await loadDashboardData();cq("#area-tabs").addEventListener("click",event=>{const button=event.target.closest("[data-area]");if(!button)return;renderAreaTabs(button.dataset.area);renderModels(button.dataset.area)});cq("#approval-list").addEventListener("click",event=>{const button=event.target.closest("[data-decision]");if(button)decideChecklist(Number(button.dataset.execution),button.dataset.decision).catch(error=>alert(error.message))})}

function resultButtons(item){const na=item.permite_na?`<label><input type="radio" name="result-${item.id}" value="NAO_APLICAVEL"><span>Não aplicável</span></label>`:"";return`<div class="checklist-result-options"><label><input type="radio" name="result-${item.id}" value="CONFORME"><span>${item.tipo_resposta==="SIM_NAO"?"Sim":"Conforme"}</span></label><label><input type="radio" name="result-${item.id}" value="NAO_CONFORME"><span>${item.tipo_resposta==="SIM_NAO"?"Não":"Não conforme"}</span></label>${na}</div>`}
function itemSpecification(item){const parts=[];if(item.valor_minimo!=null)parts.push(`Mín. ${item.valor_minimo}`);if(item.valor_alvo!=null)parts.push(`Alvo ${item.valor_alvo}`);if(item.valor_maximo!=null)parts.push(`Máx. ${item.valor_maximo}`);const source=item.fonte_limite_tipo==="INSTRUCAO_TRABALHO"?` · IT rev. ${item.fonte_limite_revisao||"—"}${item.fonte_limite_pagina?` pág. ${item.fonte_limite_pagina}`:""}`:item.fonte_limite_tipo==="FICHA_TECNICA"?" · Ficha Técnica vigente":"";return parts.length?`${parts.join(" · ")} ${item.unidade||""}${source}`:"Conforme ficha técnica/instrução vigente"}
function renderChecklistItems(items){
  const groups=new Map();for(const item of items){if(!groups.has(item.secao))groups.set(item.secao,[]);groups.get(item.secao).push(item)}
  cq("#checklist-sections").innerHTML=[...groups].map(([section,rows])=>`<section class="panel checklist-section"><div class="panel-header"><h3>${cesc(section)}</h3><button type="button" class="checklist-section-ok" data-confirm-section>Confirmar seção conforme</button></div><div class="checklist-item-list">${rows.map(item=>`<article class="checklist-item" data-item-id="${item.id}" data-type="${item.tipo_resposta}" data-min="${item.valor_minimo??""}" data-max="${item.valor_maximo??""}" data-apenas-valor="${item.apenas_valor?"1":""}"><div class="checklist-item-heading"><span class="checklist-item-number">${cesc(item.codigo)}</span><div><strong>${cesc(item.descricao)}</strong><small>${cesc(itemSpecification(item))}</small></div>${item.critico?'<span class="checklist-critical">Crítico</span>':""}</div>${item.tipo_resposta==="NUMERO"?`<div class="checklist-number-answer"><input type="number" step="any" data-number placeholder="Valor encontrado"><span>${cesc(item.unidade||"")}</span></div>${item.apenas_valor?"":(item.valor_minimo==null&&item.valor_maximo==null?resultButtons(item):'<span class="checklist-auto-result" data-auto-result>Informe o valor</span>')}`:item.tipo_resposta==="TEXTO"?'<textarea data-text rows="2" maxlength="1000" placeholder="Informe o registro"></textarea>':resultButtons(item)}<div class="checklist-deviation-fields" hidden><label>Desvio encontrado<textarea data-observation rows="2" maxlength="1000"></textarea></label><label>Ação imediata<textarea data-action rows="2" maxlength="1000"></textarea></label>${item.plano_reacao?`<p><strong>Plano de reação:</strong> ${cesc(item.plano_reacao)}</p>`:""}</div></article>`).join("")}</div></section>`).join("");updateAnswerProgress();
}
function itemResult(article){const type=article.dataset.type;if(type==="TEXTO")return article.querySelector("[data-text]").value.trim()?"CONFORME":"";if(type==="NUMERO"&&article.dataset.apenasValor==="1"){return article.querySelector("[data-number]").value!==""?"CONFORME":""}if(type==="NUMERO"&&(article.dataset.min!==""||article.dataset.max!=="")){const value=article.querySelector("[data-number]").value;if(value==="")return"";const number=Number(value),min=article.dataset.min===""?null:Number(article.dataset.min),max=article.dataset.max===""?null:Number(article.dataset.max);return(min==null||number>=min)&&(max==null||number<=max)?"CONFORME":"NAO_CONFORME"}return article.querySelector('input[type="radio"]:checked')?.value||""}
function syncItemState(article){const result=itemResult(article),deviation=article.querySelector(".checklist-deviation-fields");if(deviation)deviation.hidden=result!=="NAO_CONFORME";const badge=article.querySelector("[data-auto-result]");if(badge){badge.textContent=result?statusLabels[result]||result:"Informe o valor";badge.className=`checklist-auto-result${result?` result-${result.toLowerCase()}`:""}`}article.classList.toggle("item-nok",result==="NAO_CONFORME");updateAnswerProgress()}
function updateAnswerProgress(){const articles=[...document.querySelectorAll(".checklist-item")],answered=articles.filter(item=>itemResult(item)).length;const progress=cq("#answer-progress");if(progress)progress.textContent=`${answered} de ${articles.length} itens respondidos`}
function serializeChecklistAnswers(){return[...document.querySelectorAll(".checklist-item")].map(article=>({item_id:Number(article.dataset.itemId),resultado:itemResult(article),valor_numero:article.querySelector("[data-number]")?.value||null,valor_texto:article.querySelector("[data-text]")?.value||null,observacao:article.querySelector("[data-observation]")?.value||null,acao_imediata:article.querySelector("[data-action]")?.value||null}))}
// ---------------------------------------------------------------------------
// Grade de colunas por horário — para checks que se repetem dentro do turno
// (por enquanto: início de turno e intervalo; setup fica para uma etapa
// seguinte, pois depende de detectar os setups reais lançados na produção).
// Cada coluna é um horário previsto; ao vencer, vira preenchível até ser
// confirmada — depois disso só mostra o valor, quem lançou e quando.
// ---------------------------------------------------------------------------
const GRID_FREQUENCIES=new Set(["INTERVALO","INICIO_TURNO","SETUP"]);
function gridTimeLabel(date){return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`}
function gridResultShort(result){return result==="CONFORME"?"C":result==="NAO_CONFORME"?"NC":result==="NAO_APLICAVEL"?"N/A":"—"}
function findExecutionForSlot(slot,previousBoundary,executions){
  return executions.find(exec=>{
    if(exec.horario_previsto)return Math.abs(new Date(exec.horario_previsto).getTime()-slot.getTime())<60000;
    const t=new Date(exec.iniciado_em).getTime();
    return t>previousBoundary.getTime()&&t<=slot.getTime();
  })||null;
}
function gridResultButtons(item,colIndex){
  const na=item.permite_na?`<label><input type="radio" name="grid-${colIndex}-${item.id}" value="NAO_APLICAVEL"><span>N/A</span></label>`:"";
  return `<div class="checklist-grid-options"><label><input type="radio" name="grid-${colIndex}-${item.id}" value="CONFORME"><span>C</span></label><label><input type="radio" name="grid-${colIndex}-${item.id}" value="NAO_CONFORME"><span>NC</span></label>${na}</div><div class="checklist-grid-deviation" hidden><textarea data-observation rows="2" placeholder="Desvio"></textarea><textarea data-action rows="2" placeholder="Ação imediata"></textarea></div>`;
}
function gridCellMarkup(item,execution,colIndex,editable){
  if(execution){
    const answer=(execution.respostas_checklist||[]).find(r=>r.item_id===item.id)||null;
    const value=answer?.valor_numero!=null?`${answer.valor_numero}${item.unidade?` ${item.unidade}`:""}`:gridResultShort(answer?.resultado);
    return `<span class="checklist-grid-answer result-${(answer?.resultado||"").toLowerCase()}">${cesc(value)}</span>`;
  }
  if(!editable)return `<span class="checklist-grid-answer result-pending">—</span>`;
  if(item.tipo_resposta==="NUMERO"){
    const showButtons=!item.apenas_valor&&item.valor_minimo==null&&item.valor_maximo==null;
    return `<input type="number" step="any" class="checklist-grid-number" data-number placeholder="Valor">${showButtons?gridResultButtons(item,colIndex):""}`;
  }
  if(item.tipo_resposta==="TEXTO")return `<input type="text" class="checklist-grid-text" data-text maxlength="500">`;
  return gridResultButtons(item,colIndex);
}
function gridCellResult(cell){
  const type=cell.dataset.type;
  if(type==="TEXTO")return cell.querySelector("[data-text]")?.value.trim()?"CONFORME":"";
  if(type==="NUMERO"){
    const value=cell.querySelector("[data-number]")?.value;
    if(value===""||value==null)return"";
    if(cell.dataset.apenasValor==="1")return"CONFORME";
    if(cell.dataset.min!==""||cell.dataset.max!==""){
      const number=Number(value),min=cell.dataset.min===""?null:Number(cell.dataset.min),max=cell.dataset.max===""?null:Number(cell.dataset.max);
      return(min==null||number>=min)&&(max==null||number<=max)?"CONFORME":"NAO_CONFORME";
    }
    return cell.querySelector('input[type="radio"]:checked')?.value||"";
  }
  return cell.querySelector('input[type="radio"]:checked')?.value||"";
}
function syncGridCell(cell){
  const result=gridCellResult(cell),deviation=cell.querySelector(".checklist-grid-deviation");
  if(deviation)deviation.hidden=result!=="NAO_CONFORME";
}
function gridProductMarkup(colIndex,produto,products,editable){
  if(produto)return `<input type="hidden" class="checklist-grid-produto" data-col="${colIndex}" value="${produto.id}"><span class="checklist-grid-product-label" title="${cesc(produto.nome||"")}">${cesc(produto.codigo||"—")}</span>`;
  if(!editable)return '<span class="checklist-grid-product-label muted">—</span>';
  return `<select class="checklist-grid-produto" data-col="${colIndex}"><option value="">Produto</option>${products.map(p=>`<option value="${p.id}">${cesc(p.codigo)}</option>`).join("")}</select>`;
}
function renderChecklistGrid(items,slots,executions,bounds,canEdit,productions,products,unlockable,frequenciaTipo){
  const previousBoundaries=[bounds.start,...slots.slice(0,-1)];
  const columns=slots.map((slot,index)=>({slot,index,execution:findExecutionForSlot(slot,previousBoundaries[index],executions),producao:productions[index]}));
  const headerCells=columns.map(col=>{
    const meta=col.execution?`<small>${gridTimeLabel(new Date(col.execution.iniciado_em))} · ${cesc(col.execution.usuarios?.nome||"—")}</small>`:'<small>Pendente</small>';
    const produto=col.execution?col.execution.produtos:col.producao?.produtos;
    const productMarkup=gridProductMarkup(col.index,produto,products,canEdit&&!col.execution);
    return `<th class="checklist-grid-slot"><strong>${gridTimeLabel(col.slot)}</strong><div class="checklist-grid-product">${productMarkup}</div>${meta}</th>`;
  }).join("");
  const rows=items.map(item=>{
    const cells=columns.map(col=>`<td class="checklist-grid-cell" data-item-id="${item.id}" data-col="${col.index}" data-type="${item.tipo_resposta}" data-min="${item.valor_minimo??""}" data-max="${item.valor_maximo??""}" data-apenas-valor="${item.apenas_valor?"1":""}">${gridCellMarkup(item,col.execution,col.index,canEdit&&!col.execution)}</td>`).join("");
    return `<tr><th class="checklist-grid-itemcol"><span class="checklist-grid-item-code">${cesc(item.codigo)}</span>${cesc(item.descricao)}${item.critico?' <i class="checklist-critical-dot" title="Item crítico"></i>':""}</th>${cells}</tr>`;
  }).join("");
  const actionRow=`<tr class="checklist-grid-actions"><th></th>${columns.map(col=>`<td>${(!col.execution&&canEdit)?`<button type="button" class="button button-primary checklist-grid-confirm" data-col="${col.index}" data-slot="${col.slot.toISOString()}">Confirmar</button>`:""}</td>`).join("")}</tr>`;
  const emptyMessage=frequenciaTipo==="SETUP"?"Ainda não houve nenhuma linha de produção que exija checklist de setup neste turno.":"Ainda não há horário previsto vencido para este check.";
  const lockedMessage=!canEdit?`<p class="checklist-grid-locked">Este turno já foi fechado — somente consulta.${unlockable?' <button type="button" class="button button-secondary checklist-grid-unlock">Editar turno fechado</button>':""}</p>`:!columns.length?`<p class="checklist-grid-locked">${emptyMessage}</p>`:"";
  cq("#checklist-sections").innerHTML=`<section class="panel checklist-grid-panel"><div class="checklist-grid-wrapper"><table class="checklist-grid"><thead><tr><th class="checklist-grid-itemcol">Item</th>${headerCells}</tr></thead><tbody>${rows}${actionRow}</tbody></table></div>${lockedMessage}</section>`;
}
// Linhas de produção que exigem checklist de setup dentro do turno — mesma
// regra do apontamento (1ª linha só dispensa se for sequência do produto do
// turno anterior; as demais sempre exigem). Turno aberto ainda não tem
// registro definitivo de produção (só vira registros_producao_moldes quando
// o turno fecha), então lê do rascunho nesse caso.
async function setupProductionRows(date,turno,shiftRow){
  if(shiftRow?.status==="FECHADO"){
    const rows=await checklistData.productionsForShift(date,turno);
    return rows.filter(row=>row.inicio&&row.produto_id).map(row=>({inicio:new Date(row.inicio),produto_id:row.produto_id,produtos:row.produtos}));
  }
  const rows=(shiftRow?.rascunho_producoes||[]).map(item=>{
    const inicio=window.LIDUTEC_TURNOS.resolveShiftTime(date,turno,item.inicio);
    return inicio&&item.produto_id?{inicio,produto_id:item.produto_id,produtos:null}:null;
  }).filter(Boolean);
  return rows.sort((a,b)=>a.inicio-b.inicio);
}
async function setupSlots(date,turno,shiftRow,products){
  const rows=await setupProductionRows(date,turno,shiftRow);
  if(!rows.length)return{slots:[],productions:[]};
  const bounds=window.LIDUTEC_TURNOS.shiftBounds(date,turno);
  const previousShift=window.LIDUTEC_TURNOS.determineShift(new Date(bounds.start.getTime()-60000));
  const previousBounds=window.LIDUTEC_TURNOS.shiftBounds(previousShift.dataOperacional,previousShift.codigo);
  const previous=await checklistData.previousProduction(previousBounds.start.toISOString(),previousBounds.end.toISOString());
  const slots=[],productions=[];
  rows.forEach((row,index)=>{
    const isSequence=index===0&&previous?.produto_id!=null&&String(row.produto_id)===String(previous.produto_id);
    if(isSequence)return;
    slots.push(row.inicio);
    productions.push({produtos:row.produtos||products.find(p=>String(p.id)===String(row.produto_id))||null});
  });
  return{slots,productions};
}
async function loadChecklistGrid(model,modelId){
  const date=cq("#execution-date").value,turno=cq("#execution-shift").value;
  const bounds=window.LIDUTEC_TURNOS.shiftBounds(date,turno);
  const [items,executions,shift,products]=await Promise.all([
    checklistData.items(modelId),
    checklistData.executionsForSlots(Number(modelId),date,turno),
    checklistData.shiftStatus(date,turno),
    checklistData.products()
  ]);
  let slots,productions;
  if(model.frequencia_tipo==="SETUP"){
    ({slots,productions}=await setupSlots(date,turno,shift,products));
  }else{
    slots=window.LIDUTEC_TURNOS.checklistDueSlots(model.frequencia_tipo,bounds.start,bounds.end,model.intervalo_minutos,new Date());
    // O produto é identificado por coluna — qual produto estava em produção
    // naquele horário planejado — em vez de um único campo para o turno todo.
    productions=await Promise.all(slots.map(slot=>checklistData.productionAt(date,turno,slot)));
  }
  const open=shift?.status==="ABERTO",canEdit=open||checklistEditingClosedShift;
  const unlockable=!open&&shift?.status==="FECHADO"&&!checklistEditingClosedShift&&checklistState.permissions.has("producao_moldes.editar");
  renderChecklistGrid(items,slots,executions,bounds,canEdit,productions,products,unlockable,model.frequencia_tipo);
}

// Checklist por posto (ex.: A01 - Máquinas de rebarbação): uma coluna por
// posto de trabalho ativo no turno, em vez de por horário ou por setup. A
// Linha 1 do Acabamento está sempre ativa; a Linha 2 só entra se também
// tiver sido lançada nesse turno (turnos_acabamento_linhas).
let currentPostoColumns=[];
async function acabamentoPostoColumns(shiftRow){
  const postos=await checklistData.postosAcabamento();
  const linha2Ids=new Set((shiftRow?.turnos_acabamento_linhas||[]).map(row=>String(row.linha_maquina_id)));
  return postos.filter(posto=>posto.linhas_maquinas_producao?.codigo==="ACABAMENTO_L1"||linha2Ids.has(String(posto.linha_maquina_id)));
}
function findExecutionForPosto(posto,executions){
  return executions.find(exec=>exec.equipamento===posto.nome)||null;
}
function renderPostoChecklistGrid(items,postos,executions,canEdit,unlockable){
  const columns=postos.map((posto,index)=>({posto,index,execution:findExecutionForPosto(posto,executions)}));
  const headerCells=columns.map(col=>{
    const meta=col.execution?`<small>${gridTimeLabel(new Date(col.execution.iniciado_em))} · ${cesc(col.execution.usuarios?.nome||"—")}</small>`:'<small>Pendente</small>';
    return `<th class="checklist-grid-slot"><strong>${cesc(col.posto.nome)}</strong>${meta}</th>`;
  }).join("");
  const rows=items.map(item=>{
    const cells=columns.map(col=>`<td class="checklist-grid-cell" data-item-id="${item.id}" data-col="${col.index}" data-type="${item.tipo_resposta}" data-min="${item.valor_minimo??""}" data-max="${item.valor_maximo??""}" data-apenas-valor="${item.apenas_valor?"1":""}">${gridCellMarkup(item,col.execution,col.index,canEdit&&!col.execution)}</td>`).join("");
    return `<tr><th class="checklist-grid-itemcol"><span class="checklist-grid-item-code">${cesc(item.codigo)}</span>${cesc(item.descricao)}${item.critico?' <i class="checklist-critical-dot" title="Item crítico"></i>':""}</th>${cells}</tr>`;
  }).join("");
  const actionRow=`<tr class="checklist-grid-actions"><th></th>${columns.map(col=>`<td>${(!col.execution&&canEdit)?`<button type="button" class="button button-primary checklist-grid-confirm" data-col="${col.index}" data-posto-id="${col.posto.id}">Confirmar</button>`:""}</td>`).join("")}</tr>`;
  const lockedMessage=!canEdit?`<p class="checklist-grid-locked">Este turno já foi fechado — somente consulta.${unlockable?' <button type="button" class="button button-secondary checklist-grid-unlock">Editar turno fechado</button>':""}</p>`:!columns.length?'<p class="checklist-grid-locked">Nenhum posto ativo encontrado para este turno.</p>':"";
  cq("#checklist-sections").innerHTML=`<section class="panel checklist-grid-panel"><div class="checklist-grid-wrapper"><table class="checklist-grid"><thead><tr><th class="checklist-grid-itemcol">Item</th>${headerCells}</tr></thead><tbody>${rows}${actionRow}</tbody></table></div>${lockedMessage}</section>`;
}
async function loadPostoChecklistGrid(model,modelId){
  const date=cq("#execution-date").value,turno=cq("#execution-shift").value;
  const [items,executions,shift]=await Promise.all([
    checklistData.items(modelId),
    checklistData.executionsForSlots(Number(modelId),date,turno),
    checklistData.shiftStatus(date,turno,"ACABAMENTO")
  ]);
  currentPostoColumns=await acabamentoPostoColumns(shift);
  const open=shift?.status==="ABERTO",canEdit=open||checklistEditingClosedShift;
  const unlockable=!open&&shift?.status==="FECHADO"&&!checklistEditingClosedShift&&checklistState.permissions.has("producao_acabamento.editar");
  renderPostoChecklistGrid(items,currentPostoColumns,executions,canEdit,unlockable);
}
async function submitPostoGridColumn(button,modelId,model,posto){
  const colIndex=button.dataset.col;
  const cells=[...document.querySelectorAll(`.checklist-grid-cell[data-col="${colIndex}"]`)];
  const respostas=cells.map(cell=>({item_id:Number(cell.dataset.itemId),resultado:gridCellResult(cell),valor_numero:cell.querySelector("[data-number]")?.value||null,valor_texto:cell.querySelector("[data-text]")?.value||null,observacao:cell.querySelector("[data-observation]")?.value||null,acao_imediata:cell.querySelector("[data-action]")?.value||null}));
  if(respostas.some(item=>!item.resultado)){checklistMessage("Responda todos os itens dessa coluna antes de confirmar.","error");return}
  button.disabled=true;
  try{
    await checklistData.save({p_modelo_id:Number(modelId),p_data_operacional:cq("#execution-date").value,p_turno:cq("#execution-shift").value,p_produto_id:null,p_equipamento:posto.nome,p_corrida:null,p_observacao:null,p_respostas:respostas});
    checklistMessage(`Check do ${posto.nome} registrado com sucesso.`);
    await loadPostoChecklistGrid(model,modelId);
  }catch(error){checklistMessage(error.message,"error");button.disabled=false}
}
async function submitGridColumn(button,modelId,model){
  const colIndex=button.dataset.col,slot=button.dataset.slot;
  const cells=[...document.querySelectorAll(`.checklist-grid-cell[data-col="${colIndex}"]`)];
  const respostas=cells.map(cell=>({item_id:Number(cell.dataset.itemId),resultado:gridCellResult(cell),valor_numero:cell.querySelector("[data-number]")?.value||null,valor_texto:cell.querySelector("[data-text]")?.value||null,observacao:cell.querySelector("[data-observation]")?.value||null,acao_imediata:cell.querySelector("[data-action]")?.value||null}));
  const productControl=document.querySelector(`.checklist-grid-produto[data-col="${colIndex}"]`);
  const productId=productControl?.value?Number(productControl.value):null;
  if(model.produto_obrigatorio&&!productId){checklistMessage("Selecione o produto dessa coluna antes de confirmar.","error");return}
  button.disabled=true;
  try{
    await checklistData.save({p_modelo_id:Number(modelId),p_data_operacional:cq("#execution-date").value,p_turno:cq("#execution-shift").value,p_produto_id:productId,p_equipamento:cq("#execution-equipment").value||null,p_corrida:cq("#execution-run").value||null,p_observacao:null,p_respostas:respostas,p_horario_previsto:slot});
    checklistMessage(`Check das ${gridTimeLabel(new Date(slot))} registrado com sucesso.`);
    await loadChecklistGrid(model,modelId);
  }catch(error){checklistMessage(error.message,"error");button.disabled=false}
}

async function initializeForm(){
  const params=new URLSearchParams(location.search),modelId=params.get("modelo");if(!modelId)throw new Error("Modelo não informado.");const[model,items,products]=await Promise.all([checklistData.model(modelId),checklistData.items(modelId),checklistData.products()]);if(!model)throw new Error("Modelo não encontrado.");
  const automaticMoldProduct=model.areas_checklist?.codigo==="MOLDAGEM"&&model.codigo==="M02"&&model.frequencia_tipo==="INTERVALO"&&Number(model.intervalo_minutos)===30;
  cq("#form-title").textContent=model.nome;cq("#form-subtitle").textContent=model.descricao||model.nome;cq("#form-code").textContent=`${model.areas_checklist?.nome} · ${model.codigo} · ${modelFrequency(model)}`;cq("#form-name").textContent=model.nome;cq("#form-instruction").textContent=`Referência: ${model.instrucao_codigo||"não informada"} · revisão do modelo ${model.versao}`;
  const operationalContext=checklistOperationalContext();cq("#execution-date").value=params.get("data")||operationalContext.date;if(operationalContext.shift)cq("#execution-shift").value=params.get("turno")||operationalContext.shift;
  cq("#checklist-back-link").href=backToApontamentoUrl();
  checklistEditingClosedShift=false;
  cq("#execution-product").insertAdjacentHTML("beforeend",products.map(product=>`<option value="${product.id}">${cesc(product.codigo)} — ${cesc(product.nome)}</option>`).join(""));let selectedProduct=params.get("produto");if(automaticMoldProduct&&!selectedProduct){const production=await checklistData.productionAt(cq("#execution-date").value,cq("#execution-shift").value);selectedProduct=production?.produto_id?String(production.produto_id):"";if(production?.produtos&&!products.some(product=>String(product.id)===selectedProduct))cq("#execution-product").insertAdjacentHTML("beforeend",`<option value="${production.produtos.id}">${cesc(production.produtos.codigo)} — ${cesc(production.produtos.nome)}</option>`)}if(selectedProduct)cq("#execution-product").value=selectedProduct;if(automaticMoldProduct&&selectedProduct){cq("#execution-product").disabled=true;cq("#product-field").dataset.automatic="true"}else if(automaticMoldProduct)checklistMessage("Não foi possível identificar automaticamente um produto em produção. Selecione o produto para continuar.");cq("#product-field").hidden=!model.produto_obrigatorio;cq("#equipment-field").hidden=automaticMoldProduct||!model.equipamento_obrigatorio;if(automaticMoldProduct)cq("#execution-equipment").value="";cq("#run-field").hidden=!model.corrida_obrigatoria;
  const postoGrid=model.areas_checklist?.codigo==="ACABAMENTO"&&model.codigo==="A01";
  const useGrid=!postoGrid&&GRID_FREQUENCIES.has(model.frequencia_tipo);
  if(postoGrid){
    cq(".checklist-submit-bar").hidden=true;
    cq("#execution-notes").closest(".panel").hidden=true;
    cq("#product-field").hidden=true;
    cq("#equipment-field").hidden=true;
    await loadPostoChecklistGrid(model,modelId);
    cq("#checklist-sections").addEventListener("click",event=>{
      const confirmButton=event.target.closest(".checklist-grid-confirm");if(confirmButton){const posto=currentPostoColumns.find(item=>String(item.id)===confirmButton.dataset.postoId);if(posto)submitPostoGridColumn(confirmButton,modelId,model,posto);return}
      const unlockButton=event.target.closest(".checklist-grid-unlock");if(unlockButton){checklistEditingClosedShift=true;loadPostoChecklistGrid(model,modelId).catch(error=>checklistMessage(error.message,"error"))}
    });
    cq("#checklist-sections").addEventListener("input",event=>{const cell=event.target.closest(".checklist-grid-cell");if(cell)syncGridCell(cell)});
    cq("#checklist-sections").addEventListener("change",event=>{const cell=event.target.closest(".checklist-grid-cell");if(cell)syncGridCell(cell)});
    cq("#execution-date").addEventListener("change",()=>loadPostoChecklistGrid(model,modelId).catch(error=>checklistMessage(error.message,"error")));
    cq("#execution-shift").addEventListener("change",()=>loadPostoChecklistGrid(model,modelId).catch(error=>checklistMessage(error.message,"error")));
  }else if(useGrid){
    cq(".checklist-submit-bar").hidden=true;
    cq("#execution-notes").closest(".panel").hidden=true;
    cq("#product-field").hidden=true;
    await loadChecklistGrid(model,modelId);
    cq("#checklist-sections").addEventListener("click",event=>{
      const confirmButton=event.target.closest(".checklist-grid-confirm");if(confirmButton)return submitGridColumn(confirmButton,modelId,model);
      const unlockButton=event.target.closest(".checklist-grid-unlock");if(unlockButton){checklistEditingClosedShift=true;loadChecklistGrid(model,modelId).catch(error=>checklistMessage(error.message,"error"))}
    });
    cq("#checklist-sections").addEventListener("input",event=>{const cell=event.target.closest(".checklist-grid-cell");if(cell)syncGridCell(cell)});
    cq("#checklist-sections").addEventListener("change",event=>{const cell=event.target.closest(".checklist-grid-cell");if(cell)syncGridCell(cell)});
    cq("#execution-date").addEventListener("change",()=>loadChecklistGrid(model,modelId).catch(error=>checklistMessage(error.message,"error")));
    cq("#execution-shift").addEventListener("change",()=>loadChecklistGrid(model,modelId).catch(error=>checklistMessage(error.message,"error")));
  }else{
    renderChecklistItems(items);
    cq("#checklist-sections").addEventListener("input",event=>{const article=event.target.closest(".checklist-item");if(article)syncItemState(article)});cq("#checklist-sections").addEventListener("change",event=>{const article=event.target.closest(".checklist-item");if(article)syncItemState(article)});cq("#checklist-sections").addEventListener("click",event=>{const button=event.target.closest("[data-confirm-section]");if(!button)return;for(const article of button.closest(".checklist-section").querySelectorAll(".checklist-item")){const radio=article.querySelector('input[value="CONFORME"]');if(radio){radio.checked=true;syncItemState(article)}}});
    cq("#checklist-form").addEventListener("submit",async event=>{event.preventDefault();const submit=cq("#submit-checklist");submit.disabled=true;try{const productId=cq("#execution-product").value?Number(cq("#execution-product").value):null,id=await checklistData.save({p_modelo_id:Number(modelId),p_data_operacional:cq("#execution-date").value,p_turno:cq("#execution-shift").value,p_produto_id:productId,p_equipamento:cq("#execution-equipment").value||null,p_corrida:cq("#execution-run").value||null,p_observacao:cq("#execution-notes").value||null,p_respostas:serializeChecklistAnswers()}),completedAt=new Date().toISOString();sessionStorage.setItem("lidutec:checklists:ultima-conclusao",JSON.stringify({id,modelo_id:Number(modelId),produto_id:productId,data_operacional:cq("#execution-date").value,turno:cq("#execution-shift").value,status:"CONFORME",iniciado_em:completedAt,concluido_em:completedAt}));alert(`Checklist ${id} registrado com sucesso.`);location.replace(params.get("origem")==="apontamento"?backToApontamentoUrl():"./checklist-historico.html")}catch(error){checklistMessage(error.message);submit.disabled=false}});
  }
  cq("#checklist-loading").hidden=true;cq("#checklist-form").hidden=false;
}

function populateAreaFilter(){cq("#history-area").insertAdjacentHTML("beforeend",checklistState.areas.map(area=>`<option value="${cesc(area.codigo)}">${cesc(area.nome)}</option>`).join(""))}
function renderHistory(){const area=cq("#history-area").value,status=cq("#history-status").value,from=cq("#history-from").value,to=cq("#history-to").value;const rows=checklistState.executions.filter(row=>(!area||row.modelos_checklist?.areas_checklist?.codigo===area)&&(!status||row.status===status)&&(!from||row.data_operacional>=from)&&(!to||row.data_operacional<=to));cq("#history-rows").innerHTML=rows.map(row=>`<tr class="checklist-history-row" data-execution-id="${row.id}" tabindex="0"><td>${formatDateTimeChecklist(row.iniciado_em)}</td><td>${cesc(row.modelos_checklist?.areas_checklist?.nome)}</td><td><strong>${cesc(row.modelos_checklist?.codigo)}</strong> — ${cesc(row.modelos_checklist?.nome)}</td><td>${cesc(row.turno)}</td><td>${cesc(row.produtos?.codigo||"—")}</td><td>${cesc(row.equipamento||"—")}</td><td>${cesc(row.usuarios?.nome||"—")}</td><td>${statusBadge(row.status)}</td><td><button type="button" class="checklist-detail-button" data-view-execution="${row.id}">Visualizar</button></td></tr>`).join("");cq("#history-empty").hidden=rows.length>0}
function detailResultBadge(result){const label={CONFORME:"Conforme",NAO_CONFORME:"Não conforme",NAO_APLICAVEL:"Não aplicável"}[result]||result||"Não respondido",style=result==="CONFORME"?"conforme":result==="NAO_CONFORME"?"nao_conforme":"em_preenchimento";return`<span class="checklist-status status-${style}">${cesc(label)}</span>`}
function renderHistoryDetail(execution){const answers=[...(execution.respostas_checklist||[])].sort((a,b)=>(a.itens_checklist?.ordem||0)-(b.itens_checklist?.ordem||0)),releases=[...(execution.liberacoes_checklist||[])].sort((a,b)=>new Date(a.decidido_em)-new Date(b.decidido_em)),model=execution.modelos_checklist,product=execution.produtos,answerRows=answers.map(answer=>{const item=answer.itens_checklist,value=answer.valor_numero!=null?`${answer.valor_numero} ${item?.unidade||""}`:answer.valor_texto||"—";return`<tr><td>${cesc(item?.codigo||"—")}</td><td><strong>${cesc(item?.descricao||"—")}</strong>${item?.critico?'<span class="checklist-critical">Crítico</span>':""}</td><td>${detailResultBadge(answer.resultado)}</td><td>${cesc(value)}</td><td>${cesc(answer.observacao||"—")}</td><td>${cesc(answer.acao_imediata||"—")}</td></tr>`}).join("");cq("#history-detail-title").textContent=`${model?.codigo||"Checklist"} — ${model?.nome||"Detalhes"}`;cq("#history-detail-content").innerHTML=`<section class="checklist-detail-summary"><div><span>Status</span>${statusBadge(execution.status)}</div><div><span>Data operacional</span><strong>${cesc(new Date(`${execution.data_operacional}T12:00:00`).toLocaleDateString("pt-BR"))}</strong></div><div><span>Turno</span><strong>${cesc(execution.turno)}</strong></div><div><span>Produto</span><strong>${cesc(product?`${product.codigo} — ${product.nome}`:"—")}</strong></div><div><span>Equipamento</span><strong>${cesc(execution.equipamento||"—")}</strong></div><div><span>Operador</span><strong>${cesc(execution.usuarios?.nome||"—")}</strong></div><div><span>Início</span><strong>${formatDateTimeChecklist(execution.iniciado_em)}</strong></div><div><span>Conclusão</span><strong>${formatDateTimeChecklist(execution.concluido_em)}</strong></div></section><section class="checklist-detail-answers"><h3>Respostas registradas</h3><div class="table-wrapper"><table class="products-table"><thead><tr><th>Item</th><th>Verificação</th><th>Resultado</th><th>Valor</th><th>Desvio</th><th>Ação imediata</th></tr></thead><tbody>${answerRows}</tbody></table></div></section>${execution.observacao?`<section class="checklist-detail-notes"><h3>Observações gerais</h3><p>${cesc(execution.observacao)}</p></section>`:""}${releases.length?`<section class="checklist-detail-decisions"><h3>Decisões do supervisor</h3>${releases.map(item=>`<article><div>${detailResultBadge(item.decisao==="LIBERADO"?"CONFORME":"NAO_CONFORME")}<strong>${cesc(item.decisao==="LIBERADO"?"Liberado":"Mantido bloqueado")}</strong></div><p>${cesc(item.justificativa)}</p><small>${formatDateTimeChecklist(item.decidido_em)} · ${cesc(item.usuarios?.nome||"Supervisor")}</small></article>`).join("")}</section>`:""}`}
async function openHistoryDetail(executionId){const dialog=cq("#history-detail-dialog");cq("#history-detail-title").textContent="Detalhes do registro";cq("#history-detail-content").innerHTML='<div class="loading-state">Carregando detalhes...</div>';if(!dialog.open)dialog.showModal();try{const execution=await checklistData.execution(executionId);if(!execution)throw new Error("Registro de checklist não encontrado.");renderHistoryDetail(execution)}catch(error){cq("#history-detail-content").innerHTML=`<div class="form-message error">${cesc(error.message)}</div>`}}
async function initializeHistory(){const[areas,executions]=await Promise.all([checklistData.areas(),checklistData.executions()]);checklistState.areas=areas;checklistState.executions=executions;populateAreaFilter();for(const input of document.querySelectorAll(".checklist-filters input,.checklist-filters select"))input.addEventListener("input",renderHistory);const rows=cq("#history-rows"),dialog=cq("#history-detail-dialog");rows.addEventListener("click",event=>{const target=event.target.closest("[data-view-execution],.checklist-history-row");if(target)openHistoryDetail(target.dataset.viewExecution||target.dataset.executionId)});rows.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches(".checklist-history-row")){event.preventDefault();openHistoryDetail(event.target.dataset.executionId)}});dialog.addEventListener("click",event=>{if(event.target.matches("[data-detail-close]")||event.target===dialog)dialog.close()});renderHistory();cq("#checklist-loading").hidden=true}

function renderTrendChart(rows){const container=cq("#trend-chart");if(!rows.length){container.innerHTML="";return}if(rows.length>500){const step=(rows.length-1)/499;rows=Array.from({length:500},(_,index)=>rows[Math.round(index*step)])}const width=Math.max(720,rows.length*48),height=280,padding={left:54,right:20,top:20,bottom:48},values=rows.flatMap(row=>[Number(row.valor),row.limite_minimo,row.valor_alvo,row.limite_maximo].filter(value=>value!=null).map(Number)),min=Math.min(...values),max=Math.max(...values),range=max-min||1,x=index=>padding.left+index*(width-padding.left-padding.right)/Math.max(1,rows.length-1),y=value=>padding.top+(max-value)*(height-padding.top-padding.bottom)/range,line=key=>{const points=rows.map((row,index)=>row[key]==null?null:`${x(index)},${y(Number(row[key]))}`).filter(Boolean);return points.length?`<polyline class="trend-${key}" points="${points.join(" ")}"/>`:""};container.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Carta de tendência"><line class="trend-axis" x1="${padding.left}" y1="${height-padding.bottom}" x2="${width-padding.right}" y2="${height-padding.bottom}"/>${line("limite_minimo")}${line("valor_alvo")}${line("limite_maximo")}<polyline class="trend-value-line" points="${rows.map((row,index)=>`${x(index)},${y(Number(row.valor))}`).join(" ")}"/>${rows.map((row,index)=>`<circle class="trend-point${row.conforme===false?" nok":""}" cx="${x(index)}" cy="${y(Number(row.valor))}" r="4"><title>${formatDateTimeChecklist(row.medido_em)}: ${row.valor}</title></circle>`).join("")}</svg>`}
async function loadMeasurements(){const itemId=cq("#chart-item").value;if(!itemId)return;const rows=await checklistData.measurements(itemId,cq("#chart-from").value,cq("#chart-to").value),tableRows=rows.slice(-500);cq("#chart-total").textContent=rows.length;cq("#chart-ok").textContent=rows.filter(row=>row.conforme!==false).length;cq("#chart-nok").textContent=rows.filter(row=>row.conforme===false).length;cq("#measurement-rows").innerHTML=tableRows.map(row=>`<tr><td>${formatDateTimeChecklist(row.medido_em)}</td><td>${cesc(row.produtos?.codigo||"—")}</td><td>${cesc(row.equipamento||"—")}</td><td>${row.limite_minimo??"—"}</td><td>${row.valor_alvo??"—"}</td><td>${row.limite_maximo??"—"}</td><td><strong>${row.valor}</strong> ${cesc(row.itens_checklist?.unidade||"")}</td><td>${row.conforme===false?'<span class="checklist-status status-nao_conforme">Fora da faixa</span>':'<span class="checklist-status status-conforme">Conforme</span>'}</td></tr>`).join("");cq("#chart-empty").hidden=rows.length>0;renderTrendChart(rows)}
async function initializeCharts(){const items=await checklistData.chartItems();cq("#chart-item").insertAdjacentHTML("beforeend",items.map(item=>`<option value="${item.id}">${cesc(item.modelos_checklist?.areas_checklist?.nome)} · ${cesc(item.modelos_checklist?.codigo)} · ${cesc(item.descricao)}</option>`).join(""));cq("#chart-apply").addEventListener("click",()=>loadMeasurements().catch(error=>alert(error.message)));cq("#checklist-loading").hidden=true}

async function initializeChecklistModule(){if(!await initializeChecklistSession())return;if(checklistPage==="dashboard")await initializeDashboard();if(checklistPage==="form")await initializeForm();if(checklistPage==="history")await initializeHistory();if(checklistPage==="charts")await initializeCharts()}
cq("#menu-button")?.addEventListener("click",()=>cq("#sidebar").classList.toggle("open"));cq("#logout-button")?.addEventListener("click",()=>window.LIDUTEC_APP.signOut());setInterval(()=>{if(checklistPage==="dashboard"){const area=cq("#area-tabs .active")?.dataset.area;if(area)refreshCurrentShiftExists().then(()=>renderModels(area))}},60000);initializeChecklistModule().catch(error=>{console.error(error);const loading=cq("#checklist-loading");if(loading)loading.textContent=`Erro: ${error.message}`});
