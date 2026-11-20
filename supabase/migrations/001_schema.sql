-- =====================================================================
-- MORFEMOS · Paso 1: esquema de base de datos
-- Pegalo completo en Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
-- Más adelante (búsqueda semántica): create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- RESTAURANTES (tu capa de datos propia: este es tu activo principal)
-- ---------------------------------------------------------------------
create table if not exists public.restaurantes (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null,
  descripcion          text,
  direccion            text not null,
  barrio               text not null,
  ciudad               text not null default 'CABA',
  provincia            text not null default 'Buenos Aires',
  ubicacion            geography(Point, 4326),

  telefono             text,
  whatsapp             text,          -- formato internacional sin +, ej: 5491123456789
  web                  text,
  instagram            text,          -- usuario sin @
  horario_texto        text,          -- texto libre, ej: "Lun-Dom 12 a 16 y 20 a 00"
  acepta_reservas      boolean default false,
  link_reserva         text,

  cocinas              text[] not null default '{}',
  ambiente             text[] not null default '{}',
  ocasiones            text[] not null default '{}',

  nivel_precio         smallint check (nivel_precio between 1 and 4),  -- 1=$ ... 4=$$$$
  precio_min           integer,       -- pesos por persona (aprox.)
  precio_max           integer,
  precio_actualizado   date,          -- la inflación vence los precios: siempre guardar fecha

  apto_grupos          boolean default false,
  capacidad_grupo_max  integer,
  pet_friendly         boolean,
  apto_chicos          boolean,
  accesible            boolean,
  aire_libre           boolean,

  -- {"sin_tacc":"verificado","vegano":"menciona", ...}
  -- niveles: verificado | menciona | desconocido | no
  dietas               jsonb not null default '{}'::jsonb,

  puntaje_curaduria    numeric(2,1) check (puntaje_curaduria between 1 and 5), -- tu criterio editorial
  rating_usuarios      numeric(2,1),  -- se calcula con las valoraciones de la app
  n_valoraciones       integer not null default 0,

  fuente               text,          -- de dónde salió el dato (visita propia, web oficial, etc.)
  verificado_en        date,
  activo               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (nombre, direccion)
);

create index if not exists restaurantes_ubicacion_gix on public.restaurantes using gist (ubicacion);
create index if not exists restaurantes_barrio_idx    on public.restaurantes (barrio);
create index if not exists restaurantes_cocinas_gin   on public.restaurantes using gin (cocinas);
create index if not exists restaurantes_ambiente_gin  on public.restaurantes using gin (ambiente);
create index if not exists restaurantes_dietas_gin    on public.restaurantes using gin (dietas);

-- ---------------------------------------------------------------------
-- PLATOS (búsqueda a nivel plato: la ventaja que tienen apps como Startik)
-- ---------------------------------------------------------------------
create table if not exists public.platos (
  id                  uuid primary key default gen_random_uuid(),
  restaurante_id      uuid not null references public.restaurantes(id) on delete cascade,
  nombre              text not null,
  descripcion         text,
  categoria           text,           -- entrada | principal | postre | bebida | otro
  precio              integer,
  precio_actualizado  date,
  destacado           boolean not null default false,
  dietas              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists platos_restaurante_idx on public.platos (restaurante_id);

-- ---------------------------------------------------------------------
-- USUARIOS: perfil, interacciones (para aprender) y log de consultas
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  restricciones     text[] not null default '{}',   -- ej: {sin_tacc}
  cocinas_favoritas text[] not null default '{}',
  cocinas_evitadas  text[] not null default '{}',
  presupuesto_max   integer,
  memoria           jsonb not null default '{}'::jsonb, -- resumen editable por el usuario
  created_at        timestamptz not null default now()
);

create table if not exists public.interacciones (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  tipo           text not null check (tipo in
                   ('visto','guardado','clic_ruta','clic_whatsapp','clic_llamar','clic_reserva','visito','valoracion')),
  valor          smallint,                -- 1-5 si tipo='valoracion'
  etiquetas      text[] not null default '{}',
  contexto       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists interacciones_user_idx on public.interacciones (user_id, created_at desc);

create table if not exists public.consultas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  mensaje     text not null,
  filtros     jsonb,
  resultados  uuid[] not null default '{}',
  latencia_ms integer,
  uso         jsonb,                       -- tokens usados (control de costos)
  created_at  timestamptz not null default now()
);
create index if not exists consultas_user_idx on public.consultas (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists restaurantes_updated on public.restaurantes;
create trigger restaurantes_updated before update on public.restaurantes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- SEGURIDAD (RLS): los datos de restaurantes los lee cualquier sesión
-- (incluida la anónima); solo el service role (tu script) los escribe.
-- ---------------------------------------------------------------------
alter table public.restaurantes  enable row level security;
alter table public.platos        enable row level security;
alter table public.perfiles      enable row level security;
alter table public.interacciones enable row level security;
alter table public.consultas     enable row level security;

drop policy if exists "leer restaurantes activos" on public.restaurantes;
create policy "leer restaurantes activos" on public.restaurantes
  for select to authenticated using (activo);

drop policy if exists "leer platos" on public.platos;
create policy "leer platos" on public.platos
  for select to authenticated using (true);

drop policy if exists "perfil propio: leer" on public.perfiles;
create policy "perfil propio: leer" on public.perfiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "perfil propio: crear" on public.perfiles;
create policy "perfil propio: crear" on public.perfiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "perfil propio: editar" on public.perfiles;
create policy "perfil propio: editar" on public.perfiles
  for update to authenticated using (id = auth.uid());
drop policy if exists "perfil propio: borrar" on public.perfiles;
create policy "perfil propio: borrar" on public.perfiles
  for delete to authenticated using (id = auth.uid());

drop policy if exists "interacciones propias: leer" on public.interacciones;
create policy "interacciones propias: leer" on public.interacciones
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "interacciones propias: crear" on public.interacciones;
create policy "interacciones propias: crear" on public.interacciones
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "consultas propias: leer" on public.consultas;
create policy "consultas propias: leer" on public.consultas
  for select to authenticated using (user_id = auth.uid());
-- (las consultas las inserta la Edge Function con service role)
