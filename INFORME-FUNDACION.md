# Informe — Cimientos de «La mirada que el mundo temerá»

Trabajo hecho en este clon (`~/workspace/la-mirada-fundacion`) sobre la base
`ff6b3af`, en 4 commits locales, **sin push**:

1. `519e1d5` Sin aprobación I: el servidor y la cola ya no exigen aprobar nada
2. `a0a1c98` Escala y puestos fijos en el camino real de los keyframes de episodio
3. `706336c` Sin aprobación II: las pantallas
4. `79f7e1d` La marca de revisión se limpia regenerando; la imagen más nueva manda

No se ha regenerado ni invalidado ningún material: todo es código. El material
del bucket queda usable tal cual está, porque la resolución de «qué versión se
usa» ahora acepta lo ya generado (ver «La regla de vigencia» abajo).

---

## TAREA A — Cero aprobación

### La regla de vigencia (una sola, en todo el estudio)

> La versión en uso de cualquier material es **el último intento generado**.
> El campo apuntado (`aprobada`, `keyframe_aprobado`, `clip_elegido`) es solo
> el respaldo para material de tandas viejas cuya ruta no quedó en la lista de
> intentos. Generar de nuevo sustituye en el acto. Nadie aprueba nada.

La regla vive en tres sitios gemelos, con el mismo comportamiento:

- Servidor: `rutaAprobada(estado, tipo, id)` en `api/_lib/estado.js`
  (último intento → si no hay, el campo → si no hay, null).
- Cliente/continuidad: `rutaKeyframeEnUso()` / `rutaClipEnUso()` en
  `app/continuidad.js`.
- Pantallas: `leerEntrada()` (banco), `leerToma()` (tomas) y
  `posterGuardado()` (difusión) resuelven igual.

Los nombres internos `rutaAprobada`, `exigirAprobada`, `entradaAprobable` se
conservan por compatibilidad con el resto del código y con las pruebas; su
significado cambió: ya no exigen aprobación, exigen **existencia**.

### Cerrojos que existían y cómo quedó cada uno

**Servidor (`api/_lib/`)**

- `estado.js` — `exigirAprobada()` lanzaba error si el campo de aprobación
  estaba vacío, aunque hubiera intentos generados: era el cerrojo que impedía
  pedir un clip sin keyframe «aprobado», generar una placa sin ancla
  «aprobada», etc. Ahora comprueba existencia (campo o último intento) y los
  mensajes dicen «todavía no se ha generado». `reprobarCadena()` —que al
  aprobar una placa dejaba sin aprobar en cascada todo lo que colgaba de
  ella— es ahora una función vacía que solo valida que la placa existe.
  `resumenDePieza()` cuenta con la nueva resolución.
- `modos.js` —
  - `veo-lanzar`: exigía keyframe aprobado vigente y sin revisión pendiente
    (doble cerrojo con la interfaz). Ahora solo exige que el keyframe exista
    y que la imagen enviada sea la que está en uso; si cambió entre tanto,
    el mensaje es «El keyframe cambió mientras se preparaba el vídeo».
    Lo mismo en el encadenado (lastFrame).
  - `veo-consultar`: al terminar, el clip nuevo queda apuntado como el que
    se usa (`clip_elegido = ruta`).
  - `imagen`: la generación apunta sola la ruta nueva como vigente
    (keyframe, placa, escenario y póster) y ya no marca los keyframes nuevos
    como «revisión pendiente».
  - `musica` y `voz`: lo generado nace con `aprobada = true` (el campo queda
    como marca informativa de «existe», sin lectores que bloqueen).
  - `ficha`: la ficha nace con `ficha_aprobada = true`.
  - `montar`: caen las comprobaciones de revisión pendiente de clips y de
    capas previas; solo se comprueba que el clip del manifiesto sigue siendo
    el que está en uso.
- `planificacion-visual.js` — los escenarios para planificar se resuelven con
  `rutaAprobada()` (antes leía el campo `aprobada` a pelo).

**Cola del navegador (`app/cola.js`)**

- El ejecutor de clips resolvía el keyframe con la regla vieja (aprobado y
  vigente); ahora usa `rutaKeyframeEnUso()`. Ídem el keyframe encadenado.
- Al terminar una imagen, la cola apunta la ruta nueva como vigente
  (keyframe/placa/escenario/póster); al terminar un clip, `clip_elegido`.
- Música y voz nacen con `aprobada = true`.
- El ejecutor de montaje calcula la marca de revisión del resultado con el
  clip en uso (la marca queda como aviso en el montaje resultante, no como
  bloqueo).

**Continuidad (`app/continuidad.js`)**

- `materialVigente()` ya no pide que el último intento coincida con lo
  aprobado ni que el origen de un clip sea el keyframe actual: un clip
  generado es el vigente aunque saliera de un keyframe anterior.
- `motivoDeReferenciaPendiente()` ya no bloquea por «último intento ≠
  aprobado» ni por revisión de dirección distinta: solo bloquea si la imagen
  se está generando, si la toma necesita actualizar su dirección, si la
  imagen aún no existe, o si está marcada por un cambio de dirección
  posterior (ver «Lo que NO es aprobación» abajo).

**Pantallas (`app/pantallas/`, `app/reel.js`, `app/ui.js`)**

- **Banco**: eliminado el botón «Aprobar»/«Aprobar este intento» y la función
  `aprobar()` entera, con su cascada (`cadenaDe`/`dependientesDirectas`) que
  reprobaba lo colgante y su diálogo de confirmación. El ancla ya no bloquea
  «por aprobar» sino **por no estar generada** (sin imagen no hay referencia
  posible: es existencia, no aprobación). Filtros: fuera «Por aprobar»;
  «Aprobadas» pasa a «En uso». Contadores: «con imagen». Las miniaturas
  marcan «· en uso».
- **Tomas**: eliminados «Aprobar keyframe» (`aprobarKeyframe`) y «Elegir
  este» clip (`elegirClip`), incluido el candado de «primero reprodúcelo»
  para poder elegir. La tarjeta enseña la última imagen y el último vídeo
  como los que se usan; los textos de tandas hablan de keyframes
  «generados». La marca de revisión se enseña como «Dirección cambiada».
- **Audio**: eliminados «Aprobar»/«Quitar el visto bueno» de música y de
  bloques de voz, con el candado de haberlo oído antes
  (`motivoParaNoAprobar`, `aprobarMusica`, `aprobarBloque` borrados).
  Contadores por generado/grabado; chips «En uso».
- **Difusión**: la ficha ya no exige visto bueno para empaquetar
  (`porQueNoSePuedeEmpaquetar` solo pide vídeo montado y ficha escrita);
  eliminados «Aprobar la ficha» y, en pósters, «Aprobar esta»/«Quitar el
  visto bueno» (`aprobarLaFicha`, `aprobarPoster` borrados). Las referencias
  de un póster faltan solo si no están **generadas**.
- **Montaje**: eliminadas las faltas «sin aprobar» de bloques de voz y de
  piezas de música en `componerVoz`/`componerMusica` (eran el bloqueo que
  impedía montar con material generado pero no aprobado).
- **Reel**: la música solo necesita estar generada (antes: generada Y
  aprobada); el clip de cada plano es el apuntado o el último intento.
- **Inicio**: el progreso del banco cuenta placas con imagen (campo o
  intentos), no solo las apuntadas.
- **ui.js**: las etiquetas de estado dejan de decir «Aprobada/Aprobado/Por
  aprobar»: ahora «En uso»/«Pendiente».

### Lo que NO es aprobación y se ha conservado a propósito

- **La marca de revisión** (`revision_pendiente`, `clip_revision_pendiente`):
  significa «la dirección de este plano cambió después de generar la imagen»
  (corrección de continuidad o de desglose). No la quita ninguna persona:
  **se limpia sola al regenerar** — la cola la apaga cuando un keyframe nuevo
  termina, marca los clips viejos como por rehacer en ese momento, y un clip
  nuevo apaga la suya. Mientras está puesta, la imagen marcada no sirve de
  referencia para la toma siguiente ni de base de vídeo en pantalla, porque
  ya no corresponde a lo escrito: es un bloqueo de contenido, como el de
  «necesita dirección», no un paso de aprobación.
- **La cadena de generación**: una placa que no es ancla sigue necesitando
  que su ancla **exista** (se genera con ella delante); un clip sigue
  necesitando que su keyframe exista. Sin material no hay contra qué
  generar: eso es existencia, no aprobación.
- **Los campos** `aprobada`/`keyframe_aprobado`/`clip_elegido`/
  `ficha_aprobada` siguen existiendo en el estado (compatibilidad con lo ya
  guardado en el bucket), pero ahora los escribe la propia generación y
  ningún camino los exige escritos por una persona.

---

## TAREA B — Escala y puestos fijos

El defecto: fondo pequeño y personajes gigantes; personajes que cambian de
asiento entre imágenes de la misma escena. No había **ninguna** altura escrita
en los datos (ni de personajes ni de escenarios: solo prosa), así que la
escala se impone en texto, con proporciones relativas a un adulto de pie, en
el camino real que genera los keyframes de episodio
(`api/_lib/prompt.js` → `promptKeyframe`/`direccionDelPlano`, el mismo que
usa el modo `imagen`).

### Cómo ha quedado la regla

1. **La placa del escenario se genera ya a escala humana**
   (`promptEscenario` + `ESCALA_ARQUITECTONICA`): las placas de escenario se
   generan vacías, así que su prompt ordena dibujar la arquitectura a escala
   real (puerta ≈ 1,25 alturas de adulto, techo ≥ 1,5, mesa a la cadera,
   asiento de silla a la rodilla) y su negativo incluye la escala de casa de
   muñecas. La referencia del lugar nace fijando también la escala, no solo
   la geometría.
2. **Cada keyframe lleva la escala escrita** (`ESCALA_DEL_ESCENARIO`,
   añadida siempre que el plano ocurre en un lugar o tiene base de escena):
   adulto de pie ≈ 7,5 cabezas; puerta un poco más alta que un adulto;
   tablero de mesa a media altura de adulto; cabeza de sentado por debajo de
   la de pie; «si una figura no pudiera pasar por la puerta de este
   decorado, es demasiado grande»; el tamaño solo cambia por distancia de
   cámara, nunca porque la persona crezca o la habitación encoja. El
   negativo de todo keyframe incluye `NEGATIVO_DE_ESCALA` (gente gigante,
   habitación diminuta, escala de casa de muñecas, gente más alta que las
   puertas…). Cuando no hay base de escena se sigue añadiendo además el
   bloque de geometría; con base, la base es la autoridad espacial única
   (para no dar dos autoridades que se contradigan).
3. **Los puestos son obligatorios y no se pueden contradecir**
   (`direccionDelPlano`): tras la distribución de la base de escena se añade
   un párrafo imperativo —«SEATING AND POSITIONS ARE MANDATORY»—: el asiento
   o sitio nombrado de cada persona es parte del decorado; nadie cambia de
   asiento, de lado de la mesa ni de vecino entre planos de la escena; si la
   descripción del plano, un retrato del banco o un fotograma anterior
   sugiere otro sitio, **manda la distribución**; quien está fuera de campo
   conserva su asiento (no se enseña su sitio vacío ni ocupado por otro).
4. **El desglose está obligado a nombrar los puestos**
   (`api/_lib/texto.js`, reglas del desglose): `direccion.posiciones` debe
   nombrar el asiento/lado/vecinos exactos de cada persona y mantenerse
   constante en todos los planos de la escena («en la mesa» a secas es
   inválido), y la escala debe planearse (ningún encuadre que solo funcione
   si una persona crece o la habitación encoge). El bloque «EL MISMO
   DECORADO» añade que el decorado tampoco cambia de tamaño entre planos.
5. **La planificación lo sabe** (`planificacion-visual.js`): el texto «SET IN
   USE» que recibe el planificador dice ahora que la imagen del decorado
   fija también la escala y que los puestos nombrados se mantienen en cada
   plano de la escena.

Verificado a mano componiendo el encargo real de un plano de episodio
(capítulo 1, escena 3): el texto final contiene «SCALE IS LOCKED TO ONE
HUMAN MEASURE…», el párrafo «SEATING AND POSITIONS ARE MANDATORY…» y el
negativo de escala; y la placa de escenario contiene la escala
arquitectónica y su negativo.

---

## Pruebas

- **Antes de tocar nada** (base `ff6b3af`): `npm run comprobar` completo en
  verde (exit 0). Sirvió de línea base.
- **Después**: `npm run comprobar` completo en verde (exit 0), incluidas
  `continuidad` (que a su vez corre referencias de personajes, versión local
  y planificación visual) y las 542 comprobaciones con ✓ del resto de la
  cadena. El único «✗» que aparece en la salida es una fila de la tabla de
  `pesar` que el propio test marca así a propósito (una imagen de 2 MB que
  supera el tope: es el ejemplo del límite, no un fallo).
- Las pruebas que codificaban la regla vieja se han actualizado a la nueva
  **conservando su intención** (existencia y vigencia en vez de aprobación):
  - `probar-continuidad.mjs`: la referencia de secuencia viaja con la imagen
    que existe aunque lleve marcas viejas; el servidor solo frena el vídeo
    si la imagen en uso cambió; el montaje solo se rechaza si el clip en uso
    cambió; un clip generado es el vigente aunque saliera de otro keyframe;
    entre escenas manda la última imagen generada. Los stubs de red del
    servidor ahora son deterministas (`red-simulada`) para probar que el
    flujo llega al lanzamiento.
  - `probar-referencias-personajes.mjs`: el intento nuevo de la toma
    anterior ya presta su apariencia al reparto; el servidor apunta la
    imagen recién generada como la que se usa y no la deja «pendiente».
  - `probar-planificacion-visual.mjs`: la fixture describía un estado
    imposible (un intento «pendiente» posterior a la imagen en uso); ahora
    los intentos terminan en la imagen vigente, y un escenario con un solo
    intento generado ya se selecciona.
  - `probar-difusion.mjs`: empaquetar ya no pide ficha aprobada; cada
    formato de póster sabe cuál es su imagen en uso.
  - `probar-reel.mjs`: la música generada entra en el reel sin aprobación.
- Ninguna prueba se ha borrado ni desactivado.

## Notas para la integración

- Hay dos implementaciones de «versión en uso» (servidor y cliente) y una
  tercera lectura en las pantallas; las tres siguen hoy la misma regla
  (último intento → campo). Si un día divergen, los síntomas serían
  referencias distintas entre pantalla y servidor.
- El material vivo que la app enseñaba como «por aprobar» (6 placas del
  banco y los keyframes de episodio sin apuntar) queda automáticamente en
  uso con esta regla: no hace falta regenerarlo ni tocar el bucket.
- Siguen existiendo en el estado campos y textos internos con la palabra
  «aprobada» (nombre del campo y alguna instrucción en inglés dirigida al
  modelo de imagen, p. ej. «approved CHARACTER BANK» en las instrucciones de
  referencia): son internos, no se ven en la interfaz, y cambiar el nombre
  del campo rompería el estado ya guardado.
