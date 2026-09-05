#!/usr/bin/env bash
#
# Instala el montador de "La mirada que el mundo temerá" como Job de Cloud Run.
#
# Se ejecuta desde Cloud Shell, en el móvil, con estas dos líneas y ninguna más:
#
#     git clone https://github.com/<usuario>/<repo>.git
#     bash <repo>/montador/instalar.sh
#
# Dos líneas porque el terminal de Cloud Shell NO DEJA PEGAR DESDE EL MÓVIL y
# aquí solo hay móvil. Todo lo que no cabe en esas dos líneas lo hace este
# archivo. Si algún día la instalación no cabe en dos líneas tecleables, está
# mal diseñada.
#
# Es idempotente: se puede volver a ejecutar sin romper nada.

set -euo pipefail

# Todo lo que se imprime va en líneas cortas: se lee en la pantalla de un móvil.
ANCHO=52
raya() { printf '%*s\n' "$ANCHO" '' | tr ' ' '-'; }
titulo() { echo; raya; echo "$1"; raya; }
paso() { echo; echo "· $1"; }
malo() { echo; echo "!! $1" >&2; }

morir() { malo "$1"; echo >&2; echo "No se ha cambiado nada más." >&2; exit 1; }

command -v gcloud >/dev/null || morir "Aquí no hay gcloud. Esto se ejecuta en Cloud Shell."

NOMBRE_JOB="${NOMBRE_JOB:-montador-mirada}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

titulo "MONTADOR · LA MIRADA QUE EL MUNDO TEMERÁ"
echo "Tarda entre cinco y ocho minutos."
echo "No cierres esta ventana."

# ---------------------------------------------------------------------------
# 1. El proyecto. Único momento de darse cuenta de que es la cuenta equivocada.
# ---------------------------------------------------------------------------

PROYECTO="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$PROYECTO" ] && [ "$PROYECTO" != "(unset)" ] \
  || morir "No hay proyecto activo. Ponlo con: gcloud config set project TU_PROYECTO"

NUMERO="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)' 2>/dev/null || true)"
[ -n "$NUMERO" ] || morir "No se puede leer el proyecto «$PROYECTO». ¿Es el nombre correcto y tienes acceso?"

titulo "1. EL PROYECTO"
echo "  $PROYECTO"
echo "  número: $NUMERO"
echo
echo "Si NO es este, pulsa Ctrl+C y escribe:"
echo "  gcloud config set project TU_PROYECTO"
echo
read -r -p "Si es el correcto, pulsa Enter. " _

# ---------------------------------------------------------------------------
# 2. El bucket. Se elige por NÚMERO: teclear un nombre largo en un móvil es
#    donde se equivoca uno.
# ---------------------------------------------------------------------------

titulo "2. EL BUCKET"
paso "Buscando buckets del proyecto..."

mapfile -t BUCKETS < <(gcloud storage buckets list --project "$PROYECTO" \
  --format='value(name)' 2>/dev/null || true)

if [ "${#BUCKETS[@]}" -eq 0 ]; then
  # El nombre del bucket no se escribe aquí ni como ejemplo: el repositorio es
  # público y un nombre escrito identifica el almacén de una cuenta. Se compone
  # con el número de proyecto, que ya está a la vista de quien ejecuta esto.
  morir "Este proyecto no tiene ningún bucket.
   Crea uno primero con esta línea:
     gcloud storage buckets create gs://\$(echo ${NUMERO})-mirada --location=${REGION:-us-central1}
   y vuelve a ejecutar este instalador."
elif [ "${#BUCKETS[@]}" -eq 1 ]; then
  BUCKET="${BUCKETS[0]}"
  echo "  Solo hay uno y se coge ese:"
  echo "  $BUCKET"
else
  echo "Hay ${#BUCKETS[@]}. Escribe SOLO EL NÚMERO:"
  echo
  for i in "${!BUCKETS[@]}"; do printf '  %2d) %s\n' "$((i + 1))" "${BUCKETS[$i]}"; done
  echo
  ELEGIDO=""
  while :; do
    read -r -p "Número: " ELEGIDO
    [[ "$ELEGIDO" =~ ^[0-9]+$ ]] && [ "$ELEGIDO" -ge 1 ] && [ "$ELEGIDO" -le "${#BUCKETS[@]}" ] && break
    echo "  Escribe un número entre 1 y ${#BUCKETS[@]}."
  done
  BUCKET="${BUCKETS[$((ELEGIDO - 1))]}"
  echo
  echo "  Elegido: $BUCKET"
fi

REGION="${MONTAJE_REGION:-$(gcloud config get-value run/region 2>/dev/null || true)}"
[ -n "$REGION" ] && [ "$REGION" != "(unset)" ] || REGION="us-central1"
echo "  Región: $REGION"

# ---------------------------------------------------------------------------
# 3. Las APIs. Solo las que falten, y se dice cuáles.
# ---------------------------------------------------------------------------

titulo "3. LAS APIS"
NECESARIAS=(run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
            storage.googleapis.com aiplatform.googleapis.com
            texttospeech.googleapis.com speech.googleapis.com)

mapfile -t PUESTAS < <(gcloud services list --enabled --project "$PROYECTO" \
  --format='value(config.name)' 2>/dev/null || true)

FALTAN=()
for api in "${NECESARIAS[@]}"; do
  encontrada=0
  for ya in "${PUESTAS[@]}"; do [ "$ya" = "$api" ] && encontrada=1 && break; done
  [ "$encontrada" -eq 0 ] && FALTAN+=("$api")
done

if [ "${#FALTAN[@]}" -eq 0 ]; then
  echo "  Ya están todas."
else
  echo "  Faltan ${#FALTAN[@]} y se habilitan ahora:"
  for api in "${FALTAN[@]}"; do echo "    $api"; done
  gcloud services enable "${FALTAN[@]}" --project "$PROYECTO" --quiet
  echo "  Hechas."
fi

# ---------------------------------------------------------------------------
# 4. La clave del montador. Si el job ya existe, se reutiliza la suya: cambiarla
#    sin querer dejaría a Vercel hablando con una clave vieja.
# ---------------------------------------------------------------------------

titulo "4. LA CLAVE"
CLAVE=""
if gcloud run jobs describe "$NOMBRE_JOB" --region "$REGION" --project "$PROYECTO" >/dev/null 2>&1; then
  CLAVE="$(gcloud run jobs describe "$NOMBRE_JOB" --region "$REGION" --project "$PROYECTO" \
    --format='value(spec.template.spec.template.spec.containers[0].env.filter("name:MONTAJE_CLAVE").extract("value").flatten())' \
    2>/dev/null || true)"
  CLAVE="$(printf '%s' "$CLAVE" | tr -d '[:space:]')"
fi

if [ -n "$CLAVE" ]; then
  echo "  El montador ya estaba instalado."
  echo "  Se reutiliza su clave: la que ya tengas"
  echo "  en Vercel sigue valiendo."
else
  CLAVE="$(openssl rand -hex 24)"
  echo "  Clave nueva generada."
fi

# ---------------------------------------------------------------------------
# 5. Construir y desplegar. JOB, NO SERVICIO.
#
#    Un servicio de Cloud Run se queda sin CPU a mitad del trabajo: Google le
#    apaga el procesador y el vídeo se corta por la mitad sin error claro. Un
#    job siempre tiene CPU y admite tiempos largos, que para montar un episodio
#    de 22 minutos es la única opción sensata.
#
#    --max-retries 0 a propósito: un montaje que falla no mejora repitiéndose
#    solo, y repetirlo cuesta dinero.
# ---------------------------------------------------------------------------

titulo "5. CONSTRUIR Y DESPLEGAR"
echo "  Esto es lo que tarda. Paciencia."

DESPLIEGA=(gcloud run jobs deploy "$NOMBRE_JOB"
  --source "$AQUI" --region "$REGION" --project "$PROYECTO"
  --memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 0
  --set-env-vars "GCS_BUCKET=${BUCKET},MONTAJE_CLAVE=${CLAVE}"
  --quiet)

if ! "${DESPLIEGA[@]}"; then
  morir "No se ha podido desplegar el montador.
   Lo más habitual es que falte permiso de Cloud Build
   o que la cuenta no pueda crear repositorios de imágenes.
   El error de arriba lo dice tal cual."
fi
echo "  Desplegado."

# ---------------------------------------------------------------------------
# 6. Permisos. La trampa cara.
#
#    El montador NO se ejecuta con la service account de Vercel: se ejecuta con
#    la cuenta de compute del proyecto. Sin permiso propio sobre el bucket, el
#    montaje falla AL ESCRIBIR EL RESULTADO, después de haber hecho todo el
#    trabajo.
# ---------------------------------------------------------------------------

titulo "6. LOS PERMISOS"
COMPUTE="${NUMERO}-compute@developer.gserviceaccount.com"
paso "Dando acceso al bucket a la cuenta que ejecuta el montador:"
echo "  $COMPUTE"

if gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
     --member "serviceAccount:${COMPUTE}" \
     --role roles/storage.objectAdmin \
     --project "$PROYECTO" --quiet >/dev/null 2>&1; then
  echo "  Hecho."
else
  malo "No se ha podido dar el permiso automáticamente."
  echo "  Dáselo a mano con esta línea:" >&2
  echo "    gcloud storage buckets add-iam-policy-binding gs://${BUCKET} --member serviceAccount:${COMPUTE} --role roles/storage.objectAdmin" >&2
  echo "  Sin él, el montaje falla al escribir el" >&2
  echo "  resultado, con todo el trabajo ya hecho." >&2
fi

paso "La cuenta que uses en Vercel necesita además"
echo "  poder lanzar este job (Cloud Run Invoker)."
echo "  Escribe su correo y se lo doy, o pulsa Enter"
echo "  para saltar este paso."
read -r -p "  Correo: " CORREO_VERCEL || true
CORREO_VERCEL="$(printf '%s' "${CORREO_VERCEL:-}" | tr -d '[:space:]')"

if [ -n "$CORREO_VERCEL" ]; then
  for papel in roles/run.invoker roles/run.developer; do
    gcloud projects add-iam-policy-binding "$PROYECTO" \
      --member "serviceAccount:${CORREO_VERCEL}" --role "$papel" --quiet >/dev/null 2>&1 \
      && echo "  $papel: hecho" \
      || echo "  $papel: no se ha podido. Dáselo a mano."
  done
else
  echo "  Saltado. Recuerda dárselo antes de montar."
fi

# ---------------------------------------------------------------------------
# 7. Lo que hay que llevarse a Vercel.
# ---------------------------------------------------------------------------

URL="https://${REGION}-run.googleapis.com/v2/projects/${PROYECTO}/locations/${REGION}/jobs/${NOMBRE_JOB}"

echo
echo "======================================================"
echo "  COPIA ESTO EN VERCEL"
echo "  (Settings → Environment Variables)"
echo "======================================================"
echo
echo "  MONTAJE_URL"
echo "  $URL"
echo
echo "  MONTAJE_KEY"
echo "  $CLAVE"
echo
echo "  MONTAJE_JOB"
echo "  $NOMBRE_JOB"
echo
echo "  MONTAJE_REGION"
echo "  $REGION"
echo
echo "  GCS_BUCKET"
echo "  $BUCKET"
echo
echo "======================================================"
echo
echo "  Y DESPUÉS, SIN FALTA:"
echo
echo "  VERCEL NO APLICA UNA VARIABLE NUEVA A UN"
echo "  DESPLIEGUE YA CONSTRUIDO."
echo
echo "  Deployments → los tres puntos del último"
echo "  → Redeploy"
echo
echo "  Si no lo haces, la pantalla de Salud seguirá"
echo "  diciendo que falta algo que ya está puesto,"
echo "  y buscarás el fallo donde no está."
echo
echo "======================================================"
echo
echo "Cuando lo hayas copiado, abre la aplicación y ve"
echo "a Salud. Hasta que no esté todo en verde, no sigas."
echo
