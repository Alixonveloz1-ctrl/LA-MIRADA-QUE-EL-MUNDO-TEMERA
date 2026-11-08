# Informe de integración — la noche del capítulo 1

Qué se juntó, qué se probó, qué se publicó y qué quedó decidido NO publicar
todavía, con la ruta segura para hacerlo con el dueño despierto.

Base común de todo: `ff6b3af`. Sobre esa base había dos ramas de trabajo:

- **Fundación** (5 commits): cero aprobación en toda la app —lo generado es lo
  que está en uso, y regenerar pone lo nuevo en uso— y escala y puestos fijos
  en el camino real de los keyframes de episodio.
- **ElevenLabs** (4 commits): voces con ElevenLabs (`elevenlabs_voz_id` junto a
  la voz de Gemini, sin pisarla), modo de efecto de sonido, y Salud avisando si
  falta la variable `ELEVENLABS_API_KEY`.

Y una tercera pieza sin rama: los **planos del capítulo 1** escritos a mano
(164 planos, 550 s, en `~/workspace/la-mirada-planos/ep01-escenas-*.json`).

---

## A. La integración de código — HECHA Y EN VERDE

Se clonó la fundación y se fusionó encima la rama de ElevenLabs (merge, no
cherry-pick: las dos partían del mismo commit y el merge conserva la historia
de ambas).

**Conflictos: uno solo**, en `api/_lib/modos.js`, y era exactamente el choque
que cabía esperar entre las dos piezas. Al guardar un bloque de voz recién
grabado:

- la fundación escribía `entrada.aprobada = true` —la grabación nueva queda EN
  USO en el acto, porque ya no existe aprobar—;
- ElevenLabs escribía `entrada.aprobada = false` —el régimen viejo— y añadía
  `entrada.proveedor = proveedor`, para saber quién grabó cada bloque.

**Resolución: se conservaron las dos cosas.** La grabación nueva queda en uso
(regla de la fundación, que es la que manda ahora en toda la app) Y se apunta
el proveedor que la grabó (el dato de ElevenLabs, que hará falta cuando un
bloque se rehaga). Ninguna de las dos piezas perdió nada.

Los demás archivos que las dos ramas tocaron (`app/cola.js`,
`app/pantallas/tomas.js`) se fusionaron solos, y las pruebas de abajo cubren
precisamente esos caminos.

**Pruebas, sin maquillar:**

- `npm run comprobar` → **exit 0** (la cadena entera: datos, invariantes,
  piezas-estado, continuidad, cola, audio, **elevenlabs**, subtítulos,
  pantalla-audio, ajustes, freno, anotar, banco, veo, pantalla, fallos, zip,
  difusión, reel y pesar).
- `npm run continuidad` → **exit 0**.

Se corrieron dos veces: tras el merge, y otra vez al final, sobre el árbol ya
definitivo. Las dos en verde.

---

## B. Los planos del capítulo 1 en el código — NO METIDOS, y por qué

### Lo que sí se comprobó: meter la pieza no habría roto el material vivo

El episodio 1 ya vive en el estado del bucket con los 153 planos del desglose
automático, y de los ids de sus tomas cuelga el material generado (43 keyframes,
11 clips). Antes de tocar nada se leyó, función a función, quién manda cuando
una pieza existe en los datos y en el estado a la vez:

- **Tomas** (`construirModelo` en `app/pantallas/tomas.js`):
  `mapa = { ...estaticas, ...dinamicas }` — las piezas del estado se imponen a
  las de `serie.json` con el mismo id, enteras, sin mezclar.
- **Inicio** (`piezaActiva` en `app/pantallas/inicio.js`):
  `piezasEstado[id] || piezasBase[id]` — el estado primero.
- **Audio, Montaje y Difusión** construyen su lista con el mismo patrón.
- **`asegurar()`** (`api/_lib/estado.js`), que rellena el estado al leerlo,
  nunca escribe `estado.piezas` desde los datos, y `asegurarToma` es
  no-destructiva: conserva `keyframe_aprobado`, `clip_elegido` e intentos de
  lo que ya exista.
- **La ficha de Difusión** (`fichaDePieza` en `api/_lib/texto.js`) es la
  excepción: lee SOLO `datos/serie.json`, sin alternativa. Por eso la ficha de
  un episodio falla hoy, y una pieza `ep01` en los datos la arreglaría.

Conclusión de esa parte: una `ep01` en `serie.json` habría sido **inerte para
Tomas/Audio/Montaje** (manda la del estado, con su material) y **habría
arreglado la ficha**. El riesgo de huérfanos no existía.

### La ruta correcta no es editar serie.json: es el patrón del opening

`datos/serie.json` **se regenera** desde `datos/serie.base.json` cada vez que
corre `npm run datos` (que es el primer paso de `npm run comprobar`). Editarlo
a mano se pierde en la siguiente comprobación. El patrón que el propio
repositorio usa para las piezas que no están en la base es el del opening y el
ending: viven en `datos/opening-ending.json` y `herramientas/parche-datos.mjs`
los incorpora si faltan. Para el episodio es el mismo camino:
`datos/episodio-01.json` + un bloque en el parche + una fila en la tabla de
piezas del README (los invariantes exigen que el README nombre cada pieza que
existe).

### La pieza se construyó entera — y los invariantes dijeron que no, en 8 planos

Se unieron las 4 tandas en una pieza con la forma de las de la serie, con
estos ajustes puramente mecánicos (sin tocar ni una palabra de los planos):

- Las 164 tomas en orden, con su `escena`; la línea de tiempo se verificó sin
  huecos ni solapes y suma exactamente 550 s.
- `audio.voz` construido desde los propios planos: las **50 líneas del guion,
  las 50, ancladas** a los planos que las llevan (t = inicio del primer plano
  de la línea, hasta = fin del último), con la forma exacta que el desglose
  produce (`quien, es, ja, intencion, escena, t, hasta`).
- `boca_visible`: los planos lo traían como `true`/`false` y el contrato de la
  serie usa el id del personaje o `null`. Traducido: `true` → el `quien` de la
  voz de ese plano; `false` → `null`.
- **7 refs retiradas**: en E08-04, E08-06, E08-09 (`invitado`), E19-02
  (`vendedora`), E19-03 (`mozo`) y E21-04, E21-05 (`criado`), la lista de refs
  nombraba a un figurante **sin placa**. Las refs son placas del banco —lo que
  el generador puede adjuntar como imagen— y esos personajes no tienen: siguen
  en sus planos, descritos en el texto, como todos los figurantes de la serie.
- Los mapas de puestos de las 24 escenas se conservaron en `escenas`, y en las
  tomas sobreviven **todos** los campos nuevos: `tipo`, `voz`, `efecto`,
  `puestos`, `continuidad` y `justificacion_duracion`.

La pieza construida queda guardada en
`~/workspace/la-mirada-planos/ep01-pieza-serie.json`, con su constructor en
`~/workspace/la-mirada-planos/armar-ep01.py`.

Con ella puesta (vía el parche, en una prueba que luego se revirtió),
`npm run comprobar` falló en tres comprobaciones de datos, todas sobre
planos tal como se escribieron:

1. **Dos planos enseñan una boca durante 6 s** — E04-07 y E10-07. La regla
   de la casa: un plano con boca visible dura entre 2 y 4 s, porque más
   tiempo delata que la boca no está sincronizada. Los dos llevan su
   `justificacion_duracion` escrita (una frase única e indivisible, el golpe
   de su escena, que a ritmo natural necesita ~6 s), y el dueño ya dijo que
   si la historia lo amerita, 6–8 s vale. Pero la comprobación no tiene
   mecanismo de excepción: aceptarla es enmendar la regla —o partir las
   frases— y eso se decide despierto, no lo firma una integración de noche.
2. **Seis planos juntan a un menor con una palabra de daño en el mismo
   prompt** — E01-09 («blood», el bebé en el altar), E15-01 («gaunt», el
   bebé), E17-01 y E17-02 («gaunt», Saharis niño), E24-01 y E24-03 («dead»,
   Saharis a los 10 años). Es la regla que protege de un bloqueo seguro de
   Google al generar: con un menor en las referencias, esas palabras hacen
   que la llamada se rechace después de pagarla. La convención de la propia
   serie es contarlo sin ponerlo en cuadro. Arreglarlos es reescribir el
   texto de imagen/vídeo de esos 6 planos —dirección creativa de los planos
   tal como se escribieron—, no un ajuste mecánico.
3. (Ya resuelto en la pieza construida: las bocas de E15-04 y compañía
   quedaban apuntando a «true» sin la traducción de formato de arriba.)

Con 8 planos de 164 sin pasar las reglas duras de la casa, la pieza **no se
metió**: ni maquillando las pruebas ni reescribiendo los planos por la
puerta de atrás. El resto de la noche (fundación + ElevenLabs) no depende
de ella y va publicado solo.
...[truncated 4853 chars]

### La ruta segura, con el dueño despierto

1. Decidir los dos planos de 6 s: o se parte cada frase en dos planos, o se
   escribe la excepción en el contrato y en la comprobación (plano con boca
   de más de 4 s solo si trae `justificacion_duracion`).
2. Reescribir los 6 prompts de menor+daño contando el daño fuera de cuadro,
   como hace el resto de la serie.
3. Regenerar la pieza con `armar-ep01.py` (apuntándolo a los planos ya
   corregidos), dejarla en `datos/episodio-01.json` y reactivar en
   `herramientas/parche-datos.mjs` el bloque «4b» que la incorpora (el texto
   exacto quedó probado esta noche) más la fila de `ep01` en la tabla de
   piezas del README.
4. `npm run comprobar` y `npm run continuidad` en verde, y push.

Nada de ese camino toca el material del bucket: la pieza del estado sigue
mandando en Tomas/Audio/Montaje hasta que se decida sustituirla, y esa
sustitución —con sus 43 keyframes y 11 clips colgando de los ids del
desglose— es otra decisión, separada y despierta.

---

## C. Publicación — PREPARADA, NO EJECUTADA (caducó la aprobación)

Todo quedó integrado y commiteado en el clon
`~/workspace/la-mirada-integracion` (el merge y este informe), listo para un
solo push a `main`: 29 archivos, sin borrados, con el remoto verificado en
`ff6b3af` antes de intentarlo.

El push por git directo no es posible desde esta máquina (HTTPS pide unas
credenciales que no están y SSH está cerrado por la red), así que se preparó
por la vía del conector de GitHub: `github push-files` con el snapshot de
los 29 archivos y el manifiesto en `/tmp/la-mirada-paths.bin`.

**Se intentó dos veces y las dos veces la tarjeta de aprobación de GitHub
caducó sin respuesta** —el dueño dormía—: la acción NO se ejecutó en ninguna
de las dos, y el remoto sigue en `ff6b3af`. En cuanto el dueño apruebe la
tarjeta o pida repetirlo, el push es ese único comando ya preparado; no hay
que rehacer nada.

## D. Verificación en vivo — PENDIENTE del push

Sin push no hay despliegue nuevo: la app pública sigue corriendo la versión
anterior (`ff6b3af`), así que la verificación del código nuevo no se ha
podido hacer y no se finge. Queda preparada para justo después del push, en
solo lectura (sin generar nada y sin pulsar «Comprobar los modelos»): que la
app carga; que ya no hay botones ni etiquetas de «Aprobar» en Banco, Tomas y
Audio; que el material cuenta igual que antes (teaser, opening, ending y
archivo completos; banco 101; el episodio 1 con sus 43 keyframes y sus 11
clips); y que Salud enseña el aviso de ElevenLabs diciendo que falta la
clave.
