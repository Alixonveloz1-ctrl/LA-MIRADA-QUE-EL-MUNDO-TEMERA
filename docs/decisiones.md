# Decisiones que hubo que tomar

El plan de construcción no podía decidirlo todo. Esto es lo que se decidió al
construir, qué alternativa se descartó y por qué. Si alguna está mal, aquí es
donde se discute.

---

## 1. El prompt se compone en la función, no en el navegador

**Por qué.** El invariante dice que ningún prompt sale sin `estilo.bloque` pegado
literal. Si el navegador compusiera el prompt, ese invariante sería una promesa
que hay que recordar cumplir en cada sitio. Componiéndolo en la función, el
navegador **no tiene forma de pedirlo mal**: manda `{tipo:"placa", id:"madre-ancla"}`
y el texto lo construye `api/_lib/prompt.js`, que es el único módulo del sistema
que toca `estilo.bloque` y lo hace en una sola función, `sellar()`.

Esto encaja además con la regla de reparto de trabajo: el usuario nunca juzga
texto. Si el navegador no maneja prompts, no hay dónde enseñárselos por error.

**Descartado:** componer en el navegador y validar en la función. Validar es
avisar; no componer es impedir.

---

## 2. Las imágenes y los vídeos se ven por URL firmada, no por la función

Un PNG 2K son ~6,8 MB y ~9,1 MB en base64: no cabe en los 4,5 MB. Un clip de 8 s
son ~35 MB. Un episodio, 1-2 GB. Nada de eso puede pasar por la función.

Así que **la función nunca devuelve un archivo**: devuelve la ruta y una URL
firmada V4 de seis horas. El navegador la usa para el `<img>`, el `<audio>` y el
`<video>`, y para descargar.

**Consecuencia que hay que aceptar:** una URL firmada lleva el nombre del bucket
en la ruta y el correo de la service account dentro de `X-Goog-Credential`. Sin
esas dos cosas no es una URL. El censor tacha ese correo y ese bucket en
cualquier otro sitio de cualquier respuesta, y deja pasar la URL firmada entera
como **única excepción, escrita a propósito y comentada en el código**. La clave
privada no entra en esa excepción ni en ninguna otra.

**Consecuencia de segundo orden:** para reducir la imagen a 1280 px antes de
mandarla a Veo, el navegador tiene que **leer** el master, no solo enseñarlo. Un
`<img>` de otro origen se enseña sin CORS, pero un canvas que lo lee queda
contaminado. Así que **el bucket necesita CORS**. Está en `docs/despliegue.md`
con el JSON exacto, y la pantalla de Salud lo comprueba de verdad haciendo el
`fetch` desde el navegador y lo dice con palabras si falta. No se puede
comprobar desde el servidor.

---

## 3. Una llamada de voz por bloque, y el montador la parte

El plan pide dos cosas que chocan: **una llamada por escena** (contra la deriva
de tono) y **cada línea colocada al segundo exacto**. Si las tres líneas de la
madre van en un solo WAV, no se pueden colocar en el segundo 24, el 33 y el 58,
porque los huecos del WAV no son los del teaser.

Lo que se hace: **una llamada por bloque**, se mide con Speech-to-Text dónde
empieza y acaba cada intervención dentro del archivo, y el **montador corta el
bloque por esos puntos** y coloca cada trozo en su segundo. El manifiesto ya
tiene la forma para eso: cada entrada de audio trae `origen`, `desde`, `hasta` y
`en`.

Así se cumplen las dos: el tono no deriva dentro del bloque, y cada línea cae
donde tiene que caer. Y sigue valiendo la regla de no regenerar nunca una línea
suelta: se rehace el bloque entero.

**Cómo se agrupan los bloques.** Para el teaser, uno por personaje (la madre
tiene tres líneas, Saharis una). Para un episodio, uno por escena, con dos
hablantes como mucho por llamada, que es lo que admite el modelo. Está escrito
en `bloquesDeVoz()` y comentado allí, porque de ese criterio depende la deriva.

---

## 4. La frase de muestra de cada voz se traduce una vez y se reutiliza

El reparto trae la frase más difícil de cada personaje **en español**, y el audio
va en `ja-JP`. Hacía falta un japonés que decir.

Se traduce con el modelo de texto **una vez por personaje**, se guarda en el
estado, y todas las voces candidatas dicen exactamente la misma frase. Si cada
candidata dijera una frase distinta no se podrían comparar, que es justo para lo
que existe esa pantalla. La intención viaja como dirección de actuación, no como
texto a leer.

---

## 5. Hubo que declarar un modelo de texto

`serie.json` declaraba imagen, vídeo, música, voz y alineación, pero no texto — y
el desglose es una llamada de texto por escena. Se añadió `modelos.texto`
(`gemini-3-pro`, región `global`, sustituible por `TEXTO_MODEL`) en el parche de
datos, porque escribir ese id en el código sería justo lo que la sección de
modelos prohíbe.

Si la cuenta no tiene acceso a ese modelo, **Salud lo dice con el error de Google
tal cual** y basta con poner otro id en `TEXTO_MODEL`. Nunca se sustituye en
silencio.

---

## 6. El pestillo de la puerta

El plan dice, con razón, que no hay cuentas ni login. Pero la función es pública
y gasta el dinero del proyecto: cualquiera que dé con la URL puede generar vídeo.

Se resuelve sin contradecirlo: una variable **opcional** `CLAVE_ACCESO`. Si no
está, la puerta queda abierta y el comportamiento es exactamente el que pide el
plan. Si está, la función exige una cabecera y el navegador la guarda una vez.
No es login ni multiusuario: es un pestillo. La alternativa de plataforma
—la protección de despliegue de Vercel— está en `docs/despliegue.md`.

**Esto es una advertencia, no una imposición.** Por defecto no cambia nada.

---

## 7. El estado se escribe con generación, y el navegador reaplica

El bucket es la única verdad y hay dos escritores posibles a la vez: la cola y la
pantalla, o dos pestañas. Toda escritura va con `ifGenerationMatch`. Ante un
conflicto, el navegador **vuelve a aplicar su cambio sobre el estado fresco** y
reintenta — no reenvía el resultado que ya había calculado, que es la forma
habitual de perder el trabajo del otro.

---

## 8. Lo que se midió en vez de razonarlo

El plan avisa de que el invariante de los 4,5 MB no se ve leyendo código. Así que
hay dos medidas de verdad:

- `herramientas/pesar.mjs` fabrica material del tamaño real y pesa la respuesta
  de cada modo antes de desplegar.
- La función pone `X-Peso-Respuesta` en **todas** las respuestas, el navegador se
  queda con el máximo por modo, y **Salud lo enseña** contra el tope. Lo que se
  mide en producción es lo que cuenta.

---

## 9. Tres huecos en los datos que había que cerrar para producir el teaser

Están en `docs/patch-datos.md` con el detalle. En resumen: 13 referencias del
teaser no existían como placa del banco, 4 escenarios no existían con ese id, y
no había modelo de texto. El teaser tenía que poder generarse el primer día y
sin cerrarlos no se podía.

El caso que más importaba: el teaser llamaba al niño `nino5`, `nino10` y `bebe`,
y el banco los llama `saharis-5`, `saharis-10` y `saharis-bebe`. **Son la misma
persona.** Generar las dos series por separado habría dado niños distintos y los
flashbacks no habrían funcionado, que es exactamente lo que la cadena de edades
existe para evitar. Se reescriben a la familia `saharis-*`, que es la que
encadena al ancla de linaje.
