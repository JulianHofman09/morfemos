import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as Location from "expo-location";

import { APP_NOMBRE, SALUDO, SUGERENCIAS } from "./src/config";
import { colors, radius } from "./src/theme";
import { asegurarSesion, pedirRecomendacion } from "./src/lib/api";
import RestaurantCard from "./src/components/RestaurantCard";
import GroupSheet from "./src/components/GroupSheet";
import type { Mensaje, Persona, Ubicacion } from "./src/types";

let contador = 0;
const uid = () => `m${Date.now()}_${contador++}`;

const saludoInicial = (): Mensaje => ({ id: uid(), rol: "asistente", texto: SALUDO });

export default function App() {
  const [listo, setListo] = useState(false);
  const [errorInicio, setErrorInicio] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([saludoInicial()]);
  const [filtros, setFiltros] = useState<Record<string, unknown> | null>(null);
  const [input, setInput] = useState("");
  const [cargando, setCargando] = useState(false);
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [grupo, setGrupo] = useState<Persona[]>([]);
  const [grupoAbierto, setGrupoAbierto] = useState(false);
  const lista = useRef<FlatList<Mensaje>>(null);

  useEffect(() => {
    asegurarSesion().then(() => setListo(true)).catch((e) => setErrorInicio(e.message));
  }, []);

  const activarUbicacion = async () => {
    if (ubicacion) { setUbicacion(null); return; } // segundo toque: desactivar
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Ubicación desactivada", "Sin ubicación te pregunto por barrio. Podés activarla desde Ajustes.");
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setUbicacion({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  };

  const enviar = useCallback(async (texto: string) => {
    const limpio = texto.trim();
    if (!limpio || cargando) return;
    const conUsuario: Mensaje[] = [...mensajes, { id: uid(), rol: "usuario", texto: limpio }];
    setMensajes(conUsuario);
    setInput("");
    setCargando(true);
    try {
      const resp = await pedirRecomendacion({
        mensajes: conUsuario.map((m) => ({ rol: m.rol, texto: m.texto })),
        filtros_previos: filtros,
        grupo,
        ubicacion,
      });
      setFiltros(resp.filtros);
      setMensajes((prev) => [
        ...prev,
        { id: uid(), rol: "asistente", texto: resp.texto, cierre: resp.cierre, resultados: resp.resultados, relajado: resp.relajado },
      ]);
    } catch (e: any) {
      setMensajes((prev) => [
        ...prev,
        { id: uid(), rol: "asistente", texto: e?.message ?? "Algo falló. Probá de nuevo.", error: true },
      ]);
    } finally {
      setCargando(false);
    }
  }, [mensajes, filtros, grupo, ubicacion, cargando]);

  const nuevaBusqueda = () => {
    setMensajes([saludoInicial()]);
    setFiltros(null);
  };

  if (errorInicio) {
    return (
      <SafeAreaView style={[s.pantalla, s.centro]}>
        <Text style={s.errorTxt}>{errorInicio}</Text>
      </SafeAreaView>
    );
  }
  if (!listo) {
    return (
      <SafeAreaView style={[s.pantalla, s.centro]}>
        <ActivityIndicator color={colors.malbec} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.pantalla}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.superficie} />

      <View style={s.header}>
        <Text style={s.marca}>{APP_NOMBRE}</Text>
        <View style={s.headerAcciones}>
          <Pill texto={ubicacion ? "Ubicación activa" : "Usar mi ubicación"} activo={!!ubicacion} onPress={activarUbicacion} />
          <Pill texto={grupo.length ? `Grupo (${grupo.length})` : "Grupo"} activo={grupo.length > 0} onPress={() => setGrupoAbierto(true)} />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          ref={lista}
          data={mensajes}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
          onContentSizeChange={() => lista.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <Burbuja m={item} />}
          ListFooterComponent={
            cargando ? (
              <View style={[s.burbuja, s.burbujaAsistente, { flexDirection: "row", gap: 8, alignItems: "center" }]}>
                <ActivityIndicator size="small" color={colors.malbec} />
                <Text style={s.textoAsistente}>Buscando lugares…</Text>
              </View>
            ) : null
          }
        />

        {mensajes.length <= 2 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sugerencias} keyboardShouldPersistTaps="handled">
            {SUGERENCIAS.map((t) => (
              <Pressable key={t} style={s.sugerencia} onPress={() => setInput((prev) => (prev ? `${prev}, ${t.toLowerCase()}` : t))}>
                <Text style={s.sugerenciaTxt}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={s.barra}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="¿Qué tienen ganas de comer?"
            placeholderTextColor={colors.tintaSuave}
            multiline
            maxLength={600}
            onSubmitEditing={() => enviar(input)}
          />
          <Pressable
            onPress={() => enviar(input)}
            disabled={cargando || !input.trim()}
            style={[s.enviar, (cargando || !input.trim()) && { opacity: 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel="Enviar"
          >
            <Text style={s.enviarTxt}>Enviar</Text>
          </Pressable>
        </View>

        {mensajes.length > 2 && (
          <Pressable onPress={nuevaBusqueda} style={{ paddingBottom: 8 }} accessibilityRole="button">
            <Text style={s.nueva}>Empezar una búsqueda nueva</Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>

      <GroupSheet visible={grupoAbierto} grupo={grupo} onChange={setGrupo} onClose={() => setGrupoAbierto(false)} />
    </SafeAreaView>
  );
}

function Burbuja({ m }: { m: Mensaje }) {
  const esUsuario = m.rol === "usuario";
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={[s.burbuja, esUsuario ? s.burbujaUsuario : s.burbujaAsistente, m.error && s.burbujaError]}>
        <Text style={esUsuario ? s.textoUsuario : s.textoAsistente}>{m.texto}</Text>
      </View>
      {m.resultados?.map((r) => <RestaurantCard key={r.id} r={r} />)}
      {m.cierre ? <Text style={[s.textoAsistente, { marginTop: 10, paddingHorizontal: 4 }]}>{m.cierre}</Text> : null}
    </View>
  );
}

function Pill({ texto, activo, onPress }: { texto: string; activo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.pill, activo && s.pillOn]} accessibilityRole="button">
      <Text style={[s.pillTxt, activo && s.pillTxtOn]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo, paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0 },
  centro: { alignItems: "center", justifyContent: "center", padding: 24 },
  errorTxt: { color: colors.error, fontSize: 16, textAlign: "center" },
  header: {
    backgroundColor: colors.superficie, paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.linea,
  },
  marca: { fontSize: 22, fontWeight: "800", color: colors.malbec, marginBottom: 8 },
  headerAcciones: { flexDirection: "row", gap: 8 },
  pill: { borderWidth: 1, borderColor: colors.linea, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.superficie },
  pillOn: { backgroundColor: colors.botellaSuave, borderColor: colors.botella },
  pillTxt: { fontSize: 13, color: colors.tinta },
  pillTxtOn: { color: colors.botella, fontWeight: "700" },
  burbuja: { maxWidth: "88%", borderRadius: radius.burbuja, paddingVertical: 10, paddingHorizontal: 14 },
  burbujaUsuario: { alignSelf: "flex-end", backgroundColor: colors.malbec },
  burbujaAsistente: { alignSelf: "flex-start", backgroundColor: colors.superficie, borderWidth: 1, borderColor: colors.linea },
  burbujaError: { borderColor: colors.error },
  textoUsuario: { color: "#fff", fontSize: 16, lineHeight: 22 },
  textoAsistente: { color: colors.tinta, fontSize: 16, lineHeight: 22 },
  sugerencias: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 },
  sugerencia: { borderWidth: 1, borderColor: colors.malbec, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: colors.malbecSuave },
  sugerenciaTxt: { color: colors.malbec, fontSize: 14 },
  barra: {
    flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.linea, backgroundColor: colors.superficie,
  },
  input: {
    flex: 1, maxHeight: 120, backgroundColor: colors.fondo, borderRadius: radius.medio, borderWidth: 1,
    borderColor: colors.linea, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.tinta,
  },
  enviar: { backgroundColor: colors.malbec, borderRadius: radius.medio, paddingVertical: 12, paddingHorizontal: 16 },
  enviarTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  nueva: { textAlign: "center", color: colors.tintaSuave, fontSize: 13, paddingTop: 4 },
});
