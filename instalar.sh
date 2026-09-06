#!/usr/bin/env bash
#
# Instala TODO lo que "La mirada que el mundo temerá" necesita de Google Cloud.
#
# Se ejecuta desde Cloud Shell, en el móvil, con estas dos líneas y ninguna más:
#
#     git clone https://github.com/<usuario>/<repo>.git
#     bash <repo>/instalar.sh
#
# Y para volver a desplegar SOLO el montador, que es lo que hay que hacer cada
# vez que ese contenedor aprende algo nuevo:
#
#     bash <repo>/instalar.sh montador
#
# Dos líneas porque el terminal de Cloud Shell NO DEJA PEGAR DESDE EL MÓVIL y
# aquí solo hay móvil. Todo lo que no cabe en esas dos líneas lo hace este
# archivo: las APIs, el bucket, el CORS, la service account con sus permisos y su
# clave, el montador, y las variables listas para Vercel.
#
# Lo que Google necesita no se dicta como comandos: vive en despliegue/, en
# archivos que este script lee. Si mañana hace falta otro permiso, se añade a
# despliegue/permisos.txt y ya está.
#
# Es idempotente: se puede volver a ejecutar todas las veces que haga falta.
#
# Lo único que NO puede hacer, porque necesita un navegador y una tarjeta:
# crear la cuenta de Google Cloud y activar la facturación. Todo lo demás, sí.

set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# El nombre del Job sale de despliegue/montador.txt, el MISMO archivo que lee la
# función para saber a quién lanzar. Una sola fuente: así no hay que poner
# MONTAJE_JOB en Vercel.
NOMBRE_JOB="${NOMBRE_JOB:-$(sed -n 's/^job=//p' "$AQUI/despliegue/montador.txt" 2>/dev/null | head -1)}"
NOMBRE_JOB="${NOMBRE_JOB:-montador-mirada}"
NOMBRE_SA="${NOMBRE_SA:-mirada-app}"
SOLO="${1:-}"

# Todo lo que se imprime va en líneas cortas: se lee en la pantalla de un móvil.
raya()   { printf '%*s\n' 52 '' | tr ' ' '-'; }
titulo() { echo; raya; echo "$1"; raya; }
paso()   { echo; echo "· $1"; }
bien()   { echo "  ✓ $1"; }
ojo()    { echo "  ! $1"; }
morir()  { echo; echo "!! $1" >&2; echo >&2; exit 1; }

command -v gcloud >/dev/null || morir "Aquí no hay gcloud. Esto se ejecuta en Cloud Shell."

# Una variable de entorno del job, leída del JSON entero y no de una plantilla
# de formato de gcloud.
#
# POR QUÉ ASÍ. Las plantillas de `--format` de gcloud son un lenguaje propio, y
# la primera versión de esto se escribió a ojo: devolvía la cadena vacía sin dar
# ningún error, así que el script decía «no he podido leer el bucket» y se
# plantaba. Eso pasó de verdad, en el móvil, con el usuario delante. El JSON no
# se adivina: es el mismo desde hace años y lo lee python3, que en Cloud Shell
# está siempre.
#
#   $1 = el JSON del job    $2 = el nombre de la variable
delJob() {
  printf '%s' "$1" | python3 -c '
import json, sys
quien = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

# Se busca por TODO el JSON, no por un camino concreto. Cloud Run ha tenido dos
# formas de anidar esto (v1 y v2) y puede tener una tercera mañana; lo que no
# cambia es que una variable de entorno es un {"name": …, "value": …}. Buscar la
# pareja en vez del camino es lo único que no envejece.
def buscar(x):
    if isinstance(x, dict):
        if x.get("name") == quien and isinstance(x.get("value"), str) and x["value"]:
            return x["value"]
        for v in x.values():
            r = buscar(v)
            if r:
                return r
    elif isinstance(x, list):
        for v in x:
            r = buscar(v)
            if r:
                return r
    return None

encontrado = buscar(d)
if encontrado:
    print(encontrado)
' "$2" 2>/dev/null || true
}

# Lo mismo, pero de los archivos que dejó la instalación completa en la carpeta
# de casa. Es la última red: si el job no se deja leer —porque gcloud cambió algo
# o porque no hay permiso—, esto sigue sabiendo el bucket y la clave, y son los
# mismos, porque los escribió el mismo script que desplegó el job.
delArchivo() {
  local quien="$1"
  local valor=""
  for donde in "$HOME/mirada-variables.txt" "$HOME/mirada-extras.txt"; do
    [ -r "$donde" ] || continue
    valor="$(sed -n "s/^${quien}=//p" "$donde" | head -1)"
    [ -n "$valor" ] && { printf '%s' "$valor"; return; }
  done
}
[ -d "$AQUI/despliegue" ] || morir "No encuentro la carpeta despliegue/. ¿Has clonado el repositorio entero?"

# ---------------------------------------------------------------------------
# SOLO EL MONTADOR, Y POR QUÉ HACE FALTA UN CAMINO CORTO.
#
#     bash instalar.sh montador
#
# El montador vive en un contenedor que se despliega A MANO, así que siempre va
# por detrás del repositorio: cada vez que aprende algo nuevo —hoy, escribir el
# zip de difusión— hay que volver a desplegarlo. Y hacer eso con la instalación
# entera son diez minutos y varias preguntas sobre el bucket, para cambiar UNA
# cosa que ya está decidida desde el primer día.
#
# Este camino no pregunta nada y no toca nada más. Lee del propio job lo que ya
# tiene puesto —el bucket y su clave— y lo vuelve a desplegar igual. Que la clave
# salga del job y no se genere de nuevo es lo importante: una clave nueva
# invalidaría la que Vercel tenga puesta, y el montaje empezaría a fallar por una
# razón que no se parece en nada a la verdadera.
# ---------------------------------------------------------------------------
if [ "$SOLO" = "montador" ]; then
  titulo "SOLO EL MONTADOR"
  echo "No se toca nada más: ni el bucket, ni la"
  echo "cuenta, ni los permisos, ni tus variables"
  echo "de Vercel."

  PROYECTO="$(gcloud config get-value project 2>/dev/null || true)"
  [ -n "$PROYECTO" ] && [ "$PROYECTO" != "(unset)" ] \
    || morir "No hay proyecto activo. Ponlo con:
   gcloud config set project TU_PROYECTO"
  bien "Proyecto: $PROYECTO"

  paso "Buscando el montador que ya está desplegado"
  REGION="$(gcloud run jobs list --project "$PROYECTO" \
    --filter="metadata.name=$NOMBRE_JOB" \
    --format='value(metadata.labels."cloud.googleapis.com/location")' 2>/dev/null | head -1)"

  [ -n "$REGION" ] || morir "No encuentro el job «$NOMBRE_JOB» en este proyecto.
   Si es la primera vez, esto no vale: hay que
   hacer la instalación completa una vez, con
       bash $AQUI/instalar.sh
   y a partir de ahí ya sirve el camino corto."
  bien "Está en la región $REGION."

  # El bucket y la clave salen del propio job. Si se generaran de nuevo, la
  # MONTAJE_KEY de Vercel dejaría de valer y el montaje fallaría diciendo otra
  # cosa. Aquí se copian tal cual.
  LEIDO="$(gcloud run jobs describe "$NOMBRE_JOB" --region "$REGION" --project "$PROYECTO" \
    --format=json 2>/dev/null || true)"

  BUCKET="$(delJob "$LEIDO" GCS_BUCKET)"
  CLAVE_MONTAJE="$(delJob "$LEIDO" MONTAJE_CLAVE)"

  # Si el job no se deja leer, los archivos de la instalación completa lo saben.
  DE_DONDE="del propio job"
  if [ -z "$BUCKET" ] || [ -z "$CLAVE_MONTAJE" ]; then
    [ -n "$BUCKET" ] || BUCKET="$(delArchivo GCS_BUCKET)"
    [ -n "$CLAVE_MONTAJE" ] || CLAVE_MONTAJE="$(delArchivo MONTAJE_KEY)"
    DE_DONDE="de los archivos de la instalación"
  fi

  [ -n "$BUCKET" ] || morir "No he podido leer el bucket que tiene puesto el
   montador. Sin él no se puede redesplegar sin
   riesgo de cambiárselo. Usa la instalación
   completa:  bash $AQUI/instalar.sh"

  [ -n "$CLAVE_MONTAJE" ] || morir "No he podido leer la clave que tiene puesta el
   montador, y generar una nueva rompería la que
   tienes en Vercel. Usa la instalación completa:
       bash $AQUI/instalar.sh"

  bien "Bucket y clave leídos $DE_DONDE."
  bien "Tu MONTAJE_KEY de Vercel sigue valiendo."

  paso "Construyendo y desplegando. Esto es lo que tarda"
  gcloud run jobs deploy "$NOMBRE_JOB" \
    --source "$AQUI/montador" --region "$REGION" --project "$PROYECTO" \
    --memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 0 \
    --set-env-vars "GCS_BUCKET=${BUCKET},MONTAJE_CLAVE=${CLAVE_MONTAJE}" \
    --quiet \
    || morir "No se ha podido desplegar el montador.
   El error de arriba dice por qué. Lo que ya
   estuviera montado sigue estando."

  echo
  echo "======================================================"
  echo "  MONTADOR ACTUALIZADO"
  echo "======================================================"
  echo
  echo "  No hay que tocar nada en Vercel."
  echo
  exit 0
fi

titulo "LA MIRADA QUE EL MUNDO TEMERÁ"
echo "Instalación completa de Google Cloud."
echo
echo "Tarda entre seis y diez minutos."
echo "No cierres esta ventana."
echo
echo "No te va a pedir que teclees nada largo:"
echo "todo lo que hay que elegir se elige por"
echo "número o con un Enter."

# ---------------------------------------------------------------------------
# 1. El proyecto. Único momento de darse cuenta de que es la cuenta equivocada.
# ---------------------------------------------------------------------------

PROYECTO="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$PROYECTO" ] && [ "$PROYECTO" != "(unset)" ] \
  || morir "No hay proyecto activo. Ponlo con:
   gcloud config set project TU_PROYECTO"

NUMERO="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)' 2>/dev/null || true)"
[ -n "$NUMERO" ] || morir "No se puede leer el proyecto «$PROYECTO».
   ¿Es el nombre correcto y tienes acceso?"

titulo "1. EL PROYECTO"
echo "  $PROYECTO"
echo "  número: $NUMERO"

# La facturación no se puede activar desde aquí, pero sí avisar. Sin ella, las
# APIs se habilitan y luego todo falla con errores que no la mencionan.
FACTURA="$(gcloud billing projects describe "$PROYECTO" \
  --format='value(billingEnabled)' 2>/dev/null || echo "?")"
case "$FACTURA" in
  True|true) bien "Facturación activada." ;;
  False|false) morir "Este proyecto NO tiene facturación activada.
   Vertex no funciona sin ella, y el fallo llega
   más tarde con errores que no la mencionan.
   Actívala en la consola y vuelve:
   console.cloud.google.com/billing" ;;
  *) ojo "No he podido comprobar la facturación."
     ojo "Si no está activada, Vertex fallará luego." ;;
esac

echo
echo "Si NO es este proyecto, pulsa Ctrl+C y escribe:"
echo "  gcloud config set project TU_PROYECTO"
echo
read -r -p "Si es el correcto, pulsa Enter. " _

# ---------------------------------------------------------------------------
# 2. Las APIs. Salen de despliegue/apis.txt, no de una lista escrita aquí.
# ---------------------------------------------------------------------------

titulo "2. LAS APIS"

mapfile -t APIS < <(sed 's/#.*//' "$AQUI/despliegue/apis.txt" | tr -d '[:blank:]' | grep -v '^$')
[ "${#APIS[@]}" -gt 0 ] || morir "despliegue/apis.txt está vacío."

mapfile -t PUESTAS < <(gcloud services list --enabled --project "$PROYECTO" \
  --format='value(config.name)' 2>/dev/null || true)

FALTAN=()
for api in "${APIS[@]}"; do
  encontrada=0
  for ya in "${PUESTAS[@]}"; do [ "$ya" = "$api" ] && encontrada=1 && break; done
  [ "$encontrada" -eq 0 ] && FALTAN+=("$api")
done

if [ "${#FALTAN[@]}" -eq 0 ]; then
  bien "Ya están las ${#APIS[@]}."
else
  echo "  Faltan ${#FALTAN[@]} de ${#APIS[@]}. Habilitando:"
  for api in "${FALTAN[@]}"; do echo "    $api"; done
  echo "  (esto tarda un poco)"
  gcloud services enable "${FALTAN[@]}" --project "$PROYECTO" --quiet
  bien "Hechas."
fi

# ---------------------------------------------------------------------------
# 3. El bucket. Se elige por NÚMERO: teclear un nombre largo en un móvil es
#    donde se equivoca uno.
# ---------------------------------------------------------------------------

titulo "3. EL BUCKET"

REGION="${GCP_LOCATION:-$(gcloud config get-value run/region 2>/dev/null || true)}"
[ -n "$REGION" ] && [ "$REGION" != "(unset)" ] || REGION="us-central1"

mapfile -t BUCKETS < <(gcloud storage buckets list --project "$PROYECTO" \
  --format='value(name)' 2>/dev/null || true)

if [ "${#BUCKETS[@]}" -eq 0 ]; then
  BUCKET="${NUMERO}-mirada"
  paso "No hay ninguno. Creando gs://${BUCKET}"
  gcloud storage buckets create "gs://${BUCKET}" \
    --project "$PROYECTO" --location "$REGION" \
    --uniform-bucket-level-access --quiet
  bien "Creado."
elif [ "${#BUCKETS[@]}" -eq 1 ]; then
  BUCKET="${BUCKETS[0]}"
  echo "  Solo hay uno y se coge ese:"
  echo "  $BUCKET"
else
  echo "Hay ${#BUCKETS[@]}. Escribe SOLO EL NÚMERO:"
  echo
  for i in "${!BUCKETS[@]}"; do printf '  %2d) %s\n' "$((i + 1))" "${BUCKETS[$i]}"; done
  printf '  %2d) crear uno nuevo\n' "$(( ${#BUCKETS[@]} + 1 ))"
  echo
  while :; do
    read -r -p "Número: " ELEGIDO
    [[ "$ELEGIDO" =~ ^[0-9]+$ ]] && [ "$ELEGIDO" -ge 1 ] \
      && [ "$ELEGIDO" -le "$(( ${#BUCKETS[@]} + 1 ))" ] && break
    echo "  Escribe un número entre 1 y $(( ${#BUCKETS[@]} + 1 ))."
  done
  if [ "$ELEGIDO" -eq "$(( ${#BUCKETS[@]} + 1 ))" ]; then
    BUCKET="${NUMERO}-mirada"
    gcloud storage buckets create "gs://${BUCKET}" \
      --project "$PROYECTO" --location "$REGION" \
      --uniform-bucket-level-access --quiet
    bien "Creado gs://${BUCKET}"
  else
    BUCKET="${BUCKETS[$((ELEGIDO - 1))]}"
  fi
  echo "  Elegido: $BUCKET"
fi
echo "  Región: $REGION"

# ---------------------------------------------------------------------------
# 4. El CORS. El paso que más disgustos da si se salta.
#
#    Sin él el navegador NO puede reducir el keyframe a 1280 px antes de mandarlo
#    a Veo, y el error no menciona CORS por ningún lado: la imagen se ve
#    perfectamente y el fallo aparece al generar el clip.
#
#    La configuración vive en despliegue/cors.json, no aquí.
# ---------------------------------------------------------------------------

titulo "4. EL CORS DEL BUCKET"
echo "Sin esto la imagen se ve pero el clip falla,"
echo "y el error no menciona CORS por ningún lado."
echo
echo "Por defecto se abre a cualquier origen. Es"
echo "seguro: al bucket no se entra sin una URL"
echo "firmada, y esa URL caduca en seis horas."
echo
echo "Si prefieres cerrarlo a tu dominio de Vercel,"
echo "escríbelo ahora (p. ej. mi-app.vercel.app)."
echo "Si no, pulsa Enter."
read -r -p "Dominio: " DOMINIO || true
DOMINIO="$(printf '%s' "${DOMINIO:-}" | tr -d '[:space:]')"

CORS_ARCHIVO="$AQUI/despliegue/cors.json"
if [ -n "$DOMINIO" ]; then
  DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO%%/*}"
  CORS_ARCHIVO="$(mktemp)"
  sed "s|\"\\*\"|\"https://${DOMINIO}\"|" "$AQUI/despliegue/cors.json" > "$CORS_ARCHIVO"
  paso "Cerrado a https://${DOMINIO}"
  ojo "Habrá que repetirlo si cambia el dominio."
else
  paso "Abierto a cualquier origen (lo normal aquí)."
fi

gcloud storage buckets update "gs://${BUCKET}" \
  --cors-file="$CORS_ARCHIVO" --project "$PROYECTO" --quiet
bien "CORS aplicado."

# ---------------------------------------------------------------------------
# 5. La service account y sus permisos. Los papeles salen de
#    despliegue/permisos.txt, no de una lista escrita aquí.
# ---------------------------------------------------------------------------

titulo "5. LA CUENTA Y SUS PERMISOS"

CORREO_APP="${NOMBRE_SA}@${PROYECTO}.iam.gserviceaccount.com"
CORREO_COMPUTE="${NUMERO}-compute@developer.gserviceaccount.com"

# La cuenta puede haberla creado ya el usuario, con el nombre que le diera la
# gana. Así que: si está la que este script usa por defecto, se coge; si no, se
# enseñan las que haya y se elige POR NÚMERO, igual que el bucket; y solo si no
# hay ninguna se crea. Nunca se crea una segunda cuenta a espaldas de nadie:
# tener dos, con permisos repartidos entre las dos, es un fallo que se tarda en
# ver porque todo parece configurado.
if gcloud iam service-accounts describe "$CORREO_APP" --project "$PROYECTO" >/dev/null 2>&1; then
  bien "La cuenta ya existía: $NOMBRE_SA"
else
  mapfile -t CUENTAS < <(gcloud iam service-accounts list --project "$PROYECTO" \
    --format='value(email)' 2>/dev/null | grep -v -- '-compute@developer' || true)

  if [ "${#CUENTAS[@]}" -eq 0 ]; then
    gcloud iam service-accounts create "$NOMBRE_SA" \
      --display-name "La mirada — aplicación" \
      --project "$PROYECTO" --quiet
    bien "Cuenta creada: $NOMBRE_SA"
  else
    echo "Ya hay ${#CUENTAS[@]} cuenta(s) de servicio en este"
    echo "proyecto. ¿Cuál usa la aplicación?"
    echo "Escribe SOLO EL NÚMERO:"
    echo
    for i in "${!CUENTAS[@]}"; do printf '  %2d) %s\n' "$((i + 1))" "${CUENTAS[$i]%%@*}"; done
    printf '  %2d) crear una nueva (%s)\n' "$(( ${#CUENTAS[@]} + 1 ))" "$NOMBRE_SA"
    echo
    while :; do
      read -r -p "Número: " CUAL
      [[ "$CUAL" =~ ^[0-9]+$ ]] && [ "$CUAL" -ge 1 ] \
        && [ "$CUAL" -le "$(( ${#CUENTAS[@]} + 1 ))" ] && break
      echo "  Escribe un número entre 1 y $(( ${#CUENTAS[@]} + 1 ))."
    done
    if [ "$CUAL" -eq "$(( ${#CUENTAS[@]} + 1 ))" ]; then
      gcloud iam service-accounts create "$NOMBRE_SA" \
        --display-name "La mirada — aplicación" \
        --project "$PROYECTO" --quiet
      bien "Cuenta creada: $NOMBRE_SA"
    else
      CORREO_APP="${CUENTAS[$((CUAL - 1))]}"
      NOMBRE_SA="${CORREO_APP%%@*}"
      bien "Se usa la tuya: $NOMBRE_SA"
    fi
  fi
fi

paso "Dando permisos (despliegue/permisos.txt):"
while IFS='|' read -r quien papel donde porque; do
  quien="$(printf '%s' "$quien" | tr -d '[:space:]')"
  papel="$(printf '%s' "$papel" | tr -d '[:space:]')"
  donde="$(printf '%s' "$donde" | tr -d '[:space:]')"
  [ -z "$quien" ] && continue
  case "$quien" in \#*) continue;; esac

  case "$quien" in
    app)     CORREO="$CORREO_APP";;
    compute) CORREO="$CORREO_COMPUTE";;
    *) continue;;
  esac

  if [ "$donde" = "bucket" ]; then
    orden=(gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}")
  else
    orden=(gcloud projects add-iam-policy-binding "$PROYECTO")
  fi

  if "${orden[@]}" --member "serviceAccount:${CORREO}" --role "$papel" \
       --project "$PROYECTO" --quiet >/dev/null 2>&1; then
    echo "  ✓ ${quien}: ${papel##*/}"
  else
    echo "  ! ${quien}: ${papel##*/} — no se ha podido"
    echo "    ${porque# }"
  fi
done < <(grep -v '^[[:space:]]*#' "$AQUI/despliegue/permisos.txt" | grep '|')

# ---------------------------------------------------------------------------
# 6. La clave de la cuenta. Se genera aquí y NUNCA se enseña entera en pantalla:
#    va a un archivo, y al final se dice cómo llevarla a Vercel.
# ---------------------------------------------------------------------------

titulo "6. LA CLAVE DE LA CUENTA"

CLAVE_JSON="$HOME/mirada-service-account.json"
if [ -s "$CLAVE_JSON" ]; then
  bien "Ya había una clave descargada. Se reutiliza."
  ojo "Está en: $CLAVE_JSON"
else
  gcloud iam service-accounts keys create "$CLAVE_JSON" \
    --iam-account "$CORREO_APP" --project "$PROYECTO" --quiet
  chmod 600 "$CLAVE_JSON"
  bien "Clave creada en: $CLAVE_JSON"
fi

# En una línea, que es como se puede copiar en un móvil sin que se rompa.
# entorno.js acepta el JSON tal cual o en base64, justo por esto.
CLAVE_B64="$(base64 -w0 < "$CLAVE_JSON" 2>/dev/null || base64 < "$CLAVE_JSON" | tr -d '\n')"

# ---------------------------------------------------------------------------
# 7. El montador. JOB, NO SERVICIO.
#
#    Un servicio de Cloud Run se queda sin CPU a mitad del trabajo: Google le
#    apaga el procesador y el vídeo se corta por la mitad sin error claro. Un job
#    siempre tiene CPU y admite tiempos largos, que para montar un episodio de 22
#    minutos es la única opción sensata.
#
#    --max-retries 0 a propósito: un montaje que falla no mejora repitiéndose
#    solo, y repetirlo cuesta dinero.
# ---------------------------------------------------------------------------

titulo "7. EL MONTADOR"

# La clave del montador no se regenera nunca en silencio: si el job ya existe y
# se le cambia la clave, la que Vercel tenga puesta deja de valer y el montaje
# empieza a fallar por una razón que no se parece en nada a la verdadera. Así
# que se busca por dos caminos antes de darla por perdida, y si aun así no
# aparece, se dice bien claro que hay que volver a copiarla.
CLAVE_MONTAJE=""
JOB_YA_ESTABA=0

if gcloud run jobs describe "$NOMBRE_JOB" --region "$REGION" --project "$PROYECTO" >/dev/null 2>&1; then
  JOB_YA_ESTABA=1
  # Camino 1: preguntársela al propio job.
  CLAVE_MONTAJE="$(delJob "$(gcloud run jobs describe "$NOMBRE_JOB" --region "$REGION" \
    --project "$PROYECTO" --format=json 2>/dev/null || true)" MONTAJE_CLAVE)"

  # Camino 2: el archivo que dejó la instalación anterior. Hace falta porque la
  # expresión de arriba depende de la versión de gcloud, y si un día deja de
  # devolver nada, sin esto se generaría una clave nueva sin que nadie se entere.
  if [ -z "$CLAVE_MONTAJE" ] && [ -s "$HOME/mirada-variables.txt" ]; then
    CLAVE_MONTAJE="$(grep -m1 '^MONTAJE_KEY=' "$HOME/mirada-variables.txt" 2>/dev/null \
      | cut -d= -f2- | tr -d '[:space:]' || true)"
    [ -n "$CLAVE_MONTAJE" ] && ojo "La clave sale del archivo de la vez anterior."
  fi
fi

if [ -n "$CLAVE_MONTAJE" ]; then
  bien "El montador ya estaba. Se reutiliza su clave:"
  bien "la que ya tengas en Vercel sigue valiendo."
  CLAVE_ES_NUEVA=0
else
  CLAVE_MONTAJE="$(openssl rand -hex 24)"
  CLAVE_ES_NUEVA=1
  if [ "$JOB_YA_ESTABA" -eq 1 ]; then
    ojo "El montador ya estaba pero NO he podido leer"
    ojo "su clave, así que va una nueva."
    ojo "TENDRÁS QUE VOLVER A COPIAR MONTAJE_KEY"
    ojo "en Vercel, o el montaje fallará."
  else
    bien "Clave del montador generada."
  fi
fi

echo "  Construyendo y desplegando. Esto es lo que"
echo "  tarda. Paciencia."

if gcloud run jobs deploy "$NOMBRE_JOB" \
     --source "$AQUI/montador" --region "$REGION" --project "$PROYECTO" \
     --memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 0 \
     --set-env-vars "GCS_BUCKET=${BUCKET},MONTAJE_CLAVE=${CLAVE_MONTAJE}" \
     --quiet; then
  bien "Montador desplegado."
  MONTAJE_URL="https://${REGION}-run.googleapis.com/v2/projects/${PROYECTO}/locations/${REGION}/jobs/${NOMBRE_JOB}"
else
  ojo "No se ha podido desplegar el montador."
  ojo "Todo lo demás SÍ está hecho: puedes generar"
  ojo "imagen, vídeo y audio, y montar más adelante."
  ojo "El error de arriba dice por qué."
  MONTAJE_URL=""
fi

# ---------------------------------------------------------------------------
# 8. Lo que hay que llevarse a Vercel.
# ---------------------------------------------------------------------------

VARS="$HOME/mirada-variables.txt"
{
  echo "GCP_SERVICE_ACCOUNT=$CLAVE_B64"
  echo "GCS_BUCKET=$BUCKET"
} > "$VARS"
chmod 600 "$VARS"

# Lo demás se guarda aparte, porque NO hace falta ponerlo en Vercel y mezclarlo
# con lo que sí hace falta es la forma más fácil de que alguien copie de más.
{
  echo "# NO hacen falta en Vercel. La función ya sabe todo esto:"
  echo "#   · la región sale de GCP_LOCATION, que por defecto ya es la del bucket"
  echo "#   · el nombre del Job sale de despliegue/montador.txt, en el repositorio"
  echo "#   · la dirección del Job se compone sola con proyecto + región + nombre"
  echo "# Están aquí solo por si algún día hace falta cambiar algo a mano."
  echo "MONTAJE_JOB=$NOMBRE_JOB"
  echo "MONTAJE_REGION=$REGION"
  echo "MONTAJE_KEY=$CLAVE_MONTAJE"
  [ -n "$MONTAJE_URL" ] && echo "MONTAJE_URL=$MONTAJE_URL"
} > "$HOME/mirada-extras.txt"
chmod 600 "$HOME/mirada-extras.txt"

echo
echo "======================================================"
echo "  YA ESTÁ TODO LO DE GOOGLE CLOUD"
echo "======================================================"
echo
echo "  Proyecto:  $PROYECTO"
echo "  Bucket:    $BUCKET"
echo "  Región:    $REGION"
echo "  Cuenta:    $CORREO_APP"
[ -n "$MONTAJE_URL" ] && echo "  Montador:  $NOMBRE_JOB"
echo
echo "------------------------------------------------------"
echo "  EN VERCEL SOLO HAY QUE PONER DOS VARIABLES"
echo "------------------------------------------------------"
echo
echo "  Están escritas aquí:"
echo
echo "    $VARS"
echo
echo "  Ábrelo con:  cat $VARS"
echo
echo "    GCP_SERVICE_ACCOUNT   (la línea larga)"
echo "    GCS_BUCKET"
echo
echo "  Y nada más. La región, el nombre del Job y su"
echo "  dirección la función ya los sabe: el nombre está"
echo "  en el propio repositorio y la región por defecto"
echo "  ya es la de tu bucket."
echo
echo "  (En ~/mirada-extras.txt quedan las de más, por si"
echo "   algún día hay que cambiar algo a mano.)"
echo
echo "------------------------------------------------------"
echo "  Y DESPUÉS, SIN FALTA:"
echo "------------------------------------------------------"
echo
echo "  VERCEL NO APLICA UNA VARIABLE NUEVA A UN"
echo "  DESPLIEGUE YA CONSTRUIDO."
echo
echo "  Deployments -> los tres puntos del ultimo"
echo "  -> Redeploy"
echo
echo "======================================================"
echo
echo "Luego abre la aplicacion y ve a Salud."
echo "Hasta que no este todo en verde, no sigas."
echo
