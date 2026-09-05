# Contrato interno

Lo que cada módulo puede dar por cierto del resto. Es la única fuente para
escribir código: si algo no está aquí, se decide y **se añade aquí primero**.

Todo el código y todos los comentarios van en español. Solo van en inglés los
prompts a los modelos de imagen y vídeo y los encargos a Lyria.

---

## 0. Reparto de responsabilidades

| Quién | Qué hace | Qué nunca hace |
|---|---|---|
| `app/` (navegador) | Cola, progreso, reintentos, detener, reducir imágenes a 1280 px JPEG, pintar | Ver una credencial. Componer un prompt. Conocer un id de modelo. |
| `api/g.js` (función) | Firmar el token, componer prompts, hablar con Vertex y GCS, censurar | Devolver un master 2K. Devolver un MP4. Reintentar un 4xx. |
| `montador/` (Cloud Run) | ffmpeg: recorte, acabado, mezcla, subtítulos, cartela, capas | Conocer un archivo por su nombre. |

**El prompt se compone en la función, nunca en el navegador.** Es lo que hace
imposible que salga una generación sin `estilo.bloque`: el navegador no tiene
manera de pedirlo mal porque no manda texto, manda un id.

---

## 1. La puerta: `POST /api/g`

Un solo endpoint. El cuerpo siempre trae `modo`.

```js
{ "modo": "imagen", ...campos del modo }
```

### Respuesta

Bien:
```js
{ "ok": true, ...datos }
```

Mal — y el código HTTP acompaña:
```js
{ "ok": false, "error": {
    "mensaje": "Frase en español que se enseña tal cual en pantalla.",
    "detalle": "Lo que dijo Google, literal, o null.",
    "reintentable": false,
    "http": 413
} }
```

`mensaje` se pinta directamente. No hay códigos de error para el usuario.

### Cabeceras que pone siempre la función

- `X-Peso-Respuesta: <bytes>` — el tamaño real del cuerpo serializado. El
  navegador lo guarda por modo en `estado.pesos` y Salud lo enseña. Es la única
  forma de cumplir el invariante de los 4,5 MB: se mide, no se razona.

### Puerta opcional

Si existe `CLAVE_ACCESO`, la función exige la cabecera `X-Clave` con ese valor
y si no responde 401 con `mensaje` explicando que falta la clave. Si la variable
no existe, la función queda abierta. No es login ni cuentas: es un pestillo.

---

## 2. Los modos

Cada modo es una función `async (cuerpo, ctx) => datos` en su módulo. `ctx` trae
`{ serie, guiones, gcs, vertex, entorno }`.

### `salud`
Sin campos.
```js
{ ok:true,
  cuenta:  { correo, proyecto, bucket, prefijo },   // ya enmascarados en origen
  bucket:  { lectura:bool, escritura:bool, error:string|null },
  prueba_cors: { ruta, url },                        // objeto de 1 px que el navegador intenta leer
  modelos: [ { clave:"imagen.calidad", id, region, variable:"IMAGE_MODEL", ok:bool, error:string|null } ],
  voces:   [ { id, genero, idiomas:[..] } ] }
```
Comprueba credenciales, lectura y escritura del bucket, una llamada mínima a
cada modelo de imagen, a cada nivel de Veo, a Lyria, al modelo de texto y a
Gemini TTS en `ja-JP`. **Nunca devuelve la clave privada ni el JSON de la
service account.** `correo`, `proyecto` y `bucket` salen ya enmascarados por
`enmascarar()`, no por el censor.

El CORS del bucket no se puede comprobar desde el servidor: `salud` deja un
objeto de prueba y su URL firmada, y el navegador hace el `fetch` y decide.

### `voces`
```js
→ { ok:true, voces:[ {id, genero, idiomas} ] }
```

### `voz-muestra`
```js
{ modo:"voz-muestra", personaje:"saharis", voz_id:"..." }
→ { ok:true, es, ja, ruta:"muestras/{personaje}/{voz_id}.wav", url, dur_s }
```
El texto de muestra sale de `serie.voces.reparto[].muestra`, que está en
español. El audio va en `ja-JP`, así que la función traduce esa frase **una vez
por personaje** con el modelo de texto, la guarda en `estado.voces[p].ja` y la
reutiliza para todas las voces candidatas: si cada candidata dijera una frase
distinta no se podrían comparar. La intención viaja como dirección de actuación,
no como texto a leer.

### `imagen`
```js
{ modo:"imagen", tipo:"placa"|"escenario"|"keyframe",
  id:"saharis-ancla" | "cripta" | "A4",
  pieza:"teaser",            // solo si tipo==="keyframe"
  nivel:"calidad"|"medio"|"economico" }   // opcional; por defecto modelos.imagen.por_defecto
→ { ok:true, ruta, url, intento:2, bytes, ancho, alto }
```
El PNG 2K se queda en el bucket y **no viaja**. Vuelve la ruta y una URL firmada
para mirarlo.

Cómo compone la función, según `tipo`:

- **placa**: `banco.placas[id]`. Prompt = `personajes[placa.personaje].identidad`
  + `placa.encuadre` + `luces[placa.luz]` + `estilo.bloque`.
  Si la placa **no** es ancla, adjunta el ancla aprobada de su personaje como
  referencia de personaje con `instrucciones_referencia.banco`.
  Si trae `encadena_a`, adjunta esa placa con `banco.edades.instruccion`.
  Si el ancla que necesita no está aprobada, **falla** con mensaje en español y
  `reintentable:false`.
- **escenario**: `escenarios.placas[id]`. Prompt = `descripcion` + `encuadre`
  + `luces[luz]` + `estilo.bloque`. Sin referencias.
- **keyframe**: `piezas[pieza].tomas[id]`. Prompt = `toma.imagen`
  + `luces[toma.luz]` + `estilo.bloque`.
  Adjunta la placa del escenario como referencia de **objeto** y cada `toma.refs`
  como referencia de **personaje**, cada una seguida de
  `instrucciones_referencia.toma` con `{nombre}` sustituido.
  Si falta cualquier referencia aprobada, falla y **dice cuál**.

Cupos: `instrucciones_referencia.maximo_referencias`. Si se pasan, falla antes
de gastar.

### `veo-lanzar`
```js
{ modo:"veo-lanzar", pieza:"teaser", toma:"C3",
  imagen_b64:"...", lastFrame_b64:"..."|null }   // JPEG ya reducidos por el navegador
→ { ok:true, operacion:"projects/.../operations/..." }
```
Prompt = `toma.video` + `luces[toma.luz]` + `estilo.bloque`.
`negativePrompt` = `estilo.negativo`. `durationSeconds` = `toma.dur_gen`.
`storageUri` = `gs://{bucket}/{prefijo}/veo/{pieza}/{toma}/{intento}/`.
Fijos: `aspectRatio "16:9"`, `sampleCount 1`, `generateAudio false`,
`personGeneration "allow_adult"`.

`lastFrame` solo si `toma.encadena_con` no es null. Si el modelo lo rechaza, se
reintenta **una vez con el mismo modelo y sin `lastFrame`**, y la respuesta trae
`aviso_sin_lastframe:true` para que la pantalla lo diga.

Si `estado.tomas[...].keyframe_aprobado` es null, **falla sin llamar a Veo**.

### `veo-consultar`
```js
{ modo:"veo-consultar", pieza, toma, operacion, prefijo }
→ { ok:true, hecho:bool, ruta?:"veo/teaser/C3/2/xxx.mp4", url?, error?:string }
```
El nombre del MP4 lo pone Veo: al terminar se **lista el prefijo** y se coge el
archivo nuevo. La función lleva su propio límite (45 s) por debajo del de la
plataforma; si lo agota devuelve `hecho:false` en vez de morir sin excepción.

### `musica`
```js
{ modo:"musica", pieza:"teaser", id:"teaser-lecho" }
→ { ok:true, ruta:"audio/musica/{id}.wav", url, dur_s }
```
El encargo va **en inglés** tal cual está en `musica.piezas[].encargo`, con su
`negativo`. Lyria rechaza la petición entera en cualquier otro idioma.

### `voz`
```js
{ modo:"voz", pieza:"teaser", bloque:"madre" }
→ { ok:true, ruta:"audio/voz/{pieza}/{bloque}.wav", url, dur_s, lineas:[{quien,ja,es,t,hasta}] }
```
Un bloque es **una sola llamada** con todas sus líneas dentro, y hasta dos
hablantes. Es la única defensa real contra la deriva de tono. Nunca se regenera
una línea suelta: se rehace el bloque.

Cómo se agrupan los bloques — `bloquesDeVoz(pieza)` en `_lib/datos.js`:
- Pieza corta (el teaser): **un bloque por personaje**, con sus líneas en orden.
- Pieza de episodio: **un bloque por escena**, con sus líneas en orden; si la
  escena tiene más de dos hablantes se parte por parejas consecutivas.

La instrucción de estilo de cada personaje se compone siempre igual, carácter por
carácter, desde `serie.voces.reparto[].muestra.intencion` y la `intencion` de la
línea. Nunca se reescribe a mano.

### `alinear`
```js
{ modo:"alinear", ruta:"audio/voz/teaser/madre.wav", lineas:[{ja}] }
→ { ok:true, lineas:[ {inicio, fin} ] }   // segundos dentro del archivo
```
`speech:recognize` con `enableWordTimeOffsets`, `languageCode "ja-JP"`,
`encoding "LINEAR16"`, `sampleRateHertz 24000`. Se alinea **por bloque**, nunca
por episodio: el límite de la v1 síncrona es ~1 minuto.

Solo se toman **entrada y salida de cada intervención**. Palabra a palabra no
sirve: el audio va en japonés y el subtítulo en español, y no coincide el número
de palabras.

### `desglosar-escena`
```js
{ modo:"desglosar-escena", episodio:1, escena:"3" }
→ { ok:true, planos:[ {id, imagen, video, dur, dur_gen, recorte, veo, luz, escenario, refs, boca_visible} ] }
```
Una llamada de texto por escena, pequeña e independiente. La función valida lo
que vuelve contra las reglas del desglose (§6) y **rechaza** lo que no cumpla,
devolviendo qué regla se rompió. El usuario no aprueba planos: si una escena sale
mal se vuelve a pedir entera.

### `estado-leer` / `estado-escribir`
```js
{ modo:"estado-leer" }                          → { ok:true, estado, generacion:"17" }
{ modo:"estado-escribir", estado, generacion }  → { ok:true, generacion:"18" }
```
La escritura va con `ifGenerationMatch`. Si el bucket dice 412, la función
responde **409** con `{ ok:false, error:{...}, estado, generacion }`: el
navegador vuelve a aplicar su cambio sobre el estado que le devuelven y reintenta.
El bucket es la única verdad; el navegador tiene copia.

### `firmar`
```js
{ modo:"firmar", rutas:["banco/madre/madre-ancla.png", ...] }   // hasta 200
→ { ok:true, urls:{ "<ruta>": "<url firmada>" } }
```
URL firmada V4, 6 horas. Una sola llamada por pantalla: 400 planos no pueden ser
400 peticiones.

### `listar`
```js
{ modo:"listar", prefijo:"veo/teaser/C3/" }
→ { ok:true, objetos:[ {ruta, bytes, actualizado} ] }
```

### `borrar`
```js
{ modo:"borrar", rutas:[...] }  → { ok:true, borradas:n }
```

### `guardar-texto`
```js
{ modo:"guardar-texto", ruta:"montaje/manifiesto-3.json", contenido:"..." }
→ { ok:true, ruta, bytes }
```

### `montar`
```js
{ modo:"montar", manifiesto:{...} }   // §7
→ { ok:true, ejecucion:"projects/.../executions/xxx", manifiesto_ruta }
```
Escribe el manifiesto en el bucket y lanza el Job de Cloud Run pasándole **solo
la ruta del manifiesto**. El montador no conoce ningún archivo por su nombre.

### `montaje-estado`
```js
{ modo:"montaje-estado", ejecucion }
→ { ok:true, hecho:bool, bien:bool, queja:string|null, salidas:[rutas] }
```
`queja` sale del archivo que el montador escribe en el bucket
(`montaje/{trabajo}/queja.txt`). Un código de salida no es un mensaje de error.

---

## 3. El censor — `api/_lib/censor.js`

```js
export function instalarCensor(res, entorno)
```

**Se llama en la primera línea del handler**, antes de cualquier `await`, y
sobrescribe `res.json` y `res.end`. No se puede saltar por olvido porque no hay
otro camino de salida.

Qué tacha, en cualquier punto de cualquier respuesta, por profunda que esté:

| Qué | Por qué |
|---|---|
| `private_key`, `private_key_id` | Nunca, sin excepción, ni siquiera un fragmento |
| `client_email` y cualquier `...@....iam.gserviceaccount.com` | Es el correo |
| `project_id` y el número de proyecto | Identifica la cuenta |
| El nombre del bucket y el prefijo | Identifica el almacén |
| `ya29....`, `Bearer ...`, cualquier JWT de tres tramos | Es un token |

Lo sustituye por `«tachado»`. Recorre cadenas, claves, arrays y objetos
anidados, y también el texto que devuelva Google dentro de `error.detalle`.

**La única excepción, escrita a propósito:** una URL firmada de
`storage.googleapis.com` lleva el bucket en la ruta y el correo de la service
account dentro de `X-Goog-Credential`, y sin eso no es una URL. Se deja pasar
entera *solo* si el valor completo es una URL de ese host con firma V4. Sirve
para mirar y oír lo generado, caduca en 6 horas, y es la razón por la que el
MP4 y el PNG no pasan por la función. La clave privada no entra en esta
excepción ni en ninguna otra.

---

## 4. Errores — `api/_lib/errores.js`

```js
export class ErrorDeCara extends Error {   // el que se enseña
  constructor(mensaje, { detalle=null, reintentable=false, http=500 })
}
export function deGoogle(respuesta, cuerpo)  // → ErrorDeCara con el texto de Google literal
export function esReintentable(http)         // 408, 429, 5xx → true. Todo 4xx → false. 413 → false, siempre.
```

Reglas duras:
- Un **413 no se reintenta nunca**. El mensaje dice que no cabe y **cuánto
  pesaba**.
- Un 4xx no se reintenta: no va a cambiar.
- Si un modelo falla, se devuelve el error de Google **tal cual** en `detalle`.
  Jamás se sustituye un modelo por otro.
- Un 404 de un Gemini 3.x incluye en `mensaje` que esos modelos solo se sirven
  desde `global`, porque ese 404 parece falta de acceso y no lo es.

---

## 5. El estado — `estado.json` en el bucket

```jsonc
{
  "version": 1,
  "pieza_activa": "teaser",
  "banco":      { "saharis-ancla": { "aprobada": "banco/saharis/saharis-ancla.png", "intentos": [] } },
  "escenarios": { "cripta":        { "aprobada": null, "intentos": [] } },
  "tomas": {
    "teaser/A1": { "keyframe_aprobado": null, "intentos_keyframe": [],
                   "clip_elegido": null, "intentos_clip": [], "operacion_en_curso": null }
  },
  "audio": {
    "musica": { "teaser-lecho": { "ruta": null, "dur_s": 0, "aprobada": false, "intentos": [] } },
    "voz":    { "teaser/madre": { "ruta": null, "dur_s": 0, "aprobada": false,
                                  "lineas": [ { "inicio": 0, "fin": 0 } ], "intentos": [] } }
  },
  "voces":    { "saharis": { "voz_id": null, "ja": null, "muestras": {} } },
  "montajes": [ { "ruta": "", "capa": "pieza", "id": "teaser", "cuando": "" } ],
  "cola":     [ /* §8 */ ],
  "gasto":    { "imagen": { "calidad": 0, "medio": 0, "economico": 0 },
                "video_s": { "calidad": 0, "medio": 0, "economico": 0 },
                "musica_s": 0, "voz_s": 0 },
  "pesos":    { "imagen": 0 }
}
```

Reglas:
- **Ninguna toma genera vídeo con `keyframe_aprobado` en null.** La interfaz lo
  impide, y la función lo vuelve a comprobar. Dos cerrojos, no un aviso.
- Cambiar un ancla pone `aprobada:null` en **todas** las placas de ese personaje.
- Toda operación de Veo lanzada queda en `operacion_en_curso` **antes** de que la
  respuesta llegue al navegador. Ninguna queda huérfana.

---

## 6. Reglas del desglose

Las comprueba `_lib/desglose.js` sobre lo que devuelve el modelo, y
`herramientas/invariantes.mjs` sobre lo ya escrito.

1. Una conversación estática es **un** plano. Dos o tres solo con beats visuales
   de verdad distintos. **Un cambio de ángulo no es un beat.**
2. Duración media del plano ≈ 3 s. Ninguno por encima de 8.
3. `dur_gen` ∈ {4, 6, 8}. `recorte` = `[0, dur]` con `dur ≤ dur_gen`.
4. Encadenado (`encadena_con` ≠ null) ⇒ `dur === dur_gen`.
5. Nivel de Veo: `economico` para ambiente y cámara sobre fondo, `medio` para
   personaje con movimiento contenido, `calidad` solo para los planos que
   sostienen la escena.
6. **Regla de la boca:** ninguna línea de voz puede solaparse con un plano cuya
   `boca_visible` sea el personaje que habla, salvo que ese plano lo muestre
   hablando (su `video` lo pide explícitamente).
7. De cada intercambio hablado, solo uno o dos planos muestran la boca; el resto
   van sobre reacción, manos, nucas o escorzos.
8. Un plano con boca visible dura entre 2 y 4 s. Nunca más.
9. Todo plano tiene escenario, y ese escenario existe. Toda `ref` existe.
10. La línea de tiempo de la pieza no tiene huecos ni solapes.

---

## 7. El manifiesto de montaje

El montador **no conoce ningún archivo por su nombre**. Recibe esto y nada más:

```jsonc
{
  "trabajo": "teaser-3",
  "capa": "pieza",              // "escena" | "acto" | "episodio" | "pieza"
  "salida": "montaje/teaser-3.mp4",
  "formato": { "ancho": 1920, "alto": 1080, "fps": 24 },
  "acabado": { "cadena": "<serie.piezas[p].acabado.cadena_ffmpeg>",
               "paso_de_dos": ["A4","B2"] },
  "video": [
    { "id": "A1", "origen": "veo/teaser/A1/1/xxx.mp4",
      "desde": 0, "hasta": 4, "en": 0, "paso_de_dos": false }
  ],
  "audio": [
    { "pista": "musica", "origen": "audio/musica/teaser-lecho.wav",
      "desde": 0, "hasta": 78, "en": 0, "ganancia_db": -6, "agacha": true },
    { "pista": "voz", "origen": "audio/voz/teaser/madre.wav",
      "desde": 1.2, "hasta": 3.7, "en": 24, "ganancia_db": 0, "agacha": false }
  ],
  "silencios": [ [69, 72] ],
  "subtitulos": [ { "desde": 24, "hasta": 26.5, "texto": "No dejes que te vean." } ],
  "cartela": { "en": 75, "dur": 3, "texto": "LA MIRADA QUE EL MUNDO TEMERÁ", "fundido": 0.5 },
  "capas_previas": []           // rutas ya montadas que se concatenan tal cual
}
```

- Cada `video[]` se recorta con `desde`/`hasta` y se coloca en `en`.
- `paso_de_dos` por plano: `fps=12,fps=24` solo en los listados. Los de cámara
  sobre fondo van a 24 limpios, como en un anime real.
- Todo el audio se **remuestrea a 48 kHz** antes de mezclar: el TTS viene a 24 kHz
  y Lyria a otro. Música y ambiente se **agachan** bajo cada línea de voz
  (`sidechaincompress`), y todo pasa por `loudnorm`.
- Los subtítulos se **queman**, en español, con los tiempos reales medidos. No hay
  texto japonés en pantalla en ningún momento: al contenedor le basta una fuente
  con acentos.
- Si la capa es `acto` o `episodio`, `capas_previas` trae los archivos ya montados
  y solo se concatenan. Cada capa se guarda: si falla la tercera no se rehacen
  las dos primeras.
- El montador escribe su queja en `montaje/{trabajo}/queja.txt` **antes** de salir
  con error.

---

## 8. La cola

Vive en `estado.cola`, en el bucket. El navegador es el obrero: si se cierra el
móvil, al volver a abrir se reanuda sola.

```jsonc
{ "id": "k-teaser-A4-1", "tipo": "keyframe",
  "args": { "pieza": "teaser", "id": "A4" },
  "estado": "pendiente",     // pendiente | en_curso | hecho | fallido | detenido
  "intentos": 0, "error": null, "operacion": null,
  "creado": "2026-…", "actualizado": "2026-…" }
```

Tipos: `placa`, `escenario`, `keyframe`, `clip`, `clip-consultar`, `musica`,
`voz`, `alinear`, `desglose-escena`, `montaje`.

- Concurrencia máxima = `CONCURRENCIA` (por defecto 3), visible y ajustable en
  pantalla. Saturar las cuotas de Vertex devuelve errores que parecen falta de
  acceso.
- Reintentos solo si `error.reintentable`. Espera 2 s, 4 s, 8 s, 16 s y para.
- **Al abrir la aplicación, antes de lanzar nada nuevo**, se consultan todas las
  `operacion_en_curso` pendientes.
- Botón de detener: pone `detenido` en todo lo `pendiente` y no aborta lo que ya
  está en curso (una operación de Veo lanzada se sigue consultando; abandonarla
  sería dejarla huérfana).

---

## 9. La interfaz

Ocho pantallas: **Salud · Voces · Banco · Desglose · Tomas · Audio · Cola ·
Montaje**. Navegación por pestañas abajo, al alcance del pulgar.

Regla de reparto de trabajo, que gobierna toda la interfaz: **el usuario solo
decide sobre cosas que se perciben.** Imágenes que se miran, audio que se
escucha, vídeo que se reproduce. Nunca sobre listas, prompts, planos ni
parámetros. Si una pantalla le pide juzgar texto, esa pantalla está mal
diseñada.

Consecuencia directa: **todo lo generado tiene que poder reproducirse o verse
antes de usarse.** Ningún botón de aprobar sin el `<img>`, el `<audio>` o el
`<video>` al lado.

Regla de gasto: un keyframe malo cuesta céntimos, un clip malo cuesta un euro.
La interfaz hace **imposible** —no desaconsejable— generar vídeo sin keyframe
aprobado: el botón no existe hasta que lo hay.

### Piezas compartidas — `app/ui.js`

```js
h(etiqueta, props, ...hijos)      // crea elementos; sin framework, sin build
pantalla(titulo, ...secciones)
tarjeta({titulo, media, pie, acciones})
boton(texto, alAccionar, {tono:"principal"|"peligro"|"suave", desactivado})
aviso(mensaje, {tono:"error"|"nota"|"bien"})
barra(hechas, total, {etiqueta})
filtro(opciones, valor, alCambiar)
espera(texto)
confirmar(pregunta)               // → Promise<bool>
```

### `app/api.js`
```js
llamar(modo, campos)   // → datos si ok; lanza ErrorDeCara con .mensaje si no
```
Guarda `X-Peso-Respuesta` en `estado.pesos[modo]` quedándose con el máximo.

### `app/imagen.js`
```js
reducirParaVeo(url)   // → { b64, ancho, alto, bytes }   1280 px de ancho, JPEG 0.86
```
Descarga el master por URL firmada, lo pinta en un canvas y lo devuelve
reducido. Si el canvas queda contaminado, el mensaje dice **que le falta CORS al
bucket** y cómo se pone, no "error de canvas".

---

## 10. Variables de entorno

Nada de esto en el código. El project id sale del `project_id` de la service
account, nunca de una constante.

| Variable | Contenido | Por defecto |
|---|---|---|
| `GCP_SERVICE_ACCOUNT` | JSON completo de la service account | — (obligatoria) |
| `GCS_BUCKET` | nombre del bucket, sin `gs://` | — (obligatoria) |
| `GCS_PREFIX` | carpeta del proyecto dentro del bucket | `` |
| `GCP_LOCATION` | región por defecto | `us-central1` |
| `IMAGE_MODEL` `VEO_MODEL` `TTS_MODEL` `MUSIC_MODEL` `STT_MODEL` `TEXTO_MODEL` | sustituyen el modelo por defecto sin tocar código | los de `serie.json` |
| `MONTAJE_JOB` `MONTAJE_REGION` | el Job de Cloud Run | — / `GCP_LOCATION` |
| `CONCURRENCIA` | generaciones simultáneas como máximo | `3` |
| `CLAVE_ACCESO` | pestillo opcional de la puerta | vacío = abierta |

APIs a habilitar: `aiplatform.googleapis.com`, `storage.googleapis.com`,
`texttospeech.googleapis.com`, `speech.googleapis.com`, `run.googleapis.com`.

---

## 11. Rutas en el bucket

Todas cuelgan de `GCS_PREFIX`. El navegador **solo** maneja rutas lógicas; el
prefijo lo pone y lo quita `_lib/gcs.js`.

```
banco/{personaje}/{placa}.png          escenarios/{id}.png
keyframes/{pieza}/{toma}/{n}.png       keyframes/{pieza}/{toma}/aprobado.png
veo/{pieza}/{toma}/{n}/                veo/{pieza}/{toma}/elegido.mp4
audio/musica/{id}.wav                  audio/voz/{pieza}/{bloque}.wav
muestras/{personaje}/{voz_id}.wav      montaje/{trabajo}/…
montaje/{pieza}-{version}.mp4          estado.json
```
