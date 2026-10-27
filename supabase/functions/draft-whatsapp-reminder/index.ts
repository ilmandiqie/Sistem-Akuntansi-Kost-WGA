import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Login diperlukan." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !openAiApiKey) {
    return jsonResponse({ error: "Fungsi AI belum dikonfigurasi oleh admin." }, 503);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) return jsonResponse({ error: "Sesi login tidak valid." }, 401);

  const { data: profile, error: profileError } = await supabase
    .from("users_profile")
    .select("role, approved")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile?.approved || !["admin", "pengelola"].includes(profile.role)) {
    return jsonResponse({ error: "Tidak memiliki izin membuat draft pengingat." }, 403);
  }

  let payload: { dueDate?: unknown; outstandingAmount?: unknown; period?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Payload tidak valid." }, 400);
  }
  const amount = Number(payload.outstandingAmount);
  const dueDate = typeof payload.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)
    ? payload.dueDate
    : null;
  const period = typeof payload.period === "string" && /^\d{4}-\d{2}$/.test(payload.period)
    ? payload.period
    : null;
  if (!Number.isFinite(amount) || amount <= 0 || !dueDate || !period) {
    return jsonResponse({ error: "Data invoice tidak valid." }, 400);
  }

  const prompt = `Buat pengingat pembayaran sewa dalam bahasa Indonesia yang sopan, singkat, dan tidak mengancam. Maksimal 3 kalimat. Jangan mengarang biaya atau instruksi pembayaran. Tulis {nama} sebagai placeholder sapaan, sebutkan periode ${period}, jatuh tempo ${dueDate}, dan sisa tagihan Rp${new Intl.NumberFormat("id-ID").format(amount)}. Kembalikan teks pesan saja.`;
  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Anda membantu menyusun draft pengingat administrasi kost. Jangan meminta data pribadi." },
        { role: "user", content: prompt }
      ],
      max_tokens: 140,
      temperature: 0.4
    })
  });
  if (!aiResponse.ok) return jsonResponse({ error: "Provider AI gagal membuat draft. Coba lagi nanti." }, 502);

  const aiResult = await aiResponse.json();
  const draft = aiResult.choices?.[0]?.message?.content?.trim();
  if (typeof draft !== "string" || !draft) return jsonResponse({ error: "Provider AI mengembalikan draft kosong." }, 502);
  return jsonResponse({ draft });
});