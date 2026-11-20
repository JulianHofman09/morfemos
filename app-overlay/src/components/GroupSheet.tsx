import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "../theme";
import { COCINAS_UI, DIETAS_UI } from "../config";
import type { Persona } from "../types";

type Props = {
  visible: boolean;
  grupo: Persona[];
  onChange: (g: Persona[]) => void;
  onClose: () => void;
};

const vacia = (): Persona => ({ nombre: "", dietas: [], cocinas_gustan: [], cocinas_evita: [] });

export default function GroupSheet({ visible, grupo, onChange, onClose }: Props) {
  const [nueva, setNueva] = useState<Persona>(vacia());

  const alternar = (campo: "dietas" | "cocinas_gustan" | "cocinas_evita", clave: string) =>
    setNueva((p) => ({
      ...p,
      [campo]: p[campo].includes(clave) ? p[campo].filter((x) => x !== clave) : [...p[campo], clave],
    }));

  const agregar = () => {
    const nombre = nueva.nombre.trim() || `Persona ${grupo.length + 1}`;
    onChange([...grupo, { ...nueva, nombre }]);
    setNueva(vacia());
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.contenedor}>
        <View style={s.header}>
          <Text style={s.titulo}>Grupo</Text>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={s.cerrar}>Listo</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.ayuda}>
            Sumá a cada persona con sus restricciones y gustos. Las restricciones de salud valen para todo el grupo.
          </Text>

          {grupo.map((p, i) => (
            <View key={i} style={s.persona}>
              <View style={{ flex: 1 }}>
                <Text style={s.personaNombre}>{p.nombre}</Text>
                <Text style={s.personaDetalle}>
                  {[
                    p.dietas.length ? p.dietas.map((d) => d.replace("_", " ")).join(", ") : null,
                    p.cocinas_gustan.length ? `le gusta: ${p.cocinas_gustan.join(", ")}` : null,
                    p.cocinas_evita.length ? `evita: ${p.cocinas_evita.join(", ")}` : null,
                  ].filter(Boolean).join(" · ") || "Sin restricciones"}
                </Text>
              </View>
              <Pressable onPress={() => onChange(grupo.filter((_, j) => j !== i))} accessibilityRole="button">
                <Text style={s.quitar}>Quitar</Text>
              </Pressable>
            </View>
          ))}

          <Text style={s.subtitulo}>Agregar persona</Text>
          <TextInput
            style={s.input}
            placeholder="Nombre"
            placeholderTextColor={colors.tintaSuave}
            value={nueva.nombre}
            onChangeText={(t) => setNueva((p) => ({ ...p, nombre: t }))}
          />

          <Text style={s.etiquetaCampo}>Restricciones</Text>
          <Chips opciones={DIETAS_UI} activas={nueva.dietas} onToggle={(c) => alternar("dietas", c)} />

          <Text style={s.etiquetaCampo}>Le gusta</Text>
          <Chips opciones={COCINAS_UI} activas={nueva.cocinas_gustan} onToggle={(c) => alternar("cocinas_gustan", c)} />

          <Text style={s.etiquetaCampo}>No le copa</Text>
          <Chips opciones={COCINAS_UI} activas={nueva.cocinas_evita} onToggle={(c) => alternar("cocinas_evita", c)} />

          <Pressable onPress={agregar} style={s.agregar} accessibilityRole="button">
            <Text style={s.agregarTxt}>Agregar al grupo</Text>
          </Pressable>

          {grupo.length > 0 && (
            <Pressable onPress={() => onChange([])} accessibilityRole="button">
              <Text style={[s.quitar, { textAlign: "center", marginTop: 16 }]}>Vaciar grupo</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Chips({
  opciones, activas, onToggle,
}: { opciones: { clave: string; etiqueta: string }[]; activas: string[]; onToggle: (c: string) => void }) {
  return (
    <View style={s.chips}>
      {opciones.map((o) => {
        const on = activas.includes(o.clave);
        return (
          <Pressable key={o.clave} onPress={() => onToggle(o.clave)} style={[s.chip, on && s.chipOn]} accessibilityRole="button">
            <Text style={[s.chipTxt, on && s.chipTxtOn]}>{o.etiqueta}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.fondo },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.linea, backgroundColor: colors.superficie,
  },
  titulo: { fontSize: 20, fontWeight: "700", color: colors.tinta },
  cerrar: { fontSize: 16, fontWeight: "700", color: colors.malbec },
  ayuda: { fontSize: 14, color: colors.tintaSuave, lineHeight: 20, marginBottom: 12 },
  persona: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.superficie,
    borderRadius: radius.medio, borderWidth: 1, borderColor: colors.linea, padding: 12, marginBottom: 8,
  },
  personaNombre: { fontSize: 16, fontWeight: "700", color: colors.tinta },
  personaDetalle: { fontSize: 13, color: colors.tintaSuave, marginTop: 2 },
  quitar: { color: colors.error, fontWeight: "600", fontSize: 14 },
  subtitulo: { fontSize: 16, fontWeight: "700", color: colors.tinta, marginTop: 20, marginBottom: 8 },
  etiquetaCampo: { fontSize: 14, fontWeight: "600", color: colors.tinta, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: colors.superficie, borderWidth: 1, borderColor: colors.linea, borderRadius: radius.chico,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.tinta,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1, borderColor: colors.linea, backgroundColor: colors.superficie,
    borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12,
  },
  chipOn: { backgroundColor: colors.malbec, borderColor: colors.malbec },
  chipTxt: { color: colors.tinta, fontSize: 14 },
  chipTxtOn: { color: "#fff", fontWeight: "600" },
  agregar: { backgroundColor: colors.malbec, borderRadius: radius.medio, padding: 14, alignItems: "center", marginTop: 22 },
  agregarTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
