# El contenedor del montador.
#
# Dentro va exactamente lo que hace falta para montar y nada más: ffmpeg, Node y
# una fuente con acentos. Ni una credencial, ni el nombre del bucket, ni el del
# proyecto: todo eso llega en variables de entorno cuando se le encarga un
# trabajo. La imagen no sabe de quién es la cuenta en la que corre.

# Node 20 sobre Debian bookworm en su versión «slim».
#
# Se parte de la imagen de Node y se le añade ffmpeg, y no al revés, porque la
# imagen oficial de Node trae el intérprete ya resuelto y las de ffmpeg suelen
# venir sin Node o con uno viejo. «slim» es la variante sin las herramientas de
# compilación, que aquí no pintan nada: no hay dependencias que construir.
FROM node:20-bookworm-slim

# ffmpeg y una fuente con acentos, en una sola capa y sin las listas de apt
# detrás, que son unos cuantos megas de nada.
#
# --no-install-recommends es importante: el paquete de ffmpeg «recomienda» media
# distribución (documentación, códecs de sobra, utilidades de escritorio) que no
# se usa nunca y engorda la imagen sin traer nada. Lo que sí entra por
# dependencia dura de libavfilter es libass, que es la que quema los subtítulos,
# así que no hace falta pedirla aparte.
#
# fonts-dejavu-core es la fuente. Un solo paquete, unos dos megas, y con eso hay
# de sobra: en pantalla solo hay español, y los subtítulos y la cartela se
# escriben con la misma familia. CJK NO se instala a propósito —el japonés de
# esta serie únicamente se oye, no se ve— y ahorra doscientos megas de tipos que
# no se van a dibujar jamás.
#
# fontconfig tampoco se instala: el montador le pasa a libass la carpeta de
# fuentes directamente («fontsdir»), así que no hace falta ningún índice.
RUN apt-get update \
 && apt-get install --no-install-recommends -y ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Que la imagen se niegue a existir si le falta algo, en vez de descubrirlo a
# mitad de un montaje que ya ha costado veinte minutos de máquina. Se comprueba
# lo que de verdad se usa: que ffmpeg está, que ffprobe está —es el que dice
# cuánto dura cada capa ya montada—, que el filtro de subtítulos existe (viene
# con libass, por dependencia de libavfilter) y que la fuente con acentos está
# donde el montador la va a buscar.
RUN ffmpeg -hide_banner -version > /dev/null \
 && ffprobe -hide_banner -version > /dev/null \
 && ffmpeg -hide_banner -filters | grep -q ' subtitles ' \
 && test -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf

WORKDIR /montador

# Un solo archivo, sin package.json y sin npm install: el montador no tiene
# dependencias de npm, solo lo que trae Node dentro. La extensión .mjs es la que
# hace que Node lo lea como módulo sin necesidad de declararlo en ningún sitio.
COPY montador.mjs ./

# Sin privilegios. La imagen de Node ya trae este usuario hecho; el montador solo
# escribe en el directorio de trabajo (/tmp por defecto), que es de todos.
USER node

ENV NODE_ENV=production

# Un Job de Cloud Run arranca el contenedor, hace su trabajo y termina. No hay
# puerto ni servidor: si esto fuera un servicio, Google le quitaría el procesador
# a mitad del montaje y el vídeo saldría cortado sin decir por qué.
ENTRYPOINT ["node", "/montador/montador.mjs"]
