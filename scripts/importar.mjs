// =====================================================================
// MORFEMOS · Importador de restaurantes y platos (CSV -> Supabase)
//
// Uso:
//   1) Exportá las hojas "Restaurantes" y "Platos" del Excel como CSV UTF-8
//      y guardalas como data/restaurantes.csv y data/platos.csv
//   2) cd scripts && npm install
//   3) Completá scripts/.env (ver .env.example)
//   4) node importar.mjs            (o: node importar.mjs --solo-validar)
//
// Es idempotente: podés correrlo cuantas veces quieras (actualiza por nombre+dirección).
// Geocodificación: OpenStreetMap Nominatim (máx. 1 consulta por segundo, con User-Agent).
// Los datos de OpenStreetMap requieren atribución: © colaboradores de OpenStreetMap.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const SOLO_VALIDAR = process.argv.includes("--solo-validar");

const BARRIOS = ["Palermo", "Recoleta", "San Telmo", "Villa Crespo"];
const COCINAS = ["parrilla","argentina","pastas","pizza","italiana","bodegon","empanadas","cafe","panaderia","sushi","japonesa","peruana","mexicana","arabe","vegana","vegetariana","de_autor","mariscos","hamburguesas","cerveceria","brunch","helados","otra"];
const AMBIENTES = ["intimo","ruidoso","tranquilo","aire_libre","informal","elegante","con_vista","moderno","clasico","musica_en_vivo"];
const OCASIONES = ["cumpleanos","primera_cita","pareja","familia","amigos","trabajo","celebracion","rapido","turista"];
const NIVELES_DIETA = ["verificado", "menciona", "desconocido", "no"];
const DIETAS = ["sin_tacc", "vegano", "vegetariano", "sin_lactosa", "kosher", "halal"];

// ---------- helpers ----------
const leerCsv = (archivo) => {
  const ruta = path.join(DATA, archivo);
  if (!fs.existsSync(ruta)) { console.error(`✗ No encuentro ${ruta}`); process.exit(1); }
  return parse(fs.readFileSync(ruta, "utf8"), { columns: true, skip_empty_lines: true, trim: true, bom: true });
};
const txt = (v) => (v && String(v).trim() ? String(v).trim() : null);
const lista = (v) => (txt(v) ? txt(v).split(";").map((x) => x.trim().toLowerCase()).filter(Boolean) : []);
const bool = (v) => {
  const t = (txt(v) ?? "").toLowerCase();
  if (["si", "sí", "s", "true", "1"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  return null;
};
const entero = (v) => { const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const fecha = (v) => {
  const t = txt(v); if (!t) return null;
  const m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};
const dietasJson = (fila) => {
  const out = {};
  for (const d of DIETAS) {
    const v = (txt(fila[`dieta_${d}`]) ?? "").toLowerCase();
    if (v) out[d] = v;
  }
  return out;
};
const esEjemplo = (fila) => /ejemplo/i.test(fila.nombre ?? fila.restaurante ?? "");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- validación ----------
function validarRestaurante(f, n) {
  const e = [];
  if (!txt(f.nombre)) e.push("falta nombre");
  if (!txt(f.direccion)) e.push("falta dirección");
  if (!BARRIOS.includes(txt(f.barrio) ?? "")) e.push(`barrio inválido (${f.barrio}); usar: ${BARRIOS.join(", ")}`);
  for (const c of lista(f.cocinas)) if (!COCINAS.includes(c)) e.push(`cocina inválida: ${c}`);
  for (const a of lista(f.ambiente)) if (!AMBIENTES.includes(a)) e.push(`ambiente inválido: ${a}`);
  for (const o of lista(f.ocasiones)) if (!OCASIONES.includes(o)) e.push(`ocasión inválida: ${o}`);
  const np = txt(f.nivel_precio);
  if (np && !(["1", "2", "3", "4"].includes(np))) e.push("nivel_precio debe ser 1, 2, 3 o 4");
  for (const d of DIETAS) {
    const v = (txt(f[`dieta_${d}`]) ?? "").toLowerCase();
    if (v && !NIVELES_DIETA.includes(v)) e.push(`dieta_${d} inválida: ${v}`);
  }
  const pc = txt(f.puntaje_curaduria)?.replace(",", ".");
  if (pc && !(Number(pc) >= 1 && Number(pc) <= 5)) e.push("puntaje_curaduria debe estar entre 1 y 5");
  return e.map((m) => `Fila ${n}: ${m}`);
}

// ---------- geocodificación (OSM Nominatim) ----------
const cachePath = path.join(DATA, "geocache.json");
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
async function geocodificar(direccion, barrio) {
  const q = `${direccion}, ${barrio}, Ciudad Autónoma de Buenos Aires, Argentina`;
  if (cache[q]) return cache[q];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "User-Agent": "morfemos-importador/1.0 (contacto: tu-email@ejemplo.com)" } });
  await dormir(1100); // respetar el límite de 1 consulta por segundo
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.length) return null;
  const punto = { lat: Number(j[0].lat), lng: Number(j[0].lon) };
  cache[q] = punto;
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  return punto;
}

// ---------- main ----------
const restaurantes = leerCsv("restaurantes.csv").filter((f) => !esEjemplo(f));
const platos = fs.existsSync(path.join(DATA, "platos.csv")) ? leerCsv("platos.csv").filter((f) => !esEjemplo(f)) : [];

const errores = restaurantes.flatMap((f, i) => validarRestaurante(f, i + 2));
if (errores.length) {
  console.error("✗ Corregí estos problemas en el CSV y volvé a correr:\n  " + errores.join("\n  "));
  process.exit(1);
}
console.log(`✓ ${restaurantes.length} restaurantes y ${platos.length} platos válidos.`);
if (SOLO_VALIDAR) process.exit(0);

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("✗ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en scripts/.env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let ok = 0, sinUbicacion = [];
for (const f of restaurantes) {
  const barrio = txt(f.barrio);
  const punto = await geocodificar(txt(f.direccion), barrio);
  if (!punto) sinUbicacion.push(`${f.nombre} (${f.direccion})`);

  const fila = {
    nombre: txt(f.nombre),
    descripcion: txt(f.descripcion),
    direccion: txt(f.direccion),
    barrio,
    ubicacion: punto ? `SRID=4326;POINT(${punto.lng} ${punto.lat})` : null,
    telefono: txt(f.telefono),
    whatsapp: txt(f.whatsapp)?.replace(/\D/g, "") ?? null,
    web: txt(f.web),
    instagram: txt(f.instagram)?.replace(/^@/, "") ?? null,
    horario_texto: txt(f.horario_texto),
    acepta_reservas: bool(f.acepta_reservas) ?? false,
    link_reserva: txt(f.link_reserva),
    cocinas: lista(f.cocinas),
    ambiente: lista(f.ambiente),
    ocasiones: lista(f.ocasiones),
    nivel_precio: entero(f.nivel_precio),
    precio_min: entero(f.precio_min_pp),
    precio_max: entero(f.precio_max_pp),
    precio_actualizado: fecha(f.precio_actualizado),
    apto_grupos: bool(f.apto_grupos) ?? false,
    capacidad_grupo_max: entero(f.capacidad_grupo_max),
    pet_friendly: bool(f.pet_friendly),
    apto_chicos: bool(f.apto_chicos),
    accesible: bool(f.accesible),
    aire_libre: bool(f.aire_libre),
    dietas: dietasJson(f),
    puntaje_curaduria: txt(f.puntaje_curaduria) ? Number(txt(f.puntaje_curaduria).replace(",", ".")) : null,
    fuente: txt(f.fuente),
    verificado_en: fecha(f.verificado_en),
    activo: true,
  };
  const { error } = await supabase.from("restaurantes").upsert(fila, { onConflict: "nombre,direccion" });
  if (error) { console.error(`✗ ${f.nombre}: ${error.message}`); continue; }
  ok++;
  process.stdout.write(`\r  restaurantes cargados: ${ok}/${restaurantes.length}`);
}
console.log("");

// ---- platos: se reemplazan por restaurante (idempotente) ----
const { data: todos } = await supabase.from("restaurantes").select("id,nombre");
const porNombre = new Map();
for (const r of todos ?? []) porNombre.set(r.nombre.toLowerCase(), [...(porNombre.get(r.nombre.toLowerCase()) ?? []), r.id]);

const agrupados = new Map();
const huerfanos = [];
for (const p of platos) {
  const ids = porNombre.get((txt(p.restaurante) ?? "").toLowerCase()) ?? [];
  if (ids.length !== 1) { huerfanos.push(`${p.plato} → "${p.restaurante}" (${ids.length ? "nombre repetido" : "no existe"})`); continue; }
  agrupados.set(ids[0], [...(agrupados.get(ids[0]) ?? []), p]);
}
let nPlatos = 0;
for (const [restauranteId, filas] of agrupados) {
  await supabase.from("platos").delete().eq("restaurante_id", restauranteId);
  const insertar = filas.map((p) => ({
    restaurante_id: restauranteId,
    nombre: txt(p.plato),
    descripcion: txt(p.descripcion),
    categoria: txt(p.categoria),
    precio: entero(p.precio),
    precio_actualizado: fecha(p.precio_actualizado),
    destacado: bool(p.destacado) ?? false,
    dietas: dietasJson(p),
  })).filter((p) => p.nombre);
  const { error } = await supabase.from("platos").insert(insertar);
  if (error) console.error(`✗ platos de ${restauranteId}: ${error.message}`);
  else nPlatos += insertar.length;
}

console.log(`✓ Listo: ${ok} restaurantes y ${nPlatos} platos cargados.`);
if (sinUbicacion.length) console.log(`⚠ Sin ubicación (revisá la dirección):\n  ${sinUbicacion.join("\n  ")}`);
if (huerfanos.length) console.log(`⚠ Platos sin restaurante válido:\n  ${huerfanos.join("\n  ")}`);
console.log("Datos de ubicación: © colaboradores de OpenStreetMap");
