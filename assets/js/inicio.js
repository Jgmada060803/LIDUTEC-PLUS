(async function initializeHome(){
  const user=await window.LIDUTEC_APP.requireAuthenticatedUser();if(!user)return;
  const[profile,permissions]=await Promise.all([window.LIDUTEC_APP.getCurrentUserProfile(user.id),window.LIDUTEC_APP.getUserPermissions(user.id)]);
  if(!profile||profile.status!=="ATIVO"){await window.LIDUTEC_APP.signOut();return}
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  document.querySelector("#user-name").textContent=profile.nome;document.querySelector("#user-profile").textContent=profile.perfil||"Usuário";document.querySelector("#user-avatar").textContent=profile.nome.slice(0,1).toUpperCase();
  const processes={engenharia:"Engenharia",fusao:"Processo de Fusão",macharia:"Processo de Macharia",acabamento:"Processo de Acabamento"},key=new URLSearchParams(location.search).get("processo");
  if(document.body.classList.contains("construction-page")){const name=processes[key]||"Processo";document.title=`${name} | Metalsider`;document.querySelector("#construction-title").textContent=name;document.querySelector("#construction-process").textContent=name}else{const firstName=profile.nome.trim().split(/\s+/)[0]||"Metalsider";document.querySelector("#home-welcome-title").textContent=`Seja bem-vindo, ${firstName}`;requestAnimationFrame(()=>setTimeout(()=>document.body.classList.add("ready"),650))}
  document.querySelector("#menu-button")?.addEventListener("click",()=>document.querySelector("#sidebar")?.classList.toggle("open"));document.querySelector("#logout-button")?.addEventListener("click",()=>window.LIDUTEC_APP.signOut());
})().catch(error=>{console.error(error);alert(`Não foi possível abrir a página inicial: ${error.message}`)});
