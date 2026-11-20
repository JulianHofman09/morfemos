# Morfemos · Guía de arranque (CABA: Palermo, Recoleta, San Telmo y Villa Crespo)

*Morfemos* es el nombre de trabajo. Se cambia en un solo lugar: `app-overlay/src/config.ts`.

## Qué hay en esta carpeta

| Carpeta o archivo | Para qué sirve |
|---|---|
| `supabase/migrations/001_schema.sql` | Crea las tablas (restaurantes, platos, perfiles, interacciones, consultas) con seguridad por filas |
| `supabase/migrations/002_funciones.sql` | Función de búsqueda con filtros duros (dietas, presupuesto, zona, grupos, platos) |
| `supabase/functions/recommend/` | El "cerebro": entiende el pedido, busca, rankea en código y redacta la respuesta |
| `app-overlay/` | La app móvil (Expo): chat, tarjetas, modo grupo, ubicación |
| `scripts/importar.mjs` | Carga tus restaurantes y platos desde CSV a la base y calcula la ubicación |
| `data/plantilla_datos.xlsx` | Plantilla para cargar tus datos (con listas desplegables) |
| `eval/consultas_prueba.md` | 30 consultas para medir si la IA funciona bien |

## Cómo funciona (en 30 segundos)

1. El usuario escribe un pedido en el chat.
2. Un modelo chico (Haiku) lo convierte en filtros: barrio, presupuesto, dietas, cocinas, ocasión, platos.
3. Postgres aplica los **filtros duros**. Si pidieron sin TACC, solo pasan locales con nivel `verificado` o `menciona`.
4. **Un ranking en código** (no la IA) puntúa los candidatos y elige 3: la más segura, la más audaz y una sorpresa. En modo grupo equilibra promedio, peor caso y equidad.
5. Un modelo medio (Sonnet) redacta la explicación **solo con los datos que le pasa el ranking**. Si menciona un ID que no corresponde, se descarta.

Resultado: la IA conversa pero **no puede inventar restaurantes**.

---

## Paso 1 · Crear las cuentas (30 min)

1. **GitHub** (github.com): para guardar el código.
2. **Supabase** (supabase.com): base de datos y backend. Tiene plan gratuito.
3. **Anthropic Console** (console.anthropic.com): creá una API key y **fijá un límite mensual de gasto** (Settings > Limits).
4. **Node.js LTS** (nodejs.org) y **VS Code** (code.visualstudio.com).
5. En tu celular, la app **Expo Go** (App Store o Google Play).

## Paso 2 · Base de datos (15 min)

1. En Supabase: **New project**. Región recomendada: **South America (São Paulo)**. Guardá la contraseña.
2. Entrá a **SQL Editor > New query**, pegá todo `001_schema.sql` y tocá **Run**. Después repetí con `002_funciones.sql`.
3. **Authentication > Sign In / Providers**: activá **Allow anonymous sign-ins** (así los usuarios entran sin registrarse).
4. **Project Settings > API**: copiá la **Project URL** y la clave pública (**anon** o **publishable**). La clave **service_role** es secreta: solo se usa en el script de importación.

## Paso 3 · Función de IA (15 min)

Desde la carpeta raíz del proyecto (`morfemos/`):

```bash
npx supabase login
npx supabase init                     # si pregunta por VS Code settings, respondé N
npx supabase link --project-ref TU_REF   # el REF está en la URL: https://TU_REF.supabase.co
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
npx supabase functions deploy recommend
```

Los modelos por defecto son `claude-haiku-5-5` (extracción) y `claude-sonnet-5-5` (redacción). Se pueden cambiar con los secretos `MODEL_EXTRACCION` y `MODEL_REDACCION`.
Cada usuario tiene un tope de 60 consultas por día (`LIMITE_CONSULTAS_DIA`).

## Paso 4 · Tus datos (lo más importante, 2 a 3 días)

1. Abrí `data/plantilla_datos.xlsx` y leé la hoja **Leeme**.
2. Empezá con **20 restaurantes** (5 por barrio) y 3 a 5 platos de cada uno. Con 20 ya podés probar todo. La meta final de la fase 1 son 100.
3. Cargá datos que **relevás vos** (visita, llamada, web oficial). No copies textos, fotos ni reseñas de otros sitios.
4. Para cada hoja: **Guardar como > CSV UTF-8** y guardalos como `data/restaurantes.csv` y `data/platos.csv`.
5. Importá:

```bash
cd scripts
npm install
cp .env.example .env      # completá SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
npm run validar           # revisa errores sin tocar la base
npm run importar          # carga todo y calcula las ubicaciones (tarda ~1 s por local)
```

La geocodificación usa OpenStreetMap (Nominatim). Si algún local queda "sin ubicación", corregí la dirección y volvé a correr: es seguro repetirlo.

## Paso 5 · La app (20 min)

Desde la carpeta raíz del proyecto:

```bash
npx create-expo-app@latest app --template blank-typescript
cd app
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill expo-location
cp ../app-overlay/App.tsx ./App.tsx
cp -r ../app-overlay/src ./src
cp ../app-overlay/.env.example ./.env     # completá URL y clave pública
npx expo start
```

Escaneá el QR con Expo Go. En Windows, si `cp` no funciona, copiá los archivos a mano con el explorador.

Probá: *"Somos 4, uno celíaco, parrilla en Palermo hasta $25.000 por persona"*.

## Paso 6 · Evaluar (continuo)

Corré las 30 consultas de `eval/consultas_prueba.md` y anotá los fallos. Para pasar a beta: **100% de respeto a las restricciones duras y 0 invenciones**.

---

## Seguridad y costos: checklist

- [ ] Límite mensual de gasto en Anthropic.
- [ ] Nunca subas `.env` ni la `service_role` a GitHub (el `.gitignore` ya los excluye).
- [ ] La clave `service_role` solo vive en `scripts/.env`.
- [ ] Revisá en Supabase que las tablas tengan **RLS activado** (el SQL ya lo hace).
- [ ] Si usás Google Places más adelante: límite diario de cuota y revisión de sus términos de uso antes de guardar datos.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| "No pude iniciar sesión anónima" | Falta activar *Allow anonymous sign-ins* en Supabase |
| "Sesión inválida" | Reiniciá la app o revisá la URL y la clave pública del `.env` |
| Error 500 en la función | `npx supabase functions logs recommend` para ver el detalle; revisá `ANTHROPIC_API_KEY` |
| Nunca aparecen resultados con sin TACC | Es lo esperado si ningún local tiene `verificado` o `menciona`; cargá ese dato en la hoja |
| `permission denied` al buscar | Falta correr `002_funciones.sql` o el `grant` del final |
| Locales sin distancia | No se pudo calcular su ubicación; revisá la dirección y reimportá |

## Qué viene después (fase 2)

1. Pantalla de **valoración posvisita** (la tabla `interacciones` ya está lista).
2. **Perfil y memoria** editable (la tabla `perfiles` ya existe).
3. **Grupo por enlace** para que cada persona cargue sus preferencias desde su celular.
4. **Embeddings** con `pgvector` para búsqueda semántica de platos y ambientes.
5. Filtro "abierto ahora" (requiere estructurar los horarios).
6. Ranking aprendido (*learning to rank*) con los datos de la beta.
7. Publicación en App Store y Google Play (cuentas de desarrollador pagas y EAS Build de Expo).

## Pendientes que tenés que decidir vos

- **Nombre definitivo** y revisión de dominio, tiendas de apps y marca en el INPI.
- **Consulta legal** sobre la Ley 25.326 (datos personales) y la política de privacidad antes de publicar.
- **Fuente de tus datos**: visitas propias, llamadas, alianzas con locales.
