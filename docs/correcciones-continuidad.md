# Correcciones de continuidad implementadas

Implementación del análisis de producción. El código está preparado para revisar
los desgloses existentes sin borrar sus imágenes, clips ni audio. Esta entrega no
ejecuta correcciones sobre el estado de producción ni generaciones de pago.

## Qué cambia

- Las 24 escenas del capítulo 1 tienen reglas específicas de población,
  movimientos, objetos, vestuario, recuerdos y regreso al presente. El comedor
  conserva sus invitados; la cocina mantiene a Saharis en el umbral; el refugio
  conserva su disposición; la persecución conserva al mismo hombre y la puerta.
- El contexto de las 289 escenas incluye el momento, espacio, escenas vecinas y
  resumen del episodio. Se aplican las correcciones confirmadas de reparto y
  lugar de los otros capítulos, como Eira, la cautiva, el Celebrante y casa Ilmen.
- Cada toma debe situar a las personas visibles y fuera de campo, definir sus
  miradas, cámara, posiciones y cambios permitidos. Un encuadre cerrado no tiene
  que mostrar a todos los asistentes, pero no puede vaciar el espacio visible.
- El clima queda separado de la paleta y la iluminación. Desaparece la lluvia
  impuesta por BARRIO; el farol del refugio se conserva, el goteo es localizado y
  la nieve de Kadre permanece en exteriores.
- Se conservan las 73 placas de personajes, 28 escenarios y 56 tomas de archivo.
  Los generales vacíos no se ofrecen para escenas ocupadas, y se excluye archivo
  con clima incompatible. Los detalles compatibles siguen disponibles.
- Además del escenario y los personajes, puede adjuntarse un keyframe aprobado
  anterior de la misma secuencia. Debe corresponder a su revisión actual. La nueva
  acción, cámara, hora y luz tienen prioridad; no se crea otra galería obligatoria.
- Cada nueva imagen registra el encargo y las referencias usados. El vídeo se
  vincula al keyframe aprobado del que parte; se comprueban también los enlaces
  entre tomas y se registra su procedencia.

Los clips reciben un movimiento concreto y una toma continua, conservando el
primer fotograma. Los cambios de lugar y de tiempo se hacen en montaje; no se
pide a Veo que reconstruya la historia ni haga esos cortes dentro del clip.

## Uso después de desplegar

1. En **Tomas**, elegir el episodio y pulsar **Corregir continuidad**. La pantalla
   confirma las llamadas al modelo de texto. Se trabaja escena por escena y la
   cola permite seguir el progreso. Este paso no genera imágenes ni vídeos.
2. La reparación habitual mantiene ids, orden, duraciones, recortes, bocas,
   encadenados y audio. En 6/3, 8/8, 10/16b y 12/6 puede redistribuir planos para
   separar lugares y recuerdos, conservando la duración de la escena y el audio. Guarda un respaldo y el nuevo desglose en rutas distintas antes de
   aplicarlo. Si alguien cambió la escena mientras tanto, no la sustituye.
3. Las imágenes existentes aparecen con **Revisión pendiente**. Revisar la mirada,
   población visible, escala, posiciones, vestuario, objetos y luz. Aprobar de
   nuevo las que sirven o pedir **Otro keyframe** para las que necesitan cambios.
   Conviene aprobar primero una toma representativa de cada secuencia, para que
   pueda ayudar como referencia en las siguientes.
4. Para una tanda, usar **Regenerar keyframes por revisar**. Confirma su coste,
   conserva los originales y pide solo tomas que aún no tienen un intento de su
   nueva revisión. Los resultados se eligen en la tira de intentos y se aprueban
   individualmente. Generar no significa aprobar.
5. Usar **Regenerar vídeos con imágenes revisadas** para la tanda de clips
   pendientes o generar cada vídeo por separado. Los clips anteriores siguen en el
   historial. Un clip vinculado a otro keyframe no puede incorporarse como vigente;
   los clips antiguos sin procedencia registrada necesitan revisión manual.
6. Volver a montar con la selección revisada. Los montajes anteriores se conservan
   como versiones descargables, pero los marcados pendientes no alimentan un
   montaje nuevo ni ceden su número de versión.

Las tandas habituales de «lo que falta» siguen siendo para material sin intentos;
la tanda de revisión es una acción separada. No se regeneran todos los episodios
por abrir la aplicación ni por desplegar el código.

## Verificación y límites

`npm run continuidad` incluye 35 pruebas sin red: contexto de las 289 escenas,
ocupación del comedor, miradas, lluvia/goteo/nieve, lugares, reparto, referencias
de secuencia, archivo compatible, conservación de audio y archivos, edición
concurrente, botones de revisión y comprobaciones del servidor antes de pagar.
`npm run subtitulos` comprueba además que un montaje pendiente no se reutiliza ni
se sobrescribe su versión. Ambas comprobaciones forman parte de `npm run comprobar`.

Estas pruebas validan datos y flujo de trabajo. Falta el piloto visual con
generaciones reales y revisar el episodio completo para decidir qué imágenes
conservar y cuáles rehacer. Las instrucciones reducen las causas conocidas; no
garantizan que el modelo produzca una imagen correcta en cada intento.

El autor ya aclaró madre, edad y canción; se retiran esas objeciones del análisis.
La relectura se documenta en `docs/contexto-narrativo-revisado.md`. No se ha reescrito el diálogo ni
reconstruido texto truncado sin su fuente. La separación por segmento de 6/3,
8/8, 10/16b y 12/6 está implementada. Las pistas escritas como SIETE y RENN
y las edades representadas necesitan aprobación visual de sus keyframes.
No se han generado placas adicionales del banco. Las referencias y la dirección cubren los casos confirmados; no
equivalen a una aprobación semántica y visual de las 289 escenas.

El contrato técnico está actualizado en `docs/contrato.md`, apartado 13.12.
