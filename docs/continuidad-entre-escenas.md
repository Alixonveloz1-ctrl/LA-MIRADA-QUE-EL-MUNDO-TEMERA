# Continuidad entre escenas de toda la temporada

El límite de una escena o un capítulo no es, por sí solo, un cambio de lugar.
La placa del banco tampoco identifica por sí sola una habitación o una visita.

`datos/construir-mapa-escenas.js` recorre las 289 escenas de los doce guiones.
Resuelve espacios concretos, tiempos y pasado/presente; enlaza las continuaciones
escritas como CONTINUO o MÁS TARDE únicamente dentro del mismo espacio y tiempo
narrativo. Las continuaciones adicionales de `ENLACES` están revisadas contra la
acción del guion. Un lugar compartido no basta para añadir un enlace.

`npm run datos` reproduce `datos/mapa-escenas.js`. `datos/escenas.js` lo comparte
con el desglose, la búsqueda de referencias en el servidor y la lectura de la
historia en la pantalla. Las cuatro escenas alternadas mantienen sus segmentos;
la niña de 10/16b pertenece a la cena de Ilmen y la madre a otra secuencia.

Casos contrastados:

| Caso | Tratamiento |
|---|---|
| 1/1 → 1/2 | Mismo ritual, misma noche; la última imagen aprobada puede continuar. |
| 1/2 → 1/3 | Dieciséis años al presente y otro lugar. |
| 2/18 → 2/19 | Tejado y sótano de Renn separados aunque compartan placa. |
| 2/23 → 2/24 y 7/10 → 7/11 | Continuaciones aunque la cabecera repita la hora. |
| 1/14 → 1/16, 2/13 → 2/15, 3/18 → 3/20, 4/15 → 4/17, 6/13 → 6/18, 12/17 → 12/19 | Se retoma la acción tras recuerdos; no se copia el recuerdo. |
| 1/24 → 2/1, 3/24 → 4/1, 8/24 → 9/1 | El guion confirma la continuación entre capítulos. |
| 10/16 → 10/16b → 10/17 | Las tomas de la niña mantienen la cena; las de la madre mantienen la celda. |
| 11/13 → 11/14 | Muerte de Iven y velatorio en otro momento, con otra ocupación. |
| 12/15 → 12/16 | Acceso al refugio y habitación separados. |

La búsqueda toma la última imagen narrativa de la secuencia, comprueba su
aprobación, revisión y ausencia de trabajo pendiente. Si esa imagen necesita
revisión, no salta a una más antigua. El interruptor controla el envío de la
referencia; el banco de personajes y escenarios sigue utilizándose.

Los planes existentes se interpretan al leerlos. Este cambio no escribe el
estado de producción, no cambia aprobaciones, no borra intentos, no modifica
el guion y no genera imágenes. La referencia orienta al modelo: el resultado
de cada imagen y vídeo sigue necesitando revisión humana.

La pantalla explica la transición al comenzar una escena, muestra lugar y
tiempo junto a cada imagen y permite leer antes/después aunque crucen escenas.
La descripción de la toma tiene prioridad; si falta, se muestra un contexto de
escena identificado como tal. Las 24 escenas del primer capítulo tienen además
resúmenes de lectura contrastados con el guion; el mecanismo general lee los
doce capítulos y las descripciones de sus nuevos desgloses.

Verificación: `npm run comprobar`, incluidas 54 pruebas de continuidad sin red
ni generación. El mapa publicado se compara con su construcción desde el guion.
