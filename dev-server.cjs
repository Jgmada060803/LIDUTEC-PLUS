const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { arquivosRoot } = require("./server.config.js");

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const uploadContentTypes = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ---------------------------------------------------------------------------
// Serviço de arquivos local — pensado pra qualquer módulo da aplicação usar
// (hoje só o SGI), não só documentos controlados. O binário nunca passa pelo
// Postgres/Supabase Storage: fica em disco, na pasta configurada em
// server.config.js. Cada módulo grava sob uma subpasta com seu nome
// (`<raiz>/<modulo>/...` = arquivo oficial, `<raiz>/arquivo/<modulo>/...` =
// arquivo editável), mantendo a separação oficial/editável pedida.
// ---------------------------------------------------------------------------
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

let cachedSupabaseAuth = null;
function supabaseAuthConfig() {
  if (cachedSupabaseAuth) {
    return cachedSupabaseAuth;
  }
  const configText = fs.readFileSync(
    path.join(root, "assets", "js", "config.js"),
    "utf8",
  );
  const url = configText.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
  const anonKey = configText.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
  if (!url || !anonKey) {
    throw new Error("Não foi possível ler SUPABASE_URL/SUPABASE_ANON_KEY de assets/js/config.js");
  }
  cachedSupabaseAuth = { url, anonKey };
  return cachedSupabaseAuth;
}

// Confirma que o token da requisição pertence a uma sessão Supabase válida,
// chamando a própria API de auth do projeto — o servidor de arquivos nunca
// guarda a service_role key nem valida assinatura de JWT por conta própria.
function requireAuthenticatedUser(request, query) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : (query?.get("token") || "");
  if (!token) {
    return Promise.resolve(null);
  }
  const { url, anonKey } = supabaseAuthConfig();
  const authUrl = new URL("/auth/v1/user", url);

  return new Promise((resolve) => {
    const req = https.request(
      authUrl,
      { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

function sanitizeFileNamePart(value) {
  return String(value || "arquivo")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(Object.assign(new Error("Arquivo excede o limite de 50MB."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function handleUpload(request, response, query) {
  const user = await requireAuthenticatedUser(request, query);
  if (!user) {
    response.writeHead(401).end("Não autenticado.");
    return;
  }

  const modulo = sanitizeFileNamePart(query.get("modulo") || "geral").toLowerCase();
  const kind = query.get("kind") === "editavel" ? "editavel" : "oficial";
  const nomeOriginal = query.get("nome") || "arquivo";
  const extensao = path.extname(nomeOriginal).toLowerCase();
  const mimeType = uploadContentTypes[extensao] || "application/octet-stream";

  let buffer;
  try {
    buffer = await readRequestBody(request);
  } catch (error) {
    response.writeHead(error.statusCode || 400).end(error.message);
    return;
  }
  if (!buffer.length) {
    response.writeHead(400).end("Arquivo vazio.");
    return;
  }

  const nomeArmazenado = `${crypto.randomUUID()}-${sanitizeFileNamePart(path.basename(nomeOriginal, extensao))}${extensao}`;
  const subpastaRelativa = kind === "editavel"
    ? path.join("arquivo", modulo)
    : path.join(modulo);
  const pastaAbsoluta = path.join(arquivosRoot, subpastaRelativa);
  await fsp.mkdir(pastaAbsoluta, { recursive: true });

  const caminhoRelativo = path.join(subpastaRelativa, nomeArmazenado);
  await fsp.writeFile(path.join(arquivosRoot, caminhoRelativo), buffer);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    caminho_relativo: caminhoRelativo.split(path.sep).join("/"),
    nome_original: nomeOriginal,
    mime_type: mimeType,
    tamanho_bytes: buffer.length,
    hash_sha256: hash,
  }));
}

async function handleDownload(request, response, query) {
  const user = await requireAuthenticatedUser(request, query);
  if (!user) {
    response.writeHead(401).end("Não autenticado.");
    return;
  }

  const caminhoRelativo = query.get("caminho") || "";
  const caminhoAbsoluto = path.resolve(arquivosRoot, caminhoRelativo);
  const raizNormalizada = path.resolve(arquivosRoot);
  if (caminhoAbsoluto !== raizNormalizada && !caminhoAbsoluto.startsWith(`${raizNormalizada}${path.sep}`)) {
    response.writeHead(403).end("Caminho inválido.");
    return;
  }

  fs.readFile(caminhoAbsoluto, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Arquivo não encontrado.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(caminhoAbsoluto)] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${sanitizeFileNamePart(path.basename(caminhoAbsoluto))}"`,
    });
    response.end(content);
  });
}

for (const pasta of [arquivosRoot, path.join(arquivosRoot, "arquivo")]) {
  fs.mkdirSync(pasta, { recursive: true });
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/arquivos/upload" && request.method === "POST") {
    handleUpload(request, response, url.searchParams).catch((error) => {
      console.error(error);
      response.writeHead(500).end("Erro ao salvar arquivo.");
    });
    return;
  }

  if (pathname === "/api/arquivos/arquivo" && request.method === "GET") {
    handleDownload(request, response, url.searchParams).catch((error) => {
      console.error(error);
      response.writeHead(500).end("Erro ao ler arquivo.");
    });
    return;
  }

  const filePath = path.resolve(
    root,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type":
        contentTypes[path.extname(filePath)] ?? "application/octet-stream",
    });
    response.end(content);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`LIDUTEC+ disponível em http://127.0.0.1:${port}`);
});
