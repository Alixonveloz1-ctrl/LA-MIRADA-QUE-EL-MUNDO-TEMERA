# Integración de ElevenLabs — informe

Trabajo hecho en este clon (`la-mirada-elevenlabs`), sobre la base **ff6b3af**.
**Commits LOCALES, sin push.** Tres commits:

1. `fa15263` — Servidor: módulo nuevo, modos de voz/muestra/efecto, Salud y variables.
2. `3d2da42` — App: cola con `muestra-elevenlabs` y `efecto`, pantallas de Voces y Tomas.
3. `f09f920` — Prueba sin red `probar-elevenlabs`, dentro de `npm run comprobar`.

## Qué se ha hecho

### 1. Voces en ElevenLabs (fijas por personaje, más expresivas)

- **Módulo nuevo `api/_lib/elevenlabs.js`**: cliente de ElevenLabs. La clave
  solo vive en la variable de entorno `ELEVENLABS_API_KEY` y solo se usa en
  la cabecera `xi-api-key` dentro de ese archivo: no se guarda en el bucket,
  no sale en mensajes, no se devuelve nunca.
- **Dónde queda guardada la voz de cada personaje**: en el estado del bucket,
  en `estado.voces[personaje].elevenlabs_voz_id` — **al lado** de la voz de
  Gemini (`voz_id`), sin pisarla. Se fija una sola vez desde la pantalla de
  Voces y se usa idéntica en todas sus líneas. En `datos/serie.json` no se ha
  tocado nada (los `voz_id: null` de Gemini siguen como estaban).
- **Modo `voz` (el de siempre) con interruptor de proveedor**: al generar un
  bloque, si hay clave puesta **y todos los que hablan en el bloque tienen su
  voz de ElevenLabs fijada**, el bloque se graba con ElevenLabs; si falta la
  clave o a alguien le falta su voz de ElevenLabs, se graba con Gemini
  exactamente como hasta hoy. Nunca un bloque a medias con dos proveedores.
  El proveedor que grabó cada bloque queda apuntado en
  `estado.audio.voz["pieza/bloque"].proveedor`.
- **El audio no cambia de forma**: ElevenLabs se pide en PCM crudo a 24 kHz y
  se envuelve en WAV con el `envolverWav()` de la casa. El bloque de
  ElevenLabs entra en la alineación de subtítulos (Speech-to-Text espera
  WAV/LINEAR16) y en el montaje sin que nada note la diferencia.
- **Modos nuevos para elegir escuchando**, con las mismas reglas que Gemini:
  - `voces-elevenlabs`: la lista real de voces de la cuenta (`GET /v1/voices`).
    Sin clave contesta `{ clave:false, voces:[] }`, no un error, para que la
    pantalla pueda decir «falta la clave».
  - `voz-muestra-elevenlabs`: la frase más difícil del personaje con una
    candidata de ElevenLabs, usando **la misma traducción al japonés ya
    guardada** que usan las muestras de Gemini (todas dicen exactamente lo
    mismo y se pueden comparar entre proveedores). Con el mismo cerrojo de
    Gemini: no se paga la muestra de una voz ya fijada en otro personaje que
    no puede compartir timbre. La muestra se guarda en
    `muestras-elevenlabs/{personaje}/{voz_id}.wav` y se apunta en
    `estado.voces[personaje].muestras_elevenlabs`.
  - Trabajo de cola nuevo `muestra-elevenlabs`, igual que `muestra`.
- **Pantalla de Voces**: bloque de ElevenLabs en la tarjeta de cada personaje.
  Sin clave, las tarjetas no enseñan nada de ElevenLabs y la cabecera lo dice
  una vez. Con clave: oír candidatas (por la cola), fijar una (con
  confirmación, y **no se puede fijar sin haberla oído**, la misma regla de
  la pantalla) y quitarla. Fijar la de ElevenLabs no toca la de Gemini.

**Diferencias honestas con el camino de Gemini** (están escritas también en
la cabecera de `elevenlabs.js`):

- Gemini graba el bloque en UNA llamada con hasta dos hablantes; el
  text-to-speech de ElevenLabs es una voz por llamada. Aquí cada intervención
  se graba con la voz fijada de su personaje y las intervenciones se pegan en
  PCM, en orden, en el mismo WAV. El timbre es el `voice_id` fijado —idéntico
  siempre— y la duración total es exacta (en PCM los segundos son bytes).
- La dirección de actuación en español que compone `guionDeVoz()` **no viaja**
  a ElevenLabs: no tiene un canal de instrucciones aparte del texto, y
  mandarla dentro sería leerla en voz alta. Actúa el propio texto japonés y
  su puntuación, que es como trabaja el modelo elegido.

### 2. Efectos de sonido en ElevenLabs (cadena nueva)

- **Modo nuevo `efecto`**: cuerpo `{ pieza, id, texto, dur_s? }`. Pide el
  efecto a `POST /v1/sound-generation`, lo guarda en
  `audio/efectos/{pieza}/{toma}.mp3` y lo apunta en
  `estado.tomas["{pieza}/{toma}"].efecto = { ruta, dur_s, texto, proveedor }`
  (con `intentos_efecto` guardando las rutas pedidas). Un plano, un efecto:
  repedirlo sustituye al anterior en el estado —lo último generado es lo que
  vale, como en todo el estudio—.
- **Trabajo de cola nuevo `efecto`** (identidad = el plano), con su gasto
  apuntado como `efecto_s`.
- **Pantalla de Tomas**: bloque «Efecto de sonido» en la tarjeta de cada
  plano —campo para describirlo (el generador trabaja mejor en inglés, como
  Lyria), la duración del plano como duración pedida, botón para pedirlo por
  la cola, y el efecto vigente con su texto y su duración medida—.
- La **duración guardada es la medida del MP3** devuelto (suma de tramas),
  no la pedida: la pedida solo se usa si el MP3 no se pudiera medir.

### 3. La clave y Salud

- La clave se lee **solo** de `ELEVENLABS_API_KEY`. Nadie la pide por chat ni
  la escribe en ningún archivo.
- **Salud** devuelve ahora un bloque `elevenlabs: { clave_puesta, modelo,
  variable, variable_modelo }` **sin llamar a ElevenLabs**: saber si hay
  clave es mirar la variable, y llamar gastaría. Que la clave *valga* solo se
  sabe al generar la primera muestra, y ese error sale a pantalla con las
  palabras de ElevenLabs (401 tiene su propio mensaje en español).
- `ELEVENLABS_API_KEY` y `ELEVENLABS_TTS_MODEL` están en la ficha de
  variables de `entorno.js`, así que la lista de variables de Salud las
  enseña con su «puesta / falta» y su para-qué.

## La API, según la documentación oficial de ElevenLabs

Nota de honestidad: en este entorno la web `elevenlabs.io` no se pudo abrir
directamente (el lector de páginas la tiene bloqueada); los endpoints y
parámetros de abajo se han contrastado con el contenido de la documentación
oficial devuelto por el buscador (páginas de modelos y de referencia de la
API, espejos de `elevenlabs.io/docs`). Son los endpoints públicos estables de
la API v1:

- **Text-to-speech**: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`,
  cabecera `xi-api-key`, cuerpo JSON `{ text, model_id, voice_settings }` y
  formato en la query `?output_format=pcm_24000`. Devuelve el audio en bruto.
- **Lista de voces**: `GET https://api.elevenlabs.io/v1/voices` → `voices[]`
  con `voice_id`, `name`, `labels` (gender, description…) y `description`.
- **Efectos de sonido**: `POST https://api.elevenlabs.io/v1/sound-generation`,
  cuerpo `{ text, duration_seconds (0,5–30, opcional), prompt_influence,
  model_id }`, formato `?output_format=mp3_44100_128`. El único modelo que
  acepta el endpoint es `eleven_text_to_sound_v2`. Según la documentación, la
  API de efectos **no está en el plan gratuito** (la desbloquea un plan de
  pago o una recarga Pay-As-You-Go de al menos 5 $).

**Decisión de modelo de voz: `eleven_v3` por defecto.** La página oficial de
modelos lo presenta como el modelo de síntesis más expresivo y con mayor
rango emocional («most emotionally rich, expressive speech synthesis
model»), con más de 70 idiomas —el japonés entre ellos— y 5.000 caracteres
por llamada. Es el recomendado por la propia documentación para lo que pide
el dueño: japonés **expresivo**. La alternativa estable,
`eleven_multilingual_v2` (29 idiomas, japonés incluido), queda a una variable
de distancia: `ELEVENLABS_TTS_MODEL=eleven_multilingual_v2`, sin tocar
código. Dos consecuencias del v3 respetadas en el código: **rechaza
`language_code`** (detecta el idioma del texto; el texto ya es el japonés
traducido, así que no se manda con ningún modelo) y su límite de 5.000
caracteres se comprueba antes de gastar.

**Formato elegido para la voz: `pcm_24000`.** Es el que hace que el bloque
salga en el formato exacto de la casa. Ojo: ElevenLabs reserva los formatos
PCM a los planes de pago; si la cuenta del dueño no lo tuviera, la primera
muestra fallará con el error de ElevenLabs a la vista, y el arreglo sería
cambiar el formato en `elevenlabs.js` (una línea) — no se ha querido pedir
MP3 por defecto porque un bloque de voz en MP3 rompería la alineación de
subtítulos, que espera WAV.

## Qué tiene que hacer el dueño para poner la clave (pasos de teléfono)

1. **Sacar la clave**: en el navegador del teléfono, entra en
   **elevenlabs.io** con tu cuenta → tu perfil (arriba) → **API Keys** →
   **Create API Key** → cópiala. (Si aún no tienes cuenta, créala primero;
   para los **efectos** hace falta plan de pago o una recarga de al menos
   5 $, según la documentación.)
2. **Ponerla en Vercel**: abre **vercel.com** → el proyecto
   **la-mirada-que-el-mundo-temera** → **Settings** → **Environment
   Variables** → **Add**: nombre `ELEVENLABS_API_KEY`, valor la clave que
   copiaste, entorno **Production** → Save.
3. **Redesplegar** (obligatorio: Vercel no aplica una variable nueva a lo ya
   desplegado): en el mismo proyecto, **Deployments** → el último despliegue
   → menú **⋯** → **Redeploy**.
4. **Comprobar**: abre la aplicación → **Salud**: en la lista de variables,
   `ELEVENLABS_API_KEY` tiene que salir como puesta. No pulses «Comprobar los
   modelos» solo por esto: no hace falta y gasta cuota de Google.
5. **Fijar las voces**: pantalla **Voces** → en la tarjeta de cada personaje,
   el bloque de ElevenLabs → «Oír las voces de ElevenLabs» → escucha las
   candidatas con su frase difícil → «Fijar esta voz». Empieza por Saharis:
   es el 38 % de todo el diálogo de la serie. A partir de ahí, los bloques de
   ese personaje se graban con ElevenLabs cuando **todos** los que hablan en
   el bloque tengan la suya fijada.
6. **Efectos**: pantalla **Tomas** → tarjeta de un plano → «Efecto de
   sonido»: escribe la descripción en inglés, p. ej. `a single drop of water
   falls into a puddle on wet stone`, y pulsa «Pedir el efecto».

## Verificación

- **Antes** de tocar nada: `npm run comprobar` → **exit 0** (árbol limpio).
- **Después**: `npm run comprobar` → **exit 0** (incluye la prueba nueva
  `elevenlabs` dentro de la cadena) y `npm run continuidad` → **exit 0**.
  `node --check` limpio en todos los archivos tocados.
- **Prueba nueva `herramientas/probar-elevenlabs.mjs`** (21 comprobaciones,
  sin red): sin clave nada se rompe y el error nombra la variable; las
  validaciones rechazan antes de gastar; con un `fetch` de mentira, la voz
  sale en el WAV de la casa con la duración exacta, una llamada por
  intervención a su voz fijada, sin `language_code` y con `eleven_v3`; el
  efecto mide la duración de su MP3 trama a trama.
- **Lo NO probado, dicho tal cual**: sin la clave no se ha hecho **ni una
  llamada real** a ElevenLabs. No está verificado que la clave del dueño
  valga, que su plan dé el formato PCM, ni cómo suena nada. La primera
  comprobación real es generar una muestra desde la pantalla de Voces ya
  desplegado — y si algo falla, el error que se verá es el de ElevenLabs con
  su explicación en español delante.
