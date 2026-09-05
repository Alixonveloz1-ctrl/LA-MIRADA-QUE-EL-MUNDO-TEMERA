# Poner el estudio en marcha

Guía completa, de cero a la primera imagen generada. Se hace **entera desde el
teléfono**: en ningún paso hace falta un ordenador. Lo que necesita consola se
hace en **Cloud Shell**, que es un terminal de Google que se abre en el navegador
del móvil (`shell.cloud.google.com`, o el icono `>_` arriba a la derecha en
`console.cloud.google.com`).

**Lo primero que hay que saber de Cloud Shell en el móvil:** el terminal **no
deja pegar**. Todo lo que hay que escribir en él en esta guía está pensado para
teclearse, y es corto. Cuando haya que meter un texto largo se usa el **Editor**
de Cloud Shell (el icono del lápiz, «Open Editor»), que es una página web normal
y ahí el pegado sí funciona.

Se tarda entre media hora y una hora la primera vez. El paso 5 se puede dejar
para más adelante: sin montador se genera todo, pero no se monta nada.

---

## 1. El proyecto de Google Cloud y las APIs

1. En el navegador del móvil, `console.cloud.google.com`. Se entra con la cuenta
   de Google que vaya a pagar esto.
2. Arriba, el selector de proyecto → **Proyecto nuevo**. Un nombre cualquiera,
   por ejemplo `la-mirada`. Se crea y **se selecciona**.
3. **Facturación.** Menú → *Facturación* → vincular una cuenta de facturación al
   proyecto. Sin esto, Vertex contesta que no, y el mensaje no menciona la
   facturación por ningún lado.
4. Habilitar las cinco APIs. Lo más rápido es Cloud Shell, una sola línea:

   ```
   gcloud services enable aiplatform.googleapis.com storage.googleapis.com texttospeech.googleapis.com speech.googleapis.com run.googleapis.com
   ```

   Si se prefiere no teclearla, se hacen una a una desde el buscador de la
   consola (*Vertex AI API*, *Cloud Storage API*, *Cloud Text-to-Speech API*,
   *Cloud Speech-to-Text API*, *Cloud Run Admin API*) pulsando **Habilitar** en
   cada una. Tarda un par de minutos en propagarse.

| API | Para qué |
|---|---|
| `aiplatform.googleapis.com` | Imagen (Gemini), vídeo (Veo), música (Lyria), voz (Gemini TTS) y el modelo de texto del desglose. |
| `storage.googleapis.com` | El bucket: estado, banco, keyframes, clips, audio, montajes. |
| `texttospeech.googleapis.com` | Listar las voces reales de la API, que es de donde salen los ids que se eligen escuchando. |
| `speech.googleapis.com` | Medir dónde entra y sale cada intervención dentro de un bloque de voz, para los subtítulos. |
| `run.googleapis.com` | El Job de ffmpeg que monta. |

---

## 2. La service account y sus permisos

Es la identidad con la que la función habla con Google. **No es tu cuenta**: no
hay login de usuario en ninguna parte del estudio.

1. Menú → *IAM y administración* → **Cuentas de servicio** → **Crear cuenta de
   servicio**. Nombre: `estudio`. Continuar.
2. En el paso de permisos, dale estos dos **a nivel de proyecto**:

   | Rol | Para qué |
   |---|---|
   | **Usuario de Vertex AI** (`roles/aiplatform.user`) | Llamar a los modelos de imagen, vídeo, música, voz y texto. |
   | **Consumidor de Service Usage** (`roles/serviceusage.serviceUsageConsumer`) | Text-to-Speech y Speech-to-Text no se cubren con el rol de Vertex: sin este, las voces y la alineación contestan un error de permisos. |

   Nada más. Ni editor, ni propietario: esta cuenta va a vivir en Vercel y no
   necesita poder borrar el proyecto.
3. **El permiso sobre el bucket se da en el paso 3**, cuando el bucket exista, y
   se da **sobre el bucket**, no sobre el proyecto. El de Cloud Run, en el
   paso 5.
4. Descargar la clave: entra en la cuenta de servicio recién creada → pestaña
   **Claves** → *Añadir clave* → *Crear clave nueva* → **JSON** → Crear. El
   archivo baja al teléfono.
5. Guárdalo donde lo puedas volver a abrir (en iPhone, la app *Archivos*; en
   Android, *Descargas*). En el paso 4 hay que **abrirlo, seleccionar todo y
   copiarlo**: su contenido entero es el valor de `GCP_SERVICE_ACCOUNT`.

Dentro de ese JSON van el `project_id`, el `client_email` y la `private_key`. El
estudio saca el project id de ahí y de ningún otro sitio, y el censor tacha las
tres cosas en cualquier respuesta antes de que salgan de la función.

---

## 3. El bucket, y el CORS

### Crear el bucket

Menú → *Cloud Storage* → **Buckets** → **Crear**.

- Nombre: el que sea, es global y único. Apúntalo: es `GCS_BUCKET`.
- Tipo de ubicación: **Region**, y la misma que vayas a poner en `GCP_LOCATION`
  (por defecto `us-central1`). Estar en la misma región que los modelos ahorra
  tiempo y tránsito.
- Clase: Standard.
- Control de acceso: **Uniforme**.
- **No** marques nada que lo haga público. Todo se ve por URL firmada de seis
  horas; el bucket no tiene por qué estar abierto a nadie.

### Dar permiso a la service account, sobre el bucket

Entra en el bucket → pestaña **Permisos** → **Conceder acceso**:

- Principal: el `client_email` de la service account
  (`estudio@…​.iam.gserviceaccount.com`, está dentro del JSON del paso 2).
- Rol: **Administrador de objetos de Storage**
  (`roles/storage.objectAdmin`).

Ese rol es exactamente lo que hace falta: leer, escribir, listar y borrar
objetos. No incluye crear ni borrar buckets, y así está bien.

### Aplicar el CORS

**Esto no es opcional y es el paso que más disgustos da si se salta.**

Para mandar un keyframe a Veo, el navegador tiene que **reducir el master a
1280 px en JPEG** antes de enviarlo: el PNG 2K son unos 6,8 MB, y en base64 unos
9,1 MB, así que no cabe en los 4,5 MB de la petición. Para reducirlo tiene que
**leer** la imagen, no solo enseñarla. Y ahí está la trampa: un `<img>` de otro
origen se enseña sin CORS sin ningún problema, pero **un canvas que lee esa
imagen queda contaminado** y el navegador se niega a devolver los píxeles.

El síntoma es de los peores que hay: la imagen se ve perfectamente en pantalla,
y al pulsar «generar clip» falla con un `SecurityError` de lienzo contaminado, o
con un `fetch` que revienta sin código y sin cuerpo. **Ningún mensaje del
navegador menciona CORS.** La aplicación lo traduce y te dice que al bucket le
falta CORS, pero conviene no llegar ahí.

El JSON, exacto:

```json
[
  {
    "origin": ["https://TU-APP.vercel.app"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Length", "Content-Range", "Range", "ETag", "Date"],
    "maxAgeSeconds": 3600
  }
]
```

Cambia `TU-APP.vercel.app` por el dominio real que te dé Vercel en el paso 4 (por
eso este trozo se suele hacer justo después). Si además usas un dominio propio o
quieres que funcione en los despliegues de vista previa, añade cada origen a la
lista: son cadenas exactas, con `https://` y sin barra final; los comodines no
valen.

Cómo aplicarlo desde el móvil, en Cloud Shell:

1. Abre `shell.cloud.google.com` y espera a que arranque.
2. Pulsa el lápiz (**Open Editor**). Se abre un editor de texto normal.
3. *File → New File*, llámalo `cors.json`, **pega** ahí el JSON de arriba (en el
   editor sí se puede pegar) y guarda con *File → Save*.
4. Vuelve al terminal (**Open Terminal**) y teclea una de estas dos, según lo que
   tenga instalado tu Cloud Shell:

   ```
   gcloud storage buckets update gs://TU-BUCKET --cors-file=cors.json
   ```

   ```
   gsutil cors set cors.json gs://TU-BUCKET
   ```

   Las dos hacen lo mismo; `gcloud storage` es la forma actual y `gsutil` la
   antigua, que sigue funcionando.
5. Comprobar que ha quedado puesto:

   ```
   gcloud storage buckets describe gs://TU-BUCKET --format="default(cors_config)"
   ```

Si no quieres usar el editor, el mismo archivo se puede teclear de una vez:

```
printf '[{"origin":["https://TU-APP.vercel.app"],"method":["GET","HEAD"],"responseHeader":["Content-Type","Content-Length","Content-Range","Range","ETag","Date"],"maxAgeSeconds":3600}]' > cors.json
```

**El CORS no se puede comprobar desde el servidor.** Desde la función el bucket
se lee y se escribe igual con CORS que sin él; quien se estrella es el navegador.
Por eso la pantalla de Salud deja un PNG de un píxel en el bucket, te da su URL
firmada y **hace el fetch desde el propio navegador**. Si eso sale verde, el CORS
está bien de verdad.

---

## 4. Vercel

### Importar el repositorio

1. En el móvil, `vercel.com` → entrar con GitHub.
2. **Add New → Project** → *Import Git Repository* → este repositorio.
3. Framework Preset: **Other**. Root Directory: la raíz. **No hay comando de
   compilación ni carpeta de salida**: la aplicación son módulos ES nativos y el
   `index.html` se sirve tal cual.

### Las variables de entorno

Se ponen en el propio formulario de importación (*Environment Variables*), o
después en *Settings → Environment Variables*. Márcalas para **Production**, y
también para *Preview* si vas a usar despliegues de vista previa.

| Variable | Contenido | ¿Obligatoria? |
|---|---|---|
| `GCP_SERVICE_ACCOUNT` | El JSON completo de la service account del paso 2. | **Sí** |
| `GCS_BUCKET` | El nombre del bucket, sin `gs://` y sin barras. | **Sí** |
| `GCS_PREFIX` | Carpeta dentro del bucket donde vive este proyecto. Vacío = raíz del bucket. | No |
| `GCP_LOCATION` | Región por defecto. Si no está, `us-central1`. | No |
| `IMAGE_MODEL` | Sustituye el modelo de imagen sin tocar código. | No |
| `VEO_MODEL` | Sustituye el modelo de vídeo. | No |
| `TTS_MODEL` | Sustituye el modelo de voz. | No |
| `MUSIC_MODEL` | Sustituye el modelo de música. | No |
| `STT_MODEL` | Sustituye el modelo de alineación. | No |
| `TEXTO_MODEL` | Sustituye el modelo de texto del desglose. | No |
| `MONTAJE_JOB` | Nombre del Job de Cloud Run del montador. Sin él se genera todo pero no se monta. | No (sí para montar) |
| `MONTAJE_REGION` | Región del Job. Si no está, la misma que `GCP_LOCATION`. | No |
| `CONCURRENCIA` | Generaciones simultáneas como máximo. Si no está, `3`. | No |
| `CLAVE_ACCESO` | El pestillo de la puerta. Vacío = la función queda abierta. Lee la advertencia del final. | No, **pero** |

Las de modelo (`IMAGE_MODEL` y compañía) están para que puedas cambiar un id sin
tocar el código si tu cuenta no tiene acceso a alguno. Vacías, mandan los ids de
`datos/serie.json`, que es donde viven. **Nunca se sustituye un modelo por otro
en silencio**: si uno falla, verás el error de Google tal cual y decides tú.

Además de las de la tabla, el estudio reconoce estas tres, que aparecen en fases
posteriores:

| Variable | Contenido |
|---|---|
| `MONTAJE_URL` | Dirección completa del Job del montador. La imprime el instalador del paso 5 y manda sobre `MONTAJE_JOB` + `MONTAJE_REGION`. |
| `MONTAJE_KEY` | La clave que solo comparten la función y el montador. También sale del instalador. |
| `GCP_PROJECT_NUMBER` | El número del proyecto, para que el censor lo tache por su nombre. Sin ella el censor lo caza igual por el patrón `projects/<dígitos>`. |

**`GCP_SERVICE_ACCOUNT` admite las dos formas.** O el JSON tal cual, desde la
primera llave hasta la última, o ese mismo JSON codificado en base64. Lo normal
es pegarlo tal cual: abre el archivo descargado, selecciona todo, copia y pega en
la casilla. Si el panel te parte las líneas de la `private_key` y el JSON deja de
ser válido, usa el base64: en Cloud Shell, con el archivo subido,
`base64 -w0 clave.json` y copias esa única línea larga. La función acepta las dos
y te dice con palabras si lo que hay dentro no parsea.

### Desplegar

**Deploy**. Cuando termine, apunta el dominio (`https://algo.vercel.app`) y
**vuelve al paso 3 a poner ese dominio en el CORS del bucket**, si no lo habías
hecho ya.

> **La trampa de Vercel, y es de las que más tiempo hacen perder.**
> Vercel **no aplica una variable nueva a un despliegue ya construido.** Si
> añades o cambias una variable, hay que ir a **Deployments → los tres puntos del
> último → Redeploy**. Si no, la pantalla de Salud seguirá diciendo que falta
> algo que ya está puesto, y buscarás el fallo donde no está. La propia pantalla
> de Salud te lo recuerda junto a cada variable que falte.

---

## 5. El montador en Cloud Run

Esto se hace **una vez**, a mano, y se puede dejar para cuando toque montar: sin
él se genera todo el material, pero no hay pieza terminada.

Va como **Cloud Run Job, nunca como servicio**. Un servicio se queda sin CPU a
mitad del trabajo —Google le apaga el procesador cuando ya ha contestado a la
petición— y el vídeo se corta por la mitad sin un error claro. Un job siempre
tiene CPU y admite tiempos largos, que es lo que hace falta para un episodio de
22 minutos.

En Cloud Shell, dos líneas cortas y nada más:

```
git clone https://github.com/<usuario>/<repo>.git
```

```
bash <repo>/montador/instalar.sh
```

El instalador enseña el proyecto activo y espera un Enter (es el único momento en
que te puedes dar cuenta de que estás en la cuenta equivocada), detecta el bucket
—si hay varios, escribes **un número**, no un nombre—, habilita lo que falte,
genera la clave del montador, construye y despliega el Job, da los permisos de
bucket que hacen falta e **imprime al final, en un recuadro, las variables con su
nombre y su valor exactos** para llevarlas a Vercel. Tarda entre cinco y ocho
minutos: no cierres la ventana.

**Los detalles completos, en [`montador/README.md`](../montador/README.md).**

Dos cosas que el instalador hace y conviene entender, porque explican fallos que
si no parecen magia negra:

- **El montador no se ejecuta con la service account de Vercel.** Se ejecuta con
  la cuenta de compute del proyecto,
  `<NÚMERO_DE_PROYECTO>-compute@developer.gserviceaccount.com`. Si esa cuenta no
  tiene permiso propio sobre el bucket, el montaje falla **al escribir el
  resultado, después de haber hecho todo el trabajo**.
- **La service account de Vercel necesita Cloud Run Invoker**
  (`roles/run.invoker`) **sobre el job** para poder lanzarlo. Con eso basta:
  Cloud Run Developer (`roles/run.developer`) solo hace falta si quieres además
  desplegar o modificar el job desde esa cuenta, y no lo necesitas, porque el job
  lo despliega el instalador con tu propio usuario de Cloud Shell.

Cuando termine: copia `MONTAJE_URL` y `MONTAJE_KEY` (o `MONTAJE_JOB` y
`MONTAJE_REGION`, según lo que imprima) a las variables de Vercel, y **Redeploy**.

---

## 6. Salud, antes de gastar nada

Abre la dirección de Vercel en el móvil y entra en **Salud**. Es la primera
pantalla por algo: contesta de una vez qué tiene permitido esta cuenta, y lo
comprueba de verdad, no lo supone.

Qué mira:

- **Quién es esta instalación** — correo, proyecto, bucket y prefijo, ya
  enmascarados. Sirve para darte cuenta de que estás apuntando al bucket
  equivocado antes de llenar el bueno de basura.
- **Lectura y escritura del bucket** — escribe un objeto de prueba y lo vuelve a
  leer.
- **El CORS** — deja un PNG de un píxel y lo lee **desde el navegador**. Es la
  única comprobación honesta de CORS que existe.
- **Cada modelo** — una llamada mínima a cada nivel de imagen, a cada nivel de
  Veo, a Lyria, al modelo de texto y a Gemini TTS en `ja-JP`, con su región y la
  variable de entorno que lo sustituye al lado. Si uno falla, verás el error de
  Google tal cual.
- **El montador** — si hay job configurado.
- **Los pesos medidos** — cuánto ha pesado como máximo la respuesta de cada modo,
  contra el tope de 4,5 MB. Sale de la cabecera `X-Peso-Respuesta`, que trae el
  tamaño real del cuerpo ya serializado. No es una estimación.

**Hasta que esto esté en verde, no se sigue.** Un fallo aquí cuesta cero; el
mismo fallo en el plano 300 cuesta dinero y una tarde.

Y antes de desplegar, desde el propio repositorio, `npm run comprobar` hace lo
que se puede comprobar sin red: regenera los datos, verifica los invariantes y
pesa las respuestas de cada modo con material del tamaño real.

---

## 7. El orden de trabajo

No es una recomendación: cada paso depende de que el anterior esté aprobado, y la
interfaz lo impide si no lo está.

1. **Anclas del banco.** Pantalla *Banco*. El ancla de cada personaje se genera
   solo con texto, sin referencias. Se mira y se aprueba. **Empieza por aquí y
   por Saharis y la madre**: los pómulos de la madre tienen que verse en el ancla
   de Saharis, que es el único rasgo heredado y lo que hace que el corte entre
   flashback y presente signifique algo.
2. **El resto del banco de personajes.** Cada placa se genera con el ancla de su
   personaje adjunta como referencia. Las edades encadenan todas al ancla de
   linaje, y las placas de detalle (manos, nuca, espalda) encadenan a la edad que
   les toca. Si cambias un ancla, todas sus placas quedan por reprobar: es a
   propósito.
3. **Escenarios.** Igual, pero sin cadena: cada escenario es una placa única, y
   su placa viaja como referencia de objeto en todos los planos que ocurren ahí.
   Sin esto, once planos de «la cripta» son once criptas distintas.
4. **Voces.** Pantalla *Voces*. Se escucha a cada candidata diciendo la frase más
   difícil de ese personaje, con su intención puesta. Se elige, se fija, y no se
   vuelve a tocar. Hazlo antes de generar audio: cambiar de voz después obliga a
   rehacer todo lo grabado.
5. **Keyframes.** Pantalla *Tomas*. Un keyframe malo cuesta céntimos. Míralos y
   aprueba solo los que valgan.
6. **Clips.** Un clip malo cuesta un euro, y por eso el botón de generar vídeo
   **no existe** hasta que hay keyframe aprobado. Se lanzan, se consultan, se
   miran los intentos y se elige uno.
7. **Audio.** Pantalla *Audio*. Música de Lyria y bloques de voz, cada uno
   escuchado entero antes de entrar en el montaje. Nada suena en un montaje sin
   haber sonado antes aquí.
8. **Montaje.** Pantalla *Montaje*. Para el teaser, un solo trabajo. Para un
   episodio, por capas: escena, acto y episodio, y cada capa se guarda, así que
   si falla la tercera no se rehacen las dos primeras. La descarga va por URL
   firmada del bucket: un episodio pesa uno o dos gigas y no pasa por ninguna
   función.

Para un episodio, antes del punto 5 va el **desglose**: pantalla *Desglose*,
eliges el episodio y se convierte en planos, una llamada de texto por escena. No
hay nada que aprobar ahí y es correcto que no lo haya: lo que se juzga es la
imagen, no la lista.

---

## Qué hacer cuando algo falla

Todos los fallos se explican en pantalla, en español y con palabras. Aquí están
los cuatro que **parecen otra cosa** de la que son.

### Un 404 de un modelo Gemini 3.x que parece falta de acceso

**Síntoma.** Salud, o una generación, contesta un 404 en `gemini-3-pro-image`,
`gemini-3.1-flash-image`, `gemini-3.1-flash-tts` o `gemini-3-pro`. Como es un
404, parece que tu cuenta no tiene ese modelo habilitado, y te pones a pedir
accesos.

**Qué pasa de verdad.** Los Gemini 3.x **solo se sirven desde el endpoint
`global`**. Pedirlos a una región concreta devuelve exactamente ese 404. No es
falta de acceso: es la dirección.

**Qué hacer.** Por defecto no pasa, porque `datos/serie.json` ya los declara en
`global`. Pasa si has puesto un id 3.x en `IMAGE_MODEL`, `TTS_MODEL` o
`TEXTO_MODEL` esperando que use tu `GCP_LOCATION`. Vuelve a dejar la variable
vacía, o pon un modelo que sí se sirva por región. El mensaje del estudio ya te
lo dice en ese 404 concreto, precisamente porque es el error que más engaña.

### Un 413 que parece un tiempo agotado

**Síntoma.** Una operación se queda colgada un rato y falla. Da la sensación de
que ha tardado demasiado, así que lo intentas otra vez. Y otra.

**Qué pasa de verdad.** El cuerpo no cabe en los 4,5 MB de la plataforma. Casi
siempre es una imagen: un PNG 2K son ~6,8 MB, y en base64 ~9,1 MB.

**Qué hacer.** Nada de reintentar: **un 413 no se reintenta nunca**, y el estudio
no lo reintenta por su cuenta. El mensaje te dice que no cabe y **cuánto
pesaba**. Si sale al lanzar un clip, casi seguro es que el master no se ha podido
reducir a 1280 px, y eso te lleva otra vez al CORS del paso 3. Mira la sección de
pesos de Salud: ahí está medido, modo por modo, cuánto pesa de verdad la
respuesta de cada uno.

### La cuota de Vertex, que contesta errores que parecen permisos

**Síntoma.** Con la cola llena, empiezan a caer errores que hablan de recursos
agotados o de que no se puede acceder al modelo. Parecen permisos, y te pones a
revisar roles de IAM que están bien.

**Qué pasa de verdad.** Vertex tiene cuotas por minuto y por región. Saturarlas
devuelve errores cuya redacción se parece muchísimo a la de un permiso denegado.

**Qué hacer.** Baja `CONCURRENCIA` en Vercel (de `3` a `1` o `2`) y **Redeploy**
— acuérdate de que sin Redeploy la variable nueva no se aplica. También se ve y
se ajusta desde la pantalla de *Cola*. Si es persistente, pide ampliación de
cuota en *IAM y administración → Cuotas*. Un buen indicio de que es cuota y no
permisos: falla de forma intermitente y con la cola llena, mientras que un
permiso falla siempre y desde la primera llamada.

### Una operación de Veo que se queda colgada

**Síntoma.** Un plano lleva mucho rato en «generando» y no pasa nada.

**Qué pasa de verdad.** Generar vídeo tarda más que los 60 segundos que dura una
función, así que no es una llamada: es una **operación** que se lanza y se
consulta. La función lleva su propio límite de 45 segundos por debajo del de la
plataforma, y cuando lo agota contesta «todavía no» en vez de morirse sin
excepción. Sin ese límite propio la función se apagaría en silencio y el plano se
quedaría «generando» para siempre.

**Qué hacer.** Nada, casi siempre: el nombre de la operación queda guardado en el
bucket **antes** de que la respuesta llegue al navegador, así que ninguna queda
huérfana. Cierra la aplicación si quieres; al volver a abrirla, lo primero que
hace, **antes de lanzar nada nuevo**, es consultar todas las operaciones
pendientes. Si Veo ha contestado un error, lo verás tal cual en la pantalla de
*Cola*. Y si detienes la cola, lo que ya está en curso se sigue consultando a
propósito: abandonar una operación lanzada sería dejarla huérfana y pagada.

### Y dos más, rápidas

- **Las imágenes no se ven, o el clip falla con un error de lienzo.** Es el CORS
  del bucket (paso 3). Comprueba que el origen del CORS es exactamente el dominio
  de Vercel que estás usando, con `https://` y sin barra final. Salud lo prueba
  de verdad desde el navegador.
- **Salud dice que falta una variable que acabas de poner.** Vercel no la ha
  aplicado todavía: *Deployments → los tres puntos del último → Redeploy*.

---

## Una advertencia honesta antes de terminar

**La función no lleva login, por diseño.** No hay cuentas, no hay usuarios, no
hay sesión: el plan lo pide así y la herramienta se construyó así. Pero esa
función gasta el dinero de tu proyecto de Google Cloud, y su dirección es
pública. **Cualquiera que dé con la URL puede generar vídeo con tu tarjeta.**

Hay dos formas de cerrar eso, y con poner **una** basta:

- **`CLAVE_ACCESO`** en Vercel. Es un pestillo, no un login: si la variable
  existe, la función exige una cabecera con ese valor y contesta 401 con una
  explicación si no está. El navegador te la pide una vez y la guarda. Pon algo
  largo y aleatorio, no una palabra.
- **La protección de despliegue de Vercel** (*Settings → Deployment Protection*),
  que pone la aplicación entera detrás de tu cuenta de Vercel.

Si no pones ninguna de las dos, no pasa nada raro y todo funciona: simplemente
tienes una máquina de gastar dinero abierta a Internet. Decidido a sabiendas es
una decisión; por olvido es una factura.
