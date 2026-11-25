import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";
import { registrarInteraccion } from "../lib/api";
import type { Resultado } from "../types";

const NIVEL_TEXTO: Record<string, string> = {
  verificado: "confirmado por el local",
  menciona: "figura en reseñas o web: confirmalo con el local",
  desconocido: "sin datos",
  no: "no",
};

function abrir(url: string) {
  Linking.openURL(url).catch(() => {});
}

export default function RestaurantCard({ r }: { r: Resultado }) {
  const [guardado, setGuardado] = useState(false);

  const accion = (tipo: string, fn: () => void) => () => {
    registrarInteraccion(r.id, tipo).catch(() => {});
    fn();
  };

  const comoLlegar = () => {
    const destino = r.lat != null && r.lng != null ? `${r.lat},${r.lng}` : encodeURIComponent(`${r.nombre}, ${r.direccion}, Buenos Aires`);
    abrir(`https://www.google.com/maps/dir/?api=1&destination=${destino}`);
  };

  return (
    <View style={s.card}>
      <Text style={s.etiqueta}>{r.etiqueta_texto}</Text>
      <Text style={s.nombre}>{r.nombre}</Text>
      <Text style={s.meta}>
        {r.barrio} · {r.cocinas.map((c) => c.replace(/_/g, " ")).join(", ")}
      </Text>
      <Text style={s.meta}>
        {r.precio_texto}
        {r.distancia_texto ? ` · a ${r.distancia_texto}` : ""}
      </Text>

      {r.dietas_pedidas.length > 0 && (
        <View style={s.dietas}>
          {r.dietas_pedidas.map((d) => (
            <View key={d.dieta} style={[s.dieta, d.nivel === "verificado" ? s.dietaOk : s.dietaAviso]}>
              <Text style={[s.dietaTxt, d.nivel === "verificado" ? s.dietaTxtOk : s.dietaTxtAviso]}>
                {d.etiqueta}: {NIVEL_TEXTO[d.nivel] ?? d.nivel}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.porque}>{r.porque}</Text>
      {r.compromiso ? <Text style={s.compromiso}>{r.compromiso}</Text> : null}
      {r.horario_texto ? <Text style={s.horario}>Horario: {r.horario_texto}</Text> : null}

      <View style={s.acciones}>
        <Boton texto="Cómo llegar" onPress={accion("clic_ruta", comoLlegar)} principal />
        {r.whatsapp ? (
          <Boton texto="WhatsApp" onPress={accion("clic_whatsapp", () => abrir(`https://wa.me/${r.whatsapp!.replace(/\D/g, "")}`))} />
        ) : r.telefono ? (
          <Boton texto="Llamar" onPress={accion("clic_llamar", () => abrir(`tel:${r.telefono}`))} />
        ) : null}
        {r.link_reserva ? <Boton texto="Reservar" onPress={accion("clic_reserva", () => abrir(r.link_reserva!))} /> : null}
        <Boton
          texto={guardado ? "Guardado" : "Guardar"}
          onPress={() => {
            setGuardado(true);
            registrarInteraccion(r.id, "guardado").catch(() => {});
          }}
        />
      </View>
    </View>
  );
}

function Boton({ texto, onPress, principal }: { texto: string; onPress: () => void; principal?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.boton, principal && s.botonPrincipal, pressed && { opacity: 0.7 }]}
    >
      <Text style={[s.botonTxt, principal && s.botonTxtPrincipal]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.superficie,
    borderRadius: radius.medio,
    borderWidth: 1,
    borderColor: colors.linea,
    padding: 14,
    marginTop: 10,
  },
  etiqueta: { fontSize: 12, fontWeight: "700", color: colors.malbec, marginBottom: 4 },
  nombre: { fontSize: 19, fontWeight: "700", color: colors.tinta },
  meta: { fontSize: 13, color: colors.tintaSuave, marginTop: 2 },
  dietas: { marginTop: 8, gap: 6 },
  dieta: { borderRadius: radius.chico, paddingVertical: 5, paddingHorizontal: 8, alignSelf: "flex-start" },
  dietaOk: { backgroundColor: colors.botellaSuave },
  dietaAviso: { backgroundColor: colors.avisoSuave },
  dietaTxt: { fontSize: 12, fontWeight: "600" },
  dietaTxtOk: { color: colors.botella },
  dietaTxtAviso: { color: colors.aviso },
  porque: { fontSize: 15, color: colors.tinta, marginTop: 10, lineHeight: 21 },
  compromiso: { fontSize: 14, color: colors.tintaSuave, marginTop: 6, lineHeight: 20, fontStyle: "italic" },
  horario: { fontSize: 13, color: colors.tintaSuave, marginTop: 8 },
  acciones: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  boton: {
    borderWidth: 1,
    borderColor: colors.malbec,
    borderRadius: radius.chico,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  botonPrincipal: { backgroundColor: colors.malbec },
  botonTxt: { color: colors.malbec, fontWeight: "600", fontSize: 14 },
  botonTxtPrincipal: { color: "#fff" },
});
