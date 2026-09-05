#!/usr/bin/env bash
#
# El instalador se mudó a la raíz del repositorio, porque ya no instala solo el
# montador: instala todo lo de Google Cloud —APIs, bucket, CORS, cuenta,
# permisos y el montador— de una vez. Y desde la raíz se teclea más corto, que
# en un móvil cuenta.
#
# Esto queda aquí para que quien siga instrucciones viejas no se quede tirado.

echo
echo "El instalador está ahora en la raíz del repositorio."
echo "Ejecuta esto en su lugar:"
echo
echo "    bash $(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/instalar.sh"
echo
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/instalar.sh" "$@"
