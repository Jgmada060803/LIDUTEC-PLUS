import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const url=Deno.env.get("SUPABASE_URL")!, publishable=Deno.env.get("SUPABASE_ANON_KEY")!, secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token=req.headers.get("Authorization")?.replace("Bearer ",""); if(!token)throw new Error("Sessão não informada.");
  const scoped=createClient(url,publishable,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const admin=createClient(url,secret,{auth:{persistSession:false}});
  const {data:{user},error:userError}=await scoped.auth.getUser(token); if(userError||!user)throw new Error("Sessão inválida.");
  const {data:individual}=await admin.from("usuario_permissoes").select("permitido,permissoes!inner(codigo)").eq("usuario_id",user.id);
  const {data:profiles}=await admin.from("usuario_perfis").select("perfis!inner(perfil_permissoes!inner(permissoes!inner(codigo)))").eq("usuario_id",user.id);
  const body=await req.json();
  const required=body.action==="invite"?"usuarios.criar":"usuarios.gerenciar_acessos";
  const profileAllowed=(profiles||[]).some((r:any)=>r.perfis?.perfil_permissoes?.some((p:any)=>p.permissoes?.codigo===required));
  const override=(individual||[]).find((p:any)=>p.permissoes?.codigo===required);
  if(override?.permitido===false||(!override?.permitido&&!profileAllowed))throw new Error(`Usuário sem permissão ${required}.`);
  if(body.action==="invite"){
   const {email,nome,perfil_id}=body; if(!email||!nome||!perfil_id)throw new Error("Nome, email e perfil são obrigatórios.");
   const {data:invited,error}=await admin.auth.admin.inviteUserByEmail(email,{data:{nome}}); if(error)throw error;
   const {data:perfil}=await admin.from("perfis").select("nome").eq("id",perfil_id).single();
   await admin.from("usuarios").upsert({id:invited.user.id,nome,email,perfil:perfil?.nome||"Usuário",status:"ATIVO"});
   await admin.from("usuario_perfis").upsert({usuario_id:invited.user.id,perfil_id});
   return Response.json({ok:true,id:invited.user.id},{headers:{...cors,"Content-Type":"application/json"}});
  }
  if(body.action==="status"){
   const {error}=await admin.from("usuarios").update({status:body.status}).eq("id",body.usuario_id); if(error)throw error;
   return Response.json({ok:true},{headers:{...cors,"Content-Type":"application/json"}});
  }
  if(body.action==="set_profile_permissions"){
   const perfilId=Number(body.perfil_id);
   const permissionIds=[...new Set((body.permissao_ids||[]).map(Number).filter(Number.isInteger))];
   if(!perfilId)throw new Error("Perfil inválido.");
   const {data:total,error}=await admin.rpc("substituir_permissoes_perfil",{p_perfil_id:perfilId,p_permissao_ids:permissionIds});
   if(error)throw error;
   return Response.json({ok:true,total},{headers:{...cors,"Content-Type":"application/json"}});
  }
  throw new Error("Ação inválida.");
 }catch(error){return Response.json({error:error.message},{status:400,headers:{...cors,"Content-Type":"application/json"}})}
});
