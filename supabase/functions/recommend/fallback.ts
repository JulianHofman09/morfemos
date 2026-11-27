// =====================================================================
// MORFEMOS · Modo básico (sin IA)
// Interpreta pedidos simples con reglas. Se usa cuando la IA no está
// disponible (clave faltante, sin saldo, caída del servicio), para que
// la app siga funcionando en lugar de mostrar un error.
// =====================================================================
import { type Filtros, sanear } from "./ranking.ts";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const BARRIOS: [RegExp, string][] = [
  [/palermo|soho|hollywood/, "Palermo"],
  [/recoleta/, "Recoleta"],
  [/san telmo|\btelmo\b/, "San Telmo"],
  [/villa crespo/, "Villa Crespo"],
];

// Lugares fuera de la cobertura actual (si los nombran sin un barrio cubierto)
const FUERA = /rosario|cordoba|mendoza|bariloche|mar del plata|salta|tucuman|la plata|belgrano|caballito|almagro|colegiales|puerto madero|retiro|nunez|san isidro|vicente lopez|quilmes|lanus/;

const COCINAS: [RegExp, string[]][] = [
  [/parrilla|\bparri\b|asado|bife|choripan/, ["parrilla"]],
  [/pasta|noqui|ravioles|fideos|sorrentinos/, ["pastas"]],
  [/pizza|pizzeria/, ["pizza"]],
  [/sushi/, ["sushi", "japonesa"]],
  [/japones|nikkei|ramen/, ["japonesa"]],
  [/empanada/, ["empanadas"]],
  [/bodegon/, ["bodegon"]],
  [/peruan|ceviche|cebiche/, ["peruana"]],
  [/marisco|pescado/, ["mariscos"]],
  [/hamburguesa/, ["hamburguesas"]],
  [/\bcafe\b|merienda/, ["cafe"]],
  [/italian/, ["italiana"]],
  [/argentin|criolla/, ["argentina"]],
  [/mexican|taco/, ["mexicana"]],
  [/arabe|armenio/, ["arabe"]],
];

const DIETAS: [RegExp, string][] = [
  [/celiac|tacc/, "sin_tacc"],
  [/vegan[oa]/, "vegano"],
  [/vegetarian/, "vegetariano"],
  [/lactosa/, "sin_lactosa"],
  [/kosher/, "kosher"],
  [/halal/, "halal"],
];

const OCASIONES: [RegExp, string][] = [
  [/cumple/, "cumpleanos"],
  [/primera cita|una cita/, "primera_cita"],
  [/aniversario|pareja|novi[oa]/, "pareja"],
  [/familia|chicos|ninos|abuel/, "familia"],
  [/trabajo|laburo|reunion|cliente/, "trabajo"],
  [/amigos|pibes|grupo/, "amigos"],
  [/rapido|al paso/, "rapido"],
  [/turista|visita/, "turista"],
  [/celebr/, "celebracion"],
];

const AMBIENTES: [RegExp, string][] = [
  [/tranquil|silencios/, "tranquilo"],
  [/ruidos|movido/, "ruidoso"],
  [/aire libre|terraza|patio|vereda|jardin/, "aire_libre"],
  [/informal|casual|relajado/, "informal"],
  [/elegante|formal/, "elegante"],
  [/intimo|romantic/, "intimo"],
  [/moderno/, "moderno"],
  [/clasico|tradicional/, "clasico"],
  [/musica en vivo|show/, "musica_en_vivo"],
];

const NUMEROS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12,
};

const cocinasDe = (t: string) => [...new Set(COCINAS.filter(([re]) => re.test(t)).flatMap(([, c]) => c))];

export function extraerBasico(texto: string, previos: Filtros | null, tieneGps: boolean) {
  const t = norm(texto);
  const base: Filtros = previos ?? sanear({});
  const f: Filtros = { ...base };

  // Barrios
  const barrios = BARRIOS.filter(([re]) => re.test(t)).map(([, b]) => b);
  if (barrios.length) f.barrios = barrios;

  // Personas
  const mNum = t.match(/(?:somos|para|grupo de)\s+(\d+)/) ?? t.match(/(\d+)\s+(?:personas|amigos|pibes|comensales)/);
  const mPal = t.match(/somos\s+(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce)/);
  if (mNum) f.personas = Number(mNum[1]);
  else if (mPal) f.personas = NUMEROS[mPal[1]];

  // Presupuesto
  const mLucas = t.match(/(\d+(?:[.,]\d+)?)\s*(?:lucas|luca|k\b)/);
  const mMil = t.match(/(\d{2,3})\s*mil/);
  const mPesos = t.match(/\$\s*(\d[\d.]*)/);
  if (mLucas) f.precio_max_pp = Math.round(parseFloat(mLucas[1].replace(",", ".")) * 1000);
  else if (mMil) f.precio_max_pp = Number(mMil[1]) * 1000;
  else if (mPesos) {
    const v = Number(mPesos[1].replace(/\./g, ""));
    if (v >= 1000) f.precio_max_pp = v;
  }
  if (/barat|economic|accesible/.test(t)) f.nivel_precio_max = 2;

  // Cocinas a evitar ("sin pastas", "nada de pizza") y cocinas pedidas
  const evitar: string[] = [];
  for (const m of t.matchAll(/(?:sin|nada de|no quiero|evitar)\s+([a-zñ]+)/g)) evitar.push(...cocinasDe(m[1]));
  const sinEvitadas = t.replace(/(?:sin|nada de|no quiero|evitar)\s+[a-zñ]+/g, " ");
  const cocinas = cocinasDe(sinEvitadas).filter((c) => !evitar.includes(c));
  if (evitar.length) f.cocinas_evitar = [...new Set([...base.cocinas_evitar, ...evitar])];
  if (cocinas.length) f.cocinas = cocinas;
  if (evitar.length) f.cocinas = f.cocinas.filter((c) => !evitar.includes(c));

  // Dietas: se acumulan (son restricciones de salud)
  const dietas = DIETAS.filter(([re]) => re.test(t)).map(([, d]) => d);
  if (dietas.length) f.dietas = [...new Set([...base.dietas, ...dietas])];

  // Ocasión y ambiente
  const oc = OCASIONES.find(([re]) => re.test(t));
  if (oc) f.ocasion = oc[1];
  const amb = AMBIENTES.filter(([re]) => re.test(t)).map(([, a]) => a);
  if (amb.length) f.ambiente = amb;

  if (/cena|noche/.test(t)) f.momento = "cena";
  else if (/almuerzo|mediodia/.test(t)) f.momento = "almuerzo";

  const filtros = sanear(f);

  // ¿Fuera de cobertura?
  if (!barrios.length && FUERA.test(t)) {
    return { accion: "buscar", fuera_de_cobertura: true, filtros: { ...filtros, barrios: [] } };
  }
  // ¿Saludo o charla sin pedido?
  const hayPedido = barrios.length || cocinas.length || dietas.length || oc || amb.length || mNum || mPal || mLucas || mMil || mPesos;
  if (!hayPedido && /^(hola|buenas|buen dia|buenas tardes|buenas noches|que tal|gracias|chau)/.test(t.trim())) {
    return {
      accion: "charla",
      respuesta_charla: "¡Hola! Contame qué tienen ganas de comer, cuántos son y por dónde andan (Palermo, Recoleta, San Telmo o Villa Crespo).",
      filtros,
    };
  }
  // Sin zona ni GPS: preguntar una sola cosa
  if (!filtros.barrios.length && !tieneGps) {
    return {
      accion: "preguntar",
      pregunta: "¿Por qué zona andan? Cubro Palermo, Recoleta, San Telmo y Villa Crespo.",
      filtros,
    };
  }
  return { accion: "buscar", filtros };
}
