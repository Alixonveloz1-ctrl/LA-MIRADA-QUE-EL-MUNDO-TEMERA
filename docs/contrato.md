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
{ modo:"imagen", tipo:"placa"|"escenario"|"keyframe"|"poster",
  id:"saharis-ancla" | "cripta" | "A4" | "poster-oficial",
  pieza:"teaser",            // solo si tipo==="keyframe"
  proporcion:"9:16"|"16:9",  // solo si tipo==="poster"; por defecto difusion.posters.formato_por_defecto
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
- **poster**: `difusion.posters.piezas[id]`. Prompt = `encargo` + la frase de la
  proporción + el título **dentro** de la imagen si
  `difusion.posters.titulo_en_la_imagen` es `true` (y si no, la orden de dejar
  vacía la banda que el encargo ya reserva).
  Adjunta cada `escenarios` como referencia de **objeto** con
  `instrucciones_referencia.escenario`, y cada `refs` como referencia de
  **personaje** con `instrucciones_referencia.toma`. Son dos cupos distintos y no
  compiten: un póster lleva el sitio Y las caras.
  Si el título va dentro, el negativo va **sin las palabras de texto**: el
  negativo de la serie lleva `text`, y mandarlo junto a «escribe este título» es
  pedir y prohibir lo mismo en la misma llamada.
  La `proporcion` solo se acepta si está en `difusion.posters.formatos`, y viaja
  al modelo como `imageConfig.aspectRatio`: **no se recorta después**.
  Se guarda en `difusion/posters/{id}/{formato}/{n}.png` y se apunta en
  `estado.posters["{id}/{formato}"]`.

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
{ modo:"montaje-estado", trabajo:"teaser-3" }
→ { ok:true, hecho:bool, bien:bool, queja:string|null, salidas:[rutas] }
```
Se pregunta por el **nombre del trabajo**, no por el de la ejecución.

**El nombre de una ejecución de Cloud Run no puede salir de la función.** Es
`projects/{NÚMERO DE PROYECTO}/locations/…/executions/…`, y el censor de §1 tacha
el número al salir — hace su trabajo. Lo que llegaría al navegador es
`projects/«tachado»/…`, se guardaría así, y en la vuelta siguiente Google
contestaría **403 `CONSUMER_INVALID`** sobre ese nombre roto: un error que se lee
como falta de permisos y no lo es.

Es la misma razón por la que `veo-consultar` recibe `pieza` y `toma` y no su
operación. `lanzar()` deja la ejecución en `montaje/{trabajo}/ejecucion.txt` y la
función la lee de ahí.

Un `ejecucion` que llegue con `«tachado»` dentro se rechaza sin llamar a Google.
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
  "pesos":    { "imagen": 0 },
  "difusion": { "teaser": { "ficha": { "titulo": "", "descripcion": "", "etiquetas": [] },
                            "ficha_aprobada": false } },
  "posters":  { "poster-oficial/9-16": { "aprobada": null, "intentos": [] },
                "poster-oficial/16-9": { "aprobada": null, "intentos": [] } }
}
```

Reglas:
- **Ninguna toma genera vídeo con `keyframe_aprobado` en null.** La interfaz lo
  impide, y la función lo vuelve a comprobar. Dos cerrojos, no un aviso.
- Cambiar un ancla pone `aprobada:null` en **todas** las placas de ese personaje.
- Toda operación de Veo lanzada queda en `operacion_en_curso` **antes** de que la
  respuesta llegue al navegador. Ninguna queda huérfana.
- La clave de `posters` es **`{pieza}/{formato}`** con el formato sin dos puntos
  (`9-16`, `16-9`). El vertical y el horizontal son dos imágenes distintas, con
  sus intentos y su aprobación: generar uno **nunca** pisa el otro.

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

Tipos: `placa`, `escenario`, `poster`, `keyframe`, `clip`, `clip-consultar`,
`musica`, `voz`, `alinear`, `desglose-escena`, `ficha`, `montaje`.

En `poster`, el **formato entra en la identidad** del trabajo: encolar el 9:16 y
el 16:9 de la misma pieza no es encolar dos veces lo mismo.

El **reel** no es un tipo de trabajo aparte: es un `montaje` con capa `pieza`,
salida `montaje/reel-{pieza}-{version}.mp4` y `formato` vertical. Se dice así a
propósito —y no con una capa nueva— porque el montador comprueba la capa contra
su propia lista, y una capa que él no conozca no falla al encolarla: falla en la
nube, minutos después. Lo compone `app/reel.js`, que no llama a ningún modelo:
solo junta clips ya elegidos y música ya aprobada.

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
montaje/reel-{pieza}-{version}.mp4     difusion/{pieza}.zip
difusion/posters/{id}/{formato}/{n}.png
```

El `{formato}` de un póster es `9-16` o `16-9`: los dos puntos no viajan a una
ruta. Cada formato tiene su carpeta, y por eso el contador de intentos de uno no
cuenta los del otro.

---

## 12. Firmas exactas

Nadie inventa una firma. Si hace falta una que no está, se añade **aquí** antes
de escribirla. Todo es ESM (`"type":"module"`), sin dependencias externas ni
paso de compilación: la función corre en Node 20+ y el navegador carga módulos
nativos.

### `api/_lib/entorno.js`
```js
export function entorno()      // → { sa, bucket, prefijo, region, modelos, montajeJob, montajeRegion, concurrencia, clave }
                               //   sa = objeto de la service account ya parseado
                               //   modelos = { imagen:{calidad,medio,economico}, veo:{...}, tts, musica, stt, texto }
                               //   cada modelo = { id, region, variable }
export function enmascarar(v)  // "mi-proyecto-4711" → "mi-…-711"; null → null
```
Lanza `ErrorDeCara` con mensaje en español si falta `GCP_SERVICE_ACCOUNT` o
`GCS_BUCKET`, o si el JSON no parsea. El `project_id` sale **siempre** de
`sa.project_id`, nunca de una constante ni de otra variable.

### `api/_lib/errores.js`
```js
export class ErrorDeCara extends Error {
  constructor(mensaje, { detalle = null, reintentable = false, http = 500 } = {})
  // campos: .mensaje .detalle .reintentable .http
}
export function deGoogle(http, cuerpoTexto, contexto)  // → ErrorDeCara con el texto de Google literal en .detalle
export function esReintentable(http)                   // 408/429/5xx → true; cualquier 4xx → false; 413 → false siempre
export function comoRespuesta(err)                     // → { ok:false, error:{mensaje,detalle,reintentable,http} }
```

### `api/_lib/censor.js`
```js
export function instalarCensor(res, ent)   // sobrescribe res.json y res.end. Primera línea del handler.
export function tachar(valor, secretos)    // recursivo sobre cadenas/arrays/objetos/claves. Exportada para poder medirla.
export function esUrlFirmada(s)            // true solo si es una URL V4 de storage.googleapis.com
```

### `api/_lib/gcs.js`
```js
export async function leer(ruta)        // → { texto, generacion, bytes } | null
export async function leerBytes(ruta)   // → { datos:Buffer, generacion, bytes } | null
export async function escribir(ruta, datos, { tipo, generacion })  // → { ruta, generacion, bytes }
export async function listar(prefijo)   // → [{ ruta, bytes, actualizado }]
export async function borrar(ruta)      // → boolean
export async function firmar(rutas, { minutos = 360 })  // → { "<ruta>": "<url>" }
export function gsUri(ruta)             // → "gs://{bucket}/{prefijo}/{ruta}"
export function desdeGsUri(uri)         // → ruta lógica, o null si no es de este bucket
```
`escribir` con `generacion` usa `ifGenerationMatch`; un 412 sale como
`ErrorDeCara` con `http:409`. `generacion:0` significa «solo si no existe».
Las rutas que entran y salen son **lógicas**: el prefijo lo pone y lo quita este
módulo y nadie más.

### `api/_lib/datos.js`
```js
export const serie, guiones
export function pieza(id)                    // lanza si no existe
export function toma(idPieza, idToma)
export function placa(idPlaca)
export function escenario(id)
export function personaje(id)
export function escenaDeGuion(episodio, escena)
export function bloquesDeVoz(idPieza)        // → [{ id, personajes:[..], lineas:[{quien,ja,es,t,hasta,intencion}] }]
export function nivelImagen(nivel)           // → { id, region, variable }
export function nivelVeo(nivel)              // → { id, variable }
export function rutaPlaca(idPlaca)           // → "banco/{personaje}/{placa}.png"
export function anclaDePersonaje(idPersonaje)// → idPlaca del ancla, o null
export function placasDePersonaje(idPersonaje)
export function lineasDeVoz(idPieza)         // → [{quien, ja, es, t, hasta}] en orden
```

### `api/_lib/prompt.js`
```js
export function promptPlaca(idPlaca)            // → { texto, negativo, referencias:[{placa, instruccion, cupo}] }
export function promptEscenario(id)             // → { texto, negativo, referencias:[] }
export function promptKeyframe(idPieza, idToma) // → { texto, negativo, referencias:[{placa|escenario, instruccion, cupo}] }
export function promptVideo(idPieza, idToma)    // → { texto, negativo }
export function encargoMusica(idPieza, idMusica)// → { texto, negativo, durS }   (en inglés, literal de serie.json)
export function guionDeVoz(idPieza, idBloque)   // → { partes:[{quien, texto_ja, direccion}], instruccion }
export function comprobarCupos(referencias, idModelo)  // lanza ErrorDeCara si se pasa de cupo
export function sellar(texto)                   // devuelve texto + estilo.bloque + "negativo: …". Lanza si ya lo lleva.
```
`sellar()` es el único sitio donde se pega `estilo.bloque`, y **toda** función de
prompt termina llamándolo. `cupo` es `"personaje"` u `"objeto"`.

### `api/_lib/vertex.js`
```js
export async function llamar(url, cuerpo, { metodo = 'POST', limiteMs = 45000 })  // → json
export function urlModelo({ id, region }, verbo, proyecto)  // → URL completa de Vertex
export function urlServicio(host, ruta)                     // texttospeech / speech / run
```
`llamar` traduce cualquier respuesta no-2xx con `deGoogle(...)`. Lleva su propio
`AbortController` con `limiteMs` por debajo del límite de la plataforma: sin él
la función se apaga sin excepción y el activo se queda «generando» para siempre.

### `api/_lib/imagen.js`
```js
export async function generar({ texto, negativo, referencias, nivel })
// referencias: [{ datos:Buffer, mime, instruccion, cupo }]
// → { b64, mime, bytes }
```
`generateContent`, `aspectRatio:"16:9"`, `resolution:"2K"` (la K en mayúscula).
Cada referencia va como `inlineData` seguida **inmediatamente** de un `text` con
su instrucción: sin esa línea el modelo copia el encuadre en vez de la identidad.

### `api/_lib/veo.js`
```js
export async function lanzar({ texto, negativo, imagenB64, lastFrameB64, nivel, durGen, storageUri })
// → { operacion, avisoSinLastFrame:boolean }
export async function consultar(operacion, nivel)   // → { hecho, error }
```

### `api/_lib/audio.js`
```js
export async function musica({ texto, negativo, durS })   // → { wav:Buffer, durS }
export async function voz({ partes, instruccion, voces }) // → { wav:Buffer, durS }
export async function listarVoces()                       // → [{ id, genero, idiomas }]
export async function alinear(wav, lineas)                // → [{ inicio, fin }]
export function duracionWav(buf)                          // → segundos, leídos de la cabecera
export function envolverWav(pcm, { hz = 24000, canales = 1, bits = 16 })  // → Buffer
```

### `api/_lib/texto.js`
```js
export async function generar(prompt, { json = false, limiteMs })  // → string | objeto
export async function traducirAJapones(textoEs, intencion)         // → string
export async function desglosarEscena(episodio, escena)            // → { planos:[...] }  ya validado contra §6
```

### `api/_lib/estado.js`
```js
export const ESTADO_VACIO
export async function leer()                          // → { estado, generacion }
export async function escribir(estado, generacion)    // → { generacion }
export function asegurar(estado)                      // rellena desde serie.json lo que falte; idempotente
export function rutaAprobada(estado, tipo, id)        // tipo: "banco"|"escenario"|"keyframe"|"clip"
export function exigirAprobada(estado, tipo, id, porQue)  // devuelve la ruta o lanza ErrorDeCara diciendo qué falta
export function reprobarCadena(estado, idPlacaAncla)  // pone aprobada:null en todas las placas que dependen de esa ancla
```

### `api/_lib/montaje.js`
```js
export async function lanzar(manifiesto)     // → { ejecucion, manifiestoRuta }
export async function estado(ejecucion)      // → { hecho, bien, queja, salidas }
```

### `api/_lib/salud.js`
```js
export async function salud()   // → el objeto de §2
```

### `api/_lib/modos.js`
```js
export const MODOS   // { "<modo>": async (cuerpo) => datos }
```

### `api/g.js`
```js
export default async function handler(req, res)
```
Orden obligatorio: `instalarCensor(res, ent)` → método → clave → `modo` →
despacho → `X-Peso-Respuesta` → `res.json`.

### `app/api.js`
```js
export class ErrorDeCara extends Error   // .mensaje .detalle .reintentable .http
export async function llamar(modo, campos = {})   // → datos; lanza ErrorDeCara
export function pesos()                            // → { "<modo>": bytesMax }
```

### `app/estado.js`
```js
export async function cargar()        // → estado
export function actual()              // → estado en memoria (nunca null tras cargar)
export async function cambiar(fn)     // aplica fn(estado) y escribe; ante 409 recarga, reaplica y reintenta (5 veces)
export function alCambiar(cb)         // → función para desuscribirse
export function anotarGasto(estado, tipo, clave, cantidad)
```

### `app/cola.js`
```js
export function encolar(tipo, args)          // → id; no duplica un trabajo idéntico ya pendiente
export function encolarVarios(trabajos)      // → [id]
export async function arrancar()             // idempotente: si ya corre, no hace nada
export function detener()                    // pendiente → detenido; no aborta lo que ya está en curso
export function reanudar()
export function corriendo()                  // → boolean
export function resumen()                    // → { pendientes, enCurso, hechas, fallidas, detenidas }
export async function recuperarOperaciones() // consulta toda operacion_en_curso ANTES de lanzar nada nuevo
export const EJECUTORES                      // { "<tipo>": async (args, trabajo) => void }
```

### `app/imagen.js`
```js
export async function reducirParaVeo(url)   // → { b64, ancho, alto, bytes }
export const ANCHO_VEO = 1280
```

### `app/ui.js`
```js
export function h(etiqueta, props, ...hijos)
export function pantalla(titulo, ...secciones)
export function seccion(titulo, ...hijos)
export function tarjeta({ titulo, media, pie, acciones, estado })
export function boton(texto, alAccionar, { tono, desactivado } = {})
export function aviso(mensaje, { tono = 'nota', detalle } = {})
export function barra(hechas, total, { etiqueta } = {})
export function filtro(opciones, valor, alCambiar)
export function espera(texto)
export async function confirmar(pregunta)   // → boolean
export function vaciar(nodo)
```

### `app/formato.js`
```js
export function segundos(s), bytes(n), fecha(iso), porcentaje(a, b), plural(n, uno, varios)
```

### `app/pantallas/*.js`
```js
export default { id, titulo, icono, async montar(raiz) }   // montar pinta dentro de raiz y se suscribe a alCambiar
```

### `app/main.js`
Arranca: `cargar()` → `recuperarOperaciones()` → pinta pestañas → monta la
pantalla guardada en `location.hash` (por defecto Salud).

### `montador/montador.mjs`
Recibe la ruta del manifiesto en `MANIFIESTO` y el bucket en `GCS_BUCKET`.
Descarga lo que el manifiesto nombre, monta, sube la salida, y escribe
`montaje/{trabajo}/queja.txt` **antes** de salir con error. Un código de salida
no es un mensaje de error.

### `herramientas/invariantes.mjs`
Comprueba los 13 invariantes sobre `datos/serie.json` y el árbol de código, sin
red. Sale con 1 y una lista en español si algo falla.

### `herramientas/pesar.mjs`
Fabrica material del **tamaño real** (PNG 2K, JPEG de 1280, WAV de 45 s, listas
de 400 tomas), serializa la respuesta de cada modo y comprueba que cabe en
4,5 MB. La medida es la prueba: ese fallo no se ve razonando sobre el código.

---

## 13. Enmiendas

Posteriores a §1–§12. **Mandan sobre lo anterior** donde se contradigan.

### 13.1 Las placas de detalle encadenan a su ancla, y dicen qué copiar

Las placas de manos, nuca, espalda y escorzo (`detalle: true` en el banco) se
generan **exactamente igual que cualquier otra placa no-ancla**: con el ancla de
su personaje adjunta como referencia de personaje. Si `saharis-manos` se generase
suelta, las manos no serían las mismas manos.

La cadena es doble donde toca: `saharis-5-manos` → `saharis-5-ancla` →
`saharis-ancla`. La edad encadena al linaje y el detalle encadena a la edad.

Pero la instrucción genérica de `instrucciones_referencia.banco` habla de cara,
pelo y ojos, y en una placa de manos no hay cara. Una referencia sin propósito
hace que el modelo copie el encuadre en vez de la identidad —trampa ya pagada—,
así que estas placas traen **`instruccion_referencia` propia** que dice qué
copiar (tono de piel, complexión, cicatrices, color y corte de pelo) y, sobre
todo, **qué no dibujar** (la cara, que no está en cuadro).

`promptPlaca()` usa `placa.instruccion_referencia` cuando existe, y
`instrucciones_referencia.banco` cuando no. Nada más cambia.

Comprobado por `parche-datos.mjs` y por `invariantes.mjs`: una placa de detalle
nunca es ancla, su personaje siempre tiene ancla, y siempre dice qué copiar.

### 13.2 `tunel` y `tuneles` son dos sitios distintos

Dos lugares diferentes con nombres casi iguales. **No se fusionan nunca**, por
parecido que suene el nombre:

| id | Qué es | Cómo se usa |
|---|---|---|
| `tuneles` | La habitación de Saharis bajo la ciudad: seca, catre, mesa, un farol, y la pared entera cubierta de papeles, mapas, listas y cordel | Se **habita**. 46 escenas de la serie |
| `tunel` | El canal inundado por el que escapa a los diez años: agua somera, ladrillo goteando, rejas de hierro | Se **cruza corriendo**. La toma C4 del teaser |

Ambas placas llevan `no_fusionar_con` apuntando a la otra y una `nota` que lo
explica desde su lado, para que quien lea cualquiera de las dos vea que la otra
existe. `invariantes.mjs` falla si una desaparece o si acaban con la misma
descripción.

### 13.3 El desglose es UNA llamada de texto POR ESCENA

Ni una por episodio, ni una por plano. Son 24 llamadas por episodio y 289 en toda
la serie, pequeñas e independientes.

Esto **no es una preferencia de rendimiento y no se optimiza**:

- Una llamada por episodio no cabe en la ventana ni en los 60 s de la función, y
  cuando falla se pierden las 24 escenas, no una.
- Una llamada por plano no puede decidir cuántos planos tiene la escena, que es
  justo lo que se le está pidiendo. Y multiplica el gasto por diecisiete.

Cómo queda impuesto por la forma del código, no por un comentario:

- `desglosarEscena(episodio, escena)` recibe **una** escena y no acepta una lista.
  No existe `desglosarEpisodio()` en `api/_lib/texto.js`.
- El modo `desglosar-escena` lleva la escena en el cuerpo. No hay modo
  `desglosar-episodio`.
- La pantalla de Desglose encola **una tarea por escena**; el episodio es solo el
  botón que las encola todas.
- `invariantes.mjs` falla si aparece una llamada al modelo de texto que reciba
  más de una escena, o un modo de desglose por episodio.

### 13.4 Despliegue: lo que cambia por `docs/parche-despliegue.md`

Las instrucciones de montaje se despliegan a mano y siempre van por detrás del
repositorio. De ahí sale todo lo siguiente.

**La instalación ENTERA cabe en dos líneas tecleables.** El terminal de
Cloud Shell no deja pegar desde el móvil, y aquí solo hay móvil:

```
git clone https://github.com/<usuario>/<repo>.git
bash <repo>/instalar.sh
```

Y no vale solo para el montador: la regla es de toda la instalación. APIs,
bucket, CORS, service account, permisos y montador entran en esas dos líneas.
Lo único que queda fuera es lo que necesita un navegador y una tarjeta —crear la
cuenta de Google Cloud, activar la facturación— y Vercel.

**Lo que Google necesita no se dicta como comandos: son archivos del
repositorio**, en `despliegue/`, que el instalador lee.

| Archivo | Qué lleva |
|---|---|
| `despliegue/apis.txt` | Las APIs a habilitar, una por línea, con para qué sirve cada una |
| `despliegue/cors.json` | La configuración de CORS del bucket |
| `despliegue/permisos.txt` | Qué papel necesita cada cuenta, dónde y por qué |

Si mañana hace falta otra API o otro permiso, se añade al archivo y el instalador
lo aplica sin tocar una línea de código. Un permiso escrito dentro del script es
un permiso que nadie encuentra cuando falla.

**La clave de la service account sale en base64, en una sola línea.** Son dos
kilobytes de JSON y en un móvil no se copian de otra forma sin que se rompan;
`entorno()` acepta las dos formas justo por esto.

**La clave del montador no se regenera nunca en silencio.** Si el job ya existe,
se busca por dos caminos —preguntándosela al job y en el archivo de variables de
la vez anterior— y solo si no aparece por ninguno se genera otra, diciéndolo con
todas las letras: una clave nueva sin avisar deja el montaje fallando por una
razón que no se parece en nada a la verdadera.

El instalador, además: enseña
el proyecto activo y espera un Enter (único momento de darse cuenta de que se
está en la cuenta equivocada), detecta el bucket —si hay varios, el usuario
escribe **un número**, no un nombre—, habilita las APIs que falten, genera la
clave del montador con `openssl rand -hex 24`, construye y despliega, da los
permisos de bucket, e **imprime al final en un recuadro las variables con su
nombre y su valor exactos** para llevarlas a Vercel. Tarda entre cinco y ocho
minutos y hay que decirlo.

**Cloud Run Job, nunca servicio.** Un servicio se queda sin CPU a mitad del
trabajo y el vídeo se corta sin error claro. Parámetros:
`--memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 0`. El `--max-retries 0`
es a propósito: un montaje que falla no mejora repitiéndose solo, y repetirlo
cuesta dinero.

**Dos variables nuevas**, que salen del instalador: `MONTAJE_URL` (la dirección
del montador recién creado) y `MONTAJE_KEY` (la clave que solo comparten el
endpoint y el montador). `_lib/montaje.js` usa `MONTAJE_URL` si está, y si no la
compone desde `MONTAJE_JOB` y `MONTAJE_REGION`; la clave viaja al contenedor y el
montador la comprueba antes de trabajar.

**Permisos: no basta con la service account de Vercel.** El montador se ejecuta
con la cuenta de compute del proyecto
(`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`), no con la de Vercel.
Sin permiso propio sobre el bucket, el montaje falla **al escribir el resultado,
después de haber hecho todo el trabajo**. Y la cuenta de Vercel necesita Cloud
Run Invoker para lanzar el job. El instalador hace las dos cosas.

**Vercel no aplica una variable nueva a un despliegue ya construido.** Hay que ir
a Deployments → los tres puntos del último → Redeploy. Y esto **tiene que
decirlo la propia pantalla de Salud**, junto a cada variable que falte:
*«¿la acabas de añadir? Vercel necesita un Redeploy.»* Sin esa frase se busca el
fallo donde no está.

**La versión de Node va fijada en `package.json`**, no a merced del valor por
defecto de la plataforma.

### 13.5 El nombre de la operación de Veo no viaja nunca

Un nombre de operación es `projects/{project_id}/locations/…/operations/…`:
**lleva el project id dentro**. Y el censor tacha el project id de toda respuesta,
que es exactamente su trabajo.

Las dos cosas juntas rompían la cadena de vídeo entera: el navegador recibía
`projects/«tachado»/…`, preguntaba por una operación que no existe, y al guardar
el estado ese nombre tachado pisaba en el bucket el único ejemplar bueno. Ningún
clip se podía recoger jamás.

La salida **no** es hacerle un hueco al nombre en el censor. Es que no viaje:

- `veo-lanzar` devuelve `lanzada: true`, nunca el nombre.
- El nombre se escribe en el estado, en el bucket, por la función.
- `estado-leer` lo cambia por `true` antes de contestar. El navegador solo
  necesita saber **que** hay vídeo en vuelo, no cómo se llama.
- `estado-escribir` conserva el nombre que hay en el bucket y no acepta ninguno
  del navegador. Sí acepta que diga que ya no hay operación: limpiar es suyo.
- `veo-consultar` recibe `{pieza, toma}` y busca el nombre él mismo.

**Y un segundo apunte, por el invariante de que ninguna operación queda
huérfana.** El estado se guarda con generación y puede fallar por conflicto justo
después de lanzar. Así que `veo-lanzar` escribe además el nombre en
`veo/{pieza}/{toma}/{intento}/operacion.txt`, un archivo que no compite con
nadie, y `veo-consultar` lo rescata de ahí cuando el estado no lo tiene. Una
operación lanzada y perdida es un clip pagado que nadie recoge.

Ningún mensaje de error lleva el nombre dentro: saldría tachado y no serviría de
nada. Se nombra el prefijo, que sí es útil y no identifica la cuenta.

### 13.6 El opening y el ending

Un animé los tiene, y son **los mismos en los doce episodios**. Faltaban.

| Pieza | Planos | Duración | Música |
|---|---|---|---|
| `opening` | 27 | 90 s | `opening-tema` |
| `ending` | 15 | 90 s | `ending-tema` |

Las dos llevan `fija: true`, y eso quiere decir una cosa concreta: **se generan
una vez para toda la serie y no se regeneran nunca por episodio.** A 400 planos
por episodio, regenerarlas doce veces serían 504 planos tirados y —peor— doce
openings ligeramente distintos, que es justo lo que hace que una serie parezca
hecha a trozos.

El montaje de un episodio queda:

```
capas_previas: [ opening.mp4, acto-I.mp4, acto-II.mp4, …, ending.mp4 ]
```

Todo entra ya montado y la capa de episodio **solo concatena**. La estructura de
capas de §7 ya lo permitía sin tocar nada: `capas_previas` no distingue entre un
acto recién montado y un opening de hace tres semanas.

Viven en `datos/opening-ending.json`, que el parche mete en `serie.json`. Están
aparte para que se puedan leer y corregir sin bucear en el script.

**Dos cosas heredadas del resto del sistema, no inventadas aquí:**

- Los planos usan **solo placas y escenarios que ya existen en el banco**. El
  opening recorre la cadena de edades de Saharis —bebé, 5, 10, 12, adulto— que es
  exactamente para lo que esa cadena existe: si esas cinco fueran cinco personas,
  el opening lo cantaría a la primera.
- Una toma de cartela se marca con `cartela: true` en la propia toma, y por eso
  puede no tener escenario. Antes solo había una en toda la serie
  (`cartela.toma`); ahora hay tres, una por pieza, y el invariante lo comprueba
  pieza a pieza.

### 13.7 Las canciones del opening y del ending

**Son dos cosas distintas y no se mezclan:**

| | Qué es | Idioma |
|---|---|---|
| **Opening / ending** | Las canciones **de la serie**, como cualquier animé | Cantadas en **japonés**, subtítulo en **español** |
| **La canción de la madre** | Un elemento **de la historia** | En un idioma que no se habla en ese mundo. Sigue pendiente, y es decisión del episodio 10 |

La segunda no es el opening. Nadie las unifique más adelante.

La letra vive en `piezas[opening|ending].letra`, con `ja` (lo que se canta) y `es`
(lo que se pinta). El `ja` es de los pocos sitios donde el japonés es lo correcto,
junto a `audio.voz[].ja`: en pantalla no hay japonés en ningún momento. La letra
viaja **dentro del encargo a Lyria**, que va en inglés porque Lyria rechaza la
petición entera en cualquier otro idioma; la letra que lleva dentro es japonesa y
tiene que serlo.

**Los tiempos se marcan oyendo, no se estiman.** Con la voz hablada se mide con
Speech-to-Text. Con una canción eso no vale, por dos razones: el reconocimiento
de voz cantada es malo, y —lo que de verdad importa— **Lyria no canta exactamente
lo que se le pide**: puede cambiar una palabra, repetir un verso o saltárselo. Un
subtítulo colocado sobre una estimación diría en español algo que no es lo que
suena.

Así que la pantalla de Audio trae un **marcador**: se le da al play y se toca un
botón grande justo cuando entra cada verso. Los tiempos van a
`estado.audio.musica[id].letra_tiempos`. **Un verso sin marcar no se quema como
subtítulo** — mejor sin subtítulo que con uno que no cuadra con lo que suena.

Esto **no** rompe la regla de que el usuario solo decide sobre lo que percibe:
no está juzgando un texto, está oyendo una canción y diciendo cuándo entra cada
verso. Lo que ve es la línea en español que va a salir en pantalla; lo que
decide es un instante.

### 13.8 El README se actualiza con cada cambio

Regla de trabajo, no de código: **cada cosa que se cambia se refleja en el
README**. Un README viejo es peor que ninguno — manda a quien lo lee a buscar
cosas que ya no están y le esconde las que sí.

Y como acordarse no funciona, `herramientas/invariantes.mjs` lo comprueba: el
README tiene que **nombrar** cada pieza de `serie.json`, cada carpeta del
repositorio, las ocho pantallas, `npm run comprobar` e `instalar.sh`. Si mañana se
añade una pieza y el README no la nombra, `npm run comprobar` falla y dice cuál
falta.

Lo que la comprobación **no** hace, y conviene saberlo: no lee la prosa. Puede
decir que el README nombra el `ending`; no puede decir si lo que cuenta de él es
verdad. Eso sigue siendo de quien escribe.

### 13.9 `alinear` devuelve además cómo se dice cada línea

Enmienda a §12 (`alinear`) y a §5 (el estado guardado). §12 escribe el resultado
como `[{inicio, fin}]` y no dice nada de dos casos que sí pasan.

**Firma real:**

```js
export async function alinear(wav, lineas)
// → [{ inicio, fin, estimado?: true, trozos?: [{ inicio, fin }] }]
```

Y por la puerta:

```js
{ modo:"alinear", ruta:"audio/voz/teaser/madre.wav", lineas:[{ja}] }
→ { ok:true, lineas:[ { inicio, fin, estimado?, trozos? } ] }
```

Los dos campos son **opcionales** y ninguno de los dos aparece siempre:

`estimado: true` — solo cuando el reconocimiento vuelve con menos palabras que
líneas y la duración se ha repartido en proporción al japonés. Un tiempo medido y
uno a ojo **no valen lo mismo**: con subtítulos, un tramo estimado para el
montaje, porque un subtítulo se quema en la imagen y no se arregla después.

`trozos` — los pedazos en los que se dice esa línea, separados por las pausas que
tiene el audio. Solo viene si hay **más de uno**; una línea dicha del tirón no lo
trae. El primero empieza donde la línea y el último acaba donde la línea. Ningún
pedazo dura menos de 0,8 s: los más cortos se juntan con el de al lado, porque un
subtítulo de tres décimas parpadea en vez de leerse.

**Dónde se corta entre líneas.** El reparto proporcional a los caracteres
japoneses es el esqueleto; después cada corte se arrastra al **silencio más ancho
que tenga cerca**, sin invadir a los vecinos. Contar caracteres da *más o menos*
el sitio; quien sabe exactamente dónde acaba una línea y empieza otra es el audio.

**En el estado** (§5), cada entrada de `audio.voz[clave].lineas[]` guarda los
cuatro campos, y **las dos rutas que miden guardan lo mismo**: la pantalla de
Audio y la cola. Que una de las dos perdiera un campo ya hizo que se quemaran
subtítulos a ojo sin que se pudiera saber mirando.

```json
{ "inicio": 0.2, "fin": 5.8, "estimado": false,
  "trozos": [ { "inicio": 0.2, "fin": 1.3 },
              { "inicio": 2.0, "fin": 3.2 },
              { "inicio": 4.1, "fin": 5.8 } ] }
```

**Qué hace el montaje con ellos.** Un subtítulo **por trozo**, no por línea. El
español se reparte entre los trozos en proporción a lo que dura cada uno,
prefiriendo cortar donde la frase ya tiene una coma o un punto, y cada uno se
queda puesto **hasta que entra el siguiente** —quitarlo al acabar su voz dejaría
la pantalla en blanco durante la pausa, y eso parpadea—. La **voz no se parte**:
es una sola intervención y se corta por `inicio`/`fin` de la línea entera.

Una medida hecha antes de esta enmienda no trae `trozos`, y entonces el subtítulo
sale de una pieza, como antes. No se rompe nada; hay que volver a medir para que
existan.

### 13.10 La regla de la boca tenía solo una mitad

Enmienda a §6.6. La regla escrita dice:

> ninguna línea de voz puede solaparse con un plano cuya `boca_visible` sea el
> personaje que habla, salvo que ese plano lo muestre hablando.

Eso impide **voz sin labios**: que se oiga hablar a alguien mientras se le ve la
boca parada. Le faltaba el reverso, y el reverso se ve igual de mal:

> **13.10** Si un plano muestra a alguien hablando —`boca_visible` es ese
> personaje **y** su `video` pide el movimiento—, **tiene que oírse su voz
> mientras dura ese plano**.
>
> La regla no dice qué frase ni dónde empieza: dice que no puede haber silencio
> debajo de una boca en marcha. Que los labios no cuadren con las palabras se
> sabe y se acepta.
>
> **Y tiene que ser SU voz.** No basta con que suene una voz cualquiera: si se ven
> los labios de B y lo que suena es A, en pantalla parece que B dice las palabras
> de A. La cobertura se mide **por personaje**, siempre.

Se vio en el teaser montado. El plano `B2` es un primerísimo plano de los labios
de la madre y su `video` pide que la boca se mueva **todo** el plano. `B2` va del
21 al 25. Su línea estaba escrita en el 24: **tres segundos de una mujer moviendo
los labios en silencio**, la voz entrando cuando al plano le quedaba uno, y el
corte llevándose la frase a medias.

**`boca_visible` no significa «está hablando».** Significa que esa boca está EN
CUADRO. En el mismo teaser hay dos planos con boca y solo uno habla:

| Plano | `video` | ¿Habla? |
| --- | --- | --- |
| `B2` | *her lips move continuously as she speaks* | sí |
| `D5` | *He turns his head to camera. **Nothing else moves.*** | no |

`D5` es un retrato de Saharis mirando a cámara sin decir nada, y su frase está
escrita después, sobre el plano siguiente. Llevarle la voz a `D5` «para cuadrar la
boca» la pondría sobre unos labios parados — **rompiendo §6.6 para arreglar
13.10**. Quien decide si una boca habla es el `video`, porque es lo único que Veo
anima.

**Formularla como «la voz entra con el plano» es un error**, y se cometió. En un
episodio el diálogo va seguido: la voz viene de antes en off, entra el plano de
labios, y la voz continúa. Ahí no hay nada que arreglar, y mover la frase para
«cuadrarla» abre un hueco donde no lo había y descoloca todo lo de detrás. En el
teaser esa formulación acierta por casualidad, porque son cuatro frases sueltas.

**Qué se hace con cada plano de boca en marcha:**

| Cómo llega | Qué se hace |
| --- | --- |
| ya tiene **su** voz encima al entrar | **nada**. Caso normal en un episodio |
| arranca en silencio (> 0,4 s) | se trae la frase más cercana de ese personaje |
| ninguna frase puede cubrirlo | no se inventa: se dice |

Una línea sin ningún plano de boca es voz en off y su `t` se respeta tal cual.

Lo hace `bocasQueHablan()` en `app/pantallas/montaje.js`: descarta los planos que
ya tienen voz encima, y de los que quedan empareja cada uno con la línea de ese
personaje que tenga más cerca, con la **duración del propio plano** como tope de
distancia, resolviendo primero lo más cercano para que no dependa del orden en que
estén escritos los planos. Cada plano se lleva una línea y cada línea va a un
plano.

**Tres cosas que no hace, y las tres a propósito:**

- **No mueve si no cabe**: ni antes del ámbito, ni pisando la línea anterior ni la
  siguiente del mismo bloque —sería ponerse a hablar encima de sí mismo—, ni
  saliéndose por el final, **ni cayéndole encima a otro personaje**. Esto último
  no lo guardaba nadie: un bloque es una persona (o dos), así que A y B pueden
  estar en bloques distintos, y traer la frase de B sobre la voz en off de A
  cambiaría un fallo por otro peor. Cuando no cabe, lo dice y deja la línea donde
  estaba.
- **No toca `datos/serie.json`.** El `t` escrito se queda escrito.
- **No se lo calla.** Cada línea movida sale en el resumen del montaje, con el
  segundo de antes y el de después.

`herramientas/invariantes.mjs` comprueba las dos mitades. La segunda distingue:
una boca que se mueve y tiene su línea desplazada es un **aviso** —el montaje lo
cuadra solo y dice cuánto—; una boca que se mueve y **no tiene nada que decir
cerca** es un **fallo**, porque eso el montaje no puede inventarlo y en pantalla
queda alguien hablando en silencio hasta que corte el plano.

Y lo que **no se puede** arreglar moviendo se cuenta al final, con las voces ya
colocadas: un plano de labios más largo que lo que se dice debajo, o un hueco de
más de un segundo en medio. Eso necesita acortar el plano o escribir más diálogo,
así que se dice y no se toca nada.

**Dónde se aplica:** en toda pieza y toda capa con planos —el teaser, cada escena
de cada episodio y cada episodio entero—, porque es `componerVoz()` quien compone
la voz de todo lo que se monta. Las capas que solo concatenan lo ya montado no
vuelven a mezclar voz, así que tampoco pasan por aquí.

**La voz equivocada es un fallo, no un aviso.** Si un plano enseña la boca de B
moviéndose y durante ese plano habla A y no B, el montaje **no puede** arreglarlo:
haría falta cambiar el plano o mover el diálogo. `herramientas/invariantes.mjs` lo
da por fallo, para que salte antes de generar el clip. Si además suena la voz de B
ahí, no cuenta: eso es diálogo solapado y lo juzga quien lo oiga.

### 13.11 `alinear` mide además a qué volumen suena la grabación

Enmienda a §12 y a §5. La respuesta de `alinear` lleva un campo más:

```js
{ modo:"alinear", ruta:"…", lineas:[{ja}] }
→ { ok:true, lineas:[…], nivel: { pico_dbfs, rms_dbfs } | null }
```

**Por qué.** En el montaje la voz iba con `ganancia_db: 0` —tal como la entrega el
TTS— y la música a −6 dB con otros −9 dB de agache debajo de cada línea. Quince
decibelios de separación sobre el papel, y la voz quedaba debajo de la música.
Esos quince decibelios son **relativos a cada origen**, y Gemini TTS entrega flojo
mientras Lyria entrega fuerte.

`rms_dbfs` se mide **solo donde se habla**: por ventanas de 50 ms, descartando las
que caen más de 30 dB por debajo de la más alta. Un promedio del archivo entero
contaría los silencios y daría un número más bajo del que se oye. `pico_dbfs` es
la muestra más alta, y es lo que dice cuánto se puede subir sin recortar.

Va `null` cuando no se puede medir de verdad —otra profundidad de bits, un
archivo vacío, un archivo en silencio— en vez de inventar un número: una ganancia
calculada sobre un número inventado es peor que no tocar la ganancia.

**En el estado** (§5), `audio.voz[clave].nivel` guarda los dos números, y **los dos
caminos que miden lo guardan igual**: la pantalla de Audio y la cola.

**Qué hace el montaje con ello.** `ganancia_db` de cada pista de voz deja de ser 0
y pasa a ser lo que haga falta para subir ese bloque a −16 dBFS de habla, limitado
por un techo de pico de −1,5 dBFS, con tope de +12 dB y suelo de −6 dB. Todas las
líneas de un bloque llevan la MISMA ganancia: salen del mismo archivo, y subirlas
por separado las descuadraría entre ellas. La música no se toca.

Sin `nivel`, la ganancia es 0 y se dice en el resumen del montaje. Cada bloque que
sube también se dice, con sus decibelios.

Esto **no cambia el manifiesto**: `ganancia_db` ya existía en §7 y el montador ya
lo aplicaba. No hay que redesplegarlo.

### 13.12 Continuidad de episodios y revisión del material existente

Las escenas con alternancia o montaje se describen en `datos/segmentos.js`.
Cada plano lleva `segmento` y se valida contra el lugar, luz, tiempo y reparto
de ese segmento. Deben aparecer todos en orden; no se encadenan segmentos
distintos mediante interpolación. La unión se hace por corte en el montaje.
La reparación de estas escenas sin diálogo puede redistribuir sus planos,
conservando duración total, audio y comienzo de la escena. Los originales se
respaldan; no se reasocian sus aprobaciones automáticamente a nuevos contenidos.
El prompt de Veo se limita al movimiento del plano y conservación del primer
fotograma. El canon y la descripción narrativa completa dirigen el keyframe;
no se solicita volver a representarlos dentro de cada clip.

La aclaración del autor prevalece sobre las inferencias del análisis: Saharis
tiene dieciséis años en el presente; las demás edades corresponden al pasado.
La muerte de la madre se muestra en el capítulo 1 y sus apariciones posteriores
son recuerdos, nunca una restitución en el presente. Saharis recuerda fragmentos
de la nana y nunca la escuchó completa. No se cambia el orden de las escenas ni
se inventa una cronología para explicar los saltos. `continuidad.reglas` transporta
estas instrucciones al desglose y al prompt de imagen. El vídeo conserva ese
primer fotograma y su movimiento validado. Las anotaciones antiguas
de edad no prevalecen sobre esta aclaración. El texto fuente y el audio se conservan.
La revisión narrativa completa se documenta en `docs/contexto-narrativo-revisado.md`.

Enmienda a §2, §5, §6, §7, §8 y §12. Las correcciones contrastadas del reparto y
del lugar viven en `datos/continuidad.js`, compartido por navegador y servidor.
El texto original de acción y diálogo se conserva. El contexto del desglose
incluye la escena anterior y siguiente, resumen del episodio, población, momento,
interior/exterior, precipitación y fuentes de luz. El esquema de color no ordena
lluvia ni anula faroles escritos en la escena.

Cada plano nuevo de un episodio lleva `direccion` con `visibles`,
`fuera_de_campo`, `posiciones`, `miradas`, `camara`, `estado_inicial` y
`estado_final`. Los dos primeros son listas de ids; los demás son texto de
dirección en inglés. `continuidad` guarda `version`, `secuencia`, `interior`,
`precipitacion`, `goteo`, `luz`, `reglas`, `personajes` y `momento`. Un primer
plano puede dejar personas fuera de cuadro; no puede borrar su presencia física.
La validación comprueba ese reparto y rechaza instrucciones explícitas de mirada
al espectador y lluvia interior. No sustituye la revisión visual humana.

El archivo sigue disponible. No se ofrece un plano general vacío cuando hay
personas en la escena, ni un plano de lluvia o nieve incompatible con su contexto.
Los detalles compatibles siguen pudiendo reutilizarse. Las placas de escenario
siguen adjuntándose como referencias del lugar. Además, un keyframe puede
adjuntar la imagen aprobada anterior más próxima del mismo escenario y secuencia,
si su revisión coincide. Es opcional, respeta los cupos y no obliga a crear otra
galería. La nueva cámara, acción, hora y luz prevalecen sobre ese fotograma.

```js
{ modo:"corregir-continuidad", pieza:"ep01", escena:"4" }
→ { ok:true, corregida:true, escena:"4", respaldo:"continuidad/…/anterior.json" }
export async function corregirPlanosDeEscena(episodio, escena, existentes)
```

`desglosarEscena(episodio, escena)` conserva su firma. La corrección usa el modelo
de texto, una escena por trabajo. Salvo la redistribución de escenas mixtas
descrita al inicio de este apartado, mantiene ids, orden, duraciones, recortes,
nivel de vídeo, bocas, encadenados, audio e inicios de las tomas. Guarda primero
un respaldo y una propuesta en rutas nuevas. Dentro de la transacción compara
las tomas con las leídas al empezar; si cambiaron, falla con 409 sin sustituirlas.
La cola admite `corregir-continuidad`. La pantalla Tomas confirma su coste de
texto antes de encolarlo. No genera imágenes ni vídeos automáticamente.
La tanda «Regenerar keyframes por revisar» es una acción separada y confirmada:
encola solo imágenes pendientes que aún no tienen un intento de su nueva revisión.
La tanda de vídeos por revisar exige primero una imagen vigente y excluye vídeos
ya en cola o intentos que correspondan a esa imagen y revisión.

El estado de una toma admite `revision_pendiente`, `clip_revision_pendiente`,
`revision_aprobada`, `origenes_keyframe`, `origenes_clip` y `operacion_origen`.
Cada toma corregida lleva `revision_direccion`; la pieza registra los respaldos
en `correcciones_continuidad`. Un cambio de dirección conserva archivos e intentos
y marca el material para revisar. Se puede aprobar de nuevo una imagen que sirve.
Un clip cuyo origen conocido sea otro keyframe no se puede seleccionar como
vigente. Los clips antiguos sin procedencia registrada exigen revisión manual
cuando cambia su toma; no se inventa su procedencia.

`veo-lanzar` recibe además `imagen_ruta` y, si encadena, `lastFrame_ruta`; ambas
deben coincidir con las aprobadas y vigentes. Se registra el prompt, revisión,
rutas de origen y SHA-256 del JPEG recibido; el hash registra esos bytes, no
certifica su equivalencia visual con el PNG. Cada encargo de imagen conserva su
prompt, referencias y revisión en un JSON junto al intento.

Los nuevos desgloses usan rutas versionadas. La reparación no cambia el sello
temporal del desglose, para no reconstruir audio y tiempos. El manifiesto de
montaje añade `video[].clave` para verificar que el clip seleccionado sigue siendo
el mismo antes de lanzar y al recoger el resultado. `montajes[].revision_pendiente`
excluye capas anteriores de nuevos montajes sin borrar su descarga ni reutilizar
su número de versión. El montador ignora este campo adicional de procedencia.

`npm run continuidad` verifica estos casos sin red ni generaciones de pago y
forma parte de `npm run comprobar`.
