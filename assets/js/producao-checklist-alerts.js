(function(){
  const q=s=>document.querySelector(s),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let models=[],executions=[];
  async function request(query){const result=await query;if(result.error)throw result.error;return result.data||[]}
  async function load(){
    models=await request(supabaseClient.from("modelos_checklist").select("id,codigo,nome,frequencia_tipo,intervalo_minutos,areas_checklist!inner(codigo)").eq("ativo",true).in("frequencia_tipo",["INTERVALO","INICIO_TURNO"]).eq("areas_checklist.codigo","MOLDAGEM"));
    executions=models.length?await request(supabaseClient.from("execucoes_checklist").select("id,modelo_id,iniciado_em,status").in("modelo_id",models.map(x=>x.id)).order("iniciado_em",{ascending:false}).limit(500)):[];
    render();
  }
  function render(){
    const form=q("#shift-entry-form"),box=q("#shift-checklist-alerts");if(!form||!box||!form.elements.data_operacional.value||!form.elements.turno.value)return;
    const bounds=LIDUTEC_TURNOS.shiftBounds(form.elements.data_operacional.value,form.elements.turno.value),now=new Date(),alerts=models.map(model=>{
      const done=executions.filter(x=>String(x.modelo_id)===String(model.id)&&new Date(x.iniciado_em)>=bounds.start&&new Date(x.iniciado_em)<=now);
      if(model.frequencia_tipo==="INICIO_TURNO"){
        if(done.length)return null;
        return`<a class="shift-checklist-alert pending" href="../controle-processo/checklist.html?modelo=${model.id}"><i></i><span><strong>${esc(model.nome)}</strong><small>Pendente · obrigatório no início do turno</small></span><b>Preencher →</b></a>`;
      }
      const reference=done.length?new Date(done[0].iniciado_em):bounds.start,due=new Date(reference.getTime()+(done.length?model.intervalo_minutos:0)*60000),late=new Date(due.getTime()+model.intervalo_minutos*60000);if(now<due)return null;const level=now>=late?"late":"pending";
      return`<a class="shift-checklist-alert ${level}" href="../controle-processo/checklist.html?modelo=${model.id}"><i></i><span><strong>${esc(model.nome)}</strong><small>${level==="late"?"Atrasado":"Pendente"} · previsto ${due.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small></span><b>Preencher →</b></a>`;
    }).filter(Boolean);box.innerHTML=alerts.join("");box.hidden=!alerts.length;
  }
  document.addEventListener("DOMContentLoaded",()=>{const wait=setInterval(()=>{const form=q("#shift-entry-form");if(!form)return;clearInterval(wait);form.elements.data_operacional.addEventListener("change",render);form.elements.turno.addEventListener("change",render);load().catch(console.error);setInterval(()=>load().catch(console.error),60000)},100)});
})();
