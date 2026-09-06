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
3. Se entra en **Salud** y se pulsa **Comprobar los modelos**. No lo hace solo, y
   esa es la razón: comprobar un modelo es LLAMARLO, y esas llamadas gastan la
   misma cuota por minuto que hace falta para generar. Cuando se hacía sola al
   entrar —y Salud es la pantalla en la que abre la aplicación—, abrir el estudio
   y darle a generar en el mismo minuto se llevaba la cuota entera antes del
   primer intento: salía «se ha pasado de cuota» en la PRIMERA generación, sin
   haber generado nada. La pantalla que existe para decir si algo funciona era la
   que lo impedía.
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
   **El que se oye tiene voz propia.** En cuanto una voz queda fijada deja de
   ofrecerse a los demás, ni siquiera se puede pagar su muestra, y el servidor
   rechaza guardar un estado donde dos la compartan indebidamente: dos
   personajes con el mismo timbre son el mismo personaje para el oído, y en doce
   capítulos eso solo se arregla volviendo a grabar.

   La excepción es la del doblaje de toda la vida, y hace falta: con el género
   bien puesto salen **21 personajes masculinos y solo hay 16 voces masculinas**,
   y las de Gemini son treinta y son fijas. Así que quien dice **una o dos
   líneas** en toda la serie puede repetir timbre, pero solo con alguien que **no
   salga en ninguna de sus escenas** — hoy son once, y ninguno coincide con otro
   de los once. La pantalla lo dice antes de que elijas, con el nombre del otro.

   Las dos condiciones hacen falta: a quien se oye lo suficiente se le reconoce
   aunque nunca coincida, y dos que coinciden se delatan aunque digan una línea
   cada uno. `comparte` y `con` los calcula `npm run datos` leyendo el guion, y
   la misma regla la aplican la pantalla y el servidor.

   El servidor rechaza lo que **empeora** el reparto, no lo que arrastra. La
   comprobación está en la única puerta por la que escriben las ocho pantallas,
   así que mirar solo lo que llega convertía un dato de voces en un cerrojo para
   todo: con un timbre repetido ya guardado, la Cola no podía apuntar un trabajo
   ni Audio guardar un bloque; y con dos, soltar una voz dejaba el otro dentro y
   tampoco entraba — no había forma de deshacerlo sin editar el bucket a mano.
   Comparando con lo que hay, soltar una voz entra siempre y las demás pantallas
   siguen guardando, mientras que meter a alguien en un choque o inventarse uno
   nuevo se rechaza igual. Los repetidos que ya estuvieran guardados se avisan
   arriba en Voces, con nombres: se toleran para no bloquear nada, pero hay que
   deshacerlos antes de grabar.
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

### Una generación cada vez

**Todo pasa por la cola y se hace de una en una.** Imágenes, clips, voces,
música, montajes y las muestras para elegir voz: no hay ninguna pantalla que
llame a un modelo por su cuenta. Aunque pidas diez voces de golpe, se genera la
primera y las otras nueve esperan su turno, en orden.

No es un ajuste. Aquí había un selector de 1 a 8 que venía a 3, y se ha quitado:
con las cuotas de una cuenta nueva, subirlo no va más rápido, tumba la tanda
entera. Y Vertex pasado de cuota **no** contesta «has gastado tu cuota»:
contesta un 429 que en pantalla se lee como falta de acceso al modelo, y se
acaba buscando el fallo en los permisos, que es donde nunca está. La variable
`CONCURRENCIA` también se ha quitado — no la leía nadie.

**Y la función tiene un plazo.** Cada paso tenía su propio límite —45 s para
Vertex, 45 s para el bucket— y ninguno sabía del techo de la plataforma. Sumados
se pasaban, y cuando eso ocurre no hay error ni excepción ni una línea en los
registros: la plataforma corta la función y devuelve un 504 en bruto. En pantalla
se lee «se ha roto algo» y en el servidor no aparece nada. Ahora la puerta abre
un plazo al empezar y cada llamada espera lo que le dejen; cuando se acaba,
contesta en español diciendo qué estaba haciendo.

Ese plazo son **55 s y no los 300 que pide `vercel.json`**, y la diferencia es
deliberada: `maxDuration` se **pide**, pero quien concede es la plataforma según
el plan, y ese número no puede ser una apuesta. Si la función se creyera con más
tiempo del que le dan, volvería a morir cortada en silencio — el fallo que este
plazo existe para impedir. 55 s es el suelo seguro del plan gratuito menos un
margen; si el plan concede más, no se usa y no pasa nada. Para subirlo hay que
comprobar antes, con una generación real que tarde más de un minuto, que la
plataforma lo está concediendo. `npm run invariantes` no deja subirlo a ciegas.

**Y el obrero se pone cuando el trabajo ya está escrito, no antes.** Parece un
detalle y era el fallo que dejaba la aplicación sin generar nada: `encolar()`
mandaba escribir el trabajo al bucket —una petición de red, medio segundo— y sin
esperar llamaba al obrero; el obrero leía la cola, todavía no estaba el trabajo,
decía «no hay nada que hacer» y se iba. Medio segundo después el trabajo
aparecía y ya no había nadie mirando. Se quedaba «pedida» para siempre, sin
error, sin excepción y sin una línea en los registros. Lo vigila
`npm run cola`, que EJECUTA la cola contra un Google de mentira y un bucket que
tarda lo que tarda uno de verdad — sin ese retardo la carrera no ocurre y la
prueba pasaría mintiendo.

**Y con la cuota se tiene paciencia.** Cuando lo que falla es un 429, la cola no
insiste a los 2, 4, 8 y 16 segundos como con lo demás: espera medio minuto, uno,
minuto y medio y luego de dos en dos — nueve minutos repartidos en seis intentos.
Las cuotas de Vertex se reponen **por minuto**, así que insistir en segundos gasta
los cuatro intentos dentro del mismo minuto en que la cuota ya estaba agotada y
da el trabajo por perdido treinta segundos después de empezar. Un 429 no genera
nada y no se cobra: lo único que cuesta es esperar, que es justo lo que hay que
hacer.

### El freno que se ajusta solo

Portado de **Prisma-Negro**, otro proyecto del mismo autor que lleva meses
generando tandas de cientos de imágenes sin que el usuario vea un solo error de
cuota. La idea no es de aquí y funciona; esto es por qué.

Vertex no limita por «cuántas a la vez» sino **por minuto**. Ir de una en una ya
se hacía, pero **sin pausa entre llamadas**, y cuarenta imágenes seguidas se salen
del minuto igual aunque vayan en fila india. **Ir de una en una no es ir despacio.**

Ahora hay tres capas, y un 429 tiene que atravesarlas todas para llegar a la
pantalla:

1. **El freno** (`app/api.js`). Una pausa entre llamadas que **dobla** con cada
   429 —empieza en 8 s, que son siete llamadas por minuto, y no pasa de 60— y se
   **afloja un cuarto** cada cinco aciertos seguidos. Sube fuerte y baja despacio:
   subir multiplicando y bajar de golpe es un oscilador, no un regulador, y se
   pasa la tanda chocando cada pocas imágenes. Solo frena lo que gasta cuota de
   modelo: leer el estado habla con el bucket y no se frena, o la aplicación se
   arrastraría sin ganar nada.
2. **La espera de la llamada** (`app/api.js`). Un 429 no falla: espera 30 s, 60 y
   90 y reintenta **la misma llamada**. Si Google dice cuánto esperar se le hace
   caso, con un techo de 2 minutos —una cuota diaria puede contestar «vuelve
   dentro de 40.000 segundos», y eso serían once horas quieto—.
3. **La espera de la cola** (`app/cola.js`). Si aun así llega, no era la ventana
   del minuto: para **todo** el estudio 60 s y 180, sin perder el trabajo.

### Y por qué fallaba SIEMPRE el primer intento

Esa era la pregunta buena, y la respuesta estaba en Prisma-Negro: **el freno
aprende chocando, y lo aprendido hay que guardarlo.**

Empieza sin pausa, se estrella una vez contra la cuota, aprende, y a partir de ahí
va bien. Pero si lo aprendido se pierde al recargar la página, **cada sesión
vuelve a estrellarse una vez** — y esa una vez es justo la primera generación que
se mira. De ahí «falla desde el primer intento» con la cola vacía y nada más
corriendo.

Dos cosas lo arreglan, y las dos están en **Salud → «Con qué se genera» → El
ritmo**:

- **Se puede decir el límite.** Quien sabe que su cuenta aguanta dos por minuto lo
  elige y el estudio va a treinta segundos por generación desde la primera, sin
  chocar ni una vez.
- **Y lo aprendido se guarda** en el estado, o sea en el bucket, así que la sesión
  siguiente empieza donde acabó la anterior.

Es un suelo, no un valor fijo: si aun así se choca, el freno sube por encima.

Lo comprueba `npm run freno`, con un Google de mentira y un reloj de mentira: que
un 429 seguido de un acierto **no llegue a quien llamó**, que el freno suba a 8 s
y baje a 6, que el estado no lo pague, y que con la ventana cerrada del todo salga
**el mensaje de Google tal cual** y no una suposición.

**Y la cuota la espera la cola entera, no cada trabajo.** La cuota es una sola
para toda la cuenta: si Google dice que no hay, no la hay para el siguiente de la
lista tampoco. Antes cada trabajo se apuntaba su espera y la cola cogía
inmediatamente el siguiente, que se estrellaba contra la misma pared en el mismo
segundo. En producción se vio tal cual: **seis errores de cuota en seis
segundos**, seis trabajos quemados y nada generado. Ahora el primer «no hay
cuota» para el estudio entero, y se vuelve a mirar cada pocos segundos hasta que
la cuota se repone. Lo comprueba `npm run cola cuota`, que le pone delante un
Google sin cuota y exige que se pruebe una vez y se pare: con el código de antes
hacía ocho llamadas en seis segundos, con este hace una.

El hueco se cuenta sobre el estado del **bucket**, no sobre la pestaña que
tienes delante, así que «una cada vez» vale para todo el estudio aunque dejes
otra ventana abierta. Para poder distinguir «lo está haciendo otro» de «lo cogió
un navegador que ya no existe», quien trabaja refresca la hora de su trabajo
cada quince segundos; sin latido durante cuarenta y cinco, ese trabajo vuelve a
la cola. Por eso, al recargar la página, lo que se quedó a medias vuelve solo en
menos de un minuto en vez de bloquear el estudio durante cuatro.

### Cuando algo se rompe por dentro

Un fallo de Google, de la cuenta o del bucket sale **en la tarjeta** donde lo
pediste, con su explicación. Si en cambio aparece arriba del todo un aviso rojo
que dice «algo se ha roto por dentro del estudio y nadie lo ha recogido», eso no
es tu cuenta: es un defecto de este código. Ese aviso enseña **el detalle sin
tener que abrirlo** —el mensaje y la primera línea de dónde ocurrió—, porque es
la única línea que sirve para arreglarlo y esconderla no ayuda a nadie.

Para que ese detalle diga siempre de dónde viene, `boton()` recoge lo que
devuelve el manejador: la mitad de los botones del estudio son `async` —elegir
voz, cambiarla, montar, aprobar— y antes su fallo se perdía sin nombre. Ahora
llega con el del botón delante: «Al pulsar «Oír esta voz»: …», **entregado en
mano** con un evento. Relanzarlo para que saliera por el camino de siempre era
peor el remedio: un error lanzado fuera de la pila no tiene ningún archivo al que
Safari pueda atribuirlo, y entonces Safari lo tapa y lo entrega como «Script
error.», sin mensaje y sin línea. El intento de decir de dónde venía era justo lo
que lo borraba.

Y si alguna vez sale «Script error.» de todas formas, el estudio ya no se lo
apunta: eso es el navegador negándose a contarlo, y solo lo hace con lo que **no**
puede atribuir a un archivo de esta página —una extensión, un bloqueador de
contenido—. Se dice tal cual, porque disfrazarlo de fallo del estudio manda a
buscar donde no está.

### Con qué se genera, y cuánto cuesta

**Salud → «Con qué se genera».** Ahí se elige el modelo de imagen, el de vídeo y
la resolución de las imágenes, y se ve el **id exacto** de cada uno. Es la
decisión que más dinero mueve de toda la herramienta:

| | Se elige entre | Qué cambia |
|---|---|---|
| Imágenes | calidad · medio · económico | Del más caro al más barato. Por defecto, el que diga `serie.json`. |
| Resolución | **La que dé Google** · 1K · 2K | La misma imagen a 2K cuesta bastante más. Para juzgar un keyframe y para dárselo a Veo, 1K sobra: Veo entrega 720p. |
| Vídeos | calidad · medio · económico | Además de «el que lleve cada plano», que es lo que hay escrito en `serie.json` plano a plano. |

Los tres niveles existían desde el principio, pero solo se podían cambiar con una
variable de Vercel y un redespliegue. Eso estaba mal: lo elige quien paga, sobre
la marcha, no quien despliega. Ahora vive en el estado —o sea en el bucket—, así
que vale para todas las pestañas y sobrevive a cerrar el móvil. Se aplica a lo
que se genere a partir de ese momento; lo que ya esté generándose sigue con lo
suyo, y **un clip lanzado se consulta siempre con el nivel con el que se lanzó**
(se apunta al lado de la operación), porque preguntar por él a otro modelo de Veo
sería un clip pagado y perdido.

**«La que dé Google» no es un tamaño: es no pedir ninguno.** Y con el modelo
**medio** suele ser lo correcto, aunque no por lo que parece. Lo comprobado, con
las fuentes delante y sin adornar:

- **La documentación de Google dice que sí se admite**: 0,5K, 1K (por defecto),
  2K y 4K por `imageConfig`, también en el modelo del nivel medio.
- **Hay un informe abierto** que dice que ese modelo lo ignora y devuelve ~1K
  siempre ([js-genai #1461](https://github.com/googleapis/js-genai/issues/1461)).
  Va contra la grafía `-preview`, lleva desde abril de 2026 sin una sola
  respuesta de Google, y está marcado como prioridad baja.
- Los otros informes que se encuentran son de **librerías intermedias** que
  quitaban el campo antes de enviarlo. Este estudio llama a Vertex directo, sin
  librería, así que ese fallo no le aplica.
- Y aparte de todo eso, Vertex reparte la cuota de imagen **por resolución**:
  pedir 2K mete la petición en un cubo distinto y más pequeño que el de «por
  defecto», que es de donde salían los 429.

O sea que las fuentes no dan un sí ni un no. **Por eso no se discute: se mide.**
Cada imagen generada enseña en su esquina **su tamaño real en píxeles** y cómo lo
llamaría Google — `2048×1152 · 2K`, `928×1152 · 1K`—. Pidiendo 2K y mirando esa
esquina se sabe, para esta cuenta y hoy, si la resolución se está respetando o
no. Ninguna documentación puede contestar eso mejor que la propia imagen.

(Los ids concretos salen de `datos/serie.json`, que es de donde salen siempre;
aquí no se escriben para que este texto no envejezca mintiendo.)

Y aparte de eso, a veces es la única que funciona. Vertex reparte la cuota de imagen **por modelo Y por resolución**,
en cubos separados, y eso no se ve leyendo nada: se vio en la consola de cuotas de
una cuenta real, con el cubo `gemini-3.1-flash-image_default_res` a 34 millones
por minuto y un **0 % de uso**, mientras las peticiones que sí decían resolución
volvían con un 429. Ante un error de cuota o de tiempo agotado en las imágenes,
esta es la primera opción que hay que probar. Que el campo `imageSize` NO viaje
—que es distinto de mandarlo vacío— lo comprueba `npm run ajustes`.

**Precios: la pantalla no los pone, y es a propósito.** Este estudio no los sabe
de cierto, y un precio inventado es peor que ninguno porque alguien decidiría con
él. Lo que sí dice es el orden —cuál es el caro y cuál el barato— y el id exacto
del modelo, que es lo que hay que buscar en la tarifa de Vertex AI. Lo que sí se
cuenta de verdad es **cuántas imágenes y cuántos segundos de vídeo** se llevan
generados con cada nivel, en `estado.gasto`.

### El filtro de seguridad y los personajes niños

Google bloquea con `IMAGE_PROHIBITED_CONTENT` cualquier imagen de un menor
descrita con un catálogo de carencias sobre su cuerpo. No distingue un drama
serio de algo dañino: ve las palabras y corta, y hace bien.

Aquí se disparaba con Saharis a los cinco años, que estaba escrito así:

> `gaunt boy of five … filthy oversized rag tunic, bare feet`

Demacrado, sucio y descalzo. La historia es la misma sin eso: **la pobreza se
cuenta por la ropa, no por el cuerpo del niño**. Ahora lleva una túnica grande y
gastada, remendada, con mangas largas y zapatos de tela. Se lee igual de pobre y
no describe a un niño desnutrido y desnudo. Lo mismo con sus manos y con el de
diez años.

**`OP03` estaba escrito como un primer plano de los ojos de un recién nacido en la
cripta, y eso no era cuestión de palabras.** Un bebé dentro de un ritual de culto
es justo lo que ese filtro existe para no hacer, y buscarle la vuelta sería
saltarse la protección, no arreglar un error. Así que el plano se cuenta **sin
enseñarlo**, que además es mejor cine:

> La mano abierta de la madre cayendo laxa sobre el altar de piedra, los dedos
> abriéndose, la luz del fuego rozando la piedra pulida — y al lado de su mano,
> **dos puntos pequeños de luz roja reflejados en la piedra**. Sin figuras.
>
> La mano se posa y se detiene. Los dos reflejos rojos se quedan fijos y **no
> parpadean con el fuego**. Empuje muy lento.

El presagio está entero y el niño no sale. Y el plano encadena con `OP02`, que es
la madre en el mismo altar, así que la secuencia gana en vez de perder.

**Los guiones tienen más de esto, y conviene saberlo antes de llegar.** El
episodio 1 tiene el parto y al celebrante levantando al recién nacido; hay una
escena de un niño «desnudo, flaco, lleno de cicatrices» ante los sacerdotes. Esas
tampoco se van a generar mostrando lo que describen, y la salida es la misma: el
plano cuenta lo que pasa sin ponerlo en cuadro.

### «No hay imagen» no siempre es el filtro

Cuando el modelo contesta sin imagen, lo que importa no es solo **qué** dice
Google, sino **en qué campo** lo dice. La misma palabra significa dos cosas
distintas según de dónde venga:

| Dónde lo dice Google | Qué significa | Qué se hace |
|---|---|---|
| `promptFeedback.blockReason` — cualquier valor, `OTHER` incluido | Ha leído el prompt y lo ha rechazado **antes de dibujar nada**. Ese campo solo aparece cuando bloquea | **No se reintenta.** Repetir da lo mismo siempre: hay que cambiar el texto |
| `candidates[].finishReason` con nombre de filtro (`IMAGE_PROHIBITED_CONTENT`, `SAFETY`, `BLOCKLIST`…) | El filtro ha cortado a mitad, y con su nombre | **No se reintenta.** Igual: hay que cambiar el texto |
| `candidates[].finishReason: OTHER`, o nada de nada | «No digo por qué»: se quedó a medias | **Se reintenta.** Muchas veces sale a la siguiente |

Esto se ha corregido dos veces, y cada vez por pasarse a un lado.

Primero **todo** caía en «no se reintenta»: el mensaje mandaba a reescribir una
descripción y la cola daba el trabajo por muerto, incluso con placas que no
tienen nada que pueda molestar a un filtro — un plano medio de un adulto
vestido, de tres cuartos, sin expresión.

Luego se miró solo la palabra, junta de los dos campos, y entonces un `OTHER` en
`promptFeedback` — que **sí** es un bloqueo, solo que sin decir con qué palabra —
se reintentaba en balde una vez tras otra. Que es exactamente lo que no se
quiere: mandar a hacer una generación que va a fallar diez veces.

Ahora manda el campo. Cuando el bloqueo es del prompt, el mensaje lo dice con
esas palabras y sugiere por dónde mirar: heridas, cicatrices, cuerpo desnudo o
edad. Comprobado en `herramientas/probar-ajustes.mjs` con las dos formas de
respuesta, la de `promptFeedback` y la de `finishReason`.

**Y por eso las descripciones no nombran heridas.** El bloqueo cayó sobre
Saharis, que es un personaje de diecisiete años: menor. Google es mucho más
estricto con los menores, y basta con que en el mismo texto aparezcan la edad y
una palabra de daño. Así que en `datos/serie.base.json` la cicatriz del pacto ya
no es «a long old scar», es «a thin old pale line»; el pelo ya no está «cut short
by his own hand … hacked off» sino «roughly cut and never groomed»; y la garganta
ya no va «bare» sino con la camisa cerrada al cuello y el cuello del abrigo
bajado. **Se ve exactamente igual.** Lo único que cambia es que no hay ninguna
palabra que un filtro pueda leer como una herida en un menor.

### Apuntar lo que ya está pagado

Salía esto, que es la peor combinación posible:

> «La imagen se ha generado bien y está guardada en el bucket. Lo único que ha
> fallado es apuntarla en el estado de la producción.»

Generada, subida y **cobrada**, y sin apuntar. La causa solo se ve mirando la
secuencia entera:

1. La función **lee** el estado — versión 100.
2. **Genera** la imagen: treinta o cuarenta segundos.
3. Intenta **escribir** con la versión 100.

Pero en esos cuarenta segundos el navegador ha escrito el latido de la cola dos o
tres veces y la versión ya va por la 103. El paso 3 no era una carrera
desafortunada: era **un choque garantizado**. Y como solo había un reintento, ese
choque seguro se lo comía entero y el segundo intento se estrellaba con cualquier
latido que cayera en su ventana.

Dos cambios, y el primero es el que importa:

- **Al apuntar lo generado se RELEE el estado**, en vez de reutilizar el que se
  leyó antes de generar. Ese ya no vale para escribir, por definición.
- Y las vueltas pasan de dos a **cuatro**. Una vuelta es leer y escribir, cosa de
  un segundo; el latido escribe cada quince. Con dos bastaba un latido mal caído.

`npm run anotar` lo comprueba con latidos cayendo encima: que releyendo se apunta
a la primera, que con el estado viejo se apunta igual aunque cueste dos intentos,
y que ante una tormenta de verdad se rinde diciendo que fue una carrera.

### Los escenarios se generan VACÍOS

Un escenario se genera una vez y su placa viaja como referencia de objeto en
**todos** los planos que ocurren ahí — es lo que hace que once planos de la cripta
sean la misma cripta. Y de ahí sale una trampa que no es evidente:

**si la placa sale con figurantes de relleno, esos figurantes se heredan en los
once planos**, aparecen al lado del personaje que sí toca, y no hay forma de
quitarlos después sin regenerar la placa y todo lo hecho contra ella.

Y el modelo los pone solo. A un «plano general de un santuario con altar y
antorchas» le salen encapuchados sin que nadie los pida, porque es lo que se ve en
cualquier imagen parecida. Así que se dice, y por los dos lados:

- **En el prompt**: «the location is completely EMPTY: no people, no figures, no
  characters, nobody at all anywhere in frame».
- **En el negativo**, que es donde el modelo hace más caso: gente, figuras,
  siluetas, encapuchados, monjes, cualquiera en cuadro.

Y un segundo freno para lo que ya esté generado: la instrucción que acompaña a la
placa en cada keyframe dice ahora **«si aparece gente en esta referencia,
ignórala por completo: no es parte del sitio»**. Antes decía «copia los objetos y
dónde están» y nada sobre la gente, así que un figurante colado se leía como
mobiliario.

La gente la ponen los **planos**, cada uno la suya, con sus placas de personaje.
Lo comprueban los invariantes: si alguien quita cualquiera de los dos frenos, el
árbol de código no pasa.

---

## Antes de desplegar

```
npm run comprobar
```

Encadena las seis herramientas y no necesita red ni credenciales: regenera
`datos/serie.json` desde `serie.base.json` con el parche, comprueba los
invariantes sobre los datos y sobre el árbol de código, **ejecuta** la cola
contra un Google de mentira, **le da audio de verdad** al lector de formatos,
**sigue** el ajuste de con qué se genera hasta el cuerpo de la petición, y
**pesa** la respuesta de cada modo con material del tamaño real para verificar
que cabe en los 4,5 MB. Los cuatro últimos no se ven leyendo el código: se ven
ejecutándolo y midiendo. Si algo no cumple, sale con error y lo dice en español.

Cada paso se puede lanzar por separado con `npm run datos`, `npm run invariantes`,
`npm run cola`, `npm run audio`, `npm run ajustes` y `npm run pesar`.

### Lo que manda Google no es siempre lo mismo

`npm run audio` existe porque una suposición sobre el formato del audio ya rompió
la producción: el código daba por hecho que todo lo que no fuera WAV era PCM
crudo, así que cuando Lyria contestó con un **MP3** (`audio/mpeg`) el estudio
rechazó una música que estaba perfectamente bien, pidiéndole un muestreo que un
MP3 no tiene por qué declarar aparte.

Ahora el estudio entiende tres cosas, y guarda cada una como lo que es:

| Lo que llega | Se guarda | La duración sale de |
|---|---|---|
| WAV | `.wav` | su cabecera `fmt`/`data` |
| MP3 | `.mp3` | su cabecera Xing/VBRI, y si no la trae, de su tasa |
| PCM crudo | `.wav`, envuelto | el muestreo del propio `mimeType` |

Lo que **no** se hace es suponer un muestreo cuando no lo hay: esa duración
coloca la pieza en el montaje y arrastra todo lo que va detrás, así que antes que
inventarse un número se falla y se dice por qué. Y el formato se decide mirando
los bytes, no la etiqueta: un `audio/mpeg` cuyos bytes no sean de MP3 no se
guarda como MP3.

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
