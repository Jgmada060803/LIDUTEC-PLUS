// Configuração centralizada da pasta raiz de arquivos armazenados localmente
// (hoje: documentos controlados do SGI; futuramente outros anexos da
// aplicação, ex.: fotos de Reclamações, que hoje ficam no Supabase Storage).
//
// Pode ser sobrescrita pela variável de ambiente ARQUIVOS_ROOT sem precisar
// mexer em código-fonte — é assim que essa pasta vira uma pasta de rede no
// futuro, sem reconstruir nada.
const ARQUIVOS_ROOT = process.env.ARQUIVOS_ROOT
  || "C:\\Users\\leandro.lidugerio\\Documents\\LIDUTEC+DOC";

module.exports = {
  arquivosRoot: ARQUIVOS_ROOT
};
