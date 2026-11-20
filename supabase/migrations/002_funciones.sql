-- =====================================================================
-- MORFEMOS · Paso 2: función de búsqueda de candidatos
-- Ejecutala DESPUÉS de 001_schema.sql
-- Aplica los FILTROS DUROS (dietas, presupuesto, zona, radio, grupos).
-- El ranking fino se hace en la Edge Function (ranking.ts).
-- =====================================================================

create or replace function public.buscar_candidatos(
  p_lat            double precision default null,
  p_lng            double precision default null,
  p_radio_m        integer          default null,
  p_barrios        text[]           default null,
  p_nivel_max      smallint         default null,
  p_precio_max     integer          default null,
  p_cocinas        text[]           default null,
  p_dietas_duras   text[]           default '{}',
  p_platos         text[]           default null,
  p_personas       integer          default null,
  p_limite         integer          default 40
)
returns table (
  id                  uuid,
  nombre              text,
  descripcion         text,
  direccion           text,
  barrio              text,
  cocinas             text[],
  ambiente            text[],
  ocasiones           text[],
  nivel_precio        smallint,
  precio_min          integer,
  precio_max          integer,
  precio_actualizado  date,
  dietas              jsonb,
  puntaje_curaduria   numeric,
  rating_usuarios     numeric,
  apto_grupos         boolean,
  capacidad_grupo_max integer,
  pet_friendly        boolean,
  apto_chicos         boolean,
  aire_libre          boolean,
  accesible           boolean,
  telefono            text,
  whatsapp            text,
  web                 text,
  instagram           text,
  link_reserva        text,
  horario_texto       text,
  lat                 double precision,
  lng                 double precision,
  distancia_m         double precision,
  match_plato         double precision,
  platos_match        text[],
  verificado_en       date
)
language sql
stable
set search_path = public, extensions
as $$
  with base as (
    select
      r.*,
      case
        when p_lat is not null and p_lng is not null and r.ubicacion is not null
        then st_distance(r.ubicacion, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
      end as dist
    from public.restaurantes r
    where r.activo
      and (p_barrios is null or cardinality(p_barrios) = 0 or r.barrio = any(p_barrios))
      and (p_nivel_max is null or r.nivel_precio is null or r.nivel_precio <= p_nivel_max)
      and (p_precio_max is null or r.precio_min is null or r.precio_min <= p_precio_max)
      and (p_cocinas is null or cardinality(p_cocinas) = 0 or r.cocinas && p_cocinas)
      -- Dietas = filtro DURO: solo pasan locales con nivel 'verificado' o 'menciona'
      and not exists (
        select 1 from unnest(coalesce(p_dietas_duras, '{}')) as d(dieta)
        where coalesce(r.dietas ->> d.dieta, 'desconocido') not in ('verificado', 'menciona')
      )
      -- Grupos grandes: el local tiene que estar marcado como apto para grupos
      and (
        p_personas is null or p_personas <= 8
        or (r.apto_grupos and (r.capacidad_grupo_max is null or r.capacidad_grupo_max >= p_personas))
      )
  ),
  filtrado as (
    select * from base
    where p_radio_m is null or dist is null or dist <= p_radio_m
  ),
  platos_m as (
    select
      s.restaurante_id,
      max(s.score) as match,
      array_agg(distinct s.nombre) filter (where s.score >= 0.35) as nombres
    from (
      select
        x.restaurante_id,
        x.nombre,
        (
          select max(greatest(
            similarity(unaccent(lower(x.nombre)), unaccent(lower(t))),
            case when unaccent(lower(x.nombre)) like '%' || unaccent(lower(t)) || '%'
                 then 1.0::real else 0.0::real end
          ))
          from unnest(p_platos) as t
        ) as score
      from public.platos x
      where p_platos is not null
        and cardinality(p_platos) > 0
        and x.restaurante_id in (select ff.id from filtrado ff)
    ) s
    group by s.restaurante_id
  )
  select
    f.id, f.nombre, f.descripcion, f.direccion, f.barrio,
    f.cocinas, f.ambiente, f.ocasiones,
    f.nivel_precio, f.precio_min, f.precio_max, f.precio_actualizado,
    f.dietas,
    f.puntaje_curaduria::numeric, f.rating_usuarios::numeric,
    f.apto_grupos, f.capacidad_grupo_max,
    f.pet_friendly, f.apto_chicos, f.aire_libre, f.accesible,
    f.telefono, f.whatsapp, f.web, f.instagram, f.link_reserva, f.horario_texto,
    st_y(f.ubicacion::geometry)::double precision,
    st_x(f.ubicacion::geometry)::double precision,
    f.dist::double precision,
    coalesce(pm.match, 0)::double precision,
    pm.nombres,
    f.verificado_en
  from filtrado f
  left join platos_m pm on pm.restaurante_id = f.id
  order by coalesce(pm.match, 0) desc,
           f.puntaje_curaduria desc nulls last,
           f.dist asc nulls last
  limit greatest(p_limite, 1);
$$;

grant execute on function public.buscar_candidatos to authenticated;
