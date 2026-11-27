// Kopyahin ito bilang config.js at ilagay ang mga value mula sa
// Supabase Dashboard > Project Settings > API.
// Ligtas na public ang "anon" key (protektado ng Row Level Security).
// HUWAG kailanman ilagay dito ang "service_role" key.
window.COOLFIX_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY",
  googleLogin: false, // gawing true kapag na-set up na ang Google provider sa Supabase
  mapsKey: ""         // opsyonal: Google Maps JavaScript API key
};
