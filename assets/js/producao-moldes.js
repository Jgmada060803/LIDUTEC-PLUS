const productionPage = document.body.dataset.productionPage;
const productionState = { user:null, permissions:new Set(), products:[], lines:[], categories:[], sectors:[], records:[], stops:[], currentShift:null, editingClosed:false, originalShiftData:null, querySort:{key:null,direction:"asc"}, stopSort:{key:null,direction:"asc"} };
const q = (selector) => document.querySelector(selector);
const esc = (value="") => String(value).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number = (value) => Number(value || 0);
const formatDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const formatMinutes = (value) => `${Math.floor(number(value)/60)}h ${String(number(value)%60).padStart(2,"0")}min`;
function message(text,type="success"){const el=q("#production-message");if(!el)return;el.textContent=text;el.className=`form-message ${type}`;el.hidden=false}
async function loadSupport(){
  const{products,lines,categories,sectors}=await window.LIDUTEC_PRODUCAO_DATA.support();productionState.products=products;productionState.lines=lines;productionState.categories=categories;productionState.sectors=sectors;
  for(const select of document.querySelectorAll("[data-products]"))select.insertAdjacentHTML("beforeend",productionState.products.map(p=>`<option value="${p.id}">${esc(p.codigo)} — ${esc(p.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-lines]"))select.insertAdjacentHTML("beforeend",lines.map(x=>`<option value="${x.id}">${esc(x.codigo)} — ${esc(x.nome)}</option>`).join(""));
  for(const select of document.querySelectorAll("[data-categories]"))select.insertAdjacentHTML("beforeend",categories.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join(""));
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
  const{start,end}=window.LIDUTEC_TURNOS.shiftBounds(date,form.elements.turno.value);
  const inputValue=value=>{const pad=item=>String(item).padStart(2,"0");return`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`};return{start,end,min:inputValue(start),max:inputValue(end)};
}
function applyShiftDateTimeLimits(){const bounds=shiftDateTimeBounds();if(!bounds)return;for(const input of document.querySelectorAll('.shift-entry-table input[type="datetime-local"]')){input.min=bounds.min;input.max=bounds.max}}
function validateShiftInterval(startValue,endValue,label){const form=q("#shift-entry-form"),bounds=shiftDateTimeBounds();if(!bounds||!window.LIDUTEC_TURNOS.intervalWithinShift(form.elements.data_operacional.value,form.elements.turno.value,startValue,endValue))throw new Error(`${label} deve estar entre ${bounds?.min.replace("T"," ")} e ${bounds?.max.replace("T"," ")}.`)}
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
  const calculation=window.LIDUTEC_TURNOS.productionCalculation(poured,broken,product?.cavidades_molde,product?.peso_peca_kg);
  row.querySelector("[data-total-moldes]").textContent=calculation.totalMolds;row.querySelector("[data-total-pecas]").textContent=calculation.totalPieces.toLocaleString("pt-BR");row.querySelector("[data-toneladas]").textContent=calculation.tons.toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3});renderShiftTimeline();
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
  const data=await window.LIDUTEC_PRODUCAO_DATA.history(turnId);
  const rows=(data||[]).flatMap(item=>{const normalize=snapshot=>({productions:snapshot?.productions||[],stops:(snapshot?.stops||[]).map(stop=>({...stop,setor_id:stop.setor_responsavel_id}))}),changes=item.dados_anteriores&&item.dados_novos?changeDescriptions(normalize(item.dados_anteriores),normalize(item.dados_novos)):[item.descricao];return(changes.length?changes:[item.descricao]).map(description=>({alterado_em:item.alterado_em,nome:item.usuarios?.nome||"Usuário",description}))});
  const panel=q("#shift-edit-history");panel.hidden=!rows.length;q("#shift-edit-history-rows").innerHTML=rows.map(item=>`<tr><td>${formatDateTime(item.alterado_em)}</td><td>${esc(item.nome)} alterou ${esc(item.description)}.</td></tr>`).join("");
}
async function editClosedShift(){
  const turnId=productionState.currentShift?.id;if(!turnId)return;
  const[productions,stops]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.shiftProductions(turnId),window.LIDUTEC_PRODUCAO_DATA.shiftStops(turnId)]);
  productionState.originalShiftData={productions,stops};populateShiftRows(productions,stops);productionState.editingClosed=true;
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
  const data=await window.LIDUTEC_PRODUCAO_DATA.shift(date,shift);
  productionState.currentShift=data;productionState.editingClosed=false;productionState.originalShiftData=null;const closed=data?.status==="FECHADO",canEdit=closed&&productionState.permissions.has("producao_moldes.editar"),canDelete=closed&&productionState.permissions.has("producao_moldes.excluir_turno");q("#shift-status").textContent=closed?"Fechado":"Em apontamento";q("#close-shift-button").hidden=closed;q("#close-shift-button").disabled=closed;q("#close-shift-button").textContent="Fechar turno";q("#edit-shift-button").hidden=!canEdit;q("#delete-shift-button").hidden=!canDelete;q("#delete-shift-button").disabled=false;for(const control of form.querySelectorAll("tbody input,tbody select,tbody button,#add-production-row,#add-stop-row"))control.disabled=closed;if(data?.id)await loadShiftHistory(data.id);else q("#shift-edit-history").hidden=true;
}
async function deleteClosedShift(){
  const turnId=productionState.currentShift?.id;if(!turnId)return;if(!confirm("Excluir definitivamente este turno, suas produções, paradas e histórico de alterações?"))return;
  const button=q("#delete-shift-button");button.disabled=true;try{await window.LIDUTEC_PRODUCAO_DATA.deleteShift(turnId);localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();q("#shift-edit-history").hidden=true;message("Turno excluído com sucesso.");await checkShiftStatus()}catch(error){message(error.message,"error");button.disabled=false}
}
async function closeShift(event){
  event.preventDefault();const button=q("#close-shift-button");button.disabled=true;
  try{const form=event.currentTarget,{productions,stops}=serializeShift();if(productionState.editingClosed){const changes=changeDescriptions(productionState.originalShiftData,{productions,stops});await window.LIDUTEC_PRODUCAO_DATA.editShift({p_turno_id:productionState.currentShift.id,p_producoes:productions,p_paradas:stops,p_alteracoes:changes});localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();message("Alterações do turno salvas com sucesso.");await checkShiftStatus();return}await window.LIDUTEC_PRODUCAO_DATA.closeShift({p_data_operacional:form.elements.data_operacional.value,p_turno:form.elements.turno.value,p_producoes:productions,p_paradas:stops});localStorage.removeItem(shiftDraftKey());resetShiftEntryRows();message("Turno fechado com sucesso.");await checkShiftStatus();}
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
  [productionState.records,productionState.stops]=await Promise.all([window.LIDUTEC_PRODUCAO_DATA.records(),window.LIDUTEC_PRODUCAO_DATA.stops()]);
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
const productionSortValues={date:item=>item.data_operacional,shift:item=>item.turno,start:item=>item.inicio,end:item=>item.fim,product:item=>`${item.produtos?.codigo||""} ${item.produtos?.nome||""}`,poured:item=>number(item.moldes_vazados),broken:item=>number(item.moldes_quebrados),molds:item=>number(item.moldes_vazados)+number(item.moldes_quebrados),tons:item=>number(item.toneladas_produzidas),pieces:item=>number(item.total_pecas)};
function sortProductionRows(rows){const{key,direction}=productionState.querySort,getValue=productionSortValues[key];if(!getValue)return rows;const factor=direction==="asc"?1:-1;return rows.map((item,index)=>({item,index})).sort((left,right)=>{const a=getValue(left.item),b=getValue(right.item),result=typeof a==="number"&&typeof b==="number"?a-b:String(a??"").localeCompare(String(b??""),"pt-BR",{numeric:true,sensitivity:"base"});return result?result*factor:left.index-right.index}).map(entry=>entry.item)}
function updateProductionSortHeaders(){for(const button of document.querySelectorAll(".production-query-table .table-sort")){const active=button.dataset.sort===productionState.querySort.key,direction=active?productionState.querySort.direction:"";button.dataset.direction=direction;button.closest("th").setAttribute("aria-sort",direction==="asc"?"ascending":direction==="desc"?"descending":"none");button.title=active?`Classificação ${direction==="asc"?"crescente":"decrescente"}. Clique para inverter.`:"Clique para classificar em ordem crescente."}}
function renderProductionQuery(){
  const body=q("#dashboard-production-records"),form=q("#production-query-filters");if(!body||!form)return;const productId=form.elements.produto_id.value;
  const rows=sortProductionRows(filteredByCommonPeriod(productionState.records,form).filter(item=>item.data_operacional&&item.inicio&&item.fim&&(!productId||String(item.produto_id)===productId)));
  body.innerHTML=rows.map(item=>`<tr><td>${displayDate(item.data_operacional)}</td><td>${esc(item.turno)}</td><td>${formatDateTime(item.inicio)}</td><td>${formatDateTime(item.fim)}</td><td><strong>${esc(item.produtos?.codigo||"—")}</strong> — ${esc(item.produtos?.nome||"")}</td><td>${number(item.moldes_vazados)}</td><td>${number(item.moldes_quebrados)}</td><td>${number(item.moldes_vazados)+number(item.moldes_quebrados)}</td><td>${number(item.toneladas_produzidas).toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3})}</td><td>${number(item.total_pecas).toLocaleString("pt-BR")}</td></tr>`).join("");q("#dashboard-production-empty").hidden=rows.length>0;updateProductionSortHeaders();
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
  const form=q("#stop-query-filters"),sectorId=form?.elements.setor_id.value,categoryId=form?.elements.categoria_id.value,normalizeText=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(),terms=normalizeText(form?.elements.observacao.value).split(/\s+/).filter(Boolean),filtered=filteredByCommonPeriod(productionState.stops,form).filter(item=>(!sectorId||String(item.setor_responsavel_id)===sectorId)&&(!categoryId||String(item.categoria_id)===categoryId)&&terms.every(term=>normalizeText(item.observacao).includes(term)));
  const getters={start:item=>item.inicio,end:item=>item.fim,duration:item=>number(item.duracao_minutos),sector:item=>item.setores_responsaveis_parada?.nome,reason:item=>item.categorias_parada_producao?.nome||item.motivo,notes:item=>item.observacao,date:item=>item.data_operacional,shift:item=>item.turno},getValue=getters[productionState.stopSort.key],factor=productionState.stopSort.direction==="asc"?1:-1,rows=getValue?filtered.map((item,index)=>({item,index})).sort((left,right)=>{const a=getValue(left.item),b=getValue(right.item),result=typeof a==="number"&&typeof b==="number"?a-b:String(a??"").localeCompare(String(b??""),"pt-BR",{numeric:true,sensitivity:"base"});return result?result*factor:left.index-right.index}).map(entry=>entry.item):filtered;
  q("#stop-records").innerHTML=rows.map(x=>`<tr><td>${displayDate(x.data_operacional)}</td><td>${esc(x.turno)}</td><td>${formatDateTime(x.inicio)}</td><td>${formatDateTime(x.fim)}</td><td>${formatMinutes(x.duracao_minutos)}</td><td>${esc(x.setores_responsaveis_parada?.nome||"—")}</td><td>${esc(x.categorias_parada_producao?.nome||x.motivo||"—")}</td><td>${esc(x.observacao||"—")}</td></tr>`).join("");q("#stop-records-empty").hidden=rows.length>0;updateStopSortHeaders();
}
function updateStopSortHeaders(){for(const button of document.querySelectorAll(".stop-query-table .table-sort")){const active=button.dataset.sort===productionState.stopSort.key,direction=active?productionState.stopSort.direction:"";button.dataset.direction=direction;button.closest("th").setAttribute("aria-sort",direction==="asc"?"ascending":direction==="desc"?"descending":"none");button.title=active?`Classificação ${direction==="asc"?"crescente":"decrescente"}. Clique para inverter.`:"Clique para classificar em ordem crescente."}}
function renderCharts(){
  renderBars(productionState.records,"#daily-chart",x=>x.data_operacional,x=>x.quantidade_produzida);
  renderBars(productionState.records,"#product-chart",x=>x.produtos?.codigo||"—",x=>x.quantidade_produzida);
  renderBars(productionState.stops,"#stop-chart",x=>x.categorias_parada_producao?.nome||"—",x=>x.duracao_minutos);
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
  q("#production-query-filters")?.addEventListener("input",renderProductionQuery);q(".production-query-table")?.addEventListener("click",event=>{const button=event.target.closest(".table-sort");if(!button)return;if(productionPage==="stops"){const same=productionState.stopSort.key===button.dataset.sort;productionState.stopSort={key:button.dataset.sort,direction:same&&productionState.stopSort.direction==="asc"?"desc":"asc"};renderStops();return}const same=productionState.querySort.key===button.dataset.sort;productionState.querySort={key:button.dataset.sort,direction:same&&productionState.querySort.direction==="asc"?"desc":"asc"};renderProductionQuery()});q("#stop-query-filters")?.addEventListener("input",renderStops);
  if(productionPage==="entry"){if(!permissions.has("producao_moldes.lancar"))throw new Error("Usuário sem permissão para lançar produção.");initializeShiftEntry();}
}
q("#menu-button")?.addEventListener("click",()=>q("#sidebar").classList.toggle("open"));q("#logout-button")?.addEventListener("click",()=>window.LIDUTEC_APP.signOut());
initializeProduction().catch(error=>{console.error(error);q("#production-loading").textContent=`Erro: ${error.message}`});
