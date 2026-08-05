const productionPage = document.body.dataset.productionPage;
const productionState = { user:null, permissions:new Set(), products:[], lines:[], categories:[], sectors:[], records:[], stops:[], currentShift:null, editingClosed:false, originalShiftData:null };
const q = (selector) => document.querySelector(selector);
const esc = (value="") => String(value).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number = (value) => Number(value || 0);
const formatDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const formatMinutes = (value) => `${Math.floor(number(value)/60)}h ${String(number(value)%60).padStart(2,"0")}min`;
function message(text,type="success"){const el=q("#production-message");if(!el)return;el.textContent=text;el.className=`form-message ${type}`;el.hidden=false}
async function loadSupport(){
  const [products,lines,categories,sectors]=await Promise.all([
    window.supabaseClient.from("produtos").select("id,codigo,nome,cavidades_molde,peso_peca_kg").eq("status","ATIVO").order("codigo"),
    window.supabaseClient.from("linhas_maquinas_producao").select("id,codigo,nome").eq("ativo",true).order("codigo"),
    window.supabaseClient.from("categorias_parada_producao").select("id,codigo,nome").eq("ativo",true).order("nome"),
    window.supabaseClient.from("setores_responsaveis_parada").select("id,codigo,nome").eq("ativo",true).order("nome")
  ]);
  if(products.error)throw products.error;
  if(lines.error)throw lines.error;if(categories.error)throw categories.error;
  if(sectors.error)throw sectors.error;
  productionState.products=products.data||[];
  productionState.lines=lines.data||[];productionState.categories=categories.data||[];productionState.sectors=sectors.data||[];
  for(const select of document.querySelectorAll("[data-products]"))select.insertAdjacentHTML("beforeend",productionState.products.map(p=>`<option value="${p.id}">${esc(p.codigo)} — ${esc(p.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-lines]"))select.insertAdjacentHTML("beforeend",(lines.data||[]).map(x=>`<option value="${x.id}">${esc(x.codigo)} — ${esc(x.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-categories]"))select.insertAdjacentHTML("beforeend",(categories.data||[]).map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-sectors]"))select.insertAdjacentHTML("beforeend",productionState.sectors.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join(""));
}

const optionList=(rows,labelFn)=>rows.map(x=>`<option value="${x.id}">${esc(labelFn(x))}</option>`).join("");
function productionRow(){
  const row=document.createElement("tr");row.className="shift-production-row";
  row.innerHTML=`<td><input name="inicio" type="datetime-local"></td><td><input name="fim" type="datetime-local"></td><td><select name="produto_id"><option value="">Selecione</option>${optionList(productionState.products,p=>`${p.codigo} — ${p.nome}`)}</select></td><td><input name="moldes_vazados" type="number" min="0" step="1" value="0"></td><td><input name="moldes_quebrados" type="number" min="0" step="1" value="0"></td><td><output data-total-moldes>0</output></td><td><output data-toneladas>0,000</output></td><td><output data-total-pecas>0</output></td><td><button type="button" class="row-remove" aria-label="Remover linha">×</button></td>`;
  return row;
}
function stopRow(){
  const row=document.createElement("tr");row.className="shift-stop-row";
  row.innerHTML=`<td><input name="inicio" type="datetime-local"></td><td><input name="fim" type="datetime-local"></td><td><output data-duration>0h 00min</output></td><td><select name="setor_id"><option value="">Selecione</option>${optionList(productionState.sectors,x=>x.nome)}</select></td><td><select name="categoria_id"><option value="">Selecione</option>${optionList(productionState.categories,x=>x.nome)}</select></td><td><input name="observacao" type="text" maxlength="500"></td><td><button type="button" class="row-remove" aria-label="Remover linha">×</button></td>`;
  return row;
}
function shiftDateTimeBounds(){
  const form=q("#shift-entry-form"),date=form?.elements.data_operacional.value,shift=window.LIDUTEC_TURNOS.shifts[form?.elements.turno.value];if(!date||!shift)return null;
  const start=new Date(`${date}T${shift.inicio}`),end=new Date(`${date}T${shift.fim}`);if(end<=start)end.setDate(end.getDate()+1);
  const inputValue=value=>{const pad=item=>String(item).padStart(2,"0");return`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`};return{start,end,min:inputValue(start),max:inputValue(end)};
}
function applyShiftDateTimeLimits(){const bounds=shiftDateTimeBounds();if(!bounds)return;for(const input of document.querySelectorAll('.shift-entry-table input[type="datetime-local"]')){input.min=bounds.min;input.max=bounds.max}}
function validateShiftInterval(startValue,endValue,label){const bounds=shiftDateTimeBounds(),start=new Date(startValue),end=new Date(endValue);if(!bounds||start<bounds.start||start>bounds.end||end<bounds.start||end>bounds.end)throw new Error(`${label} deve estar entre ${bounds?.min.replace("T"," ")} e ${bounds?.max.replace("T"," ")}.`);if(end<start)throw new Error(`O fim de ${label.toLowerCase()} não pode ser anterior ao início.`)}
function appendEntryRow(target,row){q(target).append(row);applyShiftDateTimeLimits();}
function shiftDraftKey(){return `lidutec:producao-moldes:rascunho:${productionState.user?.id||"anonimo"}`;}
function rowValues(row){return Object.fromEntries([...row.querySelectorAll("input,select")].map(control=>[control.name,control.value]));}
function applyRowValues(row,values={}){for(const control of row.querySelectorAll("input,select")){if(Object.hasOwn(values,control.name))control.value=values[control.name]??""}}
function saveShiftDraft(){
  const form=q("#shift-entry-form");if(!form||!productionState.user)return;
  const draft={data_operacional:form.elements.data_operacional.value,turno:form.elements.turno.value,productions:[...document.querySelectorAll(".shift-production-row")].map(rowValues),stops:[...document.querySelectorAll(".shift-stop-row")].map(rowValues)};
  localStorage.setItem(shiftDraftKey(),JSON.stringify(draft));
}
function restoreShiftDraft(){
  let draft=null;try{draft=JSON.parse(localStorage.getItem(shiftDraftKey())||"null")}catch{localStorage.removeItem(shiftDraftKey())}
  if(!draft)return false;const form=q("#shift-entry-form");
  if(draft.data_operacional)form.elements.data_operacional.value=draft.data_operacional;if(draft.turno)form.elements.turno.value=draft.turno;
  q("#production-entry-rows").replaceChildren();q("#stop-entry-rows").replaceChildren();
  for(const values of draft.productions?.length?draft.productions:[{}]){const row=productionRow();applyRowValues(row,values);appendEntryRow("#production-entry-rows",row);updateProductionRow(row)}
  for(const values of draft.stops?.length?draft.stops:[{}]){const row=stopRow();applyRowValues(row,values);appendEntryRow("#stop-entry-rows",row);try{updateStopRow(row)}catch{row.querySelector("[data-duration]").textContent="Horário inválido"}}
  return true;
}
function resetShiftEntryRows(){
  q("#production-entry-rows").replaceChildren(productionRow());
  q("#stop-entry-rows").replaceChildren(stopRow());
  renderShiftTimeline();
}
function updateProductionRow(row){
  const product=productionState.products.find(x=>String(x.id)===row.querySelector('[name="produto_id"]').value);
  const poured=number(row.querySelector('[name="moldes_vazados"]').value);const broken=number(row.querySelector('[name="moldes_quebrados"]').value);
  const pieces=poured*number(product?.cavidades_molde);const tons=pieces*number(product?.peso_peca_kg)/1000;
  row.querySelector("[data-total-moldes]").textContent=poured+broken;row.querySelector("[data-total-pecas]").textContent=pieces.toLocaleString("pt-BR");row.querySelector("[data-toneladas]").textContent=tons.toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3});renderShiftTimeline();
}
function updateStopRow(row){
  const start=row.querySelector('[name="inicio"]').value,end=row.querySelector('[name="fim"]').value;
  let minutes=0;if(start&&end){minutes=window.LIDUTEC_TURNOS.stopDurationMinutes(start,end)}
  row.querySelector("[data-duration]").textContent=formatMinutes(minutes);renderShiftTimeline();
}
function renderShiftTimeline(){
  const form=q("#shift-entry-form"),productionContainer=q("#shift-production-segments"),container=q("#shift-stop-segments");if(!form||!productionContainer||!container)return;
  const date=form.elements.data_operacional.value,shift=window.LIDUTEC_TURNOS.shifts[form.elements.turno.value];if(!date||!shift)return;
  const start=new Date(`${date}T${shift.inicio}`),end=new Date(`${date}T${shift.fim}`);if(end<=start)end.setDate(end.getDate()+1);
  q("#timeline-start").textContent=shift.inicio;q("#timeline-end").textContent=`${shift.fim}${end.getDate()!==start.getDate()?" (+1 dia)":""}`;
  const duration=end-start,productionSegments=[],segments=[];
  for(const row of document.querySelectorAll(".shift-production-row")){
    const startValue=row.querySelector('[name="inicio"]').value,endValue=row.querySelector('[name="fim"]').value,productId=row.querySelector('[name="produto_id"]').value;if(!startValue||!endValue||!productId)continue;
    const productionStart=new Date(startValue),productionEnd=new Date(endValue);if(Number.isNaN(productionStart.getTime())||Number.isNaN(productionEnd.getTime())||productionEnd<=productionStart)continue;
    const visibleStart=Math.max(start.getTime(),productionStart.getTime()),visibleEnd=Math.min(end.getTime(),productionEnd.getTime());if(visibleEnd<=visibleStart)continue;
    const left=(visibleStart-start)/duration*100,width=(visibleEnd-visibleStart)/duration*100,product=productionState.products.find(item=>String(item.id)===productId),label=product?.codigo||"Produto";
    const title=esc(product?`${product.codigo} — ${product.nome}`:label),center=left+width/2;
    productionSegments.push(`<span class="shift-production-segment" style="left:${left}%;width:${width}%" title="${title}"></span><span class="shift-production-label" style="left:${center}%">${esc(label)}</span>`);
  }
  for(const row of document.querySelectorAll(".shift-stop-row")){
    const startValue=row.querySelector('[name="inicio"]').value,endValue=row.querySelector('[name="fim"]').value;if(!startValue||!endValue)continue;
    const stopStart=new Date(startValue),stopEnd=new Date(endValue);if(Number.isNaN(stopStart.getTime())||Number.isNaN(stopEnd.getTime())||stopEnd<=stopStart)continue;
    const visibleStart=Math.max(start.getTime(),stopStart.getTime()),visibleEnd=Math.min(end.getTime(),stopEnd.getTime());if(visibleEnd<=visibleStart)continue;
    const left=(visibleStart-start)/duration*100,width=(visibleEnd-visibleStart)/duration*100;
    const sector=row.querySelector('[name="setor_id"] option:checked')?.textContent||"Parada",reason=row.querySelector('[name="categoria_id"] option:checked')?.textContent||"Motivo não informado";
    segments.push(`<span class="shift-stop-segment" style="left:${left}%;width:${width}%" title="${esc(sector)} — ${esc(reason)} — ${formatMinutes(Math.round((visibleEnd-visibleStart)/60000))}"></span>`);
  }
  productionContainer.innerHTML=productionSegments.join("");container.innerHTML=segments.join("");
}
function completeRow(row,names){return names.some(name=>row.querySelector(`[name="${name}"]`)?.value);}
function serializeShift(){
  const productions=[...document.querySelectorAll(".shift-production-row")].filter(row=>completeRow(row,["inicio","fim","produto_id"])).map(row=>{
    const product=productionState.products.find(x=>String(x.id)===row.querySelector('[name="produto_id"]').value);
    if(!row.querySelector('[name="inicio"]').value||!row.querySelector('[name="fim"]').value||!product)throw new Error("Preencha início, fim e produto em todas as linhas de produção.");
    if(product.cavidades_molde==null||product.peso_peca_kg==null)throw new Error(`O produto ${product.codigo} não possui cavidades por molde ou peso da peça cadastrado.`);
    const start=row.querySelector('[name="inicio"]').value,end=row.querySelector('[name="fim"]').value;validateShiftInterval(start,end,"A produção");
    return{inicio:new Date(start).toISOString(),fim:new Date(end).toISOString(),produto_id:number(product.id),moldes_vazados:number(row.querySelector('[name="moldes_vazados"]').value),moldes_quebrados:number(row.querySelector('[name="moldes_quebrados"]').value)};
  });
  if(!productions.length)throw new Error("Informe ao menos uma linha de produção.");
  const stops=[...document.querySelectorAll(".shift-stop-row")].filter(row=>completeRow(row,["inicio","fim","setor_id","categoria_id","observacao"])).map(row=>{
    const value=name=>row.querySelector(`[name="${name}"]`).value;if(!value("inicio")||!value("fim")||!value("setor_id")||!value("categoria_id"))throw new Error("Preencha início, fim, setor e motivo em todas as paradas.");validateShiftInterval(value("inicio"),value("fim"),"A parada");return{inicio:new Date(value("inicio")).toISOString(),fim:new Date(value("fim")).toISOString(),setor_id:number(value("setor_id")),categoria_id:number(value("categoria_id")),observacao:value("observacao")};
  });return{productions,stops};
}
const toDateTimeInput=value=>{if(!value)return"";const date=new Date(value),pad=item=>String(item).padStart(2,"0");return`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`};
function populateShiftRows(productions,stops){
  q("#production-entry-rows").replaceChildren();q("#stop-entry-rows").replaceChildren();
  for(const item of productions.length?productions:[{}]){const row=productionRow();applyRowValues(row,{inicio:toDateTimeInput(item.inicio),fim:toDateTimeInput(item.fim),produto_id:item.produto_id??"",moldes_vazados:item.moldes_vazados??0,moldes_quebrados:item.moldes_quebrados??0});q("#production-entry-rows").append(row);updateProductionRow(row)}
  for(const item of stops.length?stops:[{}]){const row=stopRow();applyRowValues(row,{inicio:toDateTimeInput(item.inicio),fim:toDateTimeInput(item.fim),setor_id:item.setor_responsavel_id??item.setor_id??"",categoria_id:item.categoria_id??"",observacao:item.observacao??""});q("#stop-entry-rows").append(row);try{updateStopRow(row)}catch{}}
}
async function loadShiftHistory(turnId){
  const{data,error}=await window.supabaseClient.from("historico_edicoes_turno_producao").select("alterado_em,descricao,usuarios(nome)").eq("turno_producao_id",turnId).order("alterado_em",{ascending:false});if(error)throw error;
  const panel=q("#shift-edit-history");panel.hidden=!data?.length;q("#shift-edit-history-rows").innerHTML=(data||[]).map(item=>`<tr><td>${formatDateTime(item.alterado_em)}</td><td>${esc(item.usuarios?.nome||"Usuário")} alterou ${esc(item.descricao)}.</td></tr>`).join("");
}
async function editClosedShift(){
  const turnId=productionState.currentShift?.id;if(!turnId)return;
  const[productions,stops]=await Promise.all([window.supabaseClient.from("registros_producao_moldes").select("produto_id,inicio,fim,moldes_vazados,moldes_quebrados").eq("turno_producao_id",turnId).order("inicio"),window.supabaseClient.from("paradas_producao_moldes").select("inicio,fim,setor_responsavel_id,categoria_id,observacao").eq("turno_producao_id",turnId).order("inicio")]);if(productions.error)throw productions.error;if(stops.error)throw stops.error;
  productionState.originalShiftData={productions:productions.data||[],stops:stops.data||[]};populateShiftRows(productionState.originalShiftData.productions,productionState.originalShiftData.stops);productionState.editingClosed=true;
  const form=q("#shift-entry-form");for(const control of form.querySelectorAll("tbody input,tbody select,tbody button,#add-production-row,#add-stop-row"))control.disabled=false;q("#edit-shift-button").hidden=true;q("#delete-shift-button").hidden=true;q("#close-shift-button").hidden=false;q("#close-shift-button").disabled=false;q("#close-shift-button").textContent="Salvar alterações";q("#shift-status").textContent="Editando turno fechado";
}
function changeDescriptions(original,current){
  const changes=[],valueText=value=>value==null||value===""?"vazio":String(value),productCode=id=>productionState.products.find(item=>String(item.id)===String(id))?.codigo||`produto ${id}`;
  const productionFields={inicio:"início",fim:"fim",produto_id:"produto",moldes_vazados:"moldes vazados",moldes_quebrados:"moldes quebrados"};
  const oldProductions=original.productions||[],newProductions=current.productions||[],maxProduction=Math.max(oldProductions.length,newProductions.length);
  for(let index=0;index<maxProduction;index++){const before=oldProductions[index],after=newProductions[index];if(!before&&after){changes.push(`adicionou produção de ${productCode(after.produto_id)}`);continue}if(before&&!after){changes.push(`removeu produção de ${productCode(before.produto_id)}`);continue}for(const[field,label]of Object.entries(productionFields)){const isDate=field==="inicio"||field==="fim",oldValue=isDate?toDateTimeInput(before[field]):String(before[field]??""),newValue=isDate?toDateTimeInput(after[field]):String(after[field]??"");if(oldValue!==newValue)changes.push(`${label} de ${productCode(after.produto_id||before.produto_id)} de ${valueText(oldValue)} para ${valueText(newValue)}`)}}
  const oldStops=original.stops||[],newStops=current.stops||[],maxStops=Math.max(oldStops.length,newStops.length),stopFields={inicio:"início da parada",fim:"fim da parada",setor_id:"setor responsável",categoria_id:"motivo da parada",observacao:"observação da parada"};
  for(let index=0;index<maxStops;index++){const before=oldStops[index]&&{...oldStops[index],setor_id:oldStops[index].setor_responsavel_id},after=newStops[index];if(!before&&after){changes.push(`adicionou a parada ${index+1}`);continue}if(before&&!after){changes.push(`removeu a parada ${index+1}`);continue}for(const[field,label]of Object.entries(stopFields)){const isDate=field==="inicio"||field==="fim",oldValue=isDate?toDateTimeInput(before[field]):String(before[field]??""),newValue=isDate?toDateTimeInput(after[field]):String(after[field]??"");if(oldValue!==newValue)changes.push(`${label} ${index+1} de ${valueText(oldValue)} para ${valueText(newValue)}`)}}return changes;
}
async function checkShiftStatus(){
  const form=q("#shift-entry-form"),date=form.elements.data_operacional.value,shift=form.elements.turno.value;if(!date||!shift)return;
  const{data,error}=await window.supabaseClient.from("turnos_producao_moldes").select("id,status").eq("data_operacional",date).eq("turno",shift).maybeSingle();if(error)throw error;
  productionState.currentShift=data;productionState.editingClosed=false;productionState.originalShiftData=null;const closed=data?.status==="FECHADO",canEdit=closed&&productionState.permissions.has("producao_moldes.editar"),canDelete=closed&&productionState.permissions.has("producao_moldes.excluir_turno");q("#shift-status").textContent=closed?"Fechado":"Em apontamento";q("#close-shift-button").hidden=closed;q("#close-shift-button").disabled=closed;q("#close-shift-button").textContent="Fechar turno";q("#edit-shift-button").hidden=!canEdit;q("#delete-shift-button").hidden=!canDelete;q("#delete-shift-button").disabled=false;for(const control of form.querySelectorAll("tbody input,tbody select,tbody button,#add-production-row,#add-stop-row"))control.disabled=closed;if(data?.id)await loadShiftHistory(data.id);else q("#shift-edit-history").hidden=true;
}
async function deleteClosedShift(){
  const turnId=productionState.currentShift?.id;if(!turnId)return;if(!confirm("Excluir definitivamente este turno, suas produções, paradas e histórico de alterações?"))return;
  const button=q("#delete-shift-button");button.disabled=true;try{const{error}=await window.supabaseClient.rpc("excluir_turno_producao_moldes",{p_turno_id:turnId});if(error)throw error;localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();q("#shift-edit-history").hidden=true;message("Turno excluído com sucesso.");await checkShiftStatus()}catch(error){message(error.message,"error");button.disabled=false}
}
async function closeShift(event){
  event.preventDefault();const button=q("#close-shift-button");button.disabled=true;
  try{const form=event.currentTarget,{productions,stops}=serializeShift();if(productionState.editingClosed){const changes=changeDescriptions(productionState.originalShiftData,{productions,stops});const{error}=await window.supabaseClient.rpc("editar_turno_producao_moldes",{p_turno_id:productionState.currentShift.id,p_producoes:productions,p_paradas:stops,p_alteracoes:changes});if(error)throw error;localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();message("Alterações do turno salvas com sucesso.");await checkShiftStatus();return}const{error}=await window.supabaseClient.rpc("fechar_turno_producao_moldes",{p_data_operacional:form.elements.data_operacional.value,p_turno:form.elements.turno.value,p_producoes:productions,p_paradas:stops});if(error)throw error;localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();message("Turno fechado com sucesso.");await checkShiftStatus();}
  catch(error){message(error.message,"error");button.disabled=false;}
}
function initializeShiftEntry(){
  const form=q("#shift-entry-form");applyCurrentShift(form);if(!restoreShiftDraft()){appendEntryRow("#production-entry-rows",productionRow());appendEntryRow("#stop-entry-rows",stopRow())}form.hidden=false;
  q("#add-production-row").addEventListener("click",()=>{appendEntryRow("#production-entry-rows",productionRow());saveShiftDraft()});q("#add-stop-row").addEventListener("click",()=>{appendEntryRow("#stop-entry-rows",stopRow());saveShiftDraft()});
  form.addEventListener("input",event=>{const production=event.target.closest(".shift-production-row"),stop=event.target.closest(".shift-stop-row");if(production)updateProductionRow(production);if(stop)try{updateStopRow(stop)}catch(error){message(error.message,"error")}saveShiftDraft()});
  form.addEventListener("click",event=>{const button=event.target.closest(".row-remove");if(!button)return;const row=button.closest("tr"),body=row.parentElement;if(body.children.length===1){for(const control of row.querySelectorAll("input,select"))control.value=control.type==="number"?"0":"";row.matches(".shift-production-row")?updateProductionRow(row):updateStopRow(row)}else row.remove();renderShiftTimeline();saveShiftDraft()});
  form.elements.data_operacional.addEventListener("change",()=>{applyShiftDateTimeLimits();renderShiftTimeline();saveShiftDraft();checkShiftStatus().catch(error=>message(error.message,"error"))});form.elements.turno.addEventListener("change",()=>{applyShiftDateTimeLimits();renderShiftTimeline();saveShiftDraft();checkShiftStatus().catch(error=>message(error.message,"error"))});form.addEventListener("submit",closeShift);applyShiftDateTimeLimits();renderShiftTimeline();checkShiftStatus().catch(error=>message(error.message,"error"));
  q("#edit-shift-button").addEventListener("click",()=>editClosedShift().catch(error=>message(error.message,"error")));
  q("#delete-shift-button").addEventListener("click",deleteClosedShift);
}
async function loadProductionData(){
  const [records,stops]=await Promise.all([
    window.supabaseClient.from("registros_producao_moldes").select("*,produtos(codigo,nome),linhas_maquinas_producao(codigo,nome)").order("data_operacional",{ascending:false}).limit(500),
    window.supabaseClient.from("paradas_producao_moldes").select("*,produtos(codigo,nome),linhas_maquinas_producao(codigo,nome),categorias_parada_producao(nome),setores_responsaveis_parada(nome)").order("inicio",{ascending:false}).limit(500)
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
  renderProductionQuery();
}
const displayDate=value=>value?new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR"):"—";
function filteredByCommonPeriod(rows,form){const start=form?.elements.inicio.value,end=form?.elements.fim.value,shift=form?.elements.turno.value;return rows.filter(item=>(!start||item.data_operacional>=start)&&(!end||item.data_operacional<=end)&&(!shift||item.turno===shift))}
function renderProductionQuery(){
  const body=q("#dashboard-production-records"),form=q("#production-query-filters");if(!body||!form)return;const productId=form.elements.produto_id.value;
  const rows=filteredByCommonPeriod(productionState.records,form).filter(item=>item.data_operacional&&item.inicio&&item.fim&&(!productId||String(item.produto_id)===productId));
  body.innerHTML=rows.map(item=>`<tr><td>${formatDateTime(item.inicio)}</td><td>${formatDateTime(item.fim)}</td><td><strong>${esc(item.produtos?.codigo||"—")}</strong> — ${esc(item.produtos?.nome||"")}</td><td>${number(item.moldes_vazados)}</td><td>${number(item.moldes_quebrados)}</td><td>${number(item.moldes_vazados)+number(item.moldes_quebrados)}</td><td>${number(item.toneladas_produzidas).toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3})}</td><td>${number(item.total_pecas).toLocaleString("pt-BR")}</td><td>${displayDate(item.data_operacional)}</td><td>${esc(item.turno)}</td></tr>`).join("");q("#dashboard-production-empty").hidden=rows.length>0;
}
function renderBars(rows,selector,keyFn,valueFn){
  const container=q(selector);if(!container)return;const grouped=new Map();for(const row of rows)grouped.set(keyFn(row),(grouped.get(keyFn(row))||0)+number(valueFn(row)));
  const max=Math.max(1,...grouped.values());container.innerHTML=[...grouped].map(([key,value])=>`<div class="production-bar"><strong>${esc(key.replaceAll("_"," "))}</strong><div class="production-bar-track"><div class="production-bar-fill" style="width:${value/max*100}%"></div></div><span>${value}</span></div>`).join("")||'<p class="production-muted">Sem dados no período.</p>';
}
function renderRecords(){
  q("#production-records").innerHTML=productionState.records.map(x=>`<tr><td>${esc(x.data_operacional)}</td><td>${esc(x.turno)}</td><td>${esc(x.produtos?.codigo||"—")}</td><td>${esc(x.linhas_maquinas_producao?.codigo||"—")}</td><td>${x.quantidade_planejada}</td><td>${x.quantidade_produzida}</td><td>${x.quantidade_aprovada}</td><td>${x.quantidade_refugada}</td></tr>`).join("");
  q("#production-empty").hidden=productionState.records.length>0;q("#production-table").hidden=!productionState.records.length;
}
function renderStops(){
  const form=q("#stop-query-filters"),sectorId=form?.elements.setor_id.value,categoryId=form?.elements.categoria_id.value,normalizeText=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(),terms=normalizeText(form?.elements.observacao.value).split(/\s+/).filter(Boolean),rows=filteredByCommonPeriod(productionState.stops,form).filter(item=>(!sectorId||String(item.setor_responsavel_id)===sectorId)&&(!categoryId||String(item.categoria_id)===categoryId)&&terms.every(term=>normalizeText(item.observacao).includes(term)));
  q("#stop-records").innerHTML=rows.map(x=>`<tr><td>${formatDateTime(x.inicio)}</td><td>${formatDateTime(x.fim)}</td><td>${formatMinutes(x.duracao_minutos)}</td><td>${esc(x.setores_responsaveis_parada?.nome||"—")}</td><td>${esc(x.categorias_parada_producao?.nome||x.motivo||"—")}</td><td>${esc(x.observacao||"—")}</td><td>${displayDate(x.data_operacional)}</td><td>${esc(x.turno)}</td></tr>`).join("");q("#stop-records-empty").hidden=rows.length>0;
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
  await loadSupport();if(productionPage!=="entry")await loadProductionData();q("#production-loading")?.setAttribute("hidden","");
  if(productionPage==="dashboard")renderDashboard();if(productionPage==="records")renderRecords();if(productionPage==="stops")renderStops();if(productionPage==="charts")renderCharts();
  q("#production-query-filters")?.addEventListener("input",renderProductionQuery);q("#stop-query-filters")?.addEventListener("input",renderStops);
  if(productionPage==="entry"){if(!permissions.has("producao_moldes.lancar"))throw new Error("Usuário sem permissão para lançar produção.");initializeShiftEntry();}
  const productionForm=q("#production-form");if(productionForm){applyCurrentShift(productionForm);productionForm.addEventListener("submit",submitProduction)}
  q("#stop-form")?.addEventListener("submit",submitStop);
}
q("#menu-button")?.addEventListener("click",()=>q("#sidebar").classList.toggle("open"));q("#logout-button")?.addEventListener("click",()=>window.LIDUTEC_APP.signOut());
initializeProduction().catch(error=>{console.error(error);q("#production-loading").textContent=`Erro: ${error.message}`});
