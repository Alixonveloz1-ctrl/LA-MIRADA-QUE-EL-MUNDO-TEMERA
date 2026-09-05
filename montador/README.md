# El montador

El que pega los planos. Un trabajo de Cloud Run con ffmpeg dentro que recibe la
ruta de una **hoja de montaje** y devuelve un vídeo en el bucket.

No conoce ningún archivo por su nombre. Ni uno. Todo lo que usa —los clips, las
pistas de audio, los subtítulos, dónde dejar el resultado— llega escrito en el
manifiesto, que son datos. Por eso este contenedor se instala **una vez** y no
hay que volver a tocarlo cuando la serie crece: si algún día hubiera que
redesplegarlo para añadir un material nuevo, el diseño estaría mal.

Y cuando algo falla, lo escribe con palabras, en español, en
`montaje/{trabajo}/queja.txt` **dentro del bucket**, antes de salir. La
aplicación lo lee de ahí y lo enseña en la pantalla de Montaje. Un código de
salida no es un mensaje de error, y aquí nadie va a mirar los registros de la
nube desde el móvil.

---

## Instalarlo

Se hace desde **Cloud Shell**, el terminal que sale dentro de la consola de
Google Cloud. Se abre en el móvil: consola → el icono `>_` de arriba a la
derecha.

Cloud Shell **no deja pegar desde el móvil**, así que la instalación cabe en dos
líneas que se pueden teclear:

```
git clone https://github.com/<usuario>/<repo>.git
```

```
bash <repo>/montador/instalar.sh
```

Eso es todo. `instalar.sh` enseña el proyecto activo y espera un Enter —es el
único momento de darse cuenta de que estás en la cuenta equivocada—, detecta el
bucket, habilita las APIs que falten, genera la clave del montador, construye,
despliega, da los permisos e **imprime al final, en un recuadro, las variables
con su nombre y su valor exactos** para llevarlas a Vercel.

**Tarda entre cinco y ocho minutos.** No cierres la ventana: la mayor parte es
la construcción de la imagen, que va en el servidor pero se sigue desde ahí.

Cuando termine, esas variables se copian en Vercel (Settings → Environment
Variables) y **hay que hacer un Redeploy**: Vercel no aplica una variable nueva a
un despliegue ya construido. Deployments → los tres puntos del último →
Redeploy. Sin eso, la pantalla de Salud seguirá diciendo que falta algo que ya
está puesto y se busca el fallo donde no está.

---

## Instalarlo a mano, si el instalador no está o falla

Cinco pasos. Cámbiale `<bucket>` y `<region>`; el proyecto es el que tengas
activo (`gcloud config get-value project` lo dice).

**1. Las APIs.**

```
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com
```

**2. La clave del montador.** Un secreto que solo comparten el endpoint y él:

```
openssl rand -hex 24
```

Apúntala. Va a hacer falta dos veces: aquí abajo como `MONTAJE_CLAVE` y en
Vercel como `MONTAJE_KEY`. Son la misma clave con dos nombres a propósito: la de
la imagen es la buena y la de Vercel es la que se presenta.

**3. Construir y desplegar. Trabajo, nunca servicio.** Desde dentro de la carpeta
del repositorio clonado (`cd <repo>`), porque `--source montador` es esta misma
carpeta y de ella sale el `Dockerfile`:

```
gcloud run jobs deploy montador --source montador --region <region> --memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 0 --set-env-vars MONTAJE_CLAVE=<la clave>
```

- **Job y no servicio**, y esto es una trampa cara: a un *servicio* de Cloud Run
  Google le quita el procesador cuando cree que ya ha contestado, y el vídeo sale
  cortado por la mitad sin ningún error claro. Un trabajo siempre tiene CPU.
- `--max-retries 0` a propósito: un montaje que falla no mejora repitiéndose
  solo, y repetirlo cuesta dinero.
- `--task-timeout 3600` es una hora. Para el teaser sobra; para un episodio
  entero, ver más abajo.

**4. Permisos sobre el bucket, que es lo que más caro sale olvidar.**

El montador **no** se ejecuta con la service account de Vercel. Se ejecuta con la
cuenta de compute del proyecto. Si esa cuenta no tiene permiso propio sobre el
bucket, el montaje se hace **entero** y se pierde justo al guardarlo.

```
NUM=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
```

```
gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:$NUM-compute@developer.gserviceaccount.com --role=roles/storage.objectAdmin
```

**5. Que Vercel pueda encargarle trabajo.** Con el correo de la service account
que usa la aplicación:

```
gcloud run jobs add-iam-policy-binding montador --region <region> --member=serviceAccount:<correo de la cuenta de Vercel> --role=roles/run.invoker
```

---

## Las variables

### Las que recibe el montador en cada encargo

Se las pasa el endpoint (`api/_lib/montaje.js`) al lanzar el trabajo. No hay más,
y ninguna está escrita en el código.

| Variable | Qué es | Si falta |
|---|---|---|
| `MANIFIESTO` | la ruta lógica de la hoja de montaje, `montaje/{trabajo}/manifiesto.json` | no monta y lo dice |
| `GCS_BUCKET` | el bucket, sin `gs://` | no monta y lo dice |
| `GCS_PREFIX` | la carpeta del proyecto dentro del bucket; vacía es válida | trabaja en la raíz del bucket |
| `MONTAJE_KEY` | la clave que presenta quien encarga el trabajo | si el montador tiene `MONTAJE_CLAVE`, no monta |

### Las que se le graban a la imagen al desplegarla

| Variable | Qué es | Por defecto |
|---|---|---|
| `MONTAJE_CLAVE` | la clave buena, contra la que se compara `MONTAJE_KEY` | sin poner: el pestillo queda abierto y monta lo que le manden |
| `DIRECTORIO_TRABAJO` | dónde descarga y trabaja | `/tmp/montaje` |

`MONTAJE_CLAVE` y `MONTAJE_KEY` llevan nombres distintos a propósito: la de la
imagen no se puede llamar igual que la que viaja en el encargo, porque el encargo
la pisaría al lanzarse y la comparación no comprobaría nada.

### Las que hay que poner en Vercel

| Variable | Qué es |
|---|---|
| `MONTAJE_JOB` | el nombre del trabajo (`montador`, si no le has puesto otro) |
| `MONTAJE_REGION` | su región; si se deja sin poner, se usa la de `GCP_LOCATION` |
| `MONTAJE_KEY` | la misma clave que `MONTAJE_CLAVE` |
| `MONTAJE_URL` | opcional. La dirección entera del trabajo, si prefieres darla escrita |

`MONTAJE_URL`, si se usa, tiene esta forma exacta y acaba en el nombre del
trabajo:

```
https://<region>-run.googleapis.com/v2/projects/<proyecto>/locations/<region>/jobs/<trabajo>
```

Si acaba en `.run.app`, eso es un **servicio**, no un trabajo, y no vale.

**Y después de tocar cualquiera de estas: Redeploy en Vercel.**

---

## Memoria, tiempo y el tamaño de la pieza

Lo que hay que saber antes de montar algo largo: en Cloud Run **`/tmp` es
memoria**. Lo que el montador descarga y lo que va escribiendo ocupa RAM, no
disco.

| Qué se monta | Cuánto ocupa mientras trabaja | Qué pedir |
|---|---|---|
| El teaser (24 planos, 78 s) | unos cientos de megas | `--memory 2Gi --cpu 2` |
| Una escena de un episodio | parecido | lo mismo |
| Un acto (concatena escenas) | lo que pesen las escenas juntas | `--memory 4Gi` |
| Un episodio entero (1-2 GB) | lo que pesen los actos, más la salida | `--memory 8Gi --task-timeout 7200` |

Se cambia sin volver a construir nada:

```
gcloud run jobs update montador --region <region> --memory 8Gi --task-timeout 7200
```

El montador ayuda en lo que puede: borra cada clip en cuanto lo ha acabado, y
las capas que solo se concatenan se pegan **sin recodificar**, así que montar un
episodio a partir de sus actos son segundos y casi nada de memoria.

Si aun así no cabe, la salida limpia es montar un volumen del bucket en el
contenedor y apuntar ahí `DIRECTORIO_TRABAJO`, que entonces ya no es memoria:

```
gcloud run jobs update montador --region <region> --add-volume=name=faena,type=cloud-storage,bucket=<bucket> --add-volume-mount=volume=faena,mount-path=/faena --set-env-vars DIRECTORIO_TRABAJO=/faena/tmp,MONTAJE_CLAVE=<la clave>
```

---

## Probarlo a mano

Desde Cloud Shell, con un manifiesto que ya esté escrito en el bucket:

```
gcloud run jobs update montador --region <region> --set-env-vars MONTAJE_CLAVE=<la clave>,GCS_BUCKET=<bucket>,GCS_PREFIX=<prefijo>,MANIFIESTO=montaje/teaser-3/manifiesto.json,MONTAJE_KEY=<la clave>
```

```
gcloud run jobs execute montador --region <region> --wait
```

Con `--wait` espera a que termine y dice si ha ido bien. Si ha ido mal, lo que
hay que leer no es el código de salida: es

```
gcloud storage cat gs://<bucket>/<prefijo>/montaje/teaser-3/queja.txt
```

que está escrito en español y dice qué ha pasado, en qué paso estaba y qué dijo
ffmpeg por lo bajo.

---

## Qué hace por dentro, en orden

1. Pide un token al servidor de metadatos de la máquina. **No hay ninguna clave
   dentro de la imagen**: la credencial es la de la cuenta con la que corre.
2. Lee el manifiesto y lo comprueba entero antes de gastar un segundo de
   máquina: rutas, tramos, huecos y solapes de la línea de tiempo, y que no se
   cuele japonés en nada que se vaya a quemar en la imagen.
3. **Cada plano por separado**: se descarga, se recorta por `desde`/`hasta`, se
   le aplica la cadena de acabado —con el paso de dos si ese plano lo lleva, y
   sin él si va a veinticuatro limpios, como en un anime de verdad— y se guarda
   ya terminado. El original se borra al momento.
4. Se pegan todos con el demuxer `concat`.
5. **El audio**: cada pista se recorta, se remuestrea a 48 kHz —el TTS viene a 24
   y la música a otro muestreo— y se coloca en su segundo. La música y el
   ambiente se agachan bajo cada línea de voz con una envolvente calculada desde
   los tramos de voz del manifiesto; los tramos de `silencios` bajan todo a cero;
   y al final `loudnorm` mide y aplica **una ganancia constante**, que iguala
   volumen y brillo entre bloques grabados en llamadas distintas sin tocar el
   timbre.
6. **Los subtítulos y la cartela** se queman al final, sobre la imagen ya
   acabada, para que el grano y la viñeta no se les coman los bordes. En español
   y solo en español: en pantalla no hay japonés en ningún momento, el japonés
   únicamente se oye.
7. Sube el resultado al bucket por trozos, para que un corte de red a los mil
   ochocientos megas no obligue a montar el episodio otra vez.

Las capas `acto` y `episodio` no rehacen nada de lo de abajo: concatenan lo ya
montado y, como mucho, le ponen su música encima.

---

## Cuando algo va mal

Todo, sin excepción, acaba escrito en `montaje/{trabajo}/queja.txt` **antes** de
que el proceso salga: los fallos previstos, los que no lo eran, y hasta que
Cloud Run mate el trabajo por tiempo. La aplicación lo enseña tal cual en la
pantalla de Montaje.

Los tres que salen de verdad:

- **«no tiene permiso para escribir … en el bucket»** — es el paso 4 de la
  instalación a mano. La cuenta de compute, no la de Vercel.
- **«lo han parado desde fuera (SIGTERM)»** — se acabó el `--task-timeout`.
  Súbelo, o monta por capas más pequeñas.
- **«ffmpeg se ha parado en seco»** — casi siempre memoria. Sube `--memory`.
