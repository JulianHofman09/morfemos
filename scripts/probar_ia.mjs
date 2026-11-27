// =====================================================================
// MORFEMOS · Prueba rápida de la clave de Anthropic (sin pasar por Supabase)
//
// Uso (desde la carpeta scripts). La clave se toma de UNA de estas dos formas:
//   A) Archivo scripts/.env con la línea:  ANTHROPIC_API_KEY=sk-ant-...   (sin comillas)
//   B) Variable de la terminal:
//   PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."
//   CMD:         set ANTHROPIC_API_KEY=sk-ant-...
//   Mac/Linux:   export ANTHROPIC_API_KEY=sk-ant-...
//   Después:     node probar_ia.mjs
//
// La clave no se muestra completa en pantalla.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const aca = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(aca, ".env") });        // scripts/.env
dotenv.config({ path: path.join(aca, "..", ".env") });  // .env en la raíz del proyecto (si existe)

const clave = (process.env.ANTHROPIC_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
if (!clave) {
  console.error("✗ No encuentro ANTHROPIC_API_KEY. Esto es lo que veo:\n");
  const revisar = [
    ["scripts/.env", path.join(aca, ".env")],
    ["scripts/.env.txt", path.join(aca, ".env.txt")],
    ["scripts/.env.example", path.join(aca, ".env.example")],
    ["raíz/.env", path.join(aca, "..", ".env")],
  ];
  for (const [nombre, ruta] of revisar) {
    if (!fs.existsSync(ruta)) { console.error(`  · ${nombre}: no existe`); continue; }
    const nombres = Object.keys(dotenv.parse(fs.readFileSync(ruta)));
    console.error(`  · ${nombre}: existe, variables que tiene → ${nombres.length ? nombres.join(", ") : "(ninguna: ¿está vacío o sin guardar?)"}`);
  }
  console.error("\nQué revisar:");
  console.error("  1) Que la línea se llame EXACTAMENTE ANTHROPIC_API_KEY (sin espacios antes del =, sin comillas).");
  console.error("  2) Que hayas GUARDADO el archivo (Ctrl + S en Cursor).");
  console.error("  3) Que el archivo se llame .env y no .env.txt ni .env.example.");
  console.error("  4) Que esté en la carpeta scripts, la misma donde está este archivo.");
  console.error("\nAtajo: definí la clave en esta terminal y volvé a correr el script.");
  console.error("  PowerShell:  $env:ANTHROPIC_API_KEY=\"sk-ant-...\"");
  console.error("  CMD:         set ANTHROPIC_API_KEY=sk-ant-...");
  process.exit(1);
}
console.log(`Clave detectada: ${clave.slice(0, 7)}…${clave.slice(-2)} (${clave.length} caracteres)`);

const modelos = [
  process.env.MODEL_EXTRACCION ?? "claude-haiku-5-5",
  process.env.MODEL_REDACCION ?? "claude-sonnet-5-5",
];

for (const model of modelos) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: "user", content: "Respondé solo con la palabra: listo" }] }),
    });
    const j = await r.json();
    if (r.ok) {
      console.log(`✓ ${model}: responde → "${(j.content?.[0]?.text ?? "").trim().slice(0, 40)}"`);
    } else {
      const msg = j?.error?.message ?? JSON.stringify(j);
      console.log(`✗ ${model}: HTTP ${r.status} → ${msg.slice(0, 200)}`);
      if (/credit balance/i.test(msg)) console.log("  → Esta clave pertenece a una organización SIN saldo. Revisá Billing en esa organización o usá otra clave.");
      if (r.status === 401) console.log("  → La clave no es válida o está mal copiada.");
      if (r.status === 404) console.log("  → Ese modelo no está disponible en tu cuenta. Cambialo con MODEL_EXTRACCION / MODEL_REDACCION.");
    }
  } catch (e) {
    console.log(`✗ ${model}: no pude conectarme (${e.message}). Revisá tu internet.`);
  }
}

// ---- Prueba del mecanismo real que usa la app: respuesta estructurada con una herramienta ----
try {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: modelos[0],
      max_tokens: 2000,
      system: 'Respondé SIEMPRE llamando a la herramienta "responder".',
      tools: [{
        name: "responder",
        description: "Devuelve una respuesta estructurada.",
        input_schema: { type: "object", properties: { ok: { type: "boolean" }, saludo: { type: "string" } }, required: ["ok"] },
      }],
      messages: [{ role: "user", content: "Probá la herramienta con ok=true y un saludo corto." }],
    }),
  });
  const j = await r.json();
  const uso = j.content?.find((b) => b.type === "tool_use");
  if (r.ok && uso) console.log(`✓ Herramientas: la respuesta estructurada funciona → ${JSON.stringify(uso.input).slice(0, 80)}`);
  else console.log(`✗ Herramientas: HTTP ${r.status} → ${(j?.error?.message ?? `sin tool_use (stop_reason=${j.stop_reason})`).slice(0, 200)}`);
} catch (e) {
  console.log(`✗ Herramientas: no pude conectarme (${e.message}).`);
}
