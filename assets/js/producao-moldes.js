const productionPage = document.body.dataset.productionPage;
// Se veio do checklist com "?editar=1" (ida e volta durante uma edição de
// turno fechado), reabre o modo de edição sozinho assim que o turno carregar
// — sem isso, sair pro checklist e voltar perdia o modo de edição, que só
// existe na memória da página. Consumido uma única vez.
let pendingAutoEdit = new URLSearchParams(location.search).get("editar") === "1";
const productionState = { user:null, permissions:new Set(), products:[], lines:[], categories:[], sectors:[], scheduledStops:[], records:[], stops:[], materialByProduct:new Map(), cycleTimeByProduct:new Map(), currentShift:null, previousProductId:null, editingClosed:false, originalShiftData:null, statusRequestId:0, draftSaveTimer:null, draftSaveInFlight:false, querySort:{key:null,direction:"asc"}, stopSort:{key:null,direction:"asc"}, visibleProductionRows:[], visibleStopRows:[] };
const q = (selector) => document.querySelector(selector);
const esc = (value="") => String(value).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number = (value) => Number(value || 0);
const formatDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const formatMinutes = (value) => `${Math.floor(number(value)/60)}h ${String(number(value)%60).padStart(2,"0")}min`;
function message(text,type="success",source="general"){const el=q("#production-message");if(!el)return;el.textContent=text;el.className=`form-message ${type}`;el.dataset.source=source;el.hidden=false}
function clearMessage(source){const el=q("#production-message");if(!el||el.hidden||el.dataset.source!==source)return;el.hidden=true;el.textContent="";el.className="form-message";delete el.dataset.source}
async function loadSupport(){
  // support() e scheduledStopsAll() não dependem um do outro — busca os dois
  // ao mesmo tempo em vez de esperar o primeiro terminar pra só então pedir o segundo.
  const[{products,lines,categories,sectors},scheduledStops]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.support(),window.LIDUTEC_PRODUCAO_DATA.scheduledStopsAll()]);
  productionState.products=products;productionState.lines=lines;productionState.categories=categories;productionState.sectors=sectors;productionState.scheduledStops=scheduledStops;
  for(const select of document.querySelectorAll("[data-products]"))select.insertAdjacentHTML("beforeend",productionState.products.map(p=>`<option value="${p.id}">${esc(p.codigo)} — ${esc(p.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-lines]"))select.insertAdjacentHTML("beforeend",lines.map(x=>`<option value="${x.id}">${esc(x.codigo)} — ${esc(x.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-categories]"))select.insertAdjacentHTML("beforeend",categories.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-sectors]"))select.insertAdjacentHTML("beforeend",productionState.sectors.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join(""));
}

const optionList=(rows,labelFn)=>rows.map(x=>`<option value="${x.id}">${esc(labelFn(x))}</option>`).join("");
function productionRow(){
  const row=document.createElement("tr");row.className="shift-production-row";
  row.innerHTML=`<td><input name="inicio" type="time" step="60"></td><td><input name="fim" type="time" step="60" readonly aria-readonly="true" title="Calculado automaticamente pela sequência das linhas de produção."></td><td><output data-setup>Setup</output></td><td><select name="produto_id"><option value="">Selecione</option>${optionList(productionState.products,p=>`${p.codigo} — ${p.nome}`)}</select></td><td><input name="rastreabilidade" type="text" maxlength="120" placeholder="lote"></td><td><input name="moldes_vazados" type="number" min="0" step="1" value="0"></td><td><input name="moldes_quebrados" type="number" min="0" step="1" value="0"></td><td><output data-total-moldes>0</output></td><td><output data-toneladas>0,000</output></td><td><output data-total-pecas>0</output></td><td><input name="observacao" type="text" maxlength="500"></td><td><button type="button" class="row-remove" aria-label="Remover linha">×</button></td>`;
  return row;
}
function stopRow(){
  const row=document.createElement("tr");row.className="shift-stop-row";
  row.innerHTML=`<td><input name="inicio" type="time" step="60"></td><td><input name="fim" type="time" step="60"></td><td><output data-duration>0h 00min</output></td><td><select name="setor_id"><option value="">Selecione</option>${optionList(productionState.sectors,x=>x.nome)}</select></td><td><select name="categoria_id"><option value="">Selecione</option>${optionList(productionState.categories,x=>x.nome)}</select></td><td><input name="observacao" type="text" maxlength="500"></td><td><button type="button" class="row-remove" aria-label="Remover linha">×</button></td>`;
  return row;
}
function shiftDateTimeBounds(){
  const form=q("#shift-entry-form"),date=form?.elements.data_operacional.value,shift=window.LIDUTEC_TURNOS.shifts[form?.elements.turno.value];if(!date||!shift)return null;
  const{start,end}=window.LIDUTEC_TURNOS.shiftBounds(date,form.elements.turno.value);
  const inputValue=value=>{const pad=item=>String(item).padStart(2,"0");return`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`};return{start,end,min:inputValue(start),max:inputValue(end)};
}
function applyShiftDateTimeLimits(){const bounds=shiftDateTimeBounds();if(!bounds)return;for(const input of document.querySelectorAll('.shift-entry-table input[type="datetime-local"]')){input.min=bounds.min;input.max=bounds.max}}
function validateShiftInterval(startValue,endValue,label){const form=q("#shift-entry-form"),bounds=shiftDateTimeBounds();if(!bounds||!window.LIDUTEC_TURNOS.intervalWithinShift(form.elements.data_operacional.value,form.elements.turno.value,startValue,endValue))throw new Error(`${label} deve estar entre ${bounds?.min.replace("T"," ")} e ${bounds?.max.replace("T"," ")}.`)}
function appendEntryRow(target,row){q(target).append(row);applyShiftDateTimeLimits();}
function shiftDraftKey(){const form=q("#shift-entry-form"),date=form?.elements.data_operacional.value||"sem-data",shift=form?.elements.turno.value||"sem-turno";return `lidutec:producao-moldes:rascunho:${productionState.user?.id||"anonimo"}:${date}:${shift}`;}
function rowValues(row){return Object.fromEntries([...row.querySelectorAll("input,select")].map(control=>[control.name,control.value]));}
function applyRowValues(row,values={}){for(const control of row.querySelectorAll("input,select")){if(Object.hasOwn(values,control.name))control.value=values[control.name]??""}}
function syncRequiredFields(row,names,active=true,invalid=[]){for(const name of names){const control=row.querySelector(`[name="${name}"]`);if(!control)continue;const pending=active&&(!String(control.value).trim()||invalid.includes(name));control.classList.toggle("field-required",active);control.classList.toggle("field-pending",pending);control.setAttribute("aria-invalid",String(pending))}}
function syncProductionEndTimes({onlyMissing=false,referenceTime=new Date()}={}){
  if(productionState.currentShift?.status==="FECHADO"&&!productionState.editingClosed&&!onlyMissing)return;
  const bounds=shiftDateTimeBounds(),rows=[...document.querySelectorAll(".shift-production-row")];if(!bounds||!rows.length)return;
  const form=q("#shift-entry-form"),date=form.elements.data_operacional.value,shift=form.elements.turno.value,effectiveReference=productionState.editingClosed?bounds.end:referenceTime;
  rows.forEach((row,index)=>{const startInput=row.querySelector('[name="inicio"]'),endInput=row.querySelector('[name="fim"]'),nextValue=rows.slice(index+1).map(item=>item.querySelector('[name="inicio"]')?.value).find(value=>resolveShiftTime(value));if(!onlyMissing||!endInput.value)endInput.value=window.LIDUTEC_TURNOS.productionEndTime(date,shift,startInput.value,nextValue,effectiveReference);endInput.title=nextValue?"Calculado como o início da próxima linha menos 1 minuto.":"Atualizado automaticamente, respeitando o limite do turno.";syncRequiredFields(row,["inicio","produto_id","moldes_vazados","moldes_quebrados"])});
  renderShiftTimeline();
}
function resolveShiftTime(value){
  const form=q("#shift-entry-form");return window.LIDUTEC_TURNOS.resolveShiftTime(form?.elements.data_operacional.value,form?.elements.turno.value,value);
}
function normalizeStopTimeInput(value){const text=String(value||"").trim(),match=text.match(/(?:T|\s)(\d{2}:\d{2})/)||text.match(/^(\d{2}:\d{2})/);return match?match[1]:""}
function saveShiftDraft(){
  const form=q("#shift-entry-form");if(!form||!productionState.user)return;
  if(productionState.currentShift?.status==="FECHADO")return;
  const draft={savedAt:Date.now(),data_operacional:form.elements.data_operacional.value,turno:form.elements.turno.value,productions:[...document.querySelectorAll(".shift-production-row")].map(rowValues),stops:[...document.querySelectorAll(".shift-stop-row")].map(rowValues)};
  localStorage.setItem(shiftDraftKey(),JSON.stringify(draft));
  clearTimeout(productionState.draftSaveTimer);productionState.draftSaveTimer=setTimeout(()=>persistSharedShiftDraft(draft),800);
}
async function persistSharedShiftDraft(draft){
  if(productionState.currentShift?.status==="FECHADO"||productionState.editingClosed||productionState.draftSaveInFlight)return;
  productionState.draftSaveInFlight=true;
  try{const saved=await window.LIDUTEC_PRODUCAO_DATA.saveShiftDraft({p_data_operacional:draft.data_operacional,p_turno:draft.turno,p_producoes:draft.productions,p_paradas:draft.stops,p_versao:productionState.currentShift?.versao??null});productionState.currentShift={...(productionState.currentShift||{}),...saved,data_operacional:draft.data_operacional,turno:draft.turno,status:"ABERTO"};q("#shift-status").textContent="Em apontamento · salvo agora"}
  catch(error){if(/CONFLITO_RASCUNHO|40001/i.test(`${error.message||""} ${error.code||""}`)){productionState.draftSaveInFlight=false;message("Este turno foi atualizado por outro usuário. Carregamos a versão mais recente.","error","shared-draft");await checkShiftStatus()}else message(`Não foi possível salvar o rascunho compartilhado: ${error.message}`,"error","shared-draft")}
  finally{productionState.draftSaveInFlight=false}
}
function populateSharedDraft(productions=[],stops=[]){q("#production-entry-rows").replaceChildren();q("#stop-entry-rows").replaceChildren();for(const values of productions.length?productions:[{}]){const row=productionRow();applyRowValues(row,values);appendEntryRow("#production-entry-rows",row);updateProductionRow(row)}for(const values of stops.length?stops:[{}]){const row=stopRow();applyRowValues(row,values);appendEntryRow("#stop-entry-rows",row);try{updateStopRow(row)}catch{row.querySelector("[data-duration]").textContent="Horário inválido"}}syncProductionEndTimes();renderShiftTimeline()}
function restoreShiftDraft(){
  let draft=null;try{draft=JSON.parse(localStorage.getItem(shiftDraftKey())||"null")}catch{localStorage.removeItem(shiftDraftKey())}
  if(!draft)return false;if(!draft.savedAt||Date.now()-draft.savedAt>24*60*60*1000){localStorage.removeItem(shiftDraftKey());return false}const form=q("#shift-entry-form");
  if(draft.data_operacional)form.elements.data_operacional.value=draft.data_operacional;if(draft.turno)form.elements.turno.value=draft.turno;
  q("#production-entry-rows").replaceChildren();q("#stop-entry-rows").replaceChildren();
  for(const values of draft.productions?.length?draft.productions:[{}]){const row=productionRow();applyRowValues(row,{...values,inicio:normalizeStopTimeInput(values.inicio),fim:normalizeStopTimeInput(values.fim)});appendEntryRow("#production-entry-rows",row);updateProductionRow(row)}
  for(const values of draft.stops?.length?draft.stops:[{}]){const row=stopRow();applyRowValues(row,{...values,inicio:normalizeStopTimeInput(values.inicio),fim:normalizeStopTimeInput(values.fim)});appendEntryRow("#stop-entry-rows",row);try{updateStopRow(row)}catch{row.querySelector("[data-duration]").textContent="Horário inválido"}}
  return true;
}
function resetShiftEntryRows(){
  q("#production-entry-rows").replaceChildren(productionRow());
  q("#stop-entry-rows").replaceChildren(stopRow());
  renderShiftTimeline();
}
function updateProductionRow(row){
  let setupNumber=0;[...document.querySelectorAll(".shift-production-row")].forEach((item,index)=>{const productId=item.querySelector('[name="produto_id"]').value,isSequence=index===0&&productId&&String(productId)===String(productionState.previousProductId),label=item.querySelector("[data-setup]");item.dataset.setupRequired=String(!isSequence);label.textContent=isSequence?"Sequência":`Setup ${++setupNumber}`;label.title=isSequence?"Mesmo produto da última produção do turno anterior.":"Exige checklist de setup."});
  const product=productionState.products.find(x=>String(x.id)===row.querySelector('[name="produto_id"]').value);
  const poured=number(row.querySelector('[name="moldes_vazados"]').value);const broken=number(row.querySelector('[name="moldes_quebrados"]').value);
  const calculation=window.LIDUTEC_TURNOS.productionCalculation(poured,broken,product?.cavidades_molde,product?.peso_peca_kg);
  row.querySelector("[data-total-moldes]").textContent=calculation.totalMolds;row.querySelector("[data-total-pecas]").textContent=calculation.totalPieces.toLocaleString("pt-BR");row.querySelector("[data-toneladas]").textContent=calculation.tons.toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3});syncRequiredFields(row,["inicio","produto_id","moldes_vazados","moldes_quebrados"]);renderShiftTimeline();
}
function updateStopRow(row){
  const start=row.querySelector('[name="inicio"]').value,end=row.querySelector('[name="fim"]').value;
  const active=[...row.querySelectorAll("input,select")].some(control=>String(control.value).trim()),required=["inicio","fim","setor_id","categoria_id"];let minutes=0;if(start&&end){const resolvedStart=resolveShiftTime(start),resolvedEnd=resolveShiftTime(end);if(!resolvedStart||!resolvedEnd||resolvedEnd<resolvedStart){syncRequiredFields(row,required,active,["inicio","fim"]);throw new Error("Os horários da parada devem estar dentro do turno selecionado.")}minutes=window.LIDUTEC_TURNOS.stopDurationMinutes(resolvedStart.toISOString(),resolvedEnd.toISOString())}
  syncRequiredFields(row,required,active);row.querySelector("[data-duration]").textContent=formatMinutes(minutes);renderShiftTimeline();
}
function renderShiftTimeline(){
  const form=q("#shift-entry-form"),productionContainer=q("#shift-production-segments"),container=q("#shift-stop-segments");if(!form||!productionContainer||!container)return;
  const date=form.elements.data_operacional.value,shift=window.LIDUTEC_TURNOS.shifts[form.elements.turno.value];if(!date||!shift)return;
  const start=new Date(`${date}T${shift.inicio}`),end=new Date(`${date}T${shift.fim}`);if(end<=start)end.setDate(end.getDate()+1);
  q("#timeline-start").textContent=shift.inicio;q("#timeline-end").textContent=`${shift.fim}${end.getDate()!==start.getDate()?" (+1 dia)":""}`;
  const duration=end-start,productionSegments=[],segments=[];
  const spanFor=(interval,className,title="")=>{
    const left=(interval.start.getTime()-start.getTime())/duration*100,width=(interval.end.getTime()-interval.start.getTime())/duration*100;
    return `<span class="${className}" style="left:${left}%;width:${width}%"${title?` title="${title}"`:""}></span>`;
  };
  // Janela de parada programada (refeição, manutenção preventiva etc.) sempre
  // aparece em amarelo, tenha ou não parada real lançada nesse horário; as
  // paradas realmente registradas ficam em vermelho, por cima.
  const planejados=window.LIDUTEC_PARADAS_PROGRAMADAS.overlapIntervals({
    janelas:productionState.scheduledStops||[],turnoInicio:start,
    paradaInicio:start,paradaFim:end,turno:form.elements.turno.value,dataOperacional:date
  });
  segments.push(...planejados.map(interval=>spanFor(interval,"shift-planned-segment","Parada programada")));
  for(const row of document.querySelectorAll(".shift-production-row")){
    const startValue=row.querySelector('[name="inicio"]').value,endValue=row.querySelector('[name="fim"]').value,productId=row.querySelector('[name="produto_id"]').value;if(!startValue||!endValue||!productId)continue;
    const productionStart=resolveShiftTime(startValue),productionEnd=resolveShiftTime(endValue);if(!productionStart||!productionEnd||productionEnd<=productionStart)continue;
    const visibleStart=Math.max(start.getTime(),productionStart.getTime()),visibleEnd=Math.min(end.getTime(),productionEnd.getTime());if(visibleEnd<=visibleStart)continue;
    const left=(visibleStart-start)/duration*100,width=(visibleEnd-visibleStart)/duration*100,product=productionState.products.find(item=>String(item.id)===productId),label=product?.codigo||"Produto";
    const title=esc(product?`${product.codigo} — ${product.nome}`:label),center=left+width/2;
    productionSegments.push(`<span class="shift-production-segment" style="left:${left}%;width:${width}%" title="${title}"></span><span class="shift-production-label" style="left:${center}%">${esc(label)}</span>`);
  }
  for(const row of document.querySelectorAll(".shift-stop-row")){
    const startValue=row.querySelector('[name="inicio"]').value,endValue=row.querySelector('[name="fim"]').value;if(!startValue||!endValue)continue;
    const stopStart=resolveShiftTime(startValue),stopEnd=resolveShiftTime(endValue);if(!stopStart||!stopEnd||stopEnd<=stopStart)continue;
    const visibleStart=Math.max(start.getTime(),stopStart.getTime()),visibleEnd=Math.min(end.getTime(),stopEnd.getTime());if(visibleEnd<=visibleStart)continue;
    const sector=row.querySelector('[name="setor_id"] option:checked')?.textContent||"Parada",reason=row.querySelector('[name="categoria_id"] option:checked')?.textContent||"Motivo não informado";
    const title=`${esc(sector)} — ${esc(reason)} — ${formatMinutes(Math.round((visibleEnd-visibleStart)/60000))}`;
    segments.push(spanFor({start:new Date(visibleStart),end:new Date(visibleEnd)},"shift-stop-segment",title));
  }
  productionContainer.innerHTML=productionSegments.join("");container.innerHTML=segments.join("");
}
function completeRow(row,names){return names.some(name=>row.querySelector(`[name="${name}"]`)?.value);}
function serializeShift(){
  syncProductionEndTimes();
  const productions=[...document.querySelectorAll(".shift-production-row")].filter(row=>completeRow(row,["inicio","fim","produto_id"])).map(row=>{
    const product=productionState.products.find(x=>String(x.id)===row.querySelector('[name="produto_id"]').value);
    if(!row.querySelector('[name="inicio"]').value||!row.querySelector('[name="fim"]').value||!product)throw new Error("Preencha início, fim e produto em todas as linhas de produção.");
    if(product.cavidades_molde==null||product.peso_peca_kg==null)throw new Error(`O produto ${product.codigo} não possui cavidades por molde ou peso da peça cadastrado.`);
    const start=resolveShiftTime(row.querySelector('[name="inicio"]').value),end=resolveShiftTime(row.querySelector('[name="fim"]').value);if(!start||!end)throw new Error("Os horários da produção devem estar dentro do turno selecionado.");validateShiftInterval(start.toISOString(),end.toISOString(),"A produção");
    return{inicio:start.toISOString(),fim:end.toISOString(),produto_id:number(product.id),rastreabilidade:row.querySelector('[name="rastreabilidade"]').value,moldes_vazados:number(row.querySelector('[name="moldes_vazados"]').value),moldes_quebrados:number(row.querySelector('[name="moldes_quebrados"]').value),observacao:row.querySelector('[name="observacao"]').value};
  });
  if(!productions.length)throw new Error("Informe ao menos uma linha de produção.");
  const stops=[...document.querySelectorAll(".shift-stop-row")].filter(row=>completeRow(row,["inicio","fim","setor_id","categoria_id","observacao"])).map(row=>{
    const value=name=>row.querySelector(`[name="${name}"]`).value;if(!value("inicio")||!value("fim")||!value("setor_id")||!value("categoria_id"))throw new Error("Preencha início, fim, setor e motivo em todas as paradas.");const start=resolveShiftTime(value("inicio")),end=resolveShiftTime(value("fim"));if(!start||!end)throw new Error("Os horários da parada devem estar dentro do turno selecionado.");validateShiftInterval(start.toISOString(),end.toISOString(),"A parada");return{inicio:start.toISOString(),fim:end.toISOString(),setor_id:number(value("setor_id")),categoria_id:number(value("categoria_id")),observacao:value("observacao")};
  });
  // Na Moldagem uma parada trava o turno inteiro (não existe posto/equipamento
  // por parada), então duas paradas não podem ter horários sobrepostos.
  if(window.LIDUTEC_TURNOS.findOverlappingInterval(stops))throw new Error("Há paradas com horários sobrepostos. Ajuste os horários antes de continuar.");
  return{productions,stops};
}
const toTimeInput=value=>{if(!value)return"";const date=new Date(value),pad=item=>String(item).padStart(2,"0");return`${pad(date.getHours())}:${pad(date.getMinutes())}`};
function populateShiftRows(productions,stops){
  q("#production-entry-rows").replaceChildren();q("#stop-entry-rows").replaceChildren();
  for(const item of productions.length?productions:[{}]){const row=productionRow();applyRowValues(row,{inicio:toTimeInput(item.inicio),fim:toTimeInput(item.fim),produto_id:item.produto_id??"",rastreabilidade:item.rastreabilidade??"",moldes_vazados:item.moldes_vazados??0,moldes_quebrados:item.moldes_quebrados??0,observacao:item.observacao??""});q("#production-entry-rows").append(row);updateProductionRow(row)}
  for(const item of stops.length?stops:[{}]){const row=stopRow();applyRowValues(row,{inicio:toTimeInput(item.inicio),fim:toTimeInput(item.fim),setor_id:item.setor_responsavel_id??item.setor_id??"",categoria_id:item.categoria_id??"",observacao:item.observacao??""});q("#stop-entry-rows").append(row);try{updateStopRow(row)}catch{}}
}
async function loadShiftHistory(turnId){
  const data=await window.LIDUTEC_PRODUCAO_DATA.history(turnId);
  const rows=(data||[]).flatMap(item=>{const normalize=snapshot=>({productions:snapshot?.productions||[],stops:(snapshot?.stops||[]).map(stop=>({...stop,setor_id:stop.setor_responsavel_id}))}),changes=item.dados_anteriores&&item.dados_novos?changeDescriptions(normalize(item.dados_anteriores),normalize(item.dados_novos)):[item.descricao];return(changes.length?changes:[item.descricao]).map(description=>({alterado_em:item.alterado_em,nome:item.usuarios?.nome||"Usuário",description}))});
  const panel=q("#shift-edit-history");panel.hidden=!rows.length;q("#shift-edit-history-rows").innerHTML=rows.map(item=>`<tr><td>${formatDateTime(item.alterado_em)}</td><td>${esc(item.nome)} alterou ${esc(item.description)}.</td></tr>`).join("");
}
async function editClosedShift(){
  const turnId=productionState.currentShift?.id;if(!turnId)return;
  if(!productionState.originalShiftData){const[productions,stops]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.shiftProductions(turnId),window.LIDUTEC_PRODUCAO_DATA.shiftStops(turnId)]);productionState.originalShiftData={productions,stops};populateShiftRows(productions,stops);syncProductionEndTimes({onlyMissing:true,referenceTime:shiftDateTimeBounds().end})}
  productionState.editingClosed=true;
  const form=q("#shift-entry-form");form.classList.remove("shift-readonly");for(const control of form.querySelectorAll("tbody input,tbody select,tbody button,#add-production-row,#add-stop-row"))control.disabled=false;q("#edit-shift-button").hidden=true;q("#delete-shift-button").hidden=true;q("#close-shift-button").hidden=false;q("#close-shift-button").disabled=false;q("#close-shift-button").textContent="Salvar alterações";q("#shift-status").textContent="Editando turno fechado";
  updateChecklistLink();
}
function updateChecklistLink(){
  const link=q("#checklist-link"),form=q("#shift-entry-form");if(!link||!form)return;
  const params=new URLSearchParams();
  if(form.elements.data_operacional.value)params.set("data",form.elements.data_operacional.value);
  if(form.elements.turno.value)params.set("turno",form.elements.turno.value);
  params.set("origem","apontamento");
  if(productionState.editingClosed)params.set("editar","1");
  link.href=`../controle-processo/checklists.html?area=MOLDAGEM&${params}`;
}
function changeDescriptions(original,current){
  const changes=[],valueText=value=>value==null||value===""?"vazio":String(value),productCode=id=>productionState.products.find(item=>String(item.id)===String(id))?.codigo||`produto ${id}`;
  const productionFields={inicio:"início",fim:"fim",produto_id:"produto",rastreabilidade:"rastreabilidade",moldes_vazados:"moldes vazados",moldes_quebrados:"moldes quebrados",observacao:"observação da produção"};
  const oldProductions=original.productions||[],newProductions=current.productions||[],maxProduction=Math.max(oldProductions.length,newProductions.length);
  for(let index=0;index<maxProduction;index++){const before=oldProductions[index],after=newProductions[index];if(!before&&after){changes.push(`adicionou produção de ${productCode(after.produto_id)}`);continue}if(before&&!after){changes.push(`removeu produção de ${productCode(before.produto_id)}`);continue}for(const[field,label]of Object.entries(productionFields)){const isDate=field==="inicio"||field==="fim",oldValue=isDate?toTimeInput(before[field]):String(before[field]??""),newValue=isDate?toTimeInput(after[field]):String(after[field]??"");if(oldValue!==newValue)changes.push(`${label} de ${productCode(after.produto_id||before.produto_id)} de ${valueText(oldValue)} para ${valueText(newValue)}`)}}
  const oldStops=original.stops||[],newStops=current.stops||[],maxStops=Math.max(oldStops.length,newStops.length),stopFields={inicio:"início da parada",fim:"fim da parada",setor_id:"setor responsável",categoria_id:"motivo da parada",observacao:"observação da parada"};
  for(let index=0;index<maxStops;index++){const before=oldStops[index]&&{...oldStops[index],setor_id:oldStops[index].setor_responsavel_id},after=newStops[index];if(!before&&after){changes.push(`adicionou a parada ${index+1}`);continue}if(before&&!after){changes.push(`removeu a parada ${index+1}`);continue}for(const[field,label]of Object.entries(stopFields)){const isDate=field==="inicio"||field==="fim",oldValue=isDate?toTimeInput(before[field]):String(before[field]??""),newValue=isDate?toTimeInput(after[field]):String(after[field]??"");if(oldValue!==newValue)changes.push(`${label} ${index+1} de ${valueText(oldValue)} para ${valueText(newValue)}`)}}return changes;
}
async function checkShiftStatus(){
  const form=q("#shift-entry-form"),date=form.elements.data_operacional.value,shift=form.elements.turno.value;if(!date||!shift)return;
  const requestId=++productionState.statusRequestId;
  const bounds=window.LIDUTEC_TURNOS.shiftBounds(date,shift),previousMoment=new Date(bounds.start.getTime()-60000),previousShift=window.LIDUTEC_TURNOS.determineShift(previousMoment),previousBounds=window.LIDUTEC_TURNOS.shiftBounds(previousShift.dataOperacional,previousShift.codigo);
  // findBlockingOpenShift olha outras datas, e o turno atual/produção anterior
  // não dependem desse resultado — busca os três ao mesmo tempo em vez de
  // esperar o bloqueio ser descartado pra só então buscar o resto.
  const[blockingShift,data,previous]=await Promise.all([findBlockingOpenShift(shift,date),window.LIDUTEC_PRODUCAO_DATA.shift(date,shift),window.LIDUTEC_PRODUCAO_DATA.previousProduction(previousBounds.start.toISOString(),previousBounds.end.toISOString())]);
  if(requestId!==productionState.statusRequestId)return;
  if(blockingShift){showShiftBlocked(blockingShift.data_operacional,shift);return}
  hideShiftBlocked();
  const previousVersion=productionState.currentShift?.versao??-1,previousKey=productionState.currentShift?`${productionState.currentShift.data_operacional||date}|${productionState.currentShift.turno||shift}`:"";productionState.currentShift=data?{...data,data_operacional:date,turno:shift}:null;productionState.previousProductId=previous?.produto_id??null;productionState.editingClosed=false;const closed=data?.status==="FECHADO";
  // O histórico só existe quando o turno está fechado; dispara junto com a
  // busca de produções/paradas do turno em vez de esperar elas terminarem.
  const historyPromise=closed&&data?.id?loadShiftHistory(data.id):null;
  if(closed){const[productions,stops]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.shiftProductions(data.id),window.LIDUTEC_PRODUCAO_DATA.shiftStops(data.id)]);if(requestId!==productionState.statusRequestId)return;productionState.originalShiftData={productions,stops};populateShiftRows(productions,stops);syncProductionEndTimes({onlyMissing:true,referenceTime:bounds.end});form.dataset.loadedClosedShift=`${date}|${shift}`}else{productionState.originalShiftData=null;if(form.dataset.loadedClosedShift){resetShiftEntryRows();delete form.dataset.loadedClosedShift}const key=`${date}|${shift}`,hasNewSharedDraft=data&&(previousKey!==key||Number(data.versao)>Number(previousVersion));if(hasNewSharedDraft&&!productionState.draftSaveInFlight)populateSharedDraft(data.rascunho_producoes||[],data.rascunho_paradas||[])}
  for(const row of document.querySelectorAll(".shift-production-row"))updateProductionRow(row);renderShiftTimeline();document.dispatchEvent(new CustomEvent("production-setup-context-changed"));
  const canEdit=closed&&productionState.permissions.has("producao_moldes.editar"),canDelete=closed&&productionState.permissions.has("producao_moldes.excluir_turno"),updatedBy=data?.usuarios?.nome,updatedAt=data?.atualizado_em?new Date(data.atualizado_em).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"";form.classList.toggle("shift-readonly",closed);q("#shift-status").textContent=closed?"Fechado":updatedBy?`Em apontamento · ${updatedBy} às ${updatedAt}`:"Em apontamento";q("#close-shift-button").hidden=closed;q("#close-shift-button").disabled=closed;q("#close-shift-button").textContent="Fechar turno";q("#edit-shift-button").hidden=!canEdit;q("#delete-shift-button").hidden=!canDelete;q("#delete-shift-button").disabled=false;for(const control of form.querySelectorAll("tbody input,tbody select,tbody button,#add-production-row,#add-stop-row"))control.disabled=closed;if(historyPromise)await historyPromise;else q("#shift-edit-history").hidden=true;
  if(closed&&canEdit&&pendingAutoEdit){pendingAutoEdit=false;await editClosedShift()}
  updateChecklistLink();
}
async function deleteClosedShift(){
  const turnId=productionState.currentShift?.id;if(!turnId)return;if(!confirm("Excluir definitivamente este turno, suas produções, paradas e histórico de alterações?"))return;
  const button=q("#delete-shift-button");button.disabled=true;try{await window.LIDUTEC_PRODUCAO_DATA.deleteShift(turnId);localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();q("#shift-edit-history").hidden=true;message("Turno excluído com sucesso.");await checkShiftStatus()}catch(error){message(error.message,"error");button.disabled=false}
}
async function closeShift(event){
  event.preventDefault();const button=q("#close-shift-button");button.disabled=true;
  try{const form=event.currentTarget,{productions,stops}=serializeShift();if(productionState.editingClosed){const changes=changeDescriptions(productionState.originalShiftData,{productions,stops});await window.LIDUTEC_PRODUCAO_DATA.editShift({p_turno_id:productionState.currentShift.id,p_producoes:productions,p_paradas:stops,p_alteracoes:changes});localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();message("Alterações do turno salvas com sucesso.");await checkShiftStatus();return}await window.LIDUTEC_PRODUCAO_DATA.closeShift({p_data_operacional:form.elements.data_operacional.value,p_turno:form.elements.turno.value,p_producoes:productions,p_paradas:stops,p_versao:productionState.currentShift?.versao??null});localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();message("Turno fechado com sucesso.");await checkShiftStatus();}
  catch(error){message(error.message,"error");button.disabled=false;}
}
const shiftCalendarState={month:null,turns:new Map(),events:[]};
const calendarDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
function updateShiftDateButton(){const input=q('#shift-entry-form [name="data_operacional"]'),button=q("#shift-date-button");if(!input||!button)return;const parts=input.value.split("-");button.textContent=parts.length===3?`${parts[2]}/${parts[1]}/${parts[0]}`:"Selecionar data"}
function calendarDayState(value,shift){const turn=shiftCalendarState.turns.get(value),bounds=window.LIDUTEC_TURNOS.shiftBounds(value,shift),now=new Date(),events=shiftCalendarState.events.filter(event=>event.data_inicio<=value&&event.data_fim>=value),work=events.find(event=>event.tipo==="TRABALHO_EXCEPCIONAL"),holiday=events.find(event=>event.tipo==="FERIADO"),ferias=events.find(event=>event.tipo==="FERIAS_COLETIVAS"),folga=events.find(event=>event.tipo==="FOLGA_PROGRAMADA");if(turn?.status==="FECHADO"){if(holiday)return{type:"worked-holiday",label:`Trabalhado (feriado) · ${holiday.nome}`};return{type:"worked",label:`Trabalhado${events.length?` · ${events.map(event=>event.nome).join(" · ")}`:""}`}}if(turn?.status==="ABERTO"&&shiftDraftHasData(turn))return{type:"incomplete",label:"Turno com dados faltando finalizar"};if(bounds.end>now)return{type:"off",label:"Futuro"};if(work)return{type:"missing",label:`Trabalho excepcional sem apontamento · ${work.nome}`};if(holiday)return{type:"holiday",label:holiday.nome};if(ferias)return{type:"vacation",label:ferias.nome};if(folga)return{type:"off",label:folga.nome};if(!window.LIDUTEC_TURNOS.isScheduledShiftDay(value,shift))return{type:"off",label:"Folga"};return{type:"missing",label:"Turno previsto sem apontamento"}}
function renderShiftCalendar(){const form=q("#shift-entry-form"),month=shiftCalendarState.month,holder=q("#shift-calendar-days");if(!form||!month||!holder)return;const shift=form.elements.turno.value,year=month.getFullYear(),monthIndex=month.getMonth(),first=new Date(year,monthIndex,1),lastDay=new Date(year,monthIndex+1,0).getDate(),selected=form.elements.data_operacional.value,cells=[];q("#shift-calendar-title").textContent=month.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});for(let index=0;index<first.getDay();index++)cells.push('<span class="shift-calendar-day outside"></span>');for(let day=1;day<=lastDay;day++){const date=new Date(year,monthIndex,day),value=calendarDate(date),state=calendarDayState(value,shift);cells.push(`<button type="button" class="shift-calendar-day ${state.type}${value===selected?" selected":""}" data-calendar-date="${value}" title="${esc(state.label)}">${day}</button>`)}holder.innerHTML=cells.join("")}
async function loadShiftCalendar(){const form=q("#shift-entry-form"),month=shiftCalendarState.month;if(!form||!month)return;const from=calendarDate(new Date(month.getFullYear(),month.getMonth(),1)),to=calendarDate(new Date(month.getFullYear(),month.getMonth()+1,0)),shift=form.elements.turno.value,[turns,events]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.monthShifts(from,to,shift),window.LIDUTEC_PRODUCAO_DATA.calendarEvents(from,to,shift)]);shiftCalendarState.turns=new Map(turns.map(row=>[row.data_operacional,row]));shiftCalendarState.events=events;renderShiftCalendar()}
function initializeShiftCalendar(){const form=q("#shift-entry-form"),dialog=q("#shift-calendar"),button=q("#shift-date-button");updateShiftDateButton();button.addEventListener("click",()=>{const selected=new Date(`${form.elements.data_operacional.value}T12:00:00`);shiftCalendarState.month=Number.isNaN(selected.getTime())?new Date():new Date(selected.getFullYear(),selected.getMonth(),1);dialog.showModal();loadShiftCalendar().catch(error=>message(error.message,"error"))});dialog.addEventListener("click",event=>{const dateButton=event.target.closest("[data-calendar-date]");if(dateButton){form.elements.data_operacional.value=dateButton.dataset.calendarDate;updateShiftDateButton();form.elements.data_operacional.dispatchEvent(new Event("change",{bubbles:true}));dialog.close();return}if(event.target.closest("[data-calendar-close]")){dialog.close();return}const direction=event.target.closest("[data-calendar-previous]")?-1:event.target.closest("[data-calendar-next]")?1:0;if(direction){shiftCalendarState.month.setMonth(shiftCalendarState.month.getMonth()+direction);loadShiftCalendar().catch(error=>message(error.message,"error"))}});form.elements.turno.addEventListener("change",()=>{if(dialog.open)loadShiftCalendar().catch(error=>message(error.message,"error"))})}
async function initializeShiftEntry(){
  const form=q("#shift-entry-form");applyCurrentShift(form);localStorage.removeItem(`lidutec:producao-moldes:rascunho:${productionState.user?.id||"anonimo"}`);if(!restoreShiftDraft()){appendEntryRow("#production-entry-rows",productionRow());appendEntryRow("#stop-entry-rows",stopRow())}
  initializeShiftCalendar();
  q("#add-production-row").addEventListener("click",()=>{const row=productionRow();appendEntryRow("#production-entry-rows",row);updateProductionRow(row);syncProductionEndTimes();saveShiftDraft()});q("#add-stop-row").addEventListener("click",()=>{appendEntryRow("#stop-entry-rows",stopRow());saveShiftDraft()});
  form.addEventListener("input",event=>{const production=event.target.closest(".shift-production-row"),stop=event.target.closest(".shift-stop-row");if(production){updateProductionRow(production);syncProductionEndTimes()}if(stop)try{updateStopRow(stop);clearMessage("stop-time")}catch(error){message(error.message,"error","stop-time")}saveShiftDraft()});
  form.addEventListener("click",event=>{const button=event.target.closest(".row-remove");if(!button)return;const row=button.closest("tr"),body=row.parentElement;if(body.children.length===1){for(const control of row.querySelectorAll("input,select"))control.value=control.type==="number"?"0":"";row.matches(".shift-production-row")?updateProductionRow(row):updateStopRow(row)}else row.remove();for(const production of document.querySelectorAll(".shift-production-row"))updateProductionRow(production);syncProductionEndTimes();renderShiftTimeline();saveShiftDraft()});
  form.elements.data_operacional.addEventListener("change",()=>{applyShiftDateTimeLimits();syncProductionEndTimes();renderShiftTimeline();checkShiftStatus().catch(error=>message(error.message,"error"))});form.elements.turno.addEventListener("change",()=>{applyShiftDateTimeLimits();syncProductionEndTimes();renderShiftTimeline();checkShiftStatus().catch(error=>message(error.message,"error"))});form.addEventListener("submit",closeShift);applyShiftDateTimeLimits();syncProductionEndTimes();renderShiftTimeline();await checkShiftStatus();setInterval(()=>{if(!document.hidden)syncProductionEndTimes()},60000);
  window.supabaseClient.channel("shared-production-shift").on("postgres_changes",{event:"*",schema:"public",table:"turnos_producao_moldes"},payload=>{const form=q("#shift-entry-form"),row=payload.new;if(!document.hidden&&row&&row.data_operacional===form.elements.data_operacional.value&&row.turno===form.elements.turno.value&&String(row.atualizado_por)!==String(productionState.user?.id))checkShiftStatus().catch(error=>message(error.message,"error"))}).subscribe();
  q("#edit-shift-button").addEventListener("click",()=>editClosedShift().catch(error=>message(error.message,"error")));
  q("#delete-shift-button").addEventListener("click",deleteClosedShift);
}
const isoDate=date=>date.toISOString().slice(0,10);
const daysBefore=(date,days)=>{const value=new Date(`${date}T12:00:00`);value.setDate(value.getDate()-days);return isoDate(value)};
function productionFilters(form){return{from:form?.elements.inicio.value||null,to:form?.elements.fim.value||null,shift:form?.elements.turno.value||null,productId:form?.elements.produto_id?.value||null,sectorId:form?.elements.setor_id?.value||null,categoryId:form?.elements.categoria_id?.value||null,search:form?.elements.observacao?.value.trim()||null,limit:1000}}
async function loadProductionData(){
  const today=window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  if(productionPage==="dashboard"){
    const form=q("#production-query-filters");form.elements.inicio.value=today;form.elements.fim.value=today;
    const[records,stops,materials]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.records(productionFilters(form)),window.LIDUTEC_PRODUCAO_DATA.stops({from:today,to:today,limit:1000}),window.LIDUTEC_PRODUCAO_DATA.productMaterials()]);productionState.records=records;productionState.stops=stops;productionState.materialByProduct=new Map(materials.map(item=>[String(item.produto_id),item.tipo_material]));return;
  }
  if(productionPage==="stops"){
    const form=q("#stop-query-filters");form.elements.inicio.value=daysBefore(today,30);form.elements.fim.value=today;
    productionState.records=[];productionState.stops=await window.LIDUTEC_PRODUCAO_DATA.stops(productionFilters(form));return;
  }
  const from=daysBefore(today,90);
  if(productionPage==="charts"){
    const[records,stops,materials,cycleTimes]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.records({from,to:today,limit:5000}),window.LIDUTEC_PRODUCAO_DATA.stops({from,to:today,limit:5000}),window.LIDUTEC_PRODUCAO_DATA.productMaterials(),window.LIDUTEC_PRODUCAO_DATA.cycleTimes(productionState.products.map(p=>p.id))]);productionState.records=records;productionState.stops=stops;productionState.materialByProduct=new Map(materials.map(item=>[String(item.produto_id),item.tipo_material]));productionState.cycleTimeByProduct=new Map(cycleTimes.map(item=>[String(item.produto_id),item.tempo_ciclo_segundos]));return;
  }
  [productionState.records,productionState.stops]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.records({from,to:today,limit:5000}),window.LIDUTEC_PRODUCAO_DATA.stops({from,to:today,limit:5000})]);
}
function productionTotals(records=productionState.records,stops=productionState.stops){
  const poured=records.reduce((sum,x)=>sum+number(x.moldes_vazados),0),broken=records.reduce((sum,x)=>sum+number(x.moldes_quebrados),0),totalMolds=poured+broken,totalPieces=records.reduce((sum,x)=>sum+number(x.total_pecas),0),tons=records.reduce((sum,x)=>sum+number(x.toneladas_produzidas),0);
  const stopMinutes=stops.reduce((sum,x)=>sum+number(x.duracao_minutos),0);
  const scheduled=[...new Set(records.map(x=>`${x.data_operacional}|${x.turno}`))].reduce((sum,key)=>sum+window.LIDUTEC_TURNOS.shifts[key.split("|")[1]].minutos,0);
  const worked=window.LIDUTEC_TURNOS.effectiveMinutes(scheduled,stopMinutes);
  return{poured,broken,totalMolds,totalPieces,tons,stopMinutes,worked,productivity:worked?Number((totalMolds/(worked/60)).toFixed(2)):0};
}
function renderDashboard(){
  const today=window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  const records=productionState.records.filter(x=>x.data_operacional===today);
  const stops=productionState.stops.filter(x=>x.data_operacional===today);
  const t=productionTotals(records,stops);
  const values={poured:t.poured,broken:t.broken,totalMolds:t.totalMolds,totalPieces:t.totalPieces.toLocaleString("pt-BR"),tons:t.tons.toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3}),stops:formatMinutes(t.stopMinutes),worked:formatMinutes(t.worked),productivity:t.productivity};
  for(const [key,value] of Object.entries(values)){const el=q(`[data-metric="${key}"]`);if(el)el.textContent=value}
  renderBars(records,"#shift-chart",x=>x.turno,x=>x.quantidade_produzida);
  renderProductionQuery();
}
const displayDate=value=>value?new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR"):"—";
function filteredByCommonPeriod(rows,form){const start=form?.elements.inicio.value,end=form?.elements.fim.value,shift=form?.elements.turno.value;return rows.filter(item=>(!start||item.data_operacional>=start)&&(!end||item.data_operacional<=end)&&(!shift||item.turno===shift))}
const productionSortValues={date:item=>item.data_operacional,shift:item=>item.turno,start:item=>item.inicio,end:item=>item.fim,product:item=>`${item.produtos?.codigo||""} ${item.produtos?.nome||""}`,material:item=>productionMaterial(item),client:item=>item.produtos?.clientes?.nome||"",trace:item=>item.rastreabilidade||"",poured:item=>number(item.moldes_vazados),broken:item=>number(item.moldes_quebrados),molds:item=>number(item.moldes_vazados)+number(item.moldes_quebrados),tons:item=>number(item.toneladas_produzidas),pieces:item=>number(item.total_pecas)};
function sortProductionRows(rows){const{key,direction}=productionState.querySort,getValue=productionSortValues[key];if(!getValue)return rows;const factor=direction==="asc"?1:-1;return rows.map((item,index)=>({item,index})).sort((left,right)=>{const a=getValue(left.item),b=getValue(right.item),result=typeof a==="number"&&typeof b==="number"?a-b:String(a??"").localeCompare(String(b??""),"pt-BR",{numeric:true,sensitivity:"base"});return result?result*factor:left.index-right.index}).map(entry=>entry.item)}
function updateProductionSortHeaders(){for(const button of document.querySelectorAll(".production-query-table .table-sort")){const active=button.dataset.sort===productionState.querySort.key,direction=active?productionState.querySort.direction:"";button.dataset.direction=direction;button.closest("th").setAttribute("aria-sort",direction==="asc"?"ascending":direction==="desc"?"descending":"none");button.title=active?`Classificação ${direction==="asc"?"crescente":"decrescente"}. Clique para inverter.`:"Clique para classificar em ordem crescente."}}
const productionExportHeaders=["Data","Turno","Data e hora início","Data e hora fim","Código do produto","Nome do produto","Tipo de material","Cliente","Rastreabilidade","Moldes vazados","Moldes quebrados","Total de moldes","Toneladas produzidas","Total de peças"];
function productionExportValues(item){return[displayDate(item.data_operacional),item.turno,formatDateTime(item.inicio),formatDateTime(item.fim),item.produtos?.codigo||"—",item.produtos?.nome||"",productionMaterial(item),item.produtos?.clientes?.nome||"—",item.rastreabilidade||"—",number(item.moldes_vazados),number(item.moldes_quebrados),number(item.moldes_vazados)+number(item.moldes_quebrados),number(item.toneladas_produzidas).toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3}),number(item.total_pecas).toLocaleString("pt-BR")].map(String)}
function updateProductionExportControls(){const rows=productionState.visibleProductionRows,button=q("#production-export-button"),counter=q("#production-export-count");if(counter)counter.textContent=`${rows.length} registro${rows.length===1?"":"s"}`;if(button)button.disabled=!rows.length}
function downloadProductionFile(content,type,extension,baseName="pecas-produzidas"){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${baseName}-${new Date().toISOString().slice(0,10)}.${extension}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportProductionExcel(rows){const tableRows=rows.map(item=>`<tr>${productionExportValues(item).map(value=>`<td>${esc(value)}</td>`).join("")}</tr>`).join("");const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${productionExportHeaders.map(value=>`<th>${esc(value)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;downloadProductionFile(`\ufeff${html}`,"application/vnd.ms-excel;charset=utf-8","xls")}
function exportProductionSvg(rows){const widths=[90,90,170,170,105,210,110,180,160,105,115,105,135,105],rowHeight=28,width=widths.reduce((sum,value)=>sum+value,0),height=(rows.length+1)*rowHeight+2,truncate=(value,size)=>value.length>size?`${value.slice(0,Math.max(1,size-1))}…`:value,svgText=(value,x,y,maxChars,weight="400",fill="#263238")=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="11" font-weight="${weight}" fill="${fill}">${esc(truncate(String(value),maxChars))}</text>`;let content=`<rect width="100%" height="100%" fill="#fff"/>`,x=0;productionExportHeaders.forEach((header,index)=>{content+=`<rect x="${x}" y="1" width="${widths[index]}" height="${rowHeight}" fill="#b71c1c" stroke="#fff"/>${svgText(header,x+5,19,Math.floor(widths[index]/7),"700","#fff")}`;x+=widths[index]});rows.forEach((item,rowIndex)=>{const values=productionExportValues(item),y=(rowIndex+1)*rowHeight+1;x=0;values.forEach((value,index)=>{content+=`<rect x="${x}" y="${y}" width="${widths[index]}" height="${rowHeight}" fill="${rowIndex%2?"#f3f5f6":"#fff"}" stroke="#d8dee2"/>${svgText(value,x+5,y+18,Math.floor(widths[index]/7))}`;x+=widths[index]})});downloadProductionFile(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`,"image/svg+xml;charset=utf-8","svg")}
function exportVisibleProductions(){const rows=productionState.visibleProductionRows;if(!rows.length)return;const format=q("#production-export-format")?.value;format==="svg"?exportProductionSvg(rows):exportProductionExcel(rows)}
function renderProductionQuery(){
  const body=q("#dashboard-production-records"),form=q("#production-query-filters");if(!body||!form)return;const productId=form.elements.produto_id.value;
  const rows=sortProductionRows(filteredByCommonPeriod(productionState.records,form).filter(item=>item.data_operacional&&item.inicio&&item.fim&&(!productId||String(item.produto_id)===productId)));
  productionState.visibleProductionRows=rows;body.innerHTML=rows.map(item=>`<tr><td>${displayDate(item.data_operacional)}</td><td>${esc(item.turno)}</td><td>${formatDateTime(item.inicio)}</td><td>${formatDateTime(item.fim)}</td><td><strong>${esc(item.produtos?.codigo||"—")}</strong> — ${esc(item.produtos?.nome||"")}</td><td>${esc(productionMaterial(item))}</td><td>${esc(item.produtos?.clientes?.nome||"—")}</td><td>${esc(item.rastreabilidade||"—")}</td><td>${number(item.moldes_vazados)}</td><td>${number(item.moldes_quebrados)}</td><td>${number(item.moldes_vazados)+number(item.moldes_quebrados)}</td><td>${number(item.toneladas_produzidas).toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3})}</td><td>${number(item.total_pecas).toLocaleString("pt-BR")}</td></tr>`).join("");q("#dashboard-production-empty").hidden=rows.length>0;updateProductionSortHeaders();updateProductionExportControls();
}
async function reloadProductionQuery(){const form=q("#production-query-filters");productionState.records=await window.LIDUTEC_PRODUCAO_DATA.records(productionFilters(form));renderProductionQuery()}
function renderBars(rows,selector,keyFn,valueFn){
  const container=q(selector);if(!container)return;const grouped=new Map();for(const row of rows)grouped.set(keyFn(row),(grouped.get(keyFn(row))||0)+number(valueFn(row)));
  const max=Math.max(1,...grouped.values());container.innerHTML=[...grouped].map(([key,value])=>`<div class="production-bar"><strong>${esc(key.replaceAll("_"," "))}</strong><div class="production-bar-track"><div class="production-bar-fill" style="width:${value/max*100}%"></div></div><span>${value}</span></div>`).join("")||'<p class="production-muted">Sem dados no período.</p>';
}
function renderRecords(){
  q("#production-records").innerHTML=productionState.records.map(x=>`<tr><td>${esc(x.data_operacional)}</td><td>${esc(x.turno)}</td><td>${esc(x.produtos?.codigo||"—")}</td><td>${esc(x.linhas_maquinas_producao?.codigo||"—")}</td><td>${x.quantidade_planejada}</td><td>${x.quantidade_produzida}</td><td>${x.quantidade_aprovada}</td><td>${x.quantidade_refugada}</td></tr>`).join("");
  q("#production-empty").hidden=productionState.records.length>0;q("#production-table").hidden=!productionState.records.length;
}
const stopExportHeaders=["Data","Turno","Data e hora início","Data e hora fim","Tempo total","Setor responsável","Motivo da parada","Observações"];
function stopExportValues(item){return[displayDate(item.data_operacional),item.turno,formatDateTime(item.inicio),formatDateTime(item.fim),formatMinutes(item.duracao_minutos),item.setores_responsaveis_parada?.nome||"—",item.categorias_parada_producao?.nome||item.motivo||"—",item.observacao||"—"].map(String)}
function updateStopExportControls(){const rows=productionState.visibleStopRows,button=q("#stop-export-button"),counter=q("#stop-export-count");if(counter)counter.textContent=`${rows.length} registro${rows.length===1?"":"s"}`;if(button)button.disabled=!rows.length}
function exportStopsExcel(rows){const tableRows=rows.map(item=>`<tr>${stopExportValues(item).map(value=>`<td>${esc(value)}</td>`).join("")}</tr>`).join(""),html=`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${stopExportHeaders.map(value=>`<th>${esc(value)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;downloadProductionFile(`\ufeff${html}`,"application/vnd.ms-excel;charset=utf-8","xls","paradas-producao")}
function exportStopsSvg(rows){const widths=[90,90,170,170,100,190,250,300],rowHeight=28,width=widths.reduce((sum,value)=>sum+value,0),height=(rows.length+1)*rowHeight+2,truncate=(value,size)=>value.length>size?`${value.slice(0,Math.max(1,size-1))}…`:value,text=(value,x,y,maxChars,weight="400",fill="#263238")=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="11" font-weight="${weight}" fill="${fill}">${esc(truncate(String(value),maxChars))}</text>`;let content=`<rect width="100%" height="100%" fill="#fff"/>`,x=0;stopExportHeaders.forEach((header,index)=>{content+=`<rect x="${x}" y="1" width="${widths[index]}" height="${rowHeight}" fill="#b71c1c" stroke="#fff"/>${text(header,x+5,19,Math.floor(widths[index]/7),"700","#fff")}`;x+=widths[index]});rows.forEach((item,rowIndex)=>{const values=stopExportValues(item),y=(rowIndex+1)*rowHeight+1;x=0;values.forEach((value,index)=>{content+=`<rect x="${x}" y="${y}" width="${widths[index]}" height="${rowHeight}" fill="${rowIndex%2?"#f3f5f6":"#fff"}" stroke="#d8dee2"/>${text(value,x+5,y+18,Math.floor(widths[index]/7))}`;x+=widths[index]})});downloadProductionFile(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`,"image/svg+xml;charset=utf-8","svg","paradas-producao")}
function exportVisibleStops(){const rows=productionState.visibleStopRows;if(!rows.length)return;q("#stop-export-format")?.value==="svg"?exportStopsSvg(rows):exportStopsExcel(rows)}
function renderStops(){
  const form=q("#stop-query-filters"),sectorId=form?.elements.setor_id.value,categoryId=form?.elements.categoria_id.value,normalizeText=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(),terms=normalizeText(form?.elements.observacao.value).split(/\s+/).filter(Boolean),filtered=filteredByCommonPeriod(productionState.stops,form).filter(item=>(!sectorId||String(item.setor_responsavel_id)===sectorId)&&(!categoryId||String(item.categoria_id)===categoryId)&&terms.every(term=>normalizeText(item.observacao).includes(term)));
  const getters={start:item=>item.inicio,end:item=>item.fim,duration:item=>number(item.duracao_minutos),sector:item=>item.setores_responsaveis_parada?.nome,reason:item=>item.categorias_parada_producao?.nome||item.motivo,notes:item=>item.observacao,date:item=>item.data_operacional,shift:item=>item.turno},getValue=getters[productionState.stopSort.key],factor=productionState.stopSort.direction==="asc"?1:-1,rows=getValue?filtered.map((item,index)=>({item,index})).sort((left,right)=>{const a=getValue(left.item),b=getValue(right.item),result=typeof a==="number"&&typeof b==="number"?a-b:String(a??"").localeCompare(String(b??""),"pt-BR",{numeric:true,sensitivity:"base"});return result?result*factor:left.index-right.index}).map(entry=>entry.item):filtered;
  productionState.visibleStopRows=rows;q("#stop-records").innerHTML=rows.map(x=>`<tr><td>${displayDate(x.data_operacional)}</td><td>${esc(x.turno)}</td><td>${formatDateTime(x.inicio)}</td><td>${formatDateTime(x.fim)}</td><td>${formatMinutes(x.duracao_minutos)}</td><td>${esc(x.setores_responsaveis_parada?.nome||"—")}</td><td>${esc(x.categorias_parada_producao?.nome||x.motivo||"—")}</td><td>${esc(x.observacao||"—")}</td></tr>`).join("");q("#stop-records-empty").hidden=rows.length>0;updateStopSortHeaders();updateStopExportControls();
}
async function reloadStops(){const form=q("#stop-query-filters");productionState.stops=await window.LIDUTEC_PRODUCAO_DATA.stops(productionFilters(form));renderStops()}
function updateStopSortHeaders(){for(const button of document.querySelectorAll(".stop-query-table .table-sort")){const active=button.dataset.sort===productionState.stopSort.key,direction=active?productionState.stopSort.direction:"";button.dataset.direction=direction;button.closest("th").setAttribute("aria-sort",direction==="asc"?"ascending":direction==="desc"?"descending":"none");button.title=active?`Classificação ${direction==="asc"?"crescente":"decrescente"}. Clique para inverter.`:"Clique para classificar em ordem crescente."}}
function productionMaterial(record){const raw=String(productionState.materialByProduct.get(String(record.produto_id))||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();if(raw.includes("NODULAR"))return"Nodular";if(raw.includes("CINZENTO"))return"Cinzento";return"Não especificado"}
function renderDonut(selector,valueFn,formatter){
  const container=q(selector),labels=["Cinzento","Nodular","Não especificado"],colors={Cinzento:"#185abd",Nodular:"#218c4b","Não especificado":"#94a3b8"},values=new Map(labels.map(label=>[label,0]));for(const record of productionState.records){const material=productionMaterial(record);values.set(material,values.get(material)+number(valueFn(record)))}const total=[...values.values()].reduce((sum,value)=>sum+value,0);if(!total){container.innerHTML='<p class="production-muted">Sem dados no período.</p>';return}let offset=0;const segments=labels.map(label=>{const start=offset;offset+=values.get(label)/total*360;return`${colors[label]} ${start}deg ${offset}deg`});container.innerHTML=`<div class="production-donut" style="--donut-segments:${segments.join(",")}" role="img" aria-label="Distribuição por tipo de material"><div><strong>${formatter(total)}</strong><span>Total</span></div></div><div class="production-donut-legend">${labels.map(label=>`<div><i style="--legend-color:${colors[label]}"></i><span>${label}</span><strong>${formatter(values.get(label))}</strong><small>${(values.get(label)/total*100).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})}%</small></div>`).join("")}</div>`;
}
function renderGauge(selector,fraction,label){
  const container=q(selector);if(!container)return;
  const percent=Math.max(0,Math.min(1,fraction||0))*100;
  const color=percent>=85?"#218c4b":percent>=65?"#b7791f":"#b90e2c";
  container.innerHTML=`<div class="production-donut" style="--donut-segments:${color} 0deg ${percent*3.6}deg,#e2e8f0 ${percent*3.6}deg 360deg" role="img" aria-label="${esc(label)}"><div><strong>${percent.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</strong><span>${esc(label)}</span></div></div>`;
}
// OEE do período: só existem registros/paradas de turnos já fechados (a
// produção de um turno aberto ainda vive só no rascunho, não em
// registros_producao_moldes), então os turnos do período vêm dos próprios
// registros. Parte da parada que cai numa janela programada (refeição,
// manutenção preventiva etc.) não conta contra a disponibilidade.
function renderOEE(){
  const turnos=new Map();
  for(const record of productionState.records){
    const key=`${record.data_operacional}|${record.turno}`;
    if(!turnos.has(key))turnos.set(key,{data_operacional:record.data_operacional,turno:record.turno});
  }
  let totalMinutosTurno=0,totalMinutosParadaLiquida=0;
  for(const{data_operacional,turno}of turnos.values()){
    const minutosTurno=window.LIDUTEC_TURNOS.shifts[turno]?.minutos||0;if(!minutosTurno)continue;
    const bounds=window.LIDUTEC_TURNOS.shiftBounds(data_operacional,turno);
    const stopsDoTurno=productionState.stops.filter(stop=>stop.data_operacional===data_operacional&&stop.turno===turno);
    const minutosParada=stopsDoTurno.reduce((sum,stop)=>sum+number(stop.duracao_minutos),0);
    const overlapProgramado=stopsDoTurno.reduce((sum,stop)=>sum+window.LIDUTEC_PARADAS_PROGRAMADAS.overlapMinutos({janelas:productionState.scheduledStops||[],turnoInicio:bounds.start,paradaInicio:stop.inicio,paradaFim:stop.fim,turno,dataOperacional:data_operacional}),0);
    totalMinutosTurno+=minutosTurno;
    totalMinutosParadaLiquida+=Math.max(0,minutosParada-overlapProgramado);
  }
  const disponibilidade=window.LIDUTEC_TURNOS.calcularTaxaEquipamento({minutosPeriodo:totalMinutosTurno,minutosParada:totalMinutosParadaLiquida});
  const tempoDisponivel=Math.max(0,totalMinutosTurno-totalMinutosParadaLiquida);
  const tempoTeorico=productionState.records.reduce((sum,record)=>{
    const tempoCiclo=productionState.cycleTimeByProduct.get(String(record.produto_id))||0;
    return sum+window.LIDUTEC_TURNOS.calcularTempoTeorico({pecasLiberadas:record.moldes_vazados,pecasRefugadas:record.moldes_quebrados,tempoCicloSegundos:tempoCiclo});
  },0);
  const eficiencia=window.LIDUTEC_TURNOS.calcularEficiencia({tempoTeoricoMinutos:tempoTeorico,tempoDisponivelMinutos:tempoDisponivel});
  const qualidade=0.97;
  const oee=window.LIDUTEC_TURNOS.calcularOEE({disponibilidade,eficiencia,qualidade});
  renderGauge("#gauge-disponibilidade",disponibilidade,"Disponibilidade");
  renderGauge("#gauge-eficiencia",eficiencia,"Eficiência");
  renderGauge("#gauge-qualidade",qualidade,"Qualidade");
  renderGauge("#gauge-oee",oee,"OEE");
}
function renderCharts(){
  renderOEE();
  renderDonut("#material-tons-chart",record=>record.toneladas_produzidas,value=>`${value.toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3})} t`);
  renderDonut("#material-molds-chart",record=>record.moldes_vazados,value=>value.toLocaleString("pt-BR"));
}
function applyCurrentShift(form){
  const params=new URLSearchParams(location.search),paramDate=params.get("data"),paramTurno=params.get("turno");
  if(paramDate&&/^\d{4}-\d{2}-\d{2}$/.test(paramDate)&&window.LIDUTEC_TURNOS.shifts[paramTurno]){
    form.querySelector('[name="data_operacional"]')?.setAttribute("value",paramDate);
    const select=form.querySelector('[name="turno"]');if(select)select.value=paramTurno;
    return;
  }
  const shift=window.LIDUTEC_TURNOS.determineShift();form.querySelector('[name="data_operacional"]')?.setAttribute("value",shift.dataOperacional);const select=form.querySelector('[name="turno"]');if(select)select.value=shift.codigo
}
// Um turno só conta como "aberto com dados" se o rascunho realmente tiver algo
// preenchido — abrir e apagar tudo sem fechar não deve travar o turno seguinte.
function shiftDraftHasData(row){
  return (row.rascunho_producoes||[]).some(item=>item.produto_id)||
    (row.rascunho_paradas||[]).some(item=>item.categoria_id||item.setor_id);
}
async function findBlockingOpenShift(turno,date){
  const rows=await window.LIDUTEC_PRODUCAO_DATA.openShiftsBefore(turno,date);
  return rows.find(shiftDraftHasData)||null;
}
function showShiftBlocked(openDate,turno){
  const form=q("#shift-entry-form"),panel=q("#shift-blocked-message");
  if(!panel)return;
  form.hidden=true;
  const label=window.LIDUTEC_TURNOS.shifts[turno]?.nome||turno,displayDate=new Date(`${openDate}T12:00:00`).toLocaleDateString("pt-BR");
  const link=`lancamento.html?data=${openDate}&turno=${turno}`;
  q("#shift-blocked-text").textContent=`Existe um turno de ${label} em aberto no dia ${displayDate}. Feche-o ou remova os lançamentos incompletos antes de abrir um novo turno de ${label} — avalie com atenção antes de remover, pois os dados já digitados serão perdidos.`;
  q("#shift-blocked-link").href=link;
  panel.hidden=false;
}
function hideShiftBlocked(){
  const panel=q("#shift-blocked-message");
  if(panel)panel.hidden=true;
  const form=q("#shift-entry-form");
  if(form)form.hidden=false;
}
async function initializeProduction(){
  const user=await window.LIDUTEC_APP.requireAuthenticatedUser();if(!user)return;
  const[profile,permissions]=await Promise.all([window.LIDUTEC_APP.getCurrentUserProfile(user.id),window.LIDUTEC_APP.getUserPermissions(user.id)]);
  if(!profile||profile.status!=="ATIVO"){alert("Seu usuário não possui acesso ativo.");await window.LIDUTEC_APP.signOut();return}
  if(!permissions.has("producao_moldes.visualizar")){location.replace("../dashboard.html");return}
  productionState.user=user;productionState.permissions=permissions;window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  q("#user-name").textContent=profile.nome;q("#user-profile").textContent=profile.perfil||"Usuário";q("#user-avatar").textContent=profile.nome.slice(0,1).toUpperCase();
  await loadSupport();if(productionPage!=="entry")await loadProductionData();q("#production-loading")?.setAttribute("hidden","");
  if(productionPage==="dashboard")renderDashboard();if(productionPage==="records")renderRecords();if(productionPage==="stops")renderStops();if(productionPage==="charts")renderCharts();
  let filterTimer;const scheduleReload=callback=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>callback().catch(error=>message(error.message,"error")),300)};
  q("#production-query-filters")?.addEventListener("input",()=>scheduleReload(reloadProductionQuery));q(".production-query-table")?.addEventListener("click",event=>{const button=event.target.closest(".table-sort");if(!button)return;if(productionPage==="stops"){const same=productionState.stopSort.key===button.dataset.sort;productionState.stopSort={key:button.dataset.sort,direction:same&&productionState.stopSort.direction==="asc"?"desc":"asc"};renderStops();return}const same=productionState.querySort.key===button.dataset.sort;productionState.querySort={key:button.dataset.sort,direction:same&&productionState.querySort.direction==="asc"?"desc":"asc"};renderProductionQuery()});q("#stop-query-filters")?.addEventListener("input",()=>scheduleReload(reloadStops));
  q("#production-export-button")?.addEventListener("click",exportVisibleProductions);
  q("#stop-export-button")?.addEventListener("click",exportVisibleStops);
  if(productionPage==="entry"){if(!permissions.has("producao_moldes.lancar"))throw new Error("Usuário sem permissão para lançar produção.");await initializeShiftEntry();}
}
q("#menu-button")?.addEventListener("click",()=>q("#sidebar").classList.toggle("open"));q("#logout-button")?.addEventListener("click",()=>window.LIDUTEC_APP.signOut());
initializeProduction().catch(error=>{console.error(error);q("#production-loading").textContent=`Erro: ${error.message}`});
