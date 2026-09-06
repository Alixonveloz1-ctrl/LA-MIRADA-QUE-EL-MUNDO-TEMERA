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

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

exec bash "$AQUI/instalar.sh" montador
