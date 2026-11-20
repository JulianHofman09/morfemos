// =====================================================================
// MORFEMOS · Edge Function "recommend"
// Flujo: mensaje -> (IA chica) filtros -> SQL filtros duros -> ranking en código
//        -> (IA media) redacción -> respuesta con tarjetas
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BARRIOS_COBERTURA, DIETA_TEXTO, SYSTEM_EXTRACCION, SYSTEM_REDACCION, TOOL_EXTRACCION, TOOL_RESPUESTA,
} from "./prompts.ts";
import {
  type Candidato, type Elegido, type Filtros, type PerfilPersona,
  fmtDistancia, precioTexto, rankear, sanear, sanearGrupo,
} from "./ranking.ts";

const MODELO_EXTRACCION = Deno.env.get("MODEL_EXTRACCION") ?? "claude-haiku-5-5";
const MODELO_REDACCION = Deno.env.get("MODEL_REDACCION") ?? "claude-sonnet-5-5";
const LIMITE_DIARIO = Number(Deno.env.get("LIMITE_CONSULTAS_DIA") ?? 60);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ETIQUETA_TXT = { segura: "La opción más segura", audaz: "La opción más audaz", sorpresa: "La sorpresa" };

// ---------------------------------------------------------------------
// Llamada a Claude con salida estructurada (tool use forzado)
// ---------------------------------------------------------------------
async function claude(opts: { model: string; system: string; user: string; tool: any; max_tokens: number }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.max_tokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      tools: [opts.tool],
      tool_choice: { type: "tool", name: opts.tool.name },
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const bloque = j.content?.find((b: any) => b.type === "tool_use");
  if (!bloque) throw new Error("La IA no devolvió datos estructurados");
  return { input: bloque.input, usage: j.usage };
}

// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const t0 = Date.now();
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Sesión inválida. Reiniciá la app." }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- Límite diario por usuario (control de costos) ---
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin.from("consultas").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", desde);
    if ((count ?? 0) >= LIMITE_DIARIO) {
      return json({ error: "Llegaste al límite de consultas de hoy. Volvé mañana." }, 429);
    }

    // --- Entrada ---
    const body = await req.json();
    const mensajes: { rol: string; texto: string }[] = (Array.isArray(body?.mensajes) ? body.mensajes : [])
      .filter((m: any) => m && typeof m.texto === "string")
      .slice(-8)
      .map((m: any) => ({ rol: m.rol === "asistente" ? "asistente" : "usuario", texto: m.texto.slice(0, 600) }));
    const ultimo = mensajes[mensajes.length - 1];
    if (!ultimo || ultimo.rol !== "usuario" || !ultimo.texto.trim()) return json({ error: "Mensaje vacío" }, 400);

    const ubic = body?.ubicacion && isFinite(body.ubicacion.lat) && isFinite(body.ubicacion.lng)
      ? { lat: Number(body.ubicacion.lat), lng: Number(body.ubicacion.lng) } : null;
    const grupo: PerfilPersona[] = sanearGrupo(body?.grupo);
    const filtrosPrevios = body?.filtros_previos ? sanear(body.filtros_previos) : null;

    // --- 1) Extracción de filtros (modelo chico) ---
    const ext = await claude({
      model: MODELO_EXTRACCION,
      system: SYSTEM_EXTRACCION,
      user: JSON.stringify({
        filtros_previos: filtrosPrevios,
        tiene_gps: !!ubic,
        historial: mensajes,
        instruccion: "Actualizá los filtros según el ÚLTIMO mensaje del usuario.",
      }),
      tool: TOOL_EXTRACCION,
      max_tokens: 700,
    });
    const filtros: Filtros = sanear(ext.input.filtros);
    const accion: string = ext.input.accion;

    const registrar = async (ids: string[], uso: unknown) => {
      await admin.from("consultas").insert({
        user_id: user.id, mensaje: ultimo.texto, filtros, resultados: ids,
        latencia_ms: Date.now() - t0, uso,
      });
    };

    if (accion === "preguntar") {
      await registrar([], { extraccion: ext.usage });
      return json({ texto: ext.input.pregunta ?? "¿Por qué zona andan?", resultados: [], filtros, relajado: [] });
    }
    if (accion === "charla") {
      await registrar([], { extraccion: ext.usage });
      return json({
        texto: ext.input.respuesta_charla ?? "Contame qué tienen ganas de comer y por dónde andan.",
        resultados: [], filtros, relajado: [],
      });
    }
    if (ext.input.fuera_de_cobertura) {
      await registrar([], { extraccion: ext.usage });
      return json({
        texto: `Por ahora solo cubro ${BARRIOS_COBERTURA.join(", ")}. ¿Probamos con alguno de esos barrios?`,
        resultados: [], filtros: { ...filtros, barrios: [] }, relajado: [],
      });
    }

    // --- 2) Búsqueda con filtros duros ---
    const dietasDuras = [...new Set([...filtros.dietas, ...grupo.flatMap((p) => p.dietas)])];
    const personas = Math.max(filtros.personas ?? 0, grupo.length) || null;
    const params: Record<string, unknown> = {
      p_lat: ubic?.lat ?? null,
      p_lng: ubic?.lng ?? null,
      // Con GPS y sin barrio: radio por defecto 3 km. Con barrio: no se filtra por radio.
      p_radio_m: ubic && !filtros.barrios.length ? (filtros.radio_m ?? 3000) : (filtros.radio_m ?? null),
      p_barrios: filtros.barrios.length ? filtros.barrios : null,
      p_nivel_max: filtros.nivel_precio_max,
      p_precio_max: filtros.precio_max_pp,
      p_cocinas: filtros.cocinas.length ? filtros.cocinas : null,
      p_dietas_duras: dietasDuras,
      p_platos: filtros.platos.length ? filtros.platos : null,
      p_personas: personas,
      p_limite: 40,
    };
    const buscar = async (): Promise<Candidato[]> => {
      const { data, error } = await userClient.rpc("buscar_candidatos", params);
      if (error) throw new Error(`Error en la búsqueda: ${error.message}`);
      return (data ?? []) as Candidato[];
    };
    const sinEvitadas = (xs: Candidato[]) =>
      xs.filter((c) => !c.cocinas.some((k) => filtros.cocinas_evitar.includes(k)));

    // Relajación progresiva. NUNCA se relajan dietas ni cocinas a evitar.
    const relajado: string[] = [];
    let cands = sinEvitadas(await buscar());
    if (cands.length < 3 && params.p_radio_m) {
      params.p_radio_m = Number(params.p_radio_m) * 2;
      relajado.push("ampliamos el radio de búsqueda");
      cands = sinEvitadas(await buscar());
    }
    if (cands.length < 3 && params.p_cocinas) {
      params.p_cocinas = null;
      relajado.push("abrimos el tipo de cocina");
      cands = sinEvitadas(await buscar());
    }
    if (cands.length < 3 && params.p_barrios) {
      params.p_barrios = null;
      relajado.push("sumamos otros barrios cercanos de la cobertura");
      cands = sinEvitadas(await buscar());
    }

    if (!cands.length) {
      await registrar([], { extraccion: ext.usage });
      return json({
        texto: "Con esas condiciones no encontré lugares en mi base. Si querés, probamos subiendo un poco el presupuesto o cambiando de zona.",
        resultados: [], filtros, relajado,
      });
    }

    // --- 3) Ranking en código ---
    const radioUsado = params.p_radio_m ? Number(params.p_radio_m) : null;
    const elegidos: Elegido[] = rankear(cands, filtros, grupo, radioUsado);

    // --- 4) Redacción (modelo medio) ---
    const datosParaIA = elegidos.map((e) => ({
      id: e.c.id,
      nombre: e.c.nombre,
      barrio: e.c.barrio,
      etiqueta: ETIQUETA_TXT[e.etiqueta],
      cocinas: e.c.cocinas,
      precio_texto: precioTexto(e.c),
      horario: e.c.horario_texto,
      puntos_fuertes: e.puntos_fuertes,
      compromisos: e.compromisos,
    }));
    const red = await claude({
      model: MODELO_REDACCION,
      system: SYSTEM_REDACCION,
      user: JSON.stringify({
        pedido_usuario: ultimo.texto,
        filtros,
        grupo_nombres: grupo.map((p) => p.nombre),
        alergias_otras: filtros.alergias_otras,
        relajado,
        lugares: datosParaIA,
      }),
      tool: TOOL_RESPUESTA,
      max_tokens: 900,
    });

    // --- 5) Validación anti-alucinación: solo IDs que elegimos nosotros ---
    const items: Record<string, { porque?: string; compromiso?: string }> = {};
    for (const it of red.input.items ?? []) {
      if (elegidos.some((e) => e.c.id === it.id)) items[it.id] = it;
    }

    const resultados = elegidos.map((e) => ({
      id: e.c.id,
      nombre: e.c.nombre,
      barrio: e.c.barrio,
      direccion: e.c.direccion,
      cocinas: e.c.cocinas,
      etiqueta: e.etiqueta,
      etiqueta_texto: ETIQUETA_TXT[e.etiqueta],
      porque: items[e.c.id]?.porque?.trim() || e.puntos_fuertes.slice(0, 2).join(". ") + ".",
      compromiso: items[e.c.id]?.compromiso?.trim() || e.compromisos[0] || null,
      precio_texto: precioTexto(e.c),
      distancia_texto: fmtDistancia(e.c.distancia_m),
      horario_texto: e.c.horario_texto,
      dietas_pedidas: dietasDuras.map((d) => ({
        dieta: d, etiqueta: DIETA_TEXTO[d] ?? d, nivel: e.c.dietas?.[d] ?? "desconocido",
      })),
      lat: e.c.lat, lng: e.c.lng,
      telefono: e.c.telefono, whatsapp: e.c.whatsapp, instagram: e.c.instagram,
      link_reserva: e.c.link_reserva, web: e.c.web,
    }));

    await registrar(resultados.map((r) => r.id), { extraccion: ext.usage, redaccion: red.usage });

    return json({
      texto: String(red.input.intro ?? "Mirá lo que encontré:"),
      cierre: red.input.cierre ? String(red.input.cierre) : null,
      resultados,
      filtros,
      relajado,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Tuve un problema procesando tu pedido. Probá de nuevo en un momento." }, 500);
  }
});
