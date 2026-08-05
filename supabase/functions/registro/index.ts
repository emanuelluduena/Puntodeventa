import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE_KEY")!;

const admin = createClient(SB_URL, SERVICE_ROLE);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { negocio, nombre, email, telefono, username, password } = await req.json();

    // Mismas validaciones que tenía registro.html, ahora del lado del servidor
    if (!negocio || !nombre || !email || !telefono || !username || password?.length < 6) {
      return new Response(JSON.stringify({ error: "Faltan datos o la contraseña es muy corta" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const usernameNorm = String(username).trim().toLowerCase();
    if (/\s/.test(usernameNorm)) {
      return new Response(JSON.stringify({ error: "El usuario no puede tener espacios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Verificar que el username no esté tomado (único a nivel global)
    const { data: existentes, error: errExist } = await admin
      .from("usuarios")
      .select("id")
      .eq("username", usernameNorm);
    if (errExist) throw errExist;
    if (existentes && existentes.length) {
      return new Response(JSON.stringify({ error: "Ese usuario ya está en uso, probá con otro" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Crear el negocio, trial a 15 días
    const hoy = new Date();
    const vencimiento = new Date(hoy);
    vencimiento.setDate(vencimiento.getDate() + 15);
    const vencimientoStr = vencimiento.toISOString().slice(0, 10);

    const { data: negRes, error: errNeg } = await admin
      .from("negocios")
      .insert({
        nombre: negocio, email, telefono,
        contacto_nombre: nombre, es_trial: true, trial_vencimiento: vencimientoStr,
      })
      .select()
      .single();
    if (errNeg) throw errNeg;
    const negocioId = negRes.id;

    // 3) Crear el usuario Administrador
    const { data: usrRes, error: errUsr } = await admin
      .from("usuarios")
      .insert({
        negocio_id: negocioId, nombre, username: usernameNorm,
        password_hash: "temporal", rol: "Administrador", activo: true,
      })
      .select()
      .single();
    if (errUsr) throw errUsr;

    // 4) Fijar la contraseña real (hasheada), misma función que usa el sistema
    const { error: errPass } = await admin.rpc("set_password_usuario", {
      p_user_id: usrRes.id,
      p_password: password,
    });
    if (errPass) throw errPass;

    return new Response(JSON.stringify({ ok: true, negocioId, trialVencimiento: vencimientoStr }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error en registro:", e);
    return new Response(JSON.stringify({ error: "No pudimos crear tu cuenta. Probá de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});