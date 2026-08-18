import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const publishable = Deno.env.get("SUPABASE_ANON_KEY")!;
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = request.headers
      .get("Authorization")
      ?.replace("Bearer ", "");

    if (!token) throw new Error("Sessão não informada.");

    const scoped = createClient(url, publishable, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(url, secret, {
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: userError,
    } = await scoped.auth.getUser(token);

    if (userError || !user) throw new Error("Sessão inválida.");

    const [{ data: individual }, { data: profiles }] = await Promise.all([
      admin
        .from("usuario_permissoes")
        .select("permitido,permissoes!inner(codigo)")
        .eq("usuario_id", user.id),
      admin
        .from("usuario_perfis")
        .select(
          "perfis!inner(perfil_permissoes!inner(permissoes!inner(codigo)))",
        )
        .eq("usuario_id", user.id),
    ]);

    const body = await request.json();
    const required =
      body.action === "invite"
        ? "usuarios.criar"
        : "usuarios.gerenciar_acessos";
    const profileAllowed = (profiles || []).some((relation: any) =>
      relation.perfis?.perfil_permissoes?.some(
        (permission: any) =>
          permission.permissoes?.codigo === required,
      )
    );
    const override = (individual || []).find(
      (permission: any) =>
        permission.permissoes?.codigo === required,
    );

    if (
      override?.permitido === false ||
      (!override?.permitido && !profileAllowed)
    ) {
      throw new Error(`Usuário sem permissão ${required}.`);
    }

    if (body.action === "invite") {
      const { email, nome, perfil_id: profileId, senha } = body;
      const corporateEmail = String(email || "").trim().toLowerCase();
      const semEmailProprio = Boolean(senha);

      if (!nome || !profileId || !corporateEmail) {
        throw new Error("Nome, email e perfil são obrigatórios.");
      }
      if (!/^[^@\s]+@metalsider\.com\.br$/.test(corporateEmail)) {
        throw new Error(
          "Somente e-mails @metalsider.com.br podem ser cadastrados.",
        );
      }

      let userId: string;
      if (semEmailProprio) {
        // Operador sem e-mail próprio: em vez de mandar convite (que
        // nunca seria visto), o administrador já define a senha
        // provisória e a conta nasce confirmada e pronta pra logar.
        if (String(senha).length < 8) {
          throw new Error("A senha provisória deve ter pelo menos 8 caracteres.");
        }
        const { data: created, error } = await admin.auth.admin.createUser({
          email: corporateEmail,
          password: String(senha),
          email_confirm: true,
          user_metadata: { nome },
        });
        if (error) throw error;
        userId = created.user.id;
      } else {
        const { data: invited, error } =
          await admin.auth.admin.inviteUserByEmail(corporateEmail, {
            data: { nome },
          });
        if (error) throw error;
        userId = invited.user.id;
      }

      const { data: profile } = await admin
        .from("perfis")
        .select("codigo")
        .eq("id", profileId)
        .single();
      await admin.from("usuarios").upsert({
        id: userId,
        nome,
        email: corporateEmail,
        perfil: profile?.codigo || "CLIENTE",
        status: "ATIVO",
        sem_email_proprio: semEmailProprio,
        deve_trocar_senha: semEmailProprio,
      });
      await admin.from("usuario_perfis").upsert({
        usuario_id: userId,
        perfil_id: profileId,
      });
      return json({ ok: true, id: userId });
    }

    if (body.action === "status") {
      const { error } = await admin
        .from("usuarios")
        .update({ status: body.status })
        .eq("id", body.usuario_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "reject_access") {
      const userId = String(body.usuario_id || "");
      if (!userId) throw new Error("Usuário não informado.");

      const { data: account } = await admin
        .from("usuarios")
        .select("status,perfil")
        .eq("id", userId)
        .single();
      if (
        !account ||
        account.status !== "PENDENTE"
      ) {
        throw new Error("Somente solicitações pendentes podem ser negadas.");
      }

      const { error: authError } =
        await admin.auth.admin.deleteUser(userId);
      if (authError) throw authError;

      await admin.from("usuario_permissoes").delete().eq("usuario_id", userId);
      await admin.from("usuario_perfis").delete().eq("usuario_id", userId);
      await admin.from("usuarios").delete().eq("id", userId);
      return json({ ok: true });
    }

    if (body.action === "set_profile_permissions") {
      const profileId = Number(body.perfil_id);
      const permissionIds = [
        ...new Set(
          (body.permissao_ids || [])
            .map(Number)
            .filter(Number.isInteger),
        ),
      ];
      if (!profileId) throw new Error("Perfil inválido.");
      const { data: total, error } = await admin.rpc(
        "substituir_permissoes_perfil",
        {
          p_perfil_id: profileId,
          p_permissao_ids: permissionIds,
        },
      );
      if (error) throw error;
      return json({ ok: true, total });
    }

    if (body.action === "set_user_access") {
      const userId = String(body.usuario_id || "");
      const profileId = Number(body.perfil_id);
      const permissionIds = [
        ...new Set(
          (body.permissao_ids || [])
            .map(Number)
            .filter(Number.isInteger),
        ),
      ];
      if (!userId || !profileId) {
        throw new Error("Usuário e perfil são obrigatórios.");
      }
      const { data: total, error } = await admin.rpc(
        "configurar_acesso_usuario",
        {
          p_usuario_id: userId,
          p_perfil_id: profileId,
          p_permissao_ids: permissionIds,
        },
      );
      if (error) throw error;
      return json({ ok: true, total });
    }

    throw new Error("Ação inválida.");
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});
