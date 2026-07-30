# Cómo conectar BRAMAN Autos con Mercado Libre

Este paquete hace dos cosas automáticamente, cada 4 horas:

1. Trae tus publicaciones activas de Mercado Libre y arma las tarjetas del catálogo (foto, precio, año, km, link).
2. Si un auto que estaba activo deja de estarlo (porque lo pausaste o finalizaste en ML), lo pasa solo a **"Reservado"** en la página, y lo saca del todo a los 45 días.

No hace falta que sepas programar para usarlo: son 4 pasos de configuración, una única vez.

---

## Paso 1 — Subir esto a GitHub

1. Andá a [github.com](https://github.com) y creá una cuenta gratis (si no tenés).
2. Creá un repositorio nuevo, público, llamado por ejemplo `bramanautos`.
3. Subí **todos los archivos de esta carpeta** al repositorio (podés arrastrarlos desde la web de GitHub, "Add file → Upload files").
4. En **Settings → Pages**, elegí la rama `main` como fuente. GitHub te va a dar una dirección tipo `https://tuusuario.github.io/bramanautos/`.

---

## Paso 2 — Crear la aplicación en Mercado Libre

1. Entrá a [developers.mercadolibre.com.ar](https://developers.mercadolibre.com.ar) logueado con la cuenta de vendedor **pampa**.
2. Andá a "Mis aplicaciones" → "Crear aplicación".
3. Completá:
   - Nombre: `BRAMAN Autos Web` (o el que quieras).
   - URL de redirección: `https://tuusuario.github.io/bramanautos/` (la misma del Paso 1).
4. Al crearla, ML te va a mostrar dos datos importantes: **App ID (Client ID)** y **Secret Key (Client Secret)**. Guardalos.

---

## Paso 3 — Autorizar la aplicación (una sola vez)

1. Pegá esta URL en el navegador, reemplazando `TU_APP_ID` y `TU_URL_REDIRECCION`:

   ```
   https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=TU_APP_ID&redirect_uri=TU_URL_REDIRECCION
   ```

2. Te va a pedir loguearte con la cuenta **pampa** y autorizar la app. Después te redirige a tu página con algo así en la barra de direcciones:

   ```
   https://tuusuario.github.io/bramanautos/?code=TG-XXXXXXXXXXXX...
   ```

3. Copiá ese código (lo que sigue a `code=`).
4. Con ese código, hacé un solo pedido para obtener el `refresh_token`. La forma más simple es pegar esto en una terminal (o pedirme ayuda si no tenés una a mano):

   ```bash
   curl -X POST https://api.mercadolibre.com/oauth/token \
     -H "accept: application/json" \
     -H "content-type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code&client_id=TU_APP_ID&client_secret=TU_SECRET&code=EL_CODIGO&redirect_uri=TU_URL_REDIRECCION"
   ```

5. La respuesta trae un `access_token` y, lo más importante, un **`refresh_token`**. Guardalo, es el que usa el robot para siempre (se renueva solo).

6. Por último, necesitás tu **ID numérico de vendedor**. Se obtiene con:

   ```bash
   curl -X GET "https://api.mercadolibre.com/users/me" -H "Authorization: Bearer EL_ACCESS_TOKEN"
   ```

   El campo `"id"` de la respuesta es tu `ML_SELLER_ID`.

---

## Paso 4 — Cargar los datos en GitHub (Secrets)

En tu repositorio: **Settings → Secrets and variables → Actions → New repository secret**. Creá estos 4:

| Nombre               | Valor                                  |
|-----------------------|-----------------------------------------|
| `ML_CLIENT_ID`         | El App ID del Paso 2                   |
| `ML_CLIENT_SECRET`     | El Secret Key del Paso 2               |
| `ML_REFRESH_TOKEN`     | El refresh_token del Paso 3             |
| `ML_SELLER_ID`         | Tu ID numérico de vendedor del Paso 3   |

Listo. Andá a la pestaña **Actions** del repositorio, abrí "Sincronizar catálogo con Mercado Libre" y tocá **"Run workflow"** para probarlo por primera vez. Si todo salió bien, en un minuto vas a ver actualizado el archivo `cars-data.json` con tus publicaciones reales, y la página los va a mostrar automáticamente. De ahí en adelante corre solo cada 4 horas.

---

## ¿Y si quiero agregar un auto que no está en Mercado Libre?

Editá el archivo `manual-cars.json` (formato igual al de `cars-data.json`) y agregá tu auto ahí. La página combina automáticamente ambas listas. Ojo: este archivo no lo toca el robot, así que podés editarlo con confianza sin que se pierda.

## ¿Necesito tocar el código?

No. `sync-ml.js` y el workflow ya están listos. Solo tenés que completar los 4 secrets. Si en algún momento cambiás de nombre de usuario de vendedor o creás una app nueva, volvés a este mismo archivo para los pasos.
