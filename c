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

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
