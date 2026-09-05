# El parche de datos

`herramientas/parche-datos.mjs` lee `datos/serie.base.json`, cierra tres huecos y
escribe `datos/serie.json`, que es el único archivo de datos que lee la
herramienta. Se ejecuta con:

```
npm run datos
```

y va también dentro de `npm run comprobar`, delante de los invariantes y del
pesaje.

**`serie.base.json` es el archivo tal y como llegó, y no se toca nunca.** Tenía
tres huecos que impedían producir el teaser el primer día: trece referencias del
teaser que no existían como placa del banco, cuatro escenarios que no existían
con ese id, y ningún modelo de texto declarado. Se podían haber arreglado a mano
editando el JSON, y habría sido peor: nadie sabría después qué se cambió, ni por
qué, ni podría distinguir una decisión razonada de un dedazo. Escrito como
script, cada cambio está justificado en su sitio, se puede volver a ejecutar
tantas veces como haga falta y da siempre el mismo resultado, y **si el resultado
no es válido no se escribe nada**.

Sale con 22 cambios anotados, que quedan escritos dentro del propio archivo en
`meta.parche.cambios`, junto a `meta.version_datos`, que pasa de 7 a 8.

---

## 1. Trece referencias del teaser que no existían en el banco

Las 24 tomas del teaser nombran placas del banco en su campo `refs`. Trece de
esos nombres no correspondían a ninguna placa. Y no eran trece problemas del
mismo tipo: eran dos, y se arreglan de dos maneras distintas.

### Ocho eran la misma persona con otro nombre

`nino5-cripta`, `nino5-barrio`, `nino5-manos`, `nino10-barrio-espalda`,
`bebe-cripta`, `bebe-ancla`, `madre-barrio-34` y `madre-barrio-espalda`.

Seis de ellas son **Saharis de niño**. El teaser lo llama `nino5`, `nino10` y
`bebe`; el banco lo llama `saharis-5`, `saharis-10` y `saharis-bebe`. Son la
misma persona. Las otras dos son la madre, con un nombre más largo del que usa el
banco: `madre-barrio-34` es `madre-barrio` (el `-34` era el encuadre de tres
cuartos, que ya va en la propia placa) y `madre-barrio-espalda` es `madre-espalda`.

**Por qué se reescribe el nombre en vez de crear las placas que faltaban.** Ese
es justo el error que la cadena de edades existe para evitar. Si se generase la
serie `nino5-*` por un lado y la serie `saharis-5-*` por otro, saldrían dos niños
distintos, y en el momento del corte entre flashback y presente —que es de lo que
va el teaser entero— el espectador no vería a la misma persona. Todas las edades
de Saharis encadenan al mismo ancla de linaje, la del adulto, y solo funcionan si
son una sola familia de placas. Así que el parche reescribe la referencia a la
familia `saharis-*`, que es la que encadena.

El parche toca once referencias repartidas por las tomas: una para
`nino5-cripta`, una para `nino5-barrio`, dos para `nino5-manos`, una para
`nino10-barrio-espalda`, dos para `bebe-cripta`, una para `bebe-ancla`, una para
`madre-barrio-34` y dos para `madre-barrio-espalda`.

### Cinco no existían con ningún nombre

`saharis-34`, `saharis-noble-frontal`, `saharis-noble-nuca`, `saharis-manos` y
`madre-manos`. No era un problema de nombres: esas placas no estaban en el banco
de ninguna forma, y el teaser las pide. Se añaden.

### Por qué el parche acaba metiendo ocho placas nuevas y no cinco

Porque tres de los ocho renombrados apuntaban a un destino que **tampoco
existía**: `saharis-5-manos`, `saharis-10-espalda` y `madre-espalda`. El nombre
del banco era el correcto, pero la placa estaba sin escribir. Así que el banco
pasa de 65 placas a 73: cinco que faltaban con cualquier nombre, más tres que
faltaban con el nombre bueno.

### Las placas de detalle, y por qué llevan su propia línea de instrucción

Seis de las ocho placas nuevas son de **detalle**: manos, nuca y espalda —
`saharis-noble-nuca`, `saharis-manos`, `saharis-5-manos`, `saharis-10-espalda`,
`madre-manos` y `madre-espalda`. Las otras dos, `saharis-34` y
`saharis-noble-frontal`, son retratos normales.

Una placa de detalle se genera **exactamente igual que cualquier otra placa que
no sea ancla**: con el ancla de su personaje adjunta como referencia de
personaje. Si `saharis-manos` se generase suelta, las manos no serían las mismas
manos, y ese plano de las manos con el anillo y la cicatriz dejaría de decir de
quién son.

Pero la instrucción genérica del banco —la de
`instrucciones_referencia.banco`— habla de cara, de pelo y de ojos, y en una
placa de manos no hay cara. Y una referencia sin propósito claro es una de las
trampas que ya se pagaron: el modelo copia el encuadre de la referencia en vez de
copiar la identidad. Así que cada placa de detalle trae su propio
`instruccion_referencia`, compuesto por la función `DETALLE()` del script, que
dice tres cosas y siempre en el mismo orden: **qué parte muestra esta placa**,
**qué hay que copiar del ancla exactamente** (tono de piel, complexión,
cicatrices, color y corte de pelo, la ropa) y, sobre todo, **qué no hay que
dibujar** porque no está en cuadro —normalmente la cara—. Termina recordando que
la pose, el encuadre, la escala y el fondo **no** se copian: se redibujan como
dice la placa.

Ese texto va en inglés, porque es un prompt para el modelo de imagen, que es la
única excepción a que aquí todo esté en español.

`promptPlaca()` usa `placa.instruccion_referencia` cuando existe y la instrucción
genérica del banco cuando no. Nada más cambia en el código.

---

## 2. Cuatro escenarios que no existían con ese id

Tres eran el mismo sitio con otro nombre, y se reescriben al id canónico del
banco de escenarios:

| El teaser decía | El banco lo llama | Tomas afectadas |
|---|---|---|
| `celda` | `cripta-celda` | 4 |
| `salon-noble` | `elserath-salon` | 5 |
| `despacho-noble` | `elserath-despacho` | 1 |

**Por qué renombrar y no crear.** La placa de un escenario viaja como referencia
de objeto en **todos** los planos que ocurren ahí. Dos placas del mismo lugar
serían dos lugares distintos en pantalla, y el doble de dinero gastado en
generarlas.

El cuarto sí faltaba de verdad. **`tunel`**, el canal inundado por el que Saharis
escapa a los diez años, no está entre los 27 escenarios que salen de los guiones,
porque esa huida solo ocurre en el teaser. Se añade como placa nueva, con su
descripción, su encuadre y su luz de barrio, y con `origen` anotado para que se
sepa de dónde salió.

### `tunel` y `tuneles` son dos sitios distintos, y no se fusionan nunca

Este es el detalle que más fácil sería estropear, porque los nombres se
diferencian en una letra:

| id | Qué es | Cómo se usa |
|---|---|---|
| `tuneles` | La habitación de Saharis bajo la ciudad: seca, con catre, mesa, un farol y la pared entera cubierta de papeles, mapas, listas y cordel. | Se **habita**. 46 escenas de la serie. |
| `tunel` | El canal inundado: agua somera sobre losas gastadas, ladrillo abovedado goteando, rejas de hierro. No tiene nada dentro. | Se **cruza corriendo**. La toma C4 del teaser. |

El parche pone en cada uno un `no_fusionar_con` que apunta al otro y una `nota`
que lo explica **desde su lado**, para que quien abra cualquiera de los dos vea
que el otro existe y es diferente. No es una nota decorativa: al parche le
importa lo suficiente como para comprobarlo antes de escribir, y a
`herramientas/invariantes.mjs` también.

---

## 3. El modelo de texto

`serie.base.json` declara el modelo de imagen y el de vídeo, y nada más. El
desglose —convertir una escena del guion en planos— es **una llamada de texto por
escena**, veinticuatro por episodio y doscientas ochenta y nueve en toda la
serie, y no tenía a quién preguntar.

Se añade `modelos.texto`: `gemini-3-pro`, región `global`, protocolo
`generateContent`, con una nota que recuerda que solo sirve para el desglose y
que los Gemini 3.x únicamente se sirven desde `global`. Y se añade `TEXTO_MODEL`
a `modelos.sustituible_por_entorno`, para que si la cuenta no tiene acceso a ese
modelo baste con poner otro id en una variable de entorno.

**Por qué en los datos y no en el código.** Escribir ese id en un archivo `.js`
sería exactamente lo que prohíbe la sección de modelos: ningún id de modelo va
escrito a mano en el código. Salen de `datos/serie.json` y los sustituye una
variable de entorno.

---

## Lo que el parche comprueba antes de escribir

La última parte del script es una verificación. Si algo no cuadra, imprime las
quejas en español, sale con código 1 y **no escribe `serie.json`**: es preferible
quedarse con el archivo anterior que dejar uno roto.

Comprueba, sobre el resultado ya parcheado:

- Que **toda referencia** de toda toma de toda pieza existe como placa del banco.
- Que **todo escenario** de toda toma existe como placa de escenario.
- Que el `personaje` de cada placa existe en `personajes`.
- Que si una placa tiene `encadena_a`, la placa a la que encadena existe.
- Que **ninguna placa de detalle es ancla**. Una placa de detalle marcada como
  ancla se generaría solo con texto y sin referencia, y las manos no serían las
  mismas manos. Que no pueda pasar.
- Que el personaje de cada placa de detalle **tiene un ancla** a la que
  encadenar.
- Que cada placa de detalle **dice qué copiar** del ancla, es decir, que trae su
  `instruccion_referencia`.
- Que `tunel` y `tuneles` **siguen existiendo los dos** y que no han acabado con
  la misma descripción, que es lo que pasaría si alguien los fusionara por
  parecerle que sobra uno.

Después de esto, `npm run invariantes` vuelve a comprobar lo mismo y otras
veintitantas cosas sobre los datos y sobre el árbol de código. Que dos
herramientas distintas comprueben las reglas del banco de detalle y la separación
de `tunel`/`tuneles` es deliberado: son los dos sitios donde un arreglo bien
intencionado rompe algo caro y silencioso.
