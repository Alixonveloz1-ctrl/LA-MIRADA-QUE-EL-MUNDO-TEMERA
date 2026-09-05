# LA MIRADA QUE EL MUNDO TEMERÁ

El estudio de producción del animé. Se abre en el navegador del teléfono y desde
ahí se produce la serie entera: se genera el banco de personajes y escenarios, se
elige la voz de cada uno, se sacan los keyframes, se convierten en clips, se
compone el audio y se monta.

**Qué produce.** Piezas de vídeo terminadas con su audio, sus subtítulos quemados
en español y su acabado de anime. Hoy la pieza que hay escrita plano a plano es
el teaser de 78 segundos y 24 planos, que se puede generar desde el primer día.
Los doce episodios están en `datos/guiones.json` con sus 289 escenas y pasan
antes por el desglose, que los convierte en planos.

**Lo que NO es.** No es un estudio genérico para hacer animes. Es para este
animé: los personajes, los escenarios, las luces, el estilo y el reparto de voces
están escritos en `datos/serie.json` y la herramienta no inventa nada que no esté
ahí. Un animé, un camino. Si algún día sirve para otro, será otro proyecto.

Tampoco tiene cuentas, ni login, ni multiproyecto, ni ninguna pantalla para subir
imágenes: todo lo visual lo genera la herramienta.

---

## Cómo se usa

1. Se pone en marcha una vez, y casi todo lo hace un script. Desde el móvil, sin
   teclear nada:

   **[▶ Abrir en Cloud Shell e instalar](https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2FAlixonveloz1-ctrl%2FLA-MIRADA-QUE-EL-MUNDO-TEMERA&cloudshell_git_branch=claude%2Fnew-session-4grflv&cloudshell_tutorial=despliegue%2Ftutorial.md)**

   Clona el repositorio y abre un tutorial con botones que meten cada comando en
   el terminal. Habilita las APIs, crea o detecta el bucket, le aplica el CORS,
   crea la cuenta de servicio con sus permisos y su clave, y despliega el
   montador. Lo que queda a mano es Vercel, y está en
   **[docs/despliegue.md](docs/despliegue.md)**.

   Lo que Google necesita no se dicta como comandos: vive en `despliegue/`, en
   archivos que el instalador lee.
2. Se abre la dirección de Vercel en el teléfono y se añade a la pantalla de
   inicio, que es como se abre a pantalla completa.
3. Se entra en **Salud** y no se gasta nada hasta que esté todo en verde.
4. A partir de ahí, se trabaja por pantallas, en el orden que dice la guía:
   anclas del banco, resto del banco, escenarios, voces, keyframes, clips, audio
   y montaje.

Nada depende de que el móvil siga abierto: la cola y el estado viven en el
bucket, así que si se cierra la aplicación a mitad de una tirada de cuatrocientos
planos, al volver a entrar se reanuda sola.

---

## Estructura del repositorio

| Carpeta | Qué hay dentro |
|---|---|
| `app/` | La aplicación del navegador: cola, estado, progreso y las ocho pantallas, en módulos ES nativos sin build ni framework. |
| `api/` | La puerta única `POST /api/g` y su `_lib/`: firma el token, compone los prompts, habla con Vertex y con el bucket, y censura toda respuesta. |
| `datos/` | `guiones.json` (la serie), `serie.base.json` (cómo se produce, tal y como llegó), `opening-ending.json` (las dos piezas fijas y sus canciones), `voces-gemini.json` (las treinta voces de Gemini, sin Chirp) y `serie.json` (el que lee la herramienta, generado por el parche). |
| `docs/` | El contrato interno, el plan de construcción, las decisiones, la guía de despliegue y la explicación del parche de datos. |
| `herramientas/` | Lo que se ejecuta sin red: el parche de datos, los invariantes y el pesaje de las respuestas. |
| `montador/` | El contenedor de ffmpeg que corre como Job de Cloud Run: recorta, concatena, aplica el acabado, mezcla el audio y quema los subtítulos. |
| `despliegue/` | Lo que Google Cloud necesita, como archivos y no como comandos que alguien dicte: `apis.txt`, `cors.json`, `permisos.txt` y el tutorial de Cloud Shell. `instalar.sh` los lee. |

En la raíz, `index.html` (lo único que se sirve), `instalar.sh` (todo lo de Google
Cloud en un comando), `package.json`, `vercel.json` y este archivo.

---

## Las piezas

Una pieza es cualquier cosa que se produce de principio a fin. La herramienta no
distingue entre un teaser de 24 planos y un episodio de 400.

| Pieza | Planos | Duración | Se genera |
|---|---|---|---|
| `teaser` | 24 | 78 s | Una vez. Ya venía desglosada: se puede generar el primer día. |
| `opening` | 27 | 90 s | **Una vez para toda la serie.** Se pega como capa en los doce episodios. |
| `ending` | 15 | 90 s | **Una vez para toda la serie.** Igual. |
| `epNN` | ~400 | 22 min | Por episodio, con el desglose. Se añaden al lado. |

El montaje de un episodio queda `opening + actos + ending`, todo pegado como capa
ya montada. Regenerar el opening en cada episodio serían 504 planos tirados y doce
openings ligeramente distintos, que es lo que hace que una serie parezca hecha a
trozos.

### Las canciones

El opening y el ending llevan **canción con letra, cantada en japonés y
subtitulada en español**, como cualquier animé. La letra está en
`datos/opening-ending.json`.

No hay que confundirla con **la canción de la madre**, que es un elemento de la
historia, va en un idioma que no se habla en ese mundo, y esa decisión es del
episodio 10.

Los tiempos del subtítulo **se marcan oyendo la canción, no se estiman**: Lyria no
canta exactamente lo que se le pide, así que la pantalla de Audio deja darle al
play y tocar un botón cuando entra cada verso. Un verso sin marcar no se quema
como subtítulo.

**Cada canción son tres trozos, no uno.** El modelo de música disponible
(`lyria-002`) da unos 30 segundos por generación y no admite duración: pedirle
noventa devuelve treinta igual. Así que una pieza de 90 s se compone de tres
trozos que el montaje une con fundidos de 2,5 s — los cortos suenan a tajo.

### Lo que hay que poner a mano

Dos variables en Vercel, y ninguna más:

| Variable | De dónde sale |
|---|---|
| `GCP_SERVICE_ACCOUNT` | El JSON de la service account, en base64. Lo deja el instalador. |
| `GCS_BUCKET` | El nombre del bucket. Lo deja el instalador. |

Todo lo demás lo sabe la propia herramienta: la región por defecto es
`us-central1`, y el nombre del Job del montador está en
`despliegue/montador.txt`, que es el mismo archivo con el que `instalar.sh` lo
crea. Poner a mano una variable cuyo valor ya conoce el repositorio es trabajo
que no ayuda a nadie y una cosa más que puede escribirse mal.

---

### Los dos 404 que no son falta de acceso

Cuando Google contesta *«Publisher model … was not found or your project does not
have access to it»*, casi nunca es que la cuenta no tenga el modelo. Son dos
trampas distintas, y las dos están resueltas en el código:

**La región.** Los Gemini 3.x y Lyria 3 Pro **solo** se sirven desde `global`.
Pedirlos a `us-central1` devuelve exactamente el mismo 404 que «no tienes
acceso». La región de cada modelo la declara `datos/serie.json` y, si no la
declara, se deduce del nombre.

**El nombre.** Vertex publica el mismo modelo con **dos** grafías —la de preview
y la definitiva— y cuál de las dos contesta depende del proyecto. Las dos son
reales. Por eso `datos/serie.json` declara todas las que se conocen, en `ids`, y
`conGrafias()` las prueba en orden hasta que una contesta; un nombre que no
existe cuesta un 404, no genera nada y no se cobra, así que probarlos todos es
gratis. La que funciona se recuerda y se prueba primero la próxima vez.

Salud enseña, en cada modelo, **con qué nombre ha contestado** y **cuáles se han
probado**. Si ninguno contesta, el error los nombra todos con su región: eso es
lo que separa «sobra el modelo» de «falta el permiso».

Esto no se cumple solo: `npm run invariantes` arma la tabla de modelos de verdad
y comprueba que cada uno llega con todas sus grafías y cada grafía con su región,
y que ningún módulo compone la URL de un modelo sin pasar por `conGrafias()`. Fue
justo lo que se rompió una vez —la tabla entregaba el id y tiraba la lista, así
que se probaba un solo nombre— y por eso hoy se mide en vez de darse por hecho.

---

## Las ocho pantallas

1. **Salud** — dice quién es esta instalación, si el bucket se lee y se escribe,
   si cada modelo contesta y cuánto pesan las respuestas, todo comprobado de
   verdad y antes de gastar un céntimo.
2. **Voces** — los personajes ordenados por volumen de diálogo, cada uno con las
   voces de Gemini **de su género** diciendo su frase más difícil, para elegir
   escuchando. Chirp queda fuera de todo el proyecto: Chirp lee, Gemini actúa.
   Los veintinueve se pueden oír sin tocar ni un archivo: a dieciocho se les
   escribió la frase a mano y a los once figurantes se la saca del guion
   `npm run datos` —su línea de riesgo alto, o la de intención más detallada—,
   y la pantalla dice cuál de las dos cosas está oyendo.
   **Una voz es de un solo personaje**: en cuanto queda fijada deja de ofrecerse
   a los demás, ni siquiera se puede pagar su muestra, y el servidor rechaza
   guardar un estado donde dos la compartan. Dos personajes con el mismo timbre
   son el mismo personaje para el oído, y en doce capítulos eso solo se arregla
   volviendo a grabar. El margen es estrecho —30 voces para 29 personajes—, así
   que la pantalla avisa cuando quedan tres libres y `npm run invariantes` falla
   si los números dejan de dar.
3. **Banco** — los personajes y los escenarios de toda la serie: generar, mirar,
   aprobar y regenerar, con las cadenas de ancla y de edad a la vista.
4. **Desglose** — se elige un episodio y se convierte en planos, una llamada de
   texto por escena, sin campos de texto y sin pantalla de aprobación.
5. **Tomas** — la lista de la pieza activa filtrable por estado: keyframe,
   aprobar, clip, intentos, elegir.
6. **Audio** — la música de cada pieza y las voces de cada bloque, con
   reproductor: nada entra en un montaje sin haber sonado antes aquí. Y el
   marcador de letra, para poner los subtítulos de las canciones oyéndolas.
7. **Cola** — qué se está generando ahora, qué falló y por qué, el botón de
   detener y el contador de gasto.
8. **Montaje** — montar por escenas, actos y episodio, y reproducir o descargar
   el resultado por URL firmada.

---

## Antes de desplegar

```
npm run comprobar
```

Encadena las tres herramientas y no necesita red ni credenciales: regenera
`datos/serie.json` desde `serie.base.json` con el parche, comprueba los
invariantes sobre los datos y sobre el árbol de código, y **pesa** la respuesta
de cada modo con material del tamaño real para verificar que cabe en los 4,5 MB.
Ese último fallo no se ve leyendo el código; se ve midiendo. Si algo no cumple,
sale con error y lo dice en español.

Cada paso se puede lanzar por separado con `npm run datos`, `npm run invariantes`
y `npm run pesar`.

---

## Para tocar el código

Antes de escribir una línea, **[docs/contrato.md](docs/contrato.md)**: es la
única fuente de firmas, nombres de campo y reglas. Si algo no está ahí, se decide
y se añade ahí primero.

Lo demás que conviene leer: `docs/plan-de-construccion.md` (el encargo original,
con las trampas ya pagadas), `docs/decisiones.md` (lo que hubo que decidir al
construir y qué alternativa se descartó) y `docs/patch-datos.md` (qué le cambia
el parche a los datos y por qué).

Todo el código y todos los comentarios van en español. Solo van en inglés los
prompts a los modelos de imagen y de vídeo y los encargos a Lyria, porque no
admite otra cosa. Ni un project id, ni un bucket, ni un correo, ni una clave, ni
un id de modelo escritos en el código: salen de variables de entorno y de
`datos/serie.json`.
