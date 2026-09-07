#!/usr/bin/env bash
#
# «c» DE COMPROBAR. Mira y no toca nada.
#
# EXISTE POR UNA CONVERSACIÓN CONCRETA, y conviene que quede escrita. La
# aplicación dijo que Google no dejaba hacer un montaje. La respuesta que se dio
# fue «vuelve a ejecutar el instalador». Y la contestación, con toda la razón,
# fue: «pero si eso ya lo hice hace rato. ¿Cuántas veces voy a instalar eso?».
#
# «Vuelve a instalar» es la peor respuesta que se le puede dar a alguien que ya
# ha instalado. No dice qué pasa, tarda diez minutos, y si el problema no era ese
# —que casi nunca lo es— deja exactamente donde estaba, pero con menos paciencia.
#
# Cuando Google dice que no, hay dos preguntas que contestar:
#
#     ¿En QUÉ proyecto estamos?
#     ¿Qué hay encendido ahí dentro?
#
# Ninguna de las dos se contesta instalando otra vez. Se contestan MIRANDO. Eso
# es lo único que hace esto: enseña el proyecto, la facturación, las APIs una por
# una, el montador y la cuenta con sus papeles. Y se para.
#
# Y enseña la que más veces engaña de todas: si el proyecto que tiene puesto
# Cloud Shell es el mismo que el de la clave que usa Vercel. Si no lo son, todo
# lo instalado está perfecto y no sirve de nada, porque la aplicación está
# mirando otro sitio. Eso no lo dice ningún error de Google: se ve comparando lo
# que sale aquí con lo que dice la pantalla de Salud.
#
# NO ENCIENDE NADA. No crea nada. No despliega nada. No toca ni una variable.
# Se puede ejecutar las veces que haga falta y a cualquier hora.

set -euo pipefail

# SE RESUELVEN LOS ENLACES SIMBÓLICOS, y no es un detalle: es lo que permite
# dejar un atajo en la carpeta de inicio.
#
# Cloud Shell abre el terminal en «~», no dentro del repositorio, así que «./m»
# ahí no existe y hay que teclear la ruta entera con el pulgar cada vez. Con
# esto se puede hacer UNA VEZ:
#
#     ln -s cloudshell_open/LA*/m ~/m
#
# y a partir de ahí «./m» funciona desde la carpeta de inicio para siempre,
# porque la carpeta de inicio de Cloud Shell sobrevive entre sesiones. Sin
# `readlink -f`, el enlace daría la carpeta de inicio como si fuera el
# repositorio y no encontraría «instalar.sh».
AQUI="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

# ¿DE DÓNDE TRAE? Esto se comprueba ANTES de traer nada, y es la comprobación
# más importante de este archivo.
#
# Una carpeta puede ser un repositorio de git perfectamente válido y NO estar
# conectada a GitHub: si se clonó desde otra carpeta del propio disco, su
# «origin» es una ruta local. Entonces «git pull» dice «From .» y «Already up to
# date», con toda la razón, y no trae nada NUNCA.
#
# Eso pasó, y costó horas. La aplicación fallaba, se arreglaba el fallo, se
# subía, se ejecutaba esto… y se desplegaba otra vez el mismo código viejo,
# porque esta carpeta no podía recibir nada. Se buscó el fallo en Google, en los
# permisos, en las APIs y en el propio instalador. Estaba aquí.
#
# «Already up to date» es la mentira más cara que puede decir esta línea, así que
# ahora se mira de dónde viene antes de creérsela.
DE_DONDE_TRAE="$(git -C "$AQUI" remote get-url origin 2>/dev/null || true)"
case "$DE_DONDE_TRAE" in
  *github.com*) ;;
  *)
    echo
    echo "!! ESTA CARPETA NO ESTÁ CONECTADA A GITHUB."
    echo
    if [ -n "$DE_DONDE_TRAE" ]; then
      echo "   Trae de:  $DE_DONDE_TRAE"
    else
      echo "   No tiene ningún sitio de donde traer."
    fi
    echo
    echo "   Por eso «git pull» dice «Already up to"
    echo "   date» y no trae nada: se lo trae a sí"
    echo "   misma. Nada de lo que se arregle llega"
    echo "   aquí, y esto desplegaría código viejo"
    echo "   sin que se note."
    echo
    echo "   Se arregla en una línea:"
    echo
    echo "   git -C $AQUI remote set-url origin https://github.com/Alixonveloz1-ctrl/LA-MIRADA-QUE-EL-MUNDO-TEMERA.git"
    echo
    echo "   Y si prefieres empezar limpio, borra la"
    echo "   carpeta y vuelve a clonar desde el"
    echo "   enlace del README."
    echo
    exit 1
    ;;
esac

echo
echo "Trayendo lo último del repositorio…"
# Igual que en «m»: que el pull falle no es motivo para no comprobar. Lo que se
# va a mirar está en Google, no en esta carpeta.
git -C "$AQUI" pull --ff-only || {
  echo
  echo "  ! No se ha podido traer lo último."
  echo "  ! Se comprueba con lo que hay en esta carpeta."
}

exec bash "$AQUI/instalar.sh" comprobar
