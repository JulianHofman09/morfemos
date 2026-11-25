import { supabase } from "./supabase";
import type { Persona, Respuesta, Ubicacion } from "../types";

// Sesión anónima: el usuario usa la app sin registrarse.
export async function asegurarSesion() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error("No pude iniciar sesión anónima. Revisá que esté habilitada en Supabase.");
}

type Entrada = {
  mensajes: { rol: string; texto: string }[];
  filtros_previos: Record<string, unknown> | null;
  grupo: Persona[];
  ubicacion: Ubicacion | null;
};

export async function pedirRecomendacion(entrada: Entrada): Promise<Respuesta> {
  const { data, error } = await supabase.functions.invoke("recommend", { body: entrada });
  if (error) {
    let mensaje = "No pude conectarme. Revisá tu internet y probá de nuevo.";
    try {
      const cuerpo = await (error as any).context?.json?.();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {}
    throw new Error(mensaje);
  }
  return data as Respuesta;
}

export async function registrarInteraccion(restauranteId: string, tipo: string, valor?: number) {
  // Si falla no molestamos al usuario: es solo para aprender.
  await supabase.from("interacciones").insert({ restaurante_id: restauranteId, tipo, valor: valor ?? null });
}
