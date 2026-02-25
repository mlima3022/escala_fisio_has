const cfg = window.APP_CONFIG;

if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  console.error("Configure frontend/config.js com SUPABASE_URL e SUPABASE_ANON_KEY.");
}

export const supabase = window.supabase.createClient(
  cfg?.SUPABASE_URL || "",
  cfg?.SUPABASE_ANON_KEY || ""
);

export const parserApiUrl = cfg?.PARSER_API_URL || "";
