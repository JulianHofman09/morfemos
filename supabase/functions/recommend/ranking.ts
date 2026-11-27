// =====================================================================
// MORFEMOS · Motor de ranking (determinista y auditable)
// El LLM NO decide qué lugares se recomiendan: lo decide este archivo.
// Los pesos son un punto de partida: calibralos con datos de la beta.
// =====================================================================
import { AMBIENTES, COCINAS, DIETAS, DIETA_TEXTO, OCASIONES, BARRIOS_COBERTURA } from "./prompts.ts";

export type Filtros = {
  personas: number | null;
  barrios: string[];
  radio_m: number | null;
  nivel_precio_max: number | null;
  precio_max_pp: number | null;
  cocinas: string[];
  cocinas_evitar: string[];
  platos: string[];
  dietas: string[];
  alergias_otras: string[];
  ocasion: string | null;
  ambiente: string[];
  momento: string | null;
};

export type PerfilPersona = {
  nombre: string;
  dietas: string[];
  cocinas_gustan: string[];
  cocinas_evita: string[];
};

export type Candidato = {
  id: string; nombre: string; descripcion: string | null; direccion: string; barrio: string;
  cocinas: string[]; ambiente: string[]; ocasiones: string[];
  nivel_precio: number | null; precio_min: number | null; precio_max: number | null;
  precio_actualizado: string | null;
  dietas: Record<string, string>;
  puntaje_curaduria: number | null; rating_usuarios: number | null;
  apto_grupos: boolean | null; capacidad_grupo_max: number | null;
  pet_friendly: boolean | null; apto_chicos: boolean | null; aire_libre: boolean | null; accesible: boolean | null;
  telefono: string | null; whatsapp: string | null; web: string | null; instagram: string | null;
  link_reserva: string | null; horario_texto: string | null;
  lat: number | null; lng: number | null; distancia_m: number | null;
  match_plato: number | null; platos_match: string[] | null; verificado_en: string | null;
};

export type Etiqueta = "segura" | "audaz" | "sorpresa" | "alternativa";

export type Elegido = {
  c: Candidato;
  score: number;
  etiqueta: Etiqueta;
  puntos_fuertes: string[];
  compromisos: string[];
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const inter = (a: string[] = [], b: string[] = []) => a.filter((x) => b.includes(x));
const unique = <T>(xs: T[]) => [...new Set(xs)];

export function sanear(raw: any): Filtros {
  const arr = (v: any, permitidos?: string[]) =>
    Array.isArray(v) ? unique(v.filter((x) => typeof x === "string" && (!permitidos || permitidos.includes(x)))) : [];
  const num = (v: any) => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : null);
  return {
    personas: num(raw?.personas),
    barrios: arr(raw?.barrios, BARRIOS_COBERTURA),
    radio_m: num(raw?.radio_m),
    nivel_precio_max: raw?.nivel_precio_max >= 1 && raw?.nivel_precio_max <= 4 ? Math.round(raw.nivel_precio_max) : null,
    precio_max_pp: num(raw?.precio_max_pp),
    cocinas: arr(raw?.cocinas, COCINAS),
    cocinas_evitar: arr(raw?.cocinas_evitar, COCINAS),
    platos: arr(raw?.platos).slice(0, 4).map((p) => p.slice(0, 60)),
    dietas: arr(raw?.dietas, DIETAS),
    alergias_otras: arr(raw?.alergias_otras).slice(0, 5).map((p) => p.slice(0, 40)),
    ocasion: OCASIONES.includes(raw?.ocasion) ? raw.ocasion : null,
    ambiente: arr(raw?.ambiente, AMBIENTES),
    momento: typeof raw?.momento === "string" ? raw.momento.slice(0, 60) : null,
  };
}

export function sanearGrupo(raw: any): PerfilPersona[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((p: any, i: number) => ({
    nombre: typeof p?.nombre === "string" && p.nombre.trim() ? p.nombre.trim().slice(0, 30) : `Persona ${i + 1}`,
    dietas: Array.isArray(p?.dietas) ? p.dietas.filter((d: string) => DIETAS.includes(d)) : [],
    cocinas_gustan: Array.isArray(p?.cocinas_gustan) ? p.cocinas_gustan.filter((c: string) => COCINAS.includes(c)) : [],
    cocinas_evita: Array.isArray(p?.cocinas_evita) ? p.cocinas_evita.filter((c: string) => COCINAS.includes(c)) : [],
  }));
}

// ---------------------------------------------------------------------
// Pesos por ocasión (suman 1.0). "afinidad" = gustos de la persona o del grupo.
// ---------------------------------------------------------------------
type Pesos = { calidad: number; ajuste: number; afinidad: number; conveniencia: number; valor: number; confianza: number };

const PESOS_DEFAULT: Pesos = { calidad: 0.25, ajuste: 0.30, afinidad: 0.20, conveniencia: 0.15, valor: 0.05, confianza: 0.05 };
const PESOS_OCASION: Record<string, Pesos> = {
  primera_cita: { calidad: 0.25, ajuste: 0.35, afinidad: 0.15, conveniencia: 0.10, valor: 0.05, confianza: 0.10 },
  pareja:       { calidad: 0.25, ajuste: 0.35, afinidad: 0.15, conveniencia: 0.10, valor: 0.05, confianza: 0.10 },
  trabajo:      { calidad: 0.20, ajuste: 0.25, afinidad: 0.10, conveniencia: 0.30, valor: 0.10, confianza: 0.05 },
  rapido:       { calidad: 0.15, ajuste: 0.25, afinidad: 0.10, conveniencia: 0.35, valor: 0.10, confianza: 0.05 },
  familia:      { calidad: 0.20, ajuste: 0.30, afinidad: 0.20, conveniencia: 0.15, valor: 0.10, confianza: 0.05 },
  cumpleanos:   { calidad: 0.25, ajuste: 0.35, afinidad: 0.20, conveniencia: 0.10, valor: 0.05, confianza: 0.05 },
  celebracion:  { calidad: 0.25, ajuste: 0.35, afinidad: 0.20, conveniencia: 0.10, valor: 0.05, confianza: 0.05 },
};

// ---------------------------------------------------------------------
// Componentes del puntaje (cada uno devuelve 0..1)
// ---------------------------------------------------------------------
function calidad(c: Candidato): number {
  const cur = c.puntaje_curaduria != null ? (c.puntaje_curaduria - 1) / 4 : 0.5;
  if (c.rating_usuarios != null) return 0.6 * cur + 0.4 * ((c.rating_usuarios - 1) / 4);
  return cur;
}

function ajuste(c: Candidato, f: Filtros): number {
  const partes: number[] = [];
  if (f.cocinas.length) partes.push(inter(c.cocinas, f.cocinas).length ? 1 : 0);
  if (f.ambiente.length) partes.push(inter(c.ambiente, f.ambiente).length / f.ambiente.length);
  if (f.ocasion) partes.push(c.ocasiones.includes(f.ocasion) ? 1 : 0.3);
  if (f.platos.length) partes.push(clamp(c.match_plato ?? 0));
  return partes.length ? avg(partes) : 0.6;
}

function conveniencia(c: Candidato, f: Filtros, radioUsado: number | null): number {
  if (c.distancia_m == null) return 0.5;
  const radio = radioUsado ?? f.radio_m ?? 3000;
  return clamp(1 - c.distancia_m / radio);
}

function valor(c: Candidato): number {
  const nivel = c.nivel_precio ?? 2;
  return clamp(calidad(c) * (1.1 - 0.1 * nivel)); // calibrar con datos reales
}

function confianza(c: Candidato, f: Filtros): number {
  let base = 0.2;
  if (c.verificado_en) {
    const dias = (Date.now() - new Date(c.verificado_en).getTime()) / 86_400_000;
    base = dias <= 90 ? 1 : dias <= 180 ? 0.7 : dias <= 365 ? 0.4 : 0.2;
  }
  const todasVerificadas = f.dietas.every((d) => c.dietas?.[d] === "verificado");
  return f.dietas.length && !todasVerificadas ? Math.min(base, 0.7) : base;
}

// Afinidad de UNA persona con un restaurante (0..1)
function afinidadPersona(c: Candidato, p: PerfilPersona, f: Filtros): number {
  let a = 0.5;
  if (inter(c.cocinas, p.cocinas_gustan).length) a += 0.3;
  if (inter(c.cocinas, p.cocinas_evita).length) a -= 0.5;
  if (f.ambiente.length) a += 0.1 * (inter(c.ambiente, f.ambiente).length / f.ambiente.length);
  return clamp(a);
}

// Afinidad del grupo: promedio + peor caso + equidad (ver propuesta, sección 4.2)
function afinidadGrupo(c: Candidato, grupo: PerfilPersona[], f: Filtros) {
  const xs = grupo.map((p) => afinidadPersona(c, p, f));
  const prom = avg(xs);
  const min = Math.min(...xs);
  const spread = Math.max(...xs) - min;
  return { score: 0.5 * prom + 0.4 * min + 0.1 * (1 - spread), min, porPersona: xs };
}

// ---------------------------------------------------------------------
// Texto auxiliar
// ---------------------------------------------------------------------
export function fmtDistancia(m: number | null): string | null {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

export function precioTexto(c: Candidato): string {
  const signos = c.nivel_precio ? "$".repeat(c.nivel_precio) : "";
  if (c.precio_min == null) return signos || "Precio sin dato";
  const pesos = `~$${c.precio_min.toLocaleString("es-AR")} por persona`;
  let fecha = "";
  if (c.precio_actualizado) {
    const d = new Date(c.precio_actualizado);
    fecha = ` (dato de ${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()})`;
  }
  return `${signos ? signos + " · " : ""}${pesos}${fecha}`;
}

const NIVEL_DIETA_TEXTO: Record<string, string> = {
  verificado: "confirmado por el local",
  menciona: "figura en reseñas o web, confirmar con el local",
};

// ---------------------------------------------------------------------
// Ranking principal
// ---------------------------------------------------------------------
export function rankear(
  candidatos: Candidato[],
  f: Filtros,
  grupo: PerfilPersona[],
  radioUsado: number | null,
): Elegido[] {
  // Exclusión dura: cocinas que el usuario pidió evitar
  const validos = candidatos.filter((c) => !inter(c.cocinas, f.cocinas_evitar).length);
  if (!validos.length) return [];

  const pesos = (f.ocasion && PESOS_OCASION[f.ocasion]) || PESOS_DEFAULT;

  const puntuados = validos.map((c) => {
    const g = grupo.length ? afinidadGrupo(c, grupo, f) : null;
    const comp: Record<keyof Pesos, number | null> = {
      calidad: calidad(c),
      ajuste: ajuste(c, f),
      afinidad: g ? g.score : null,
      conveniencia: conveniencia(c, f, radioUsado),
      valor: valor(c),
      confianza: confianza(c, f),
    };
    // Si no hay afinidad (sin grupo ni perfil), se redistribuye su peso
    const claves = (Object.keys(pesos) as (keyof Pesos)[]).filter((k) => comp[k] != null);
    const total = claves.reduce((s, k) => s + pesos[k], 0);
    const score = claves.reduce((s, k) => s + (pesos[k] / total) * (comp[k] as number), 0);
    return { c, score, g, calidad: comp.calidad as number };
  });

  puntuados.sort((a, b) => b.score - a.score);
  const top = puntuados.slice(0, 10);

  // --- Diversificación: segura / audaz / sorpresa ---
  const elegidos: { p: (typeof puntuados)[number]; etiqueta: Etiqueta }[] = [];
  const usados = new Set<string>();

  // 1) La más segura: mejor puntaje, con bonus por "peor caso" del grupo
  const segura = [...top].sort((a, b) => (b.score + 0.3 * (b.g?.min ?? 0)) - (a.score + 0.3 * (a.g?.min ?? 0)))[0];
  elegidos.push({ p: segura, etiqueta: "segura" });
  usados.add(segura.c.id);

  // 2) La más audaz: mayor calidad entre las que mantienen buen puntaje
  const umbral = segura.score * 0.85;
  const audaz = top
    .filter((x) => !usados.has(x.c.id) && x.score >= umbral)
    .sort((a, b) => b.calidad - a.calidad)[0];
  if (audaz) { elegidos.push({ p: audaz, etiqueta: "audaz" }); usados.add(audaz.c.id); }

  // 3) Sorpresa: la mejor con cocina distinta a las ya elegidas (o la mejor que quede)
  const cocinasUsadas = new Set(elegidos.flatMap((e) => e.p.c.cocinas));
  const resto = top.filter((x) => !usados.has(x.c.id));
  const sorpresa = resto.find((x) => !x.c.cocinas.some((k) => cocinasUsadas.has(k))) ?? resto[0];
  if (sorpresa) { elegidos.push({ p: sorpresa, etiqueta: "sorpresa" }); usados.add(sorpresa.c.id); }

  // 4) Si faltan opciones (ej: no hubo una "audaz" que cumpla el umbral), completar con las mejores restantes
  for (const x of top) {
    if (elegidos.length >= 3) break;
    if (!usados.has(x.c.id)) { elegidos.push({ p: x, etiqueta: "alternativa" }); usados.add(x.c.id); }
  }

  return elegidos.map(({ p, etiqueta }) => ({
    c: p.c,
    score: Math.round(p.score * 100) / 100,
    etiqueta,
    puntos_fuertes: puntosFuertes(p.c, f, grupo, p.g),
    compromisos: compromisos(p.c, f, grupo, p.g, radioUsado),
  }));
}

function puntosFuertes(c: Candidato, f: Filtros, grupo: PerfilPersona[], g: ReturnType<typeof afinidadGrupo> | null): string[] {
  const out: string[] = [];
  const cocinasOk = inter(c.cocinas, f.cocinas);
  if (cocinasOk.length) out.push(`Cocina pedida: ${cocinasOk.join(", ")}`);
  if ((c.match_plato ?? 0) >= 0.35 && c.platos_match?.length) out.push(`Tiene en la carta: ${c.platos_match.slice(0, 3).join(", ")}`);
  for (const d of f.dietas) {
    const nivel = c.dietas?.[d];
    if (nivel && NIVEL_DIETA_TEXTO[nivel]) out.push(`${DIETA_TEXTO[d]}: ${NIVEL_DIETA_TEXTO[nivel]}`);
  }
  const dist = fmtDistancia(c.distancia_m);
  if (dist) out.push(`Queda a ${dist}`);
  if (f.ocasion && c.ocasiones.includes(f.ocasion)) out.push(`Va bien para la ocasión (${f.ocasion.replace("_", " ")})`);
  const ambOk = inter(c.ambiente, f.ambiente);
  if (ambOk.length) out.push(`Ambiente: ${ambOk.join(", ").replace(/_/g, " ")}`);
  if (g && g.min >= 0.5) out.push("Nadie del grupo queda muy afuera");
  if (c.puntaje_curaduria != null && c.puntaje_curaduria >= 4.5) out.push("Muy bien puntuado en nuestra curaduría");
  if (!out.length) out.push("Buen equilibrio general entre calidad, zona y precio");
  return out;
}

function compromisos(
  c: Candidato, f: Filtros, grupo: PerfilPersona[],
  g: ReturnType<typeof afinidadGrupo> | null, radioUsado: number | null,
): string[] {
  const out: string[] = [];
  if (f.cocinas.length && !inter(c.cocinas, f.cocinas).length) out.push("No es exactamente la cocina pedida");
  if (f.nivel_precio_max && c.nivel_precio && c.nivel_precio > f.nivel_precio_max) out.push("Está algo por encima del presupuesto indicado");
  const radio = radioUsado ?? f.radio_m;
  if (radio && c.distancia_m != null && c.distancia_m > radio * 0.8) out.push("Queda en el límite de la distancia pedida");
  if (g) {
    grupo.forEach((p, i) => {
      if (inter(c.cocinas, p.cocinas_evita).length) out.push(`A ${p.nombre} no le copa este tipo de cocina`);
      else if (g.porPersona[i] < 0.4) out.push(`Es lo que menos encaja con los gustos de ${p.nombre}`);
    });
  }
  if (f.ambiente.length && !inter(c.ambiente, f.ambiente).length) out.push("El ambiente no coincide del todo con lo pedido");
  return out.slice(0, 3);
}
