const config = window.LIDUTEC_CONFIG;

if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
  throw new Error("Configuração do Supabase não encontrada.");
}

window.supabaseClient = supabase.createClient(
  config.supabaseUrl,
  config.supabaseAnonKey
);
