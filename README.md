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

   **[▶ Abrir en Cloud Shell e instalar](https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2FAlixonveloz1-ctrl%2FLA-MIRADA-QUE-EL-MUNDO-TEMERA&cloudshell_git_branch=main&cloudshell_tutorial=despliegue%2Ftutorial.md)**

   Clona el repositorio y abre un tutorial con botones que meten cada comando en
   el terminal. Habilita las APIs, crea o detecta el bucket, le aplica el CORS,
   crea la cuenta de servicio con sus permisos y su clave, y despliega el
   montador. Lo que queda a mano es Vercel, y está en
   **[docs/despliegue.md](docs/despliegue.md)**.

   Lo que Google necesita no se dicta como comandos: vive en `despliegue/`, en
   archivos que el instalador lee.

   **Para volver a desplegar solo el montador** —hay que hacerlo cada vez que ese
   contenedor aprende algo nuevo, porque se despliega a mano y siempre va por
   detrás del repositorio— hay su propio tutorial, también con botones:

   **[▶ Volver a desplegar el montador](https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2FAlixonveloz1-ctrl%2FLA-MIRADA-QUE-EL-MUNDO-TEMERA&cloudshell_git_branch=main&cloudshell_tutorial=despliegue%2Fmontador.md)**

   **Y si el panel del tutorial no carga** —el editor de Cloud Shell avisa de
   que los navegadores del móvil no están soportados—, en el terminal, que se
   abre ya dentro de la carpeta clonada:

   ```
   ./m
   ```

   Tres caracteres. Ese archivo existe por eso y solo por eso: aquí solo hay un
   móvil, el terminal no deja pegar, y todo lo que haya que ejecutar se teclea
   con el pulgar. Trae lo último y despliega. No pregunta nada, no toca ni el
   bucket ni la cuenta, y lee del propio job el bucket y la clave que ya tiene
   puestos. Que la clave salga de ahí y no se genere de nuevo es lo importante:
   una clave nueva invalidaría la `MONTAJE_KEY` de Vercel y el montaje empezaría
   a fallar por una razón que no se parece en nada a la verdadera.

   **Ningún enlace de este repositorio lleva dentro un id de proyecto ni una
   cuenta.** Cloud Shell pregunta en cuál instalar; el que hace falta añadirle
   `?authuser=` o `&project=` para su cuenta, se lo añade y no lo escribe aquí:
   esto es público.
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
| `despliegue/` | Lo que Google Cloud necesita, como archivos y no como comandos que alguien dicte: `apis.txt`, `cors.json`, `permisos.txt` y los dos tutoriales de Cloud Shell —el de instalar y el de volver a desplegar el montador—. `instalar.sh` los lee. |

En la raíz, `index.html` (lo único que se sirve), `instalar.sh` (todo lo de Google
Cloud en un comando), `m` (tres caracteres para volver a desplegar el montador
desde el móvil), `package.json`, `vercel.json` y este archivo.

---

## Las piezas

Una pieza es cualquier cosa que se produce de principio a fin. La herramienta no
distingue entre un teaser de 24 planos y un episodio de 400.

| Pieza | Planos | Duración | Se genera |
|---|---|---|---|
| `teaser` | 24 | 78 s | Una vez. Ya venía desglosada: se puede generar el primer día. |
| `opening` | 27 | 90 s | **Una vez para toda la serie.** Se pega como capa en los doce episodios. |
| `ending` | 15 | 90 s | **Una vez para toda la serie.** Igual. |
| `archivo` | 56 | — | **Una vez para toda la serie.** No es una película: es una biblioteca. |
| `epNN` | ~400 | 22 min | Por episodio, con el desglose. Se añaden al lado. |

El montaje de un episodio queda `opening + actos + ending`, todo pegado como capa
ya montada. Regenerar el opening en cada episodio serían 504 planos tirados y doce
openings ligeramente distintos, que es lo que hace que una serie parezca hecha a
trozos.

### El archivo: 56 planos en vez de 289

La cripta sale en **24 escenas repartidas por 8 episodios**. Los túneles, en **46
repartidas por 11**. Si cada escena paga su propio plano de ambiente, son 289
keyframes y 289 clips para enseñar veintiocho sitios.

El archivo son **56 planos de ambiente que se generan una vez y se reutilizan en
los doce episodios**, igual que el opening, el ending y el banco de música. Son
**233 planos que no se pagan**, y el espectador no lo nota, porque un plano de
ambiente no cuenta nada: dice dónde estamos y se quita. Es exactamente lo que
hace el anime de verdad.

**Dos por sitio, y a propósito dos cosas distintas:**

- **El general vacío** — el sitio entero, sin nadie, para abrir una escena.
- **El detalle que se mueve solo** — humo, lluvia, una llama, agua, polvo en un
  haz de luz. Es lo que hace que el sitio parezca vivo sin que haya nadie.

Dos planos iguales se notarían al repetirse. Un general y un detalle no, porque
el ojo no los compara.

**Qué NO puede entrar en el archivo**, y esto es la regla entera: nada con un
personaje dentro, nada que pase una sola vez, y nada que cuente algo. Si en un
plano de archivo ocurre algo, al repetirlo en el episodio 9 vuelve a ocurrir. Lo
comprueba `npm run invariantes`, que rechaza un plano de archivo con referencias
de personaje, con encadenado o sin decir cuándo se usa, y avisa —con la palabra
señalada— cuando el texto nombra a alguien sin negarlo.

La excepción son **tres sitios cuyo sentido ES la gente**: la ciudad trabajando,
la cola de carros en la puerta y el campamento. Vacíos contarían lo contrario de
lo que son. Ahí se admiten figurantes a lo lejos, el plano se marca
`figurantes_lejanos`, y a cambio se le exige que prometa `no faces visible`: un
figurante reconocible en un plano que sale en cuatro episodios sería un personaje
sin ficha.

**El banco se elige, no se acumula.** Al principio se pintaba SIEMPRE debajo de
la pieza, en su propia sección, con la idea de que se viera que no era de nadie.
En el teléfono se lee al revés: eliges el teaser, ves sus dos pistas, y debajo
aparecen dieciocho más — y lo que parece es que la música de la temporada se ha
comido la de la pieza. El título de la sección no salva eso: para cuando se llega
a él ya se ha desplazado media pantalla.

Ahora el banco es **una opción más del mismo selector**, al lado del teaser, el
opening y el ending. O una pieza, o el banco; nunca las dos cosas a la vez. Y
mirando el banco, la pantalla dice con cuántas pistas cuenta la pieza que tenías
puesta, para que no haya que ir a comprobarlo. La elección **no** se guarda en
`pieza_activa` del estado: esa la comparten Tomas y Montaje, y el banco no es una
pieza para ellas.

Cada pieza de música dice de quién es en su campo `pieza`; las del banco llevan
`temporada`. `npm run banco` dibuja la pantalla y comprueba que con el teaser
salen dos pistas y **ni una** del banco, y que el selector trae la opción.

**El archivo vive dentro de `piezas`** para que toda la maquinaria de Tomas, la
cola y el estado le sirva sin tocar una línea. El precio es que las pantallas que
no deben ofrecerlo tienen que decirlo: **Montaje** no lo ofrece —montarlo daría
un rollo de cuatro minutos que nadie va a ver, pagado entero— y **Audio** tampoco
—no tiene ni música ni diálogo—. `npm run banco` comprueba las dos cosas, porque
es un fallo que no se ve mirando.

Se escriben con `node herramientas/escribir-archivo.mjs`: son 56 planos de doce
campos, y once de esos doce son siempre lo mismo. A mano son 672 casillas donde
equivocarse en una sola tira una comprobación que no dice dónde.

#### Cómo se usa un plano de archivo

El ahorro no lo hace el archivo: lo hace el **desglose**, que es quien decide si
un plano se encarga nuevo o se coge del archivo. Por eso el archivo se montó
**antes** de desglosar ningún episodio — hecho después, el dinero ya estaría
gastado.

Al desglosar una escena, el modelo recibe la lista de planos de archivo **de ese
escenario y de esa luz**, con lo que se ve, lo que se mueve y para qué está
pensado cada uno. Se le dice que los use siempre que el plano que iba a proponer
sea sitio y nada más, y que no los use cuando tenga que verse alguien o pasar
algo.

Cuando los usa, el plano que devuelve es **un puntero, no una descripción**:

```json
{ "id": "12-1", "de_archivo": "arch-cripta-a", "imagen": "", "video": "",
  "refs": [], "boca_visible": null, "encadena_con": null, "dur": 3 }
```

Y a partir de ahí, todo el estudio lee ese plano del archivo:

- **Tomas** no le pone botones. Dice, con palabras, que ese plano se genera en el
  archivo y que rehacerlo ahí lo cambia en todos los sitios donde sale a la vez.
- **Montaje** pone en el manifiesto la ruta del clip del archivo. Es el mismo
  material, no una copia: copiarlo obligaría a pagarlo otra vez.
- **El desglose** no le crea entrada propia en el estado, para que no aparezca en
  Tomas como si le faltara todo.

La regla de dónde vive el material de un plano está en **un solo sitio**,
`app/planos.js`, porque la necesitan tres pantallas que no se hablan entre ellas.
Escrita tres veces, el día que cambiara cambiaría en dos, y el fallo sería un
episodio montado con un hueco. Eso no se ve leyendo el código: se ve viendo el
vídeo.

**Se puede usar menos de lo que dura, nunca más.** Coger dos segundos de un plano
de cuatro es montar y no cuesta nada; pedir ocho de uno de cuatro sería encargar
un tramo que no existe. Lo rechazan la comprobación del desglose y
`npm run invariantes`, cada una en su momento.

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

**El lecho y el canto van separados a propósito.** Con la voz metida dentro de la
misma pista no se puede ni mover ni bajar; separados, el canto se coloca en su
segundo exacto y se mezcla a su propio nivel.

El modelo es **Lyria 3 Pro**, que llega a 184 segundos por pieza. La duración no
es un parámetro: se pide con palabras dentro del encargo, y lo que manda después
es la duración REAL medida del archivo. Lo que pase de 184 s se parte en varias
piezas y se une en el montaje con fundidos de 2,5 s — los cortos suenan a tajo.

### La música de la temporada

El opening y el ending son dos canciones. **La música que suena dentro de los
episodios es otra cosa, y hasta ahora no existía.** Son 289 escenas.

No se compone por escena. Un anime de verdad tiene una **biblioteca de temas**
—una función cada uno— y los repite toda la temporada. Repetirlos no es pobreza:
es exactamente lo que hace que doce episodios suenen a una sola serie en vez de a
doce encargos distintos. Así que el banco se genera **una vez**, igual que el
opening y el ending, y no se rehace por episodio nunca.

Son **dieciocho piezas, treinta y dos minutos**, escritas en `musica.piezas` de
`datos/serie.json` con `"temporada": true`, y salen en su propia sección de la
pantalla de Audio, que no cambia al cambiar de pieza.

No están inventadas: salen de leer los doce guiones escena por escena y contar
qué se repite de verdad.

| Qué son | Cuántas | Por qué |
|---|---|---|
| Un lecho por esquema de luz | 3 | Lo que más vuelve en la temporada no es una emoción, es una habitación: CRIPTA 39 escenas, NOBLE 88, BARRIO 162 |
| Música de salón, tocada dentro de la escena | 1 | Se paga sola: si la sala ya tiene música, la partitura puede callarse mientras Saharis destruye a un hombre con un elogio |
| El tambor seco: pensar, ejecutar, acercarse | 3 | El motor de doce episodios es un hombre calculando |
| La melodía de la madre, transformada | 5 | Rota, al aire, contaminada, enterrada, y en negativo. Es el hilo de la serie |
| Voz femenina sola | 2 | La hermana en el lago y la niña del valle. La voz es el recurso más caro: solo hay tres sitios donde vale, y el tercero ya existe |
| Piezas de gesto | 4 | Romperse, reconocer, contenerse, y el altar vacío |

**El Celebrante no tiene tema propio: tiene el de ella, mal afinado y a tempo de
oficina.** Eso cuenta el episodio 7 entero sin una línea de guion.

Y hay una decimonovena pieza que es la más usada de todas: **el silencio**. Está
escrita con todas sus reglas en `musica.banco.silencio`, y la primera es que no
suena nada debajo de la frase que decide la escena.

**Cada pieza de música dice ahora de quién es.** Antes se adivinaba por el
principio del id —`teaser-lecho` era del teaser porque empezaba por `teaser-`—, y
eso funcionaba solo mientras la única pieza fuera el teaser. Ahora cada entrada
lleva su campo `pieza`, las del banco llevan `temporada`, y `npm run banco`
comprueba que ninguna se quede sin pantalla donde salir: una pieza escrita que no
aparece en ningún sitio no tiene botón que la genere, y eso no se nota mirando.

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

## Las nueve pantallas

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
6. **Audio** — la música de cada pieza, **el banco de la temporada** —las
   dieciocho piezas que suenan dentro de los episodios, en su propia sección que
   no cambia al cambiar de pieza— y las voces de cada bloque, con reproductor:
   nada entra en un montaje sin haber sonado antes aquí. Y el marcador de letra,
   para poner los subtítulos de las canciones oyéndolas.
7. **Cola** — qué se está generando ahora, qué falló y por qué, el botón de
   detener y el contador de gasto.
8. **Montaje** — montar por escenas, actos y episodio, y reproducir o descargar
   el resultado por URL firmada.
9. **Difusión** — lo que hace falta para PUBLICAR, que no es lo mismo que lo que
   hace falta para producir: la ficha con la que se sube cada pieza, el zip con
   el vídeo y esa ficha dentro, los reels de treinta segundos en vertical
   armados solos, y los pósters y miniaturas en 9:16 o 16:9.

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

#### El fallo que espera a que estés pagando

La pantalla de Cola reventaba entera —`Can't find variable: operacion`— y solo
cuando había un clip de Veo generándose.

En JavaScript, `{ pieza, toma, operacion }` significa `operacion: operacion`. Si
esa variable no existe, no queda un campo vacío: **es un error que tumba la
función entera**. Y la sintaxis es perfecta, así que no lo ve ningún
comprobador de sintaxis.

Venía de un cambio correcto: el nombre de la operación de Veo dejó de viajar al
navegador porque lleva el project id dentro. Se quitó la variable y **se quedó el
campo**. Ahí siguió, escrito, esperando a que alguien lanzara un vídeo — que es
justo cuando esa pantalla hace falta, y con el clip ya pagado.

Dos cosas para que no vuelva:

- `npm run invariantes` recoge todos los nombres que declara cada archivo y
  rechaza cualquier campo en forma corta que nombre uno que no está.
- `npm run pantalla` **ejecuta** la pantalla de Cola contra un estado con un
  vídeo en vuelo. Ese estado no lo construía nunca nadie, y por eso el fallo
  podía vivir ahí meses: un estado vacío no prueba nada, porque casi todas las
  funciones de una pantalla salen por la puerta de «no hay nada que enseñar».

Las dos se probaron contra el código de antes, y las dos lo cazan. La primera
versión de la comprobación de invariantes **no** lo cazaba —se daba por buena a
sí misma— y eso se vio ejecutándola contra el commit anterior, no leyéndola.

#### Un clip pagado no se tira por un descuadre de contabilidad

Un clip de Veo se lanza y se consulta minutos después, y la operación vive
colgada del modelo que la creó: se pregunta a ese modelo o Google contesta que no
existe.

El estudio decidía a qué modelo preguntar por lo que llevaba escrito el plano o
por lo que estuviera elegido en Salud. Cuando eso no coincidía con el modelo real
—porque el nivel se tocó mientras el clip se generaba, o porque el estado se
perdió y solo quedó el apunte del bucket, **que no llevaba el nivel**— se plantaba
y daba el clip por perdido. Terminado, pagado, y con la puerta cerrada.

Y era innecesario. **El nombre de la operación dice con qué modelo y en qué región
se creó**: viene dentro, escrito por Google. Si nuestra idea no coincide con el
nombre, quien se equivoca es nuestra idea — y preguntar no cuesta nada ni genera
nada, así que hacerle caso no tiene ningún riesgo.

Ahora se busca ese modelo entre los tres niveles de la serie y se pregunta ahí,
diciendo con cuál se lanzó de verdad. Solo se falla cuando el modelo del nombre
no es **ninguno** de los tres, que ya no es un descuadre nuestro. Y el apunte del
bucket —el que existe para que no se pierda un clip— lleva ahora también el
nivel, porque un salvavidas incompleto no es un salvavidas. `npm run veo` lo
ejecuta.

#### Y el aviso que no se callaba

El mismo aviso, cerrado y vuelto a salir, cerrado y vuelto a salir. Eran dos
defectos encima del mismo sitio:

- **Solo se comparaba con el último.** Un fallo que salta con cada latido de la
  cola —cada diez segundos— se repintaba entero cada vez.
- **«Entendido» borraba esa memoria.** Cerrarlo era pedirle que volviera.

Y el que más se repetía era precisamente el que el navegador **se niega a
identificar**, que por definición no viene de aquí. O sea: una tarjeta roja
tapando el plano que estabas mirando, con un botón de recargar que no iba a
arreglar nada, por algo que este código no puede tocar.

Ahora un fallo repetido es **una** tarjeta con un contador («ha vuelto a pasar 12
veces»), cerrarla lo silencia para el resto de la sesión, y los que el navegador
no atribuye a esta página se pintan como **nota** y sin botón de recargar. Los
que sí son del estudio siguen gritando en rojo, que es lo que tienen que hacer.
`npm run fallos` lo ejecuta con un DOM de mentira y repite el fallo doce veces
para verlo.

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

#### Y ahora se comprueba antes de pagarlo

Esto se descubrió tres veces, y las tres pagando la llamada y leyendo el error
rojo en el móvil:

| Qué se pidió | Qué pasó |
|---|---|
| La placa de Saharis a los cinco años: *gaunt, filthy, bare feet* | Bloqueada. Y es un **ancla**: sin ella no se genera ni un plano suyo en toda la serie |
| `saharis-barrio`, con «diecisiete años» y una cicatriz en la palma | Bloqueada, y sin decir con qué palabra |
| El plano C2 del teaser: un recién nacido con la cara **salpicada de sangre** | Bloqueado. Google no va a generar eso nunca |

La regla estaba escrita. Lo que faltaba era comprobarla. `npm run invariantes`
saca ahora la lista de personajes menores **de su propia ficha** —no de una
lista escrita a mano, que se queda vieja en cuanto se añade un personaje— y
rechaza cualquier plano o placa que junte a uno de ellos con una palabra de
daño: sangre, cicatriz, herida, desnudo, hambriento, sucio, golpeado.

Un plano que no se puede generar es peor que uno mal escrito. El mal escrito
sale feo y se rehace; este no sale, y la primera noticia es un error rojo con la
llamada ya pagada.

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

**La música sigue la misma regla.** Lyria contestaba «OTHER» y el estudio decía
«repetir da el mismo resultado», que con una pieza de tres minutos es
sencillamente falso: ahí «OTHER» es «no digo por qué» y muchas veces sale a la
siguiente. Ahora la cola la reintenta sola, y solo se planta cuando el bloqueo
viene en `promptFeedback` o el filtro se nombra a sí mismo. `npm run audio` lo
comprueba con las dos formas de respuesta.

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

## Difusión: lo que hace falta para publicar

Las otras ocho pantallas sirven para hacer la serie. Esta sirve para sacarla.

### La ficha

Cada pieza montada se descarga con su ficha al lado: **el título** con el que se
sube, **la descripción** y **las etiquetas**. No se escriben a mano, y no es solo
por comodidad: la descripción no puede contar el final ni nombrar a quien todavía
no ha aparecido, y eso, escrito con prisa en el teclado de un móvil doce veces,
se falla.

Se pide, se lee y, si no gusta, se vuelve a pedir. **El botón de aprobarla está
apagado hasta que está delante**, igual que en Audio no se aprueba una pista sin
oírla: una descripción que cuenta el final se publica una vez y ya no se recoge.

### Las etiquetas no se inventan

Salen de una lista escrita en `difusion.etiquetas.lista` de `datos/serie.json` y
el modelo solo **elige** de ahí. Las que se invente se tiran, una a una, y si
quedan menos de ocho la ficha se rechaza y se vuelve a pedir.

Dos razones, y las dos cuestan dinero si se ignoran:

- Una etiqueta inventada **no la busca nadie**, y puede estar cogida por otra cosa.
- Son **generales de animé** a propósito — `#anime`, `#seinen`, `#darkanime`— y
  ninguna es de esta serie. Una etiqueta propia solo la busca quien ya conoce el
  animé, y todavía no lo conoce nadie.

Tres de la lista (`#aianimation`, `#animacion`, `#cortoanimado`) dicen que está
hecho con animación generada. Se ponen o se quitan según cómo se presente la
pieza: eso lo decide quien publica, no el modelo.

### El paquete

Un botón por pieza: **el vídeo y la ficha juntos en un zip**. Lo escribe el
montador, que es donde está el archivo — un episodio pesa entre 1 y 2 GB y no
puede pasar por la función, que tiene 4,5 MB de tope.

El zip va **sin comprimir** a propósito: dentro hay un MP4, que ya está
comprimido, y volver a comprimirlo tarda minutos de máquina y no quita ni un
megabyte. El zip aquí no sirve para que ocupe menos; sirve para que no haya que
acordarse de descargar dos cosas.

Está escrito a mano, byte a byte, porque este proyecto no tiene ni una
dependencia de npm y Node no trae ninguno. Eso tiene una manera muy fea de
fallar: un zip mal escrito **no da ningún error al escribirlo**, lo da al abrirlo,
en el teléfono, después de haber descargado un gigabyte y medio. Por eso
`npm run zip` escribe uno de verdad y lo abre con el `unzip` del sistema —un
programa que no sabe nada de este proyecto y no perdona nada—, comprueba los CRC
y que lo que sale es byte a byte lo que entró. Y lleva ZIP64 para cuando un
episodio pase de 4 GB, que es donde el formato original se queda corto.

**El aviso antes de pulsar** dice lo que pesa, porque en un teléfono hay que
descargarlo Y dejar libre otro tanto para abrirlo.

### Los pósters y las miniaturas

El **póster oficial** de la serie y una **miniatura por episodio**: trece piezas,
escritas en `difusion.posters.piezas` de `datos/serie.json`.

**No son fotogramas del capítulo.** Se generan aquí, con el mismo modelo de
imagen que las placas y con las **placas ya aprobadas** de los personajes delante
como referencia, para que sea la misma cara, la misma luz y el mismo estilo. Un
fotograma cualquiera no compone, y una miniatura tiene que leerse del tamaño de
una uña.

#### Un póster es una composición, no un retrato con el título encima

La primera versión de estos encargos pedía, con estas palabras, *«un joven de
unos diecisiete de pie, solo, mirando al espectador, centrado, con espacio vacío
alrededor»*. Sale exactamente lo que dice: un retrato de catálogo con el título
flotando encima. Y las doce miniaturas compartían **el mismo encargo genérico**,
así que eran doce imágenes intercambiables.

Los trece están reescritos como key visuals, cada miniatura leyendo su propio
guion para encontrar la imagen que vende **ese** episodio. Lo que un encargo tiene
que traer, y lo que se comprueba:

- **Contraste de escala** — la figura pequeña contra un mundo enorme, o una cara
  muy cerca con la escena viviendo detrás. Nunca «media figura, tamaño catálogo».
- **Capas de profundidad** — algo en primer plano desenfocado que enmarca, el
  sujeto en el medio, el mundo al fondo.
- **Gente en la sombra** — siluetas encapuchadas, una cara a media luz, una figura
  que se aleja. El vacío poblado es lo que hace que un póster cuente algo.
- **Una diagonal**, una sola fuente de luz haciendo trabajo dramático, y
  **atmósfera con materia**: ceniza, lluvia, humo, aliento en el frío.
- **Una banda vacía reservada** para el título, sobre lo más oscuro, donde no
  compita con ninguna cara. Cada pieza dice dónde está la suya.

`npm run difusion` comprueba que los trece son trece textos distintos, que
ninguno empieza igual que otro y que ninguno baja de 80 palabras: un encargo
corto no compone.

#### El sitio también es una referencia

Este era el fallo de fondo, y se veía en la imagen: el póster salía precioso pero
la cripta **no era la cripta**, el ídolo no era el ídolo y los encapuchados no
eran los acólitos. Solo viajaba una referencia, la cara del protagonista.

Un póster lleva ahora **dos clases de referencia**, y son cupos distintos que no
compiten entre sí:

| Campo | Va como | Qué aporta |
|---|---|---|
| `escenarios` | referencia de **objeto** | El sitio: la arquitectura, los materiales, los objetos y dónde están. |
| `refs` | referencia de **personaje** | La cara: el mismo rostro, el mismo pelo, la misma edad. |

La regla que ya gobernaba los keyframes vale igual aquí, y por el mismo motivo
—*«sin la placa, diez planos de la cripta son diez criptas distintas»*—, solo que
en un póster pesa más: es la única imagen que va a ver alguien que no ha visto
nada.

Y hay algo que solo hace la placa del sitio: **trae sus objetos dentro**. La de
`cripta` lleva escrito, en sus propias palabras, el ídolo colosal de muchos brazos
con cabeza de calavera de cabra, el altar de piedra oscura, los nichos con
calaveras y los brazaletes de antorcha. Adjuntarla es la única forma de que salgan
**esos** y no unos parecidos.

Las trece piezas dicen dónde ocurren: la cripta el póster oficial y los episodios
8 y 11, los túneles el 3 y el 12, el archivo de la casa el 7 y el 9, la orilla el
5 y el 6, y cada uno de los demás el suyo.

#### Toda cara que se referencia necesita sitio y escala

Esto salió mirando el póster generado: en el centro apareció un enmascarado
prominente, de frente a cámara, que no era el celebrante de la serie.

La causa era una contradicción que yo mismo había escrito. Adjuntar la placa de
alguien es decirle al modelo **«copia esta identidad»**. Pero el encargo lo
nombraba solo como *«una mejilla de máscara»* dentro de *«una masa de espaldas
encapuchadas»*: sin escala y sin sitio. La instrucción de referencia dice
literalmente «redibújalo al tamaño que esta toma requiera», y la toma no requería
ninguno. El modelo resolvió la contradicción **inventándose una figura suya** y
poniéndola delante.

La regla queda escrita en `difusion.posters.regla_escala`:

- Si un personaje tiene una placa adjunta, el encargo tiene que decir **dónde
  está y de qué tamaño**. El póster ahora lo coloca en el labio del charco de
  antorchas, al doble de la figura pequeña, de tres cuartos y vuelto hacia la
  escalera, con «no está mirándonos y no está en primer plano».
- Si un personaje **no** tiene un sitio de verdad en el cuadro, no se le adjunta
  su placa: se queda como bulto encapuchado anónimo.
- Y si lo que hace falta es solo su objeto —la máscara vacía en el suelo del
  episodio 11—, hay que escribir que **la persona no está en la imagen**, o el
  modelo la dibuja.

#### Preferencia por las anclas, no obligación

Una referencia de personaje existe para llevar la **identidad**, y eso es lo que
un ancla es; la pose y el encuadre los describe el encargo. Así que casi todas
son anclas.

Pero no es una regla dura, porque a veces el diseño **es** lo que se ve: el
póster oficial y el episodio 11 llevan `celebrante-mascara` y no
`celebrante-ancla`, porque esa máscara de cuero es su identidad visual en la
cripta y el ancla es el mismo hombre sin ella. Una máscara no se hereda de una
cara.

Eso tiene un precio y los invariantes lo **avisan** en vez de tumbarlo: una placa
que no es ancla obliga a aprobarla a ella *y* al ancla de su personaje, dos
imágenes antes de que el botón se encienda. La pantalla dice cuáles faltan, por su
nombre.

#### Los pósters se generan con el modelo bueno, y con su propio selector

`difusion.posters.nivel` es `calidad`, y **no mira lo que esté elegido en Salud**.

Son **trece imágenes en toda la serie**, y son las únicas que va a ver alguien que
no ha visto nada: ahorrar ahí no ahorra nada. Y hay una razón técnica encima:
`gemini-3-pro-image` es el que admite más imágenes de referencia (6 de objeto + 5
de personaje), que es justo lo que hace falta para llevar el sitio **y** las caras
en la misma llamada.

Pero encima de las tarjetas hay un **selector de modelo**, y no es un adorno.

Modelo de calidad + 2K + tres referencias delante es **la petición más pesada que
hace este estudio entero**. Cuando Google contesta un **502 con una página HTML de
error** —no con un error de la API—, lo que ha fallado está *delante* del modelo:
un balanceador que se ha cansado de esperar. Eso no lo arregla insistir.

Sin el selector, la única salida sería irse a Salud a cambiar el ajuste de **todo
el estudio** para poder generar un póster. Con él se baja un nivel, se genera y se
vuelve a subir: dos toques, y las demás pantallas siguen con lo suyo.

Y si falla en los tres niveles, el problema no es la carga: es el modelo. **Salud
→ Comprobar los modelos** llama a cada nivel y dice cuál contesta y cuál no. Para
eso existe esa pantalla.

El botón de generar **no se enciende** mientras falte una de esas placas por
aprobar, y dice cuál falta. Lo comprueba también la función, que es quien manda:
encolar un trabajo que ya se sabe que va a fallar cuesta diez minutos de espera
para nada.

#### El formato se elige antes, no se recorta después

Un selector arriba de la sección, **9:16 o 16:9**, y lo que se elija es lo que se
genera y lo que se mira debajo. Uno solo para las trece tarjetas: en un teléfono,
trece selectores iguales son trece formas de equivocarse.

`9:16` es lo vertical —el póster de toda la vida, y lo que piden las plataformas
de móvil—; `16:9` es lo que pide una miniatura de YouTube. **Cada uno se genera
con su proporción desde el principio**: recortar uno para sacar el otro deja la
cabeza fuera del cuadro.

Por eso cada formato es **su propia imagen**, con sus intentos y su aprobación.
En el estado viven separados, con la pieza y el formato en la clave
(`poster-oficial/9-16`, `poster-oficial/16-9`), y en el bucket en carpetas
distintas. Generar el horizontal **nunca** pisa el vertical que ya estaba
aprobado. Eso lo comprueba `npm run difusion` ejecutándolo, porque es justo la
clase de fallo que no avisa: se perdería una imagen ya pagada sin un solo error
en pantalla.

Y **el marco de la tarjeta toma la forma de lo que enseña**. Toda la aplicación
mira en 16:9, que es la proporción de la serie, y un póster vertical dentro de un
hueco apaisado se recortaba por arriba y por abajo — justo la banda donde va el
título. En una pantalla donde aprobar es *mirar*, esconder lo que hay que juzgar
es el peor fallo posible. Ahora la tarjeta acepta su proporción y enseña la
imagen **entera**: dos franjas negras al lado son mejores que un trozo escondido.

#### El título va dentro de la imagen

`LA MIRADA QUE EL MUNDO TEMERÁ` se le pide al modelo **escrito dentro del
póster**, letra por letra, en el propio prompt.

Es una decisión de quien paga, tomada a sabiendas y escrita aquí para que no
parezca un descuido: **los modelos de imagen escriben mal las tildes y las eñes**,
así que puede salir con letras inventadas. Se mira y se rehace hasta que salga;
por eso el botón de «Otro intento» está siempre a mano y **ningún intento se
borra**, que el bueno puede ser el tercero.

Se cambia en un sitio: `difusion.posters.titulo_en_la_imagen` a `false` en
`datos/serie.json`, y entonces el prompt le dice al modelo que **deje vacía la
banda que ya tiene reservada**. No un «sin texto» a secas: los encargos hablan de
su banda de título, así que una negación suelta al final los contradiría y esa
pelea la resolvería el modelo a su gusto.

**Y el negativo dejó de pelearse con el título.** El negativo de la serie lleva
`text` dentro, porque en un keyframe o en un clip cualquier letra que aparezca es
basura. Pero en un póster el título va DENTRO de la imagen y se pide con todas las
letras: mandar las dos cosas en la misma llamada es pedir una cosa y prohibirla a
la vez.

Ese fallo **no da ningún error**. El modelo devuelve un título flojo, torcido o
pegado como una pegatina, se cobra la generación igual, y pasa por «así escriben
los modelos» sin que nadie sospeche de la lista de negativos. Ahora, cuando el
título va dentro, se quitan del negativo las palabras que hablan de texto **y nada
más**: la marca de agua y la firma se quedan, porque esas sobran siempre, y el
resto —paleta shonen, render 3D, ojos brillantes— es lo que hace que el póster se
parezca a la serie. `npm run difusion` compone el prompt de verdad y lo comprueba.

**El formato se le dice como reencuadre, no como composición.** La frase que
acompaña al 9:16 o al 16:9 dice «enmarca esto como imagen alta / ancha,
manteniendo la composición de arriba», y no «pon el sujeto a un lado». La
composición la manda el encargo, que es quien sabe dónde está la banda del título;
una frase genérica pelearía con él.

Un invariante comprueba que el título que se pide dentro del póster es el mismo
que `meta.titulo_es`, que los formatos escritos son proporciones que el modelo
acepta, que cada póster referencia placas que existen y que **hay una miniatura
por cada guion escrito**: si algún día hay un episodio trece, el que se quede sin
la suya se subiría sin portada.

### Los reels

Un reel por pieza: **treinta segundos en vertical, armados solos**.

**No genera nada.** Ni una llamada a un modelo, ni un céntimo de Vertex. Coge los
clips que YA están elegidos y la música que YA está aprobada y los pone uno
detrás de otro. Lo único que gasta es el rato de máquina del montador, igual que
cualquier otro montaje. Por eso su botón puede estar apagado con todo bien
escrito: lo que falta no es una decisión, es material. Y por eso se rehace sin
pensarlo en cuanto hay un clip más.

**Barras negras, a propósito.** Salen a 1080 × 1920. Todo el material está rodado
en 16:9, así que el montador escala cada plano hasta que quepa entero y rellena
lo que sobra de negro. Recortar a vertical dejaría media cara fuera de cuadro en
casi todos los planos, y eso es peor que una franja.

**Cómo se corta**, y las cuatro reglas están en `difusion.reels` de
`datos/serie.json` para cambiarlas ahí y no en el código:

1. **El orden es el del guion.** En los datos no hay ninguna nota que diga qué
   plano es «el bueno», así que inventarse un orden sería inventarse un criterio.
   En el orden del guion, el reel del teaser es el teaser contado corto.
2. **Los planos de menos de 1,2 s se saltan.** Por debajo de eso un plano
   parpadea y se lee como un fallo de reproducción, no como montaje.
3. **Los de más de 3,5 s se cortan, y se cortan por el final**: se coge su
   principio, que es donde está lo que se quería contar. En medio minuto caben
   diez o doce planos; con cuatro de ocho segundos no hay reel, hay un vídeo
   lento.
4. **Aterriza exactamente en los treinta.** Cuando del ajuste sobra un pico —queda
   un segundo y ya no cabe ni el plano más corto que se acepta—, ese pico se
   reparte estirando planos **desde el último hacia atrás**, hasta donde llegue el
   material de cada clip. Un reel de veintinueve segundos no es «casi treinta»:
   es un vídeo que se corta antes de tiempo, y se nota.

   Y **solo si el reel se llenó**. Si lo que se acabaron fueron los clips, el
   hueco no es un pico: es que no hay material. Entonces el reel sale corto y lo
   dice, en vez de estirar tres planos hasta el medio minuto y entregar tres
   planos lentísimos.

**Sin voz y sin subtítulos.** Con el diálogo en japonés no se entiende en el móvil
de nadie, y con el diálogo en español un reel de treinta segundos cuenta el
capítulo entero. Va la música, desde su segundo cero, recortada a lo que dure el
reel y sin agacharse: agacharse es dejarle sitio a una voz que aquí no hay.

**La capa con la que se le encarga al montador es `pieza`**, y eso no es un
descuido: un reel *es* una capa de planos con su audio y sin capas ya montadas
debajo. Decirlo así hace que funcione con **el montador que ya está desplegado**.
Una capa nueva no daría un error al encolarla: daría un trabajo que falla en la
nube diez minutos después y que obliga a volver a desplegar el montador desde el
móvil. Un invariante comprueba que la capa que usa `app/reel.js` está en la lista
que conocen tanto la función como `montador/montador.mjs`.

**Y el corte se comprueba ejecutándolo.** Un reel mal cortado no da ningún error:
da un vídeo, con un parpadeo o con tres segundos de negro al final, y eso solo se
ve mirándolo, después de esperar los minutos del montador. `npm run reel` corta
reels contra estados de mentira y comprueba que los planos van pegados, que
ninguno queda por debajo del mínimo, que el total no se pasa, que con poco
material sale corto en vez de estirado — y le pasa el manifiesto al **mismo
validador que usa la función en producción**. Esa última es la que importa: es
enterarse aquí en un segundo, o enterarse en la nube dentro de diez minutos.

---

## Antes de desplegar

```
npm run comprobar
```

Encadena las quince herramientas y no necesita red ni credenciales: regenera
`datos/serie.json` desde `serie.base.json` con el parche, comprueba los
invariantes sobre los datos y sobre el árbol de código, **ejecuta** la cola
contra un Google de mentira, **le da audio de verdad** al lector de formatos,
**sigue** el ajuste de con qué se genera hasta el cuerpo de la petición,
**frena** contra un reloj de mentira, **apunta** lo generado con latidos cayendo
encima, comprueba que **ninguna pieza de música se quede sin pantalla donde
salir**, **recupera** un clip lanzado con otro nivel de Veo, **ejecuta** la pantalla de
Cola con un vídeo en vuelo, **repite** un fallo doce veces para ver que el aviso
no se apila, **escribe un zip y lo abre con el `unzip` del sistema**, **tira** las
etiquetas que se inventa el modelo, **corta un reel de treinta segundos y le pasa
el manifiesto al mismo validador que usa la función en producción**, y **pesa** la
respuesta de cada modo con material del tamaño real para
verificar que cabe en los 4,5 MB. Casi ninguno se ve leyendo el código: se ven
ejecutándolo y midiendo. Si algo no cumple, sale con error y lo dice en español.

Cada paso se puede lanzar por separado con `npm run datos`, `npm run invariantes`,
`npm run cola`, `npm run audio`, `npm run ajustes`, `npm run freno`,
`npm run anotar`, `npm run banco`, `npm run veo`, `npm run pantalla`,
`npm run fallos`, `npm run zip`, `npm run difusion`, `npm run reel` y
`npm run pesar`. Y
`npm run archivo` reescribe los 56 planos de ambiente desde su tabla.

### Un 403 son dos averías distintas que se ven igual

Un 403 de Google puede ser una de estas dos, y se arreglan en sitios distintos:

- **Los papeles de la cuenta**: a la service account le falta un rol.
- **Las APIs del proyecto**: esa API no está encendida, o la facturación no lo
  está.

El mensaje mandaba a revisar **las dos**. La mitad de las veces, eso es mandar a
revisar la que estaba bien: una tarde en la consola de Google mirando permisos
perfectos.

Y no hace falta adivinar, porque **Google lo dice**. Dentro de su respuesta viene
un campo `reason`, y ahí pone:

| `reason` | Qué es de verdad | Dónde se arregla |
|---|---|---|
| `IAM_PERMISSION_DENIED` | A la cuenta le falta un rol | `despliegue/permisos.txt` |
| `SERVICE_DISABLED` | La API está apagada | `despliegue/apis.txt` |
| `CONSUMER_INVALID` | Este proyecto no puede usar esa API | `despliegue/apis.txt`, o la facturación |
| `BILLING_DISABLED` | La facturación está desactivada | La consola de Google Cloud |

Ese dato se leía y se tiraba. Ahora decide la frase.

`CONSUMER_INVALID` merece frase propia porque es el más confuso: se lee como «no
tienes permiso» y significa «este proyecto no puede usar esta API», que casi
siempre es que **nunca se encendió**. Se distingue en un segundo mirando si otra
API del mismo proyecto responde: **si las imágenes se generan y el montaje no, la
cuenta está bien y lo que falta es el interruptor.**

Y si Google contesta un `reason` que no conocemos, no se inventa un diagnóstico:
se dice lo que hay y se manda a leer, palabra por palabra, lo que ha contestado.
`npm run fallos` lo comprueba con las cinco respuestas.

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
