#!/usr/bin/env bash
#
# SE LLAMA «m» DE UNA SOLA LETRA, Y ES LA RAZÓN MÁS SERIA DE TODO ESTE
# REPOSITORIO PARA SALTARSE SUS PROPIAS NORMAS DE NOMBRES.
#
# Aquí solo hay un móvil, y el terminal de Cloud Shell NO DEJA PEGAR desde un
# móvil. Todo lo que haya que ejecutar se teclea a mano, con el pulgar, en una
# pantalla de seis pulgadas. Y hay una cosa que hay que ejecutar una y otra vez:
# volver a desplegar el montador, porque ese contenedor se despliega a mano y
# siempre va por detrás del repositorio.
#
# La forma larga es:
#
#     bash ~/cloudshell_open/LA-MIRADA-QUE-EL-MUNDO-TEMERA/instalar.sh montador
#
# Setenta y cinco caracteres. Y ni siquiera funciona siempre: cuando Cloud Shell
# clona encima de un clon que ya existía, la carpeta se llama «…-TEMERA-0», y esa
# línea entra en la copia vieja.
#
# Esto son tres:
#
#     ./m
#
# Cloud Shell abre el terminal YA DENTRO del repositorio que acaba de clonar, se
# llame como se llame esa carpeta. Así que «./m» siempre da con el bueno.
#
# NO HACE NADA POR SU CUENTA. Trae lo último y llama a `instalar.sh montador`,
# que es donde está escrito de verdad lo que pasa y por qué. Si algún día hay que
# entender algo, se lee ahí; esto es solo la puerta corta.

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
# Que el «git pull» falle no es motivo para no desplegar: puede no haber red para
# GitHub y sí para Google, o puede haber cambios locales. Se dice y se sigue con
# lo que haya, que es mejor que no desplegar nada.
git -C "$AQUI" pull --ff-only || {
  echo
  echo "  ! No se ha podido traer lo último."
  echo "  ! Se despliega lo que hay en esta carpeta."
}

# QUÉ SE VA A DESPLEGAR, con fecha. Y no es un adorno.
#
# Si el «git pull» de arriba falla —una carpeta clonada de otra parte, un remoto
# que no es GitHub, cambios locales—, esto sigue adelante y despliega lo que
# haya. Que es lo correcto: mejor desplegar algo viejo que no desplegar nada.
#
# Pero entonces el montador se queda como estaba y no hay forma de saberlo desde
# la aplicación: se ve el mismo error de siempre y parece que el arreglo no
# funcionó. Con la fecha delante se ve en un segundo. Si dice hoy, es lo último;
# si dice la semana pasada, el pull no trajo nada y hay que mirar eso primero.
SELLO="$(git -C "$AQUI" log -1 --format='%h · %cd · %s' --date=format:'%d/%m %H:%M' -- montador 2>/dev/null || true)"
if [ -n "$SELLO" ]; then
  echo
  echo "Lo último que cambió del montador:"
  echo "  $SELLO"
fi

exec bash "$AQUI/instalar.sh" montador
