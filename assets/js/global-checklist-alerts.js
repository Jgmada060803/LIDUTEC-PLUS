(function initializeGlobalChecklistAlerts(){
  const client=window.supabaseClient;
  if(!client)return;
  const escapeHtml=(value="")=>String(value).replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const localDate=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
  const context=()=>{
    if(window.LIDUTEC_TURNOS){const current=window.LIDUTEC_TURNOS.determineShift();return{date:current.dataOperacional,shift:current.codigo,bounds:window.LIDUTEC_TURNOS.shiftBounds(current.dataOperacional,current.codigo)}}
    const now=new Date(),minutes=now.getHours()*60+now.getMinutes(),operational=new Date(now);let shift="NOITE",startMinutes=21*60+30,endMinutes=30*60;
    if(minutes<360)operational.setDate(operational.getDate()-1);else if(minutes<800){shift="MANHA";startMinutes=360;endMinutes=800}else if(minutes<1290){shift="TARDE";startMinutes=800;endMinutes=1290}
    const start=new Date(operational);start.setHours(Math.floor(startMinutes/60),startMinutes%60,0,0);const end=new Date(operational);if(endMinutes>=1440){end.setDate(end.getDate()+1);end.setHours(Math.floor((endMinutes-1440)/60),(endMinutes-1440)%60,0,0)}else end.setHours(Math.floor(endMinutes/60),endMinutes%60,0,0);
    return{date:localDate(operational),shift,bounds:{start,end}};
  };
  const checklistHref=(modelId,date,shift,productId)=>{const nested=/\/pages\/[^/]+\//.test(location.pathname),prefix=nested?"../":"./",params=new URLSearchParams({modelo:modelId,data:date,turno:shift});if(productId)params.set("produto",productId);if(document.querySelector("#shift-entry-form"))params.set("origem","apontamento");return`${prefix}controle-processo/checklist.html?${params}`};
  const request=async query=>{const response=await query;if(response.error)throw response.error;return response.data||[]};
  const intervalStatus=(bounds,interval,completed,now)=>window.LIDUTEC_TURNOS?.checklistIntervalStatus?.(bounds.start,bounds.end,interval,completed,now)||(()=>{const dueCount=Math.floor(Math.max(0,Math.min(now,bounds.end)-bounds.start)/60000/interval),missingCount=Math.max(0,dueCount-completed);return missingCount?{due:new Date(bounds.start.getTime()+(completed+1)*interval*60000),missingCount,late:missingCount>1}:null})();
  let sequence=0,cachedModels=[],modelsLoadedAt=0;
  async function checklistModels(){if(cachedModels.length&&Date.now()-modelsLoadedAt<5*60*1000)return cachedModels;cachedModels=await request(client.from("modelos_checklist").select("id,codigo,nome,frequencia_tipo,intervalo_minutos,areas_checklist!inner(codigo)").eq("ativo",true).in("frequencia_tipo",["INTERVALO","INICIO_TURNO"]).eq("areas_checklist.codigo","MOLDAGEM"));modelsLoadedAt=Date.now();return cachedModels}
  async function refresh(){
    const currentSequence=++sequence,{date,shift,bounds}=context(),now=new Date();
    if(now<bounds.start||now>bounds.end)return render([]);
    const {data:{user}}=await client.auth.getUser();if(!user)return render([]);
    // Turno não programado (ex.: sábado à tarde) só gera alerta se alguém
    // realmente estiver apontando produção extraordinária nele; e, existindo
    // um turno (programado ou não), o alerta só aparece para quem é
    // responsável por ele — nunca para todo mundo logado.
    const scheduled=window.LIDUTEC_TURNOS?.isScheduledShiftDay?.(date,shift)??true;
    const {data:turno,error:turnoError}=await client.from("turnos_producao_moldes").select("criado_por,fechado_por").eq("data_operacional",date).eq("turno",shift).maybeSingle();
    if(turnoError)throw turnoError;
    if(!scheduled&&!turno)return render([]);
    if(turno&&user.id!==turno.criado_por&&user.id!==turno.fechado_por)return render([]);
    if(currentSequence!==sequence)return;
    const models=await checklistModels();
    if(!models.length)return render([]);
    const [executions,production]=await Promise.all([
      request(client.from("execucoes_checklist").select("id,modelo_id,data_operacional,turno,iniciado_em,concluido_em,status").in("modelo_id",models.map(model=>model.id)).eq("data_operacional",date).eq("turno",shift).neq("status","EM_PREENCHIMENTO").order("concluido_em",{ascending:false}).limit(500)),
      client.from("registros_producao_moldes").select("produto_id,inicio").eq("data_operacional",date).eq("turno",shift).lte("inicio",now.toISOString()).order("inicio",{ascending:false}).limit(1).maybeSingle()
    ]);
    let local=null;try{local=JSON.parse(sessionStorage.getItem("lidutec:checklists:ultima-conclusao")||"null")}catch{sessionStorage.removeItem("lidutec:checklists:ultima-conclusao")}
    if(local&&local.data_operacional===date&&local.turno===shift&&!executions.some(item=>String(item.id)===String(local.id)))executions.unshift(local);
    if(currentSequence!==sequence)return;
    const alerts=models.flatMap(model=>{
      const done=executions.filter(item=>String(item.modelo_id)===String(model.id)&&new Date(item.concluido_em||item.iniciado_em)<=now);
      if(model.frequencia_tipo==="INICIO_TURNO")return done.length?[]:[{model,level:"pending",due:bounds.start,message:"Obrigatório no início do turno"}];
      const interval=Number(model.intervalo_minutos),status=intervalStatus(bounds,interval,done.length,now);if(!status)return[];return Array.from({length:status.missingCount},(_,index)=>{const due=new Date(status.due.getTime()+index*interval*60000),late=now>=new Date(due.getTime()+interval*60000);return{model,level:late?"late":"pending",due,message:`${late?"Atrasado":"Pendente"} · check das ${due.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`}});
    }).map(alert=>({...alert,href:checklistHref(alert.model.id,date,shift,production.data?.produto_id)})).sort((left,right)=>left.due-right.due);
    render(alerts,date,shift);
  }
  function render(alerts,date,shift){
    let holder=document.querySelector("#global-checklist-alerts");
    if(!alerts.length){holder?.remove();return}
    if(!holder){holder=document.createElement("aside");holder.id="global-checklist-alerts";holder.className="global-checklist-alerts";holder.setAttribute("aria-live","assertive");document.body.append(holder)}
    holder.dataset.date=date;holder.dataset.turno=shift;
    holder.innerHTML=alerts.map(alert=>`<a class="global-checklist-alert ${alert.level}" href="${alert.href}" title="${escapeHtml(`${alert.model.nome} · ${alert.message}`)}"><strong>${escapeHtml(alert.model.codigo)}</strong><small>${alert.due.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small></a>`).join("");
  }
  const safeRefresh=()=>refresh().catch(error=>console.error("Erro ao atualizar alertas globais de checklist:",error));
  function scheduleDeadlineRefresh(){const interval=30*60*1000,delay=interval-Date.now()%interval+250;setTimeout(()=>{safeRefresh();scheduleDeadlineRefresh()},delay)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",safeRefresh,{once:true});else safeRefresh();
  window.addEventListener("focus",safeRefresh);window.addEventListener("pageshow",safeRefresh);document.addEventListener("visibilitychange",()=>{document.documentElement.classList.toggle("checklist-alerts-paused",document.hidden);if(!document.hidden)safeRefresh()});setInterval(()=>{if(!document.hidden)safeRefresh()},120000);scheduleDeadlineRefresh();
  client.channel("global-checklist-alerts").on("postgres_changes",{event:"*",schema:"public",table:"execucoes_checklist"},()=>{if(!document.hidden)safeRefresh()}).subscribe();
})();
