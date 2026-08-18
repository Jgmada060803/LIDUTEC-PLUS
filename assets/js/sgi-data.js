(function initializeSgiData(root) {
  const client = () => root.supabaseClient;
  const result = async (request, fallback = []) => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data ?? fallback;
  };

  async function accessToken() {
    const { data } = await client().auth.getSession();
    return data.session?.access_token || null;
  }

  // Envia o binário direto no corpo da requisição (sem multipart) — metadados
  // (módulo, tipo, nome original) vão na query string. O backend local
  // (dev-server.cjs) grava em disco e devolve só os metadados; o binário
  // nunca passa pelo Supabase.
  async function uploadArquivo(file, { modulo, kind }) {
    const token = await accessToken();
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");

    const params = new URLSearchParams({
      modulo,
      kind,
      nome: file.name
    });
    const response = await fetch(`/api/arquivos/upload?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    });
    if (!response.ok) {
      throw new Error(`Não foi possível enviar o arquivo (${response.status}).`);
    }
    return response.json();
  }

  // URL pronta pra <iframe>/<a>: o token vai na query porque esses elementos
  // não conseguem mandar cabeçalho Authorization.
  async function arquivoUrl(caminhoRelativo) {
    const token = await accessToken();
    const params = new URLSearchParams({ caminho: caminhoRelativo, token: token || "" });
    return `/api/arquivos/arquivo?${params}`;
  }

  root.LIDUTEC_SGI_DATA = {
    support: async () => {
      const [areas, tipos] = await Promise.all([
        result(client().from("sgi_areas").select("id,codigo,nome").eq("ativo", true).order("nome")),
        result(client().from("sgi_tipos_documento").select("id,codigo,nome,editavel").eq("ativo", true).order("nome"))
      ]);
      return { areas, tipos };
    },
    listar: () => result(
      client().from("sgi_documentos")
        .select(`
          id, codigo, titulo, origem, numero_revisao, status, vigente,
          processo_setor, palavras_chave, criado_em, atualizado_em,
          sgi_tipos_documento (codigo, nome),
          sgi_areas (codigo, nome),
          arquivo_oficial:arquivo_oficial_id (id, caminho_relativo, nome_original)
        `)
        .order("codigo")
        .limit(5000)
    ),
    obter: (id) => result(
      client().from("sgi_documentos")
        .select(`
          id, codigo, titulo, origem, numero_revisao, status, vigente,
          processo_setor, palavras_chave, observacoes, criado_em, atualizado_em,
          elaborado_por, documento_anterior_id,
          sgi_tipos_documento (id, codigo, nome),
          sgi_areas (id, codigo, nome),
          arquivo_oficial:arquivo_oficial_id (id, caminho_relativo, nome_original, mime_type, tamanho_bytes)
        `)
        .eq("id", id)
        .maybeSingle(),
      null
    ),
    cadastrarDocumentoExterno: async (payload, file) => {
      const arquivo = await uploadArquivo(file, { modulo: "sgi", kind: "oficial" });
      const { data, error } = await client().rpc("sgi_cadastrar_documento_externo", {
        p_codigo: payload.codigo,
        p_titulo: payload.titulo,
        p_tipo_documento_id: payload.tipoDocumentoId,
        p_area_responsavel_id: payload.areaResponsavelId,
        p_processo_setor: payload.processoSetor,
        p_palavras_chave: payload.palavrasChave,
        p_observacoes: payload.observacoes,
        p_arquivo_nome_original: arquivo.nome_original,
        p_arquivo_caminho_relativo: arquivo.caminho_relativo,
        p_arquivo_mime_type: arquivo.mime_type,
        p_arquivo_tamanho_bytes: arquivo.tamanho_bytes,
        p_arquivo_hash_sha256: arquivo.hash_sha256
      });
      if (error) throw error;
      return data;
    },
    criarNovaRevisao: async (documentoId, motivo, file) => {
      const arquivo = await uploadArquivo(file, { modulo: "sgi", kind: "oficial" });
      const { data, error } = await client().rpc("sgi_criar_nova_revisao", {
        p_documento_id: documentoId,
        p_motivo: motivo,
        p_arquivo_nome_original: arquivo.nome_original,
        p_arquivo_caminho_relativo: arquivo.caminho_relativo,
        p_arquivo_mime_type: arquivo.mime_type,
        p_arquivo_tamanho_bytes: arquivo.tamanho_bytes,
        p_arquivo_hash_sha256: arquivo.hash_sha256
      });
      if (error) throw error;
      return data;
    },
    enviarParaAprovacao: async (documentoId) => {
      const { error } = await client().rpc("sgi_enviar_para_aprovacao", { p_documento_id: documentoId });
      if (error) throw error;
    },
    decidirAprovacao: async (aprovacaoId, resultado, comentario) => {
      const { error } = await client().rpc("sgi_decidir_aprovacao", {
        p_aprovacao_id: aprovacaoId,
        p_resultado: resultado,
        p_comentario: comentario
      });
      if (error) throw error;
    },
    aprovacaoPendente: (documentoId) => result(
      client().from("sgi_aprovacoes")
        .select("id, area_id, status, solicitado_em")
        .eq("documento_id", documentoId)
        .eq("status", "PENDENTE")
        .maybeSingle(),
      null
    ),
    revisoesDaFamilia: (codigo) => result(
      client().from("sgi_documentos")
        .select("id, numero_revisao, status, vigente, criado_em")
        .eq("codigo", codigo)
        .order("numero_revisao", { ascending: false })
    ),
    historico: (documentoId) => result(
      client().from("sgi_historico")
        .select("id, acao, descricao, status_anterior, status_novo, criado_em, usuarios (nome)")
        .eq("documento_id", documentoId)
        .order("criado_em", { ascending: false })
    ),
    arquivoUrl
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
