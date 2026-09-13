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

## Referencias de personajes y acompañantes

El banco fija la identidad y el diseño: rostro, pelo, ojos, ropa, máscara y
accesorios. Una toma anterior aporta relaciones espaciales y continuidad de la
acción; no puede sustituir las fichas ni cambiar su diseño. Solo un cambio
explícito del relato permite modificar la edad, el vestuario o el estado físico.
La colocación de una máscara puede cambiar sin rediseñar la máscara.

`personajesSinReferencia` comprueba que cada personaje visible con ficha tenga
una placa asignada, también en detalles y fondos desenfocados. La comprobación
se usa al validar el desglose, al habilitar el botón y antes de generar. El
desglose debe corregir las omisiones; no se adivinan variantes de edad por luz.
Los personajes fuera de campo no deben dibujarse aunque aparezcan en una ficha
o en el contexto general de la escena.

`referenciasDeReparto` busca además la última aparición aprobada de acompañantes
sin ficha propia que estén visibles en la nueva toma. Usa la misma secuencia
canónica que la imagen anterior: no cruza visitas distintas, recuerdos, lugares
ni planos futuros. Un primer plano intermedio no borra su vestuario. No se usa
una versión anterior de una aparición que aún está pendiente de revisión.
La referencia se limita al aspecto de esos acompañantes y excluye a las demás
personas que pueda contener. Si comparte imagen con la referencia de secuencia,
se envía una sola copia con ambos cometidos. El interruptor apaga ambos usos de
imágenes anteriores; las fichas del banco siempre permanecen.

La pantalla muestra solo las fichas aprobadas que se usarán en la próxima
imagen y permite ver la fuente del aspecto de los acompañantes. Cada encargo
guarda las rutas exactas y el cometido de las referencias antes de enviarse.
Los orígenes de la imagen generada registran también qué fichas se utilizaron.

`herramientas/probar-referencias-personajes.mjs` añade diez pruebas sin red.
Recorre los doce capítulos y un enlace entre capítulos; ejecuta los módulos
reales de generación con transporte simulado y verifica los bytes e
instrucciones de cada referencia en el cuerpo enviado a Vertex, su registro y
la aprobación pendiente del resultado. No permite pagar con una ficha sin
aprobar y comprueba que apagar continuidad conserva el banco.
