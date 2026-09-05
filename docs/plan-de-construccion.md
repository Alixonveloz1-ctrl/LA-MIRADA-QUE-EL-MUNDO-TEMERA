# Plan de construcción — estudio de producción

Encargo completo para la fase de código. **Tres archivos y nada más**: este
documento, `guiones.json` (la serie) y `serie.json` (cómo se produce). Quien
construya no necesita haber estado en ninguna conversación.

**Qué se construye: el estudio completo de *La mirada que el mundo temerá*.**
Capaz de producir cualquier pieza de la serie — un teaser de 24 planos o un
episodio de 400 — de principio a fin, desde un teléfono.

**Qué se produce primero: el teaser de 78 segundos.** Pero la herramienta no se
diseña para él: se diseña para la temporada, y el teaser es su primera pieza.

**El teaser ya viene desglosado.** Sus 24 planos están escritos uno a uno dentro
de `serie.json`, con prompts, duraciones, encadenados y referencias. No pasa por
el desglose: se puede generar desde el primer día. Los episodios sí lo necesitan,
porque son ~400 planos cada uno.

**Qué NO es:** un estudio genérico para hacer animes. Es para este animé. Si algún
día sirve para otro, será otro proyecto.

---

## 1. Lo que no se construye

Escrito primero, porque es lo que más tiempo ahorra.

- Nada de generar la historia. La biblia, la escaleta y los doce guiones ya
  existen y son material humano, no entrada de la máquina.
- Nada de multi-proyecto, multi-usuario, cuentas ni login.
- Nada de abstracciones «por si algún día». Un animé, un camino.
- Ninguna pantalla para subir imágenes: **todo lo visual lo genera la
  herramienta**.

---

## 2. Las restricciones que condicionan todo

Cada una mató un diseño distinto antes de llegar al que funciona.

| Restricción | Consecuencia |
|---|---|
| Se trabaja **solo desde un teléfono** | La interfaz es la herramienta entera. Ningún «corre este comando». |
| El repositorio es público | Ni un project id, ni un bucket, ni un correo en el código. |
| Función serverless de **60 s** | Lo que tarde más es una *operación* que se consulta. |
| Petición y respuesta **≤ 4,5 MB** | El de la respuesta es el traicionero: parece un tiempo agotado. |
| **Un episodio son ~400 planos** | Nada puede depender de que el navegador siga abierto. |
| **Un episodio montado pesa 1-2 GB** | El vídeo largo no pasa por ninguna función, ni siquiera para descargarlo. |
| Todo vive en la nube del usuario | El bucket es la única verdad. El navegador tiene copia. |
| El usuario no lee registros de la nube | Todo fallo se explica **en pantalla, con palabras**. |

---

## 3. Arquitectura

```
NAVEGADOR                 FUNCIÓN                    NUBE
(cola, estado, progreso) → (puerta única) →          (bucket + Vertex + Cloud Run)
```

- **`index.html` + `app/`** — el director de orquesta. Cola, progreso, reintentos,
  botón de detener, y la reducción de imágenes antes de mandarlas. Nunca ve una
  credencial.
- **Un solo endpoint** con un campo `modo`. Firma el token, reenvía a Vertex y
  **censura toda respuesta** antes de devolverla — el censor se instala
  sobrescribiendo `res.json` en la primera línea, para que no se pueda saltar por
  olvido.
- **Bucket de GCS** — única verdad. Estado, banco, keyframes, clips, audio,
  montajes.
- **Cloud Run + ffmpeg** — el montador. **No conoce ningún archivo por su
  nombre**: recibe un manifiesto `origen → destino`. Si alguna vez hay que
  editarlo para añadir un material nuevo, el diseño está mal.

---

## 4. Los datos

`serie.json` es el contrato. La herramienta no lee nada más y no inventa nada.

Son **dos** archivos de datos, los dos en el repositorio:

- **`guiones.json`** — la serie entera. Doce episodios, 289 escenas, 397 líneas de
  diálogo, 40 flashbacks. Cada escena con su lugar, momento, personajes, acción,
  diálogo, **escenario canónico y esquema de luz**. Generado desde los guiones, no
  escrito a mano.
- **`serie.json`** — cómo se produce. Modelos, estilo, luces, el banco completo de
  la serie y las piezas.

Secciones de `serie.json`: `meta`, `formato`, `modelos`, `estilo`, `luces`,
`instrucciones_referencia`, `personajes`, `personajes_figurantes`, `banco`,
`escenarios`, `musica`, `voces`, `subtitulos`, `cartela`, `dialogo`, `rutas`,
`estado`, `limites_tecnicos`, `episodios`, `salud`.

Y una sección `piezas`, que **contiene muchas**. Hoy tiene una: `teaser`. Cuando
se desglose el episodio 1, se añade `ep01` al lado. Misma herramienta, misma
estructura, una pieza más.

**Composición de un prompt**, siempre en este orden y sin excepción:

```
<prompt de la toma o de la placa>
+ luces[luz]
+ estilo.bloque          ← literal, sin modificar
negativo: estilo.negativo
```

Una generación sin `estilo.bloque` se descarta.

---

## 5. Modelos y protocolos

Ids exactos. **Nunca se sustituye un modelo por otro en silencio**: si falla, se
devuelve el error de Google tal cual, porque si no el resultado sale distinto y
nadie sabe por qué.

### Imagen — `:generateContent`

| Nivel | Id | Región |
|---|---|---|
| calidad | `gemini-3-pro-image` | **global** |
| medio | `gemini-3.1-flash-image` | **global** |
| económico | `gemini-2.5-flash-image` | us-central1 |

`aspectRatio: "16:9"`, `resolution: "2K"` — la K **en mayúscula**.

Los Gemini 3.x **solo** se sirven desde `global`. Pedirlos a una región concreta
devuelve un 404 que parece falta de acceso sin serlo.

Cada referencia va seguida de **una línea que dice qué copiar de ella**. Sin esa
línea el modelo reproduce el encuadre en vez de la identidad.

Cupos (separados, no compiten): Pro admite 6 de objeto + 5 de personaje + 3 de
estilo. El escenario viaja como objeto; los personajes, como personaje.

La familia Imagen queda fuera: no acepta referencias.

### Vídeo — `:predictLongRunning` + `fetchPredictOperation`

| Nivel | Id |
|---|---|
| calidad | `veo-3.1-generate-001` |
| medio | `veo-3.1-fast-generate-001` |
| económico | `veo-3.1-lite-generate-001` |

Fijos: `aspectRatio "16:9"`, `sampleCount 1`, `generateAudio false`,
`personGeneration "allow_adult"`, `storageUri` al bucket.

**Duraciones: solo 4, 6 u 8 segundos.** Cada toma trae `dur_gen` y `recorte`.

**Encadenado:** con `encadena_con`, el keyframe de la toma siguiente va como
`lastFrame` y Veo interpola. Una toma encadenada se usa **entera** (`dur ==
dur_gen`) o la interpolación no llega al corte. Si el modelo rechaza `lastFrame`,
se reintenta con el mismo modelo sin él y se avisa.

### Música — Lyria, `:generateContent`

`lyria-3-pro-preview`. **Máximo 3 minutos por pieza** y **solo acepta inglés**
(rechaza la petición entera con *Unsupported language detected*).

Consecuencia para episodios: un episodio de 22 minutos son **varias piezas, una
por acto o por bloque**, unidas en el montaje con fundidos de 2,5 s. Los fundidos
cortos suenan a tajo.

El lecho instrumental y las voces cantadas van **como piezas separadas**, para
poder colocarlas al segundo exacto y mezclarlas a su propio nivel. El lecho lleva
la prohibición de voz en el encargo **y** en el negativo.

### Voz — Gemini TTS

`gemini-3.1-flash-tts` en `ja-JP`. Chirp descartado de todo el proyecto: se elige
Gemini por expresividad.

Devuelve **PCM mono de 16 bits a 24 kHz** en WAV.

Los ids de voz **se listan desde la API y se eligen escuchando**. No se inventan.

Gemini TTS es solo para voz hablada. **El canto lo genera Lyria.**

**Admite dos hablantes en una sola llamada**, y un diálogo entero de varias
líneas en una sola petición. Esto no es un detalle: es la única defensa real
contra la deriva de tono.

**La deriva de tono entre llamadas no se arregla.** El timbre no cambia —es la
voz elegida— pero la entrega sí: tono, energía, ritmo. No se corrige con
prompts, y pedirlo con más detalle no funciona. Lo que se hace es reducir la
exposición: **una llamada por escena y no por línea**, **dos personajes en la
misma llamada** cuando la escena es un intercambio, **nunca regenerar una línea
suelta** —se rehace el bloque de la escena entera—, la instrucción de estilo del
personaje idéntica en todas sus llamadas, y `loudnorm` en el montador para
igualar volumen y brillo. La política completa está en `serie.json`, en
`voces.deriva_de_tono`.

### Alineación — Speech-to-Text

Para episodios, con decenas de líneas: `speech:recognize` con
`enableWordTimeOffsets`, `languageCode: ja-JP`, `encoding LINEAR16`,
`sampleRateHertz 24000`.

El límite de la v1 síncrona es ~1 minuto, así que **se alinea por escena, nunca
por episodio**.

**Y un matiz que no está en ningún manual:** el audio va en japonés y el
subtítulo en español, así que la alineación palabra a palabra no transfiere — no
coincide el número de palabras. Lo que se toma es la **entrada y la salida de
cada intervención**, y eso se aplica al texto español a nivel de línea.

---

## 6. El banco

El banco es **de la serie**, no de una pieza. Crece con cada episodio que se
desglosa.

### Personajes

1. Se genera el **ancla**, solo con texto, sin referencias.
2. Se aprueba. Va a `banco/{personaje}/{placa}.png`.
3. Cada placa restante se genera **con su ancla como referencia de personaje**.
4. Si se cambia un ancla, todas sus placas quedan por reprobar.

**Las edades son el caso difícil.** Saharis aparece con 0, 5, 10, 12, 16, 17 y 18
años. Cada edad es una entrada distinta del banco, pero **todas encadenan al
mismo ancla de linaje** —la del adulto— con la instrucción de conservar la
estructura de la cara y cambiar la edad. Sin eso son siete personas distintas y
los flashbacks no funcionan.

Lo mismo con la madre, que solo tiene una edad, pero cuyos **pómulos** deben
verse en el ancla de Saharis: es el único rasgo heredado y es lo que hace que el
corte entre flashback y presente signifique algo.

### Escenarios

Igual, pero sin cadena: cada escenario es una placa única. Su placa viaja como
referencia de objeto en **todos** los planos que ocurren ahí. Sin esto, once
planos de «la cripta» son once criptas distintas.

---

## 7. Del guion a los planos: el desglose

**Este es el módulo que decide si la herramienta sirve.**

La serie entera ya está en el repositorio, en `guiones.json`: doce episodios, 289
escenas, con su lugar, su momento, si es flashback, qué personajes hay, el
diálogo y la acción. Y cada escena trae ya resuelto **su escenario canónico y su
esquema de luz**.

**Aquí no se pega nada.** El usuario elige un episodio y pulsa desglosar. La
herramienta recorre sus escenas y propone los planos de todas.

**El usuario no aprueba planos.** No es su trabajo y no tiene por qué saber de
dirección. Esta es una regla dura del producto, no una preferencia.

Flujo:

1. El usuario elige el episodio y pulsa desglosar.
2. La herramienta recorre sus escenas. **Una llamada de texto por escena** —
   pequeña e independiente, no una gigante por episodio. Son 24 llamadas por
   episodio y 289 en toda la serie. Cada una devuelve los planos de su escena:
   cuántos, qué se ve, qué se mueve, duración, nivel de Veo, referencias de
   escenario y de personaje, y `boca_visible`.
3. Los planos se escriben directamente como una pieza nueva en `serie.json`. **Sin
   pasar por ninguna pantalla de aprobación.**
4. A partir de ahí el usuario ya solo ve imágenes y vídeos.

**Dónde aprueba el usuario, entonces:** en el keyframe y en el clip, que es lo
único que se juzga mirando. Y si una escena sale mal una y otra vez, tiene un
botón para **rehacer el desglose de esa escena** — no para editarlo a mano, solo
para pedir otro. El plano es un detalle interno de la máquina; lo que el usuario
juzga es la imagen.

Reglas que el desglose tiene que respetar, y que conviene comprobar
automáticamente:

- Una conversación estática es **un** plano. Solo se abren dos o tres cuando hay
  beats visuales realmente distintos. **Un cambio de ángulo no es un beat.**
- Duración media de plano: 3 s. Nada por encima de 8.
- El estado final de un plano debe ser la imagen del siguiente cuando la acción
  es continua: eso es lo que permite encadenar con `lastFrame`.
- Nivel de Veo por tipo: `económico` para ambiente y cámara sobre fondo, `medio`
  para personaje con movimiento contenido, `calidad` solo para los planos que
  sostienen la escena.
- **Regla de la boca:** ninguna línea de diálogo puede solaparse con un plano
  donde se vea la boca quieta de quien habla. Cada plano declara `boca_visible`.
- De cada intercambio hablado, solo uno o dos planos muestran la boca; el resto
  van sobre reacción, manos, nucas o escorzos. Así se monta el anime de verdad.

---

## 8. Escala: 400 planos

Todo lo de esta sección existe porque el teaser tiene 24 y un episodio tiene 400.

- **La cola vive en el bucket, no en el navegador.** Si se cierra el móvil, se
  apaga la pantalla o se va la conexión, al volver a abrir se reanuda sola.
- **Lotes con concurrencia limitada.** Vertex tiene cuotas; saturarlas devuelve
  errores que parecen fallos de acceso. Un tope configurable y visible.
- **Operaciones de Veo en curso, persistidas.** Cada toma guarda el nombre de su
  operación. Al abrir, se consultan las pendientes antes de lanzar nada nuevo.
- **Lista filtrable por estado**: sin keyframe · keyframe pendiente de aprobar ·
  listo para vídeo · vídeo en curso · intentos sin elegir · listo. Sin esos
  filtros, 400 planos son inmanejables en una pantalla de teléfono.
- **Contador de gasto por pieza.** No como límite, sino como información:
  segundos de vídeo generados e imágenes por nivel. Con 400 planos, saber dónde
  se va el dinero cambia decisiones.
- **Progreso por escena y por acto**, no solo por plano. Es lo que permite saber
  si un episodio va por la mitad.

---

## 9. Montaje

### Pieza corta (teaser)

Un solo trabajo: recorte de cada clip según `recorte`, concatenado, acabado,
mezcla de audio, subtítulos quemados y cartela.

### Pieza larga (episodio)

**Por capas y reanudable**, porque un episodio no cabe en un solo trabajo:

1. **Escena** — se montan los planos de una escena, con su audio y sus
   subtítulos. Sale un archivo por escena.
2. **Acto** — se concatenan las escenas del acto y se le pone su pista de música
   con los fundidos.
3. **Episodio** — se concatenan los actos.

Cada capa se guarda. Si falla la tercera, no se rehacen las dos primeras.

**La descarga.** Un episodio a 1080p pesa uno o dos gigas: no pasa por ninguna
función. Se entrega con **URL firmada del bucket**, y el navegador solo recibe el
enlace.

### El acabado

Es lo que separa esto de un vídeo de IA. Se aplica a todo por igual.

```
fps=12,fps=24,
rgbashift=rh=-1:bh=1,
split[a][b];
[b]curves=all='0/0 0.7/0.2 1/1',gblur=sigma=14[glow];
[a][glow]blend=all_mode=screen:all_opacity=0.35,
noise=alls=7:allf=t+u,
vignette=PI/5
```

- `fps=12,fps=24` es el **paso de dos**, y solo se aplica a los planos listados
  en `acabado.paso_de_dos`. Los de cámara sobre fondo van a 24 limpios, igual que
  en un anime real.
- `rgbashift`, aberración cromática. `curves`+`gblur`+`blend screen`, halación.
  `noise`, grano. `vignette`, viñeta.

Se miran en pantalla una vez, se ajustan, y no se tocan más en toda la serie.

**Audio.** TTS a 24 kHz, Lyria a otro muestreo: se remuestrea todo a 48 kHz antes
de mezclar. Música y ambiente se agachan bajo cada línea de voz.

**Subtítulos.** Quemados, en español, con entrada y salida reales. **No hay texto
japonés en pantalla en ningún momento**, así que el contenedor solo necesita una
fuente con acentos. CJK no hace falta.

---

## 10. Las trampas ya pagadas

Todas costaron un fallo real. No se vuelven a pagar.

| Trampa | Qué pasa | Qué se hace |
|---|---|---|
| **Peso de imagen** | Una imagen 2K en PNG son ~6,8 MB, ~9,1 MB en base64. No cabe en 4,5 MB y el error parece un timeout. | El master 2K se queda en el bucket y **nunca viaja**. A Veo va una copia reducida a 1280 px en JPEG, hecha en el navegador. |
| **413** | Insistir no lo arregla. | Un 413 **no se reintenta**. Se dice en pantalla que no cabe y cuánto pesaba. |
| **Peso de vídeo** | Un clip de 8 s a 1080p son ~35 MB; un episodio, 1-2 GB. | `storageUri` al bucket, y descarga por URL firmada. Nunca por la función. |
| **Región de Gemini 3.x** | Un 404 que parece falta de acceso. | Endpoint `global`, siempre. |
| **Referencia sin propósito** | El modelo copia el encuadre en vez de la identidad. | Cada referencia lleva pegada su línea de qué copiar. |
| **Cambio de modelo silencioso** | El resultado sale distinto y nadie sabe por qué. | Se devuelve el error de Google tal cual. |
| **Duraciones de Veo** | 2 y 3 segundos no existen. | `dur_gen` y `recorte`. |
| **Operación que muere** | Sin límite propio, la función se apaga sin excepción y el activo se queda «generando» para siempre. | Límite propio por debajo del de la plataforma, y el fallo escrito en pantalla. |
| **Nombre del MP4** | Lo pone Veo. | Se lista el prefijo al terminar la operación. |
| **Muestreo de audio** | TTS 24 kHz, Lyria otro. | Remuestreo a 48 kHz antes de mezclar. |
| **Tiempos de subtítulo** | Estimados no cuadran. | Se miden del audio real y se escriben de vuelta. |
| **Lyria y el idioma** | Rechaza la petición entera en cualquier idioma que no sea inglés. | El encargo se compone en inglés desde los mismos datos. |
| **Navegador cerrado** | Con 400 planos es inevitable que pase. | Cola y estado en el bucket. Se reanuda sola. |

---

## 11. Las pantallas

Ocho.

1. **Salud** — service account enmascarada, project id, bucket, y cada modelo con
   su región y la variable que lo sustituye. Comprueba credenciales, lectura y
   escritura en el bucket, y una llamada mínima a cada modelo. Nunca devuelve la
   clave privada.
2. **Reparto de voces** — la lista de personajes **ordenada por volumen de
   diálogo**, con sus líneas, su porcentaje y sus episodios. Por cada uno, las
   voces reales de la API y un botón para oírlas **diciendo la frase más difícil
   de ese personaje en toda la serie**, con su intención puesta — nunca un saludo
   neutro. Se elige, se fija en `serie.json`, y no se vuelve a tocar.
3. **Banco** — personajes y escenarios de toda la serie. Generar, mirar, aprobar,
   regenerar. Con las cadenas de ancla y de edad visibles.
4. **Desglose** — elegir episodio y desglosarlo entero. Sin campos de texto y sin
   aprobación: se ejecuta y ya. Con un botón por escena para rehacer su desglose
   si más adelante da problemas.
5. **Tomas** — la lista de la pieza activa, filtrable por estado. Keyframe →
   aprobar → clip → intentos → elegir.
6. **Audio** — música y voces. **Con reproductor.** Cada pieza de Lyria y cada
   línea de Gemini TTS se escucha entera antes de entrar en el montaje, y se
   aprueba o se rehace. Nada suena en un montaje sin haber sonado antes aquí.
7. **Cola** — qué se está generando, qué falló y por qué, botón de detener,
   contador de gasto.
8. **Montaje** — montar por escenas, actos y episodio. Reproducir y descargar.

Regla de gasto: un keyframe malo cuesta céntimos, un clip malo cuesta un euro. La
interfaz tiene que hacer **imposible** generar vídeo sin keyframe aprobado.

**Y una regla de reparto de trabajo, que gobierna toda la interfaz:** el usuario
solo decide sobre cosas que se **perciben** — imágenes que se miran, audio que se
escucha, vídeo que se reproduce. Nunca sobre listas, prompts, planos ni
parámetros. Si una pantalla le pide juzgar texto, esa pantalla está mal diseñada.

Consecuencia directa: **todo lo generado tiene que poder reproducirse o verse
antes de usarse.** Un keyframe se mira, un clip se reproduce, una pista de música
se escucha entera, una línea de voz se escucha. Nada entra en el montaje sin que
haya pasado por los ojos o los oídos del usuario.

---

## 12. Orden de construcción

La herramienta es completa, pero **no se construye en cualquier orden**. Cada paso
tiene que quedar usable desde el teléfono antes de pasar al siguiente, para que
si algo se rompe se rompa barato.

**Fase A — que exista**
1. Endpoint puerta, autenticación y censor.
2. **Salud.** Responde de una vez qué modelos tiene permitidos la cuenta.

**Fase B — que genere**
3. Banco: generar **un** ancla de punta a punta y aprobarla.
4. El resto del banco de personajes, con cadenas de ancla y de edad.
5. Banco de escenarios.
6. Keyframe de una toma, con escenario y personajes adjuntos.
7. Clip: lanzar, consultar, listar, elegir. Con la reducción a JPEG desde el
   principio.
8. Encadenado con `lastFrame`.

**Fase C — que termine una pieza**
9. Audio: Lyria y TTS, con medida de duraciones.
10. Montador en Cloud Run con la cadena de acabado.
11. Subtítulos y cartela.
12. **Aquí se produce el teaser entero.** Es la prueba de que la cadena funciona.

**Fase D — que aguante un episodio**
13. Cola y estado persistidos en el bucket, reanudables.
14. Lotes con concurrencia limitada y contador de gasto.
15. Lista filtrable y progreso por escena y acto.
16. Desglose asistido.
17. Montaje por capas: escena → acto → episodio, con descarga por URL firmada.
18. Alineación de subtítulos con Speech-to-Text por escena.

La fase D se puede construir mientras se produce el teaser, pero **no antes**: si
la cadena básica no da la calidad que buscamos, media fase D sobra.

---

## 13. Invariantes

Comprobaciones sobre cómo tiene que estar construido el sistema.

- Ningún prompt sale sin `estilo.bloque` pegado literal.
- Ninguna toma genera vídeo con `keyframe_aprobado` en null.
- Ninguna placa que no sea ancla se genera sin el ancla de su personaje aprobada.
- Toda toma tiene escenario, y ese escenario existe en el banco.
- Toda referencia de una toma existe en el banco.
- Las duraciones de generación son 4, 6 u 8. Los encadenados tienen `dur ==
  dur_gen`.
- La línea de tiempo de una pieza no tiene huecos ni solapes.
- Ninguna línea de voz se solapa con una toma cuya `boca_visible` sea el
  personaje que habla, salvo que esa toma lo muestre hablando.
- No hay texto japonés en ningún campo que acabe en pantalla.
- Ningún project id, bucket, correo ni clave en el código.
- Ninguna operación de Veo queda huérfana: toda operación lanzada está persistida.

**Y una que no se comprueba leyendo:** hay que **pesar** las respuestas de cada
modo con material del tamaño real y verificar que caben en 4,5 MB. Ese fallo no se
ve razonando sobre el código; se ve midiendo.

---

## 14. Variables de entorno

Nada de esto en el código. El project id sale del `project_id` de la service
account, nunca de una constante.

| Variable | Contenido |
|---|---|
| `GCP_SERVICE_ACCOUNT` | JSON completo de la service account |
| `GCS_BUCKET` | nombre del bucket, sin `gs://` |
| `GCS_PREFIX` | carpeta del proyecto dentro del bucket |
| `GCP_LOCATION` | región por defecto (`us-central1`) |
| `IMAGE_MODEL` · `VEO_MODEL` · `TTS_MODEL` · `MUSIC_MODEL` · `STT_MODEL` | sustituyen el modelo por defecto sin tocar código |
| `MONTAJE_JOB` · `MONTAJE_REGION` | el job de Cloud Run |
| `CONCURRENCIA` | cuántas generaciones simultáneas como máximo |

APIs a habilitar: `aiplatform.googleapis.com`, `storage.googleapis.com`,
`texttospeech.googleapis.com`, `speech.googleapis.com`.

---

## 15. Cómo se comporta el código

- Todo fallo se explica **en pantalla, con palabras**, no con un código.
- El trabajo pesado escribe su queja en un sitio que la aplicación pueda leer. Un
  código de salida no es un mensaje de error.
- Un 4xx no se reintenta: no va a cambiar. Un 413 menos todavía.
- Nada depende de que el navegador siga abierto.
- El código y los comentarios van en español. Solo van en inglés los prompts a
  los modelos de imagen y vídeo, y los encargos a Lyria porque no admite otra
  cosa.
