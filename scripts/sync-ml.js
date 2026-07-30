/**
 * sync-ml.js
 * -----------------------------------------------------------------------
 * Se conecta a la cuenta de Mercado Libre de BRAMAN Autos, trae las
 * publicaciones activas y genera "cars-data.json" (el archivo que la
 * página web lee para dibujar el catálogo).
 *
 * Si un auto que antes estaba activo deja de aparecer (porque lo
 * pausaste/finalizaste en Mercado Libre), se lo mantiene en el catálogo
 * pero marcado como "reservado" durante 45 días, y después se elimina
 * solo.
 *
 * No hace falta editar este archivo. Se ejecuta automáticamente por el
 * GitHub Action (.github/workflows/sync-mercadolibre.yml) usando las
 * credenciales guardadas como "Secrets" del repositorio.
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const {
  ML_CLIENT_ID,
  ML_CLIENT_SECRET,
  ML_REFRESH_TOKEN,
  ML_SELLER_ID,
} = process.env;

const OUTPUT_FILE = path.join(__dirname, "..", "cars-data.json");
const STATE_FILE = path.join(__dirname, "..", "data", "cars-state.json");
const DIAS_ANTES_DE_BORRAR = 45; // cuánto tiempo mostrar "Reservado" antes de sacarlo del todo

function requireEnv() {
  const faltantes = ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REFRESH_TOKEN", "ML_SELLER_ID"].filter(
    (k) => !process.env[k]
  );
  if (faltantes.length) {
    console.error("Faltan variables de entorno:", faltantes.join(", "));
    console.error("Revisá los 'Secrets' del repositorio en GitHub (Settings > Secrets and variables > Actions).");
    process.exit(1);
  }
}

async function getAccessToken() {
  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: ML_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    throw new Error("No se pudo renovar el token de Mercado Libre: " + (await res.text()));
  }
  const data = await res.json();
  if (data.refresh_token && data.refresh_token !== ML_REFRESH_TOKEN) {
    console.warn(
      "\n⚠️  Mercado Libre entregó un refresh_token nuevo. Actualizá el secret ML_REFRESH_TOKEN en GitHub con este valor:\n" +
        data.refresh_token +
        "\n"
    );
  }
  return data.access_token;
}

async function getActiveItemIds(token) {
  const ids = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const url = `https://api.mercadolibre.com/users/${ML_SELLER_ID}/items/search?status=active&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("Error consultando publicaciones activas: " + (await res.text()));
    const data = await res.json();
    ids.push(...data.results);
    offset += limit;
    if (offset >= (data.paging?.total ?? 0)) break;
  }
  return ids;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getItemsDetail(token, ids) {
  const items = [];
  for (const grupo of chunk(ids, 20)) {
    const url = `https://api.mercadolibre.com/items?ids=${grupo.join(",")}&attributes=id,title,price,currency_id,thumbnail,pictures,permalink,attributes,condition`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("Error consultando detalle de publicaciones: " + (await res.text()));
    const data = await res.json();
    for (const row of data) {
      if (row.code === 200) items.push(row.body);
    }
  }
  return items;
}

function buscarAtributo(atributos, nombresPosibles) {
  if (!atributos) return null;
  for (const attr of atributos) {
    const idNombre = (attr.id || "").toUpperCase();
    const etiqueta = (attr.name || "").toLowerCase();
    if (
      nombresPosibles.some(
        (n) => idNombre.includes(n.toUpperCase()) || etiqueta.includes(n.toLowerCase())
      )
    ) {
      return attr.value_name ?? attr.value_id ?? null;
    }
  }
  return null;
}

function formatearPrecio(price, currency_id) {
  const numero = Math.round(price).toLocaleString("es-AR");
  if (currency_id === "USD") return `USD ${numero}`;
  return `$${numero}`;
}

function mapearItem(item) {
  const anio = buscarAtributo(item.attributes, ["VEHICLE_YEAR", "año", "ano"]);
  const kmTexto = buscarAtributo(item.attributes, ["KILOMETERS", "kilóm", "kilom"]);
  const km = kmTexto ? kmTexto.replace(/[^\d]/g, "") : null;

  const titulo = item.title || "";
  const partes = titulo.split(" ");
  const nombre = partes.slice(0, 2).join(" ");
  const version = partes.slice(2).join(" ");

  let meta = "";
  if (anio && km) meta = `${anio} · ${Number(km).toLocaleString("es-AR")} km`;
  else if (anio) meta = `${anio} · 0 km`;
  else meta = "Consultar";

  return {
    id: item.id,
    tipo: item.condition === "new" ? "0km" : "usado",
    estado: "activo",
    nombre: nombre || titulo,
    version: version,
    meta: meta,
    precio: formatearPrecio(item.price, item.currency_id),
    imagen: item.pictures?.[0]?.secure_url || item.thumbnail,
    link: item.permalink,
    actualizado: new Date().toISOString(),
  };
}

function cargarEstadoPrevio() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { autos: [] };
  }
}

function guardarJSON(archivo, data) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(data, null, 2));
}

async function main() {
  requireEnv();
  console.log("Conectando con Mercado Libre...");
  const token = await getAccessToken();

  console.log("Buscando publicaciones activas de la cuenta", ML_SELLER_ID, "...");
  const ids = await getActiveItemIds(token);
  console.log(`Encontradas ${ids.length} publicaciones activas.`);

  const detalles = await getItemsDetail(token, ids);
  const activos = detalles.map(mapearItem);
  const idsActivos = new Set(activos.map((a) => a.id));

  const estadoPrevio = cargarEstadoPrevio();
  const ahora = Date.now();
  const reservados = [];

  for (const autoPrevio of estadoPrevio.autos || []) {
    const sigueActivo = idsActivos.has(autoPrevio.id);
    if (sigueActivo) continue; // ya está en "activos", no hace falta duplicar

    const desde = autoPrevio.reservadoDesde || ahora;
    const diasReservado = (ahora - desde) / (1000 * 60 * 60 * 24);
    if (diasReservado > DIAS_ANTES_DE_BORRAR) continue; // se cumplió el plazo, se descarta

    reservados.push({
      ...autoPrevio,
      tipo: "reservado",
      estado: "reservado",
      reservadoDesde: desde,
    });
  }

  const catalogoFinal = [...activos, ...reservados];

  guardarJSON(OUTPUT_FILE, catalogoFinal);
  guardarJSON(STATE_FILE, {
    autos: [
      ...activos.map((a) => ({ ...a, reservadoDesde: null })),
      ...reservados,
    ],
  });

  console.log(`Listo. ${activos.length} activos, ${reservados.length} marcados como reservados.`);
}

main().catch((err) => {
  console.error("Falló la sincronización:", err.message);
  process.exit(1);
});
