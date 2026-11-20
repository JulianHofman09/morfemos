export type Persona = {
  nombre: string;
  dietas: string[];
  cocinas_gustan: string[];
  cocinas_evita: string[];
};

export type Ubicacion = { lat: number; lng: number };

export type DietaPedida = { dieta: string; etiqueta: string; nivel: "verificado" | "menciona" | "desconocido" | "no" | string };

export type Resultado = {
  id: string;
  nombre: string;
  barrio: string;
  direccion: string;
  cocinas: string[];
  etiqueta: "segura" | "audaz" | "sorpresa";
  etiqueta_texto: string;
  porque: string;
  compromiso: string | null;
  precio_texto: string;
  distancia_texto: string | null;
  horario_texto: string | null;
  dietas_pedidas: DietaPedida[];
  lat: number | null;
  lng: number | null;
  telefono: string | null;
  whatsapp: string | null;
  instagram: string | null;
  link_reserva: string | null;
  web: string | null;
};

export type Respuesta = {
  texto: string;
  cierre?: string | null;
  resultados: Resultado[];
  filtros: Record<string, unknown>;
  relajado: string[];
};

export type Mensaje = {
  id: string;
  rol: "usuario" | "asistente";
  texto: string;
  cierre?: string | null;
  resultados?: Resultado[];
  relajado?: string[];
  error?: boolean;
};
