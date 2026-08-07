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
  const checklistHref=(modelId,date,shift,productId)=>{const nested=/\/pages\/[^/]+\//.test(location.pathname),prefix=nested?"../":"./",params=new URLSearchParams({modelo:modelId,data:date,turno:shift});if(productId)params.set("produto",productId);return`${prefix}controle-processo/checklist.html?${params}`};
  const request=async query=>{const response=await query;if(response.error)throw response.error;return response.data||[]};
  let sequence=0;
  async function refresh(){
    const currentSequence=++sequence,{data:date,shift,bounds}=context(),now=new Date();
    if(now<bounds.start||now>bounds.end)return render([]);
    const {data:{user}}=await client.auth.getUser();if(!user)return render([]);
    const models=await request(client.from("modelos_checklist").select("id,nome,frequencia_tipo,intervalo_minutos,areas_checklist!inner(codigo)").eq("ativo",true).in("frequencia_tipo",["INTERVALO","INICIO_TURNO"]).eq("areas_checklist.codigo","MOLDAGEM"));
    if(!models.length)return render([]);
    const [executions,production]=await Promise.all([
      request(client.from("execucoes_checklist").select("id,modelo_id,data_operacional,turno,iniciado_em,concluido_em,status").in("modelo_id",models.map(model=>model.id)).eq("data_operacional",date).eq("turno",shift).neq("status","EM_PREENCHIMENTO").order("concluido_em",{ascending:false}).limit(500)),
      client.from("registros_producao_moldes").select("produto_id,inicio").eq("data_operacional",date).eq("turno",shift).lte("inicio",now.toISOString()).order("inicio",{ascending:false}).limit(1).maybeSingle()
    ]);
    let local=null;try{local=JSON.parse(sessionStorage.getItem("lidutec:checklists:ultima-conclusao")||"null")}catch{sessionStorage.removeItem("lidutec:checklists:ultima-conclusao")}
    if(local&&local.data_operacional===date&&local.turno===shift&&!executions.some(item=>String(item.id)===String(local.id)))executions.unshift(local);
    if(currentSequence!==sequence)return;
    const alerts=models.map(model=>{
      const done=executions.filter(item=>String(item.modelo_id)===String(model.id)&&new Date(item.concluido_em||item.iniciado_em)<=now);
      if(model.frequencia_tipo==="INICIO_TURNO")return done.length?null:{model,level:"pending",message:"Obrigatório no início do turno"};
      const reference=done.length?new Date(done[0].concluido_em||done[0].iniciado_em):bounds.start,due=new Date(reference.getTime()+Number(model.intervalo_minutos)*60000);if(now<due)return null;const late=now>=new Date(due.getTime()+Number(model.intervalo_minutos)*60000);return{model,level:late?"late":"pending",message:`${late?"Atrasado":"Pendente"} · previsto ${due.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`};
    }).filter(Boolean).map(alert=>({...alert,href:checklistHref(alert.model.id,date,shift,production.data?.produto_id)}));
    render(alerts);
  }
  function render(alerts){
    let holder=document.querySelector("#global-checklist-alerts");
    if(!alerts.length){holder?.remove();return}
    if(!holder){holder=document.createElement("aside");holder.id="global-checklist-alerts";holder.className="global-checklist-alerts";holder.setAttribute("aria-live","assertive");document.body.append(holder)}
    holder.innerHTML=alerts.map(alert=>`<a class="global-checklist-alert ${alert.level}" href="${alert.href}"><i></i><span><strong>Checklist: ${escapeHtml(alert.model.nome)}</strong><small>${escapeHtml(alert.message)}</small></span><b>Preencher →</b></a>`).join("");
  }
  const safeRefresh=()=>refresh().catch(error=>console.error("Erro ao atualizar alertas globais de checklist:",error));
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",safeRefresh,{once:true});else safeRefresh();
  window.addEventListener("focus",safeRefresh);window.addEventListener("pageshow",safeRefresh);document.addEventListener("visibilitychange",()=>{if(!document.hidden)safeRefresh()});setInterval(()=>{if(!document.hidden)safeRefresh()},60000);
})();
