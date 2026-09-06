#!/usr/bin/env node
// Escribe el BANCO DE PLANOS DE ARCHIVO en datos/serie.base.json.
//
//   node herramientas/escribir-archivo.mjs
//
// POR QUÉ EXISTE ESTE ARCHIVO Y NO SE ESCRIBIÓ A MANO. Son 56 planos con doce
// campos cada uno, y once de esos doce son siempre lo mismo: cuatro segundos,
// sin personajes, sin encadenar, boca no visible, recorte [0, dur]. Escribirlos
// a mano son 672 casillas donde equivocarse en una sola tira una comprobación
// que no dice dónde. Aquí se escribe lo único que cambia —el sitio, lo que se ve
// y lo que se mueve— y el resto se rellena solo, igual para todos.
//
// QUÉ ES EL ARCHIVO. La cripta sale en 24 escenas repartidas por 8 episodios.
// Los túneles, en 46 repartidas por 11. Sin archivo, cada una de esas escenas
// paga su propio plano de ambiente: 289 keyframes y 289 clips para enseñar
// veintiocho sitios. Con archivo son 56, generados una vez y reutilizados toda
// la temporada, como el opening, el ending y el banco de música. Es lo que hace
// el anime de verdad, y no se nota porque un plano de ambiente no cuenta nada:
// dice dónde estamos y se quita.
//
// DOS POR SITIO, Y POR QUÉ DOS COSAS DISTINTAS. El primero es el plano general
// vacío: el sitio entero, para abrir una escena. El segundo es un detalle que se
// mueve solo —humo, lluvia, una llama, agua, polvo en un haz de luz—, y es el
// que hace que el sitio parezca vivo sin que haya nadie. Dos planos iguales se
// notarían al repetirse; un general y un detalle no, porque no se comparan.
//
// LO QUE NO ENTRA EN EL ARCHIVO. Nada con un personaje dentro, nada que pase una
// sola vez, y nada que cuente algo. Un plano de archivo no puede tener acción de
// guion: si en él ocurre algo, no se puede repetir en el episodio 9 sin que
// vuelva a ocurrir. Lo comprueba `npm run invariantes`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ruta = join(raiz, 'datos/serie.base.json');
const serie = JSON.parse(readFileSync(ruta, 'utf8'));

// SE ESCRIBE EN `serie.base.json` PERO SE COMPRUEBA CONTRA `serie.json`.
//
// El archivo se escribe en la base, que es de donde sale todo. Pero uno de los
// veintiocho escenarios —el túnel inundado— no está en la base: lo añade
// `parche-datos.mjs`, porque era un sitio del guion que no tenía placa. Así que
// si la lista de escenarios se leyera de la base, este programa se plantaría
// diciendo que un sitio que sí existe no existe.
const yaParcheada = JSON.parse(readFileSync(join(raiz, 'datos/serie.json'), 'utf8'));

/** Lo que dura un plano de archivo. Cuatro segundos abren una escena de sobra. */
const DUR = 4;

/**
 * Los planos, por sitio. `a` es el general vacío y `b` el detalle que se mueve.
 * `imagen` y `video` van en inglés porque son para los modelos; `uso`, en
 * español, porque es para quien monta.
 *
 * La luz NO se escribe aquí: la pone `promptKeyframe` leyendo `luz` de la toma,
 * y repetirla sería decirla dos veces con el riesgo de decirla distinta. Tampoco
 * se describe el sitio entero: su placa de escenario viaja como referencia en
 * todos los planos que ocurren ahí, que es justo para lo que existe.
 */
const SITIOS = [
  {
    escenario: 'cripta',
    a: {
      imagen: 'Wide establishing shot of the whole underground sanctuary, seen from the back of the hall toward the altar and the many-armed idol, completely empty, no people anywhere in frame, no figures, torch smoke hanging in the air',
      video: 'The torch flames breathe and the smoke drifts slowly across the frame. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de la cripta. El plano con el que se llega al sitio.',
    },
    b: {
      imagen: 'Close detail of one iron torch bracket on the damp black wall, the flame burning low, wet stone shining around it, bones set into a niche just visible at the edge of frame, no people',
      video: 'The flame gutters and recovers, throwing the shadow of the bracket back and forth across the wet stone. Very slow push in. Nothing else moves.',
      uso: 'Corte de respiro dentro de la cripta, o para tapar un salto de tiempo.',
    },
  },
  {
    escenario: 'cripta-celda',
    a: {
      imagen: 'Wide establishing shot of the whole bare stone cell, the straw pallet, the heavy wooden door standing ajar, cold light falling from the single high barred opening, completely empty, no people anywhere in frame',
      video: 'Dust turns slowly in the shaft of light from the barred opening. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir una escena de la celda. Sirve igual con la celda ocupada o vacía.',
    },
    b: {
      imagen: 'Close detail of the high barred opening seen from inside the cell, cold light coming through, damp running down the rough stone below it, no people',
      video: 'The light through the bars dims very slightly and comes back, as if a cloud crossed outside. One drop runs down the stone. Camera locked.',
      uso: 'El paso del tiempo en la celda, sin decir cuánto.',
    },
  },
  {
    escenario: 'tuneles',
    a: {
      imagen: 'Wide establishing shot of the whole dry stone room under the city: the pallet, the table, the single lantern, and the entire wall covered in pinned papers, maps, lists and cord, completely empty, no people anywhere in frame',
      video: 'The lantern flame shifts and the pinned papers stir very slightly in the draught. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de la base. El sitio que más sale de toda la serie.',
    },
    b: {
      imagen: 'Close detail of the wall of pinned papers: overlapping notes, a map corner, lists in a small cramped script, cord running between the pins, lit from one side by the lantern, no people, no readable words',
      video: 'One loose paper corner lifts and settles in the draught. The lantern light shifts across the pins. Very slow lateral pan to the right. Nothing else moves.',
      uso: 'El trabajo que hay detrás sin enseñar a nadie trabajando. Corte de pensamiento.',
    },
  },
  {
    escenario: 'academia',
    a: {
      imagen: 'Wide establishing shot of the whole bare stone hall of the cult academy: rows of low empty desks, the blackened writing wall, the altar at the far end, torchlight, completely empty, no people anywhere in frame',
      video: 'Torchlight moves slowly across the empty desks. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir una escena de la academia, antes o después de que estén los niños.',
    },
    b: {
      imagen: 'Close detail of the blackened writing wall, chalk dust caught in the surface, one low desk corner in the foreground, torchlight raking across from the left, no people, no readable writing',
      video: 'The torchlight rakes slowly across the blackened surface and chalk dust drifts through it. Camera locked.',
      uso: 'Detalle de la academia. Vale para cualquier lección sin enseñar la lección.',
    },
  },
  {
    escenario: 'barrio-humo',
    a: {
      imagen: 'Wide establishing shot down a mud alley of the low district: leaning shacks, open drains, doorways without doors, rain falling on broken cobbles, completely empty, no people anywhere in frame',
      video: 'Rain falls steadily and runs in the open drain. Smoke drifts from a roof at the far end. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena del barrio. El plano de llegada al sitio donde creció.',
    },
    b: {
      imagen: 'Close detail of rain running off the edge of a leaning shack roof into the mud below, broken cobbles half under water, no people',
      video: 'The water runs off the roof edge in an uneven stream and hits the mud. Rings spread in the standing water. Camera locked.',
      uso: 'Detalle del barrio. Se usa mucho bajo una voz en off.',
    },
  },
  {
    escenario: 'calle',
    a: {
      imagen: 'Wide establishing shot along a Feyrond street between districts: worn cobbles, shuttered shopfronts, street lamps at intervals, wet stone, completely empty, no people anywhere in frame',
      video: 'One shutter swings slightly in the wind. The lamps flicker. Camera locked. Nothing else moves. No people enter.',
      uso: 'Cualquier tránsito entre distritos. Abrir una escena de calle.',
    },
    b: {
      imagen: 'Close detail of one street lamp on its bracket over wet cobbles, the light pooling on the stone below, shuttered fronts out of focus behind, no people',
      video: 'The lamp flame moves and the pool of light on the cobbles breathes with it. Very slow push in. Nothing else moves.',
      uso: 'Una noche cualquiera en la ciudad. Sirve de puente entre dos escenas.',
    },
  },
  {
    escenario: 'elserath-salon',
    a: {
      imagen: 'Wide establishing shot of the whole great hall of the declining noble house: tall windows, the long table, dark polished wood, faded tapestries, dust suspended in the light, completely empty, no people anywhere in frame, no places set',
      video: 'Dust turns slowly in the light from the tall windows. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena del salón Elserath. La casa antes de que llegue nadie.',
    },
    b: {
      imagen: 'Close detail of an oil lamp on the long polished table, the grain of the dark wood, one faded tapestry edge out of focus behind, dust in the air, no people',
      video: 'The lamp flame leans and rights itself. Dust drifts through the light above the table. Camera locked.',
      uso: 'Detalle del salón. Corte de respiro en una escena de mesa larga.',
    },
  },
  {
    escenario: 'elserath-despacho',
    a: {
      imagen: 'Wide establishing shot of the whole study: the heavy dark desk, stacked ledgers, sealing wax, the single oil lamp, shelves receding into shadow, completely empty, no people anywhere in frame, the chair pushed back and unoccupied',
      video: 'The lamp flame shifts and the shadows on the shelves move with it. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena del despacho. También sirve de cierre, con la silla vacía.',
    },
    b: {
      imagen: 'Close detail of the desk surface: a stick of sealing wax, a closed ledger, the base of the oil lamp, the dark wood grain, no people, no readable writing',
      video: 'The lamp light steadies and dips on the desk surface. Very slow push in. Nothing else moves.',
      uso: 'El detalle que se usa bajo la frase que decide algo, con la música fuera.',
    },
  },
  {
    escenario: 'elserath-cocina',
    a: {
      imagen: 'Wide establishing shot of the whole service kitchen: steam, hanging copper, the long scrubbed table, the low ceiling, completely empty, no people anywhere in frame',
      video: 'Steam rises steadily and drifts under the low ceiling. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir una escena de cocina. El único sitio caliente de la casa.',
    },
    b: {
      imagen: 'Close detail of hanging copper pots against the kitchen wall, steam moving across them, the scrubbed table edge in the foreground, no people',
      video: 'Steam drifts across the copper and the reflections shift with it. Camera locked.',
      uso: 'Detalle de cocina. Bajo una conversación de servicio.',
    },
  },
  {
    escenario: 'elserath-jardin',
    a: {
      imagen: 'Wide establishing shot of the whole walled garden at night: clipped hedges gone slightly wild, gravel paths, cold moonlight, no lamps anywhere, completely empty, no people anywhere in frame',
      video: 'The hedges move very slightly in the night air. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir una escena de jardín de noche. Lo que se habla ahí no se habla dentro.',
    },
    b: {
      imagen: 'Close detail of gravel path and the base of a clipped hedge gone wild at the edge, cold moonlight, one leaf on the gravel, no people',
      video: 'One leaf turns over on the gravel in the night air and stops. Camera locked. Nothing else moves.',
      uso: 'Detalle de jardín. Muy útil para dejar un silencio después de una frase.',
    },
  },
  {
    escenario: 'consejo',
    a: {
      imagen: 'Wide establishing shot of the whole council chamber: the shallow amphitheatre of dark empty benches, the speaker\'s floor, high windows, gold light and dust, completely empty, no people anywhere in frame',
      video: 'Dust turns in the light from the high windows over the empty benches. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir una sesión del Consejo. La sala antes de que se llene.',
    },
    b: {
      imagen: 'Close detail of the worn edge of one dark council bench and the empty speaker\'s floor beyond it, gold light falling across the wood, dust in the air, no people',
      video: 'The shaft of gold light creeps very slowly across the bench. Dust drifts through it. Camera locked.',
      uso: 'Detalle del Consejo. Sirve para el momento en que nadie contesta.',
    },
  },
  {
    escenario: 'casa-renn',
    a: {
      imagen: 'Wide establishing shot of the small cellar shrine beneath the merchant house: the carved symbol on the wall, black candles, fresh offerings laid out, swept stone floor, completely empty, no people anywhere in frame',
      video: 'The black candle flames move together and the carved symbol shifts in and out of shadow. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de la casa Renn. Lo que hay debajo de una casa normal.',
    },
    b: {
      imagen: 'Close detail of the black candles and the fresh offerings on the shrine ledge, wax run down the stone, the carved symbol out of focus behind, no people',
      video: 'The candle flames lean and the wax shines. Very slow push in toward the carved symbol going out of focus behind. Nothing else moves.',
      uso: 'Detalle del culto doméstico. El que dice «esto está en uso» sin decirlo.',
    },
  },
  {
    escenario: 'casa-vharn',
    a: {
      imagen: 'Wide establishing shot of the whole seat of the Great House: marble, silver, no dust anywhere, nothing faded, cold and rich, completely empty, no people anywhere in frame',
      video: 'The light moves very slightly across the marble, as if a cloud passed outside. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de Vharn. La casa que hace pequeña a Elserath.',
    },
    b: {
      imagen: 'Close detail of a silver piece on a marble surface, the reflection of a tall window across it, no dust, no fingerprints, no people',
      video: 'The reflection of the window slides very slowly across the silver. Nothing else moves. Camera locked.',
      uso: 'Detalle de Vharn. La riqueza sin nadie que la disfrute.',
    },
  },
  {
    escenario: 'vharn-jardin',
    a: {
      imagen: 'Wide establishing shot of the whole formal garden of the Great House at night: paper lanterns along gravel paths, clipped stone, cold air, completely empty, no people anywhere in frame',
      video: 'The paper lanterns sway slightly and their light moves on the gravel. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir una escena de jardín Vharn. Lo bonito y lo frío a la vez.',
    },
    b: {
      imagen: 'Close detail of one paper lantern hanging over a gravel path at night, the paper glowing from within, clipped stone out of focus behind, no people',
      video: 'The lantern turns slowly on its cord and the light on the gravel turns with it. Nothing else moves.',
      uso: 'Detalle de jardín Vharn. Para cerrar una escena sin resolverla.',
    },
  },
  {
    escenario: 'registros',
    a: {
      imagen: 'Wide establishing shot of the whole record vault beneath the Great House: shelves from floor to ceiling, four centuries of ledgers, one lantern alone in the dark, completely empty, no people anywhere in frame',
      video: 'The single lantern light shifts and the shelves recede further into the dark. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de los registros. La cantidad de papel es el argumento.',
    },
    b: {
      imagen: 'Close detail of a row of ledger spines on one shelf, leather worn at the top edge, dust along the shelf, lantern light falling from one side, no people, no readable writing',
      video: 'The lantern light travels slowly along the row of spines and dust lifts in it. Very slow lateral pan to the right.',
      uso: 'Detalle de registros. Bajo la búsqueda, sin enseñar a nadie buscando.',
    },
  },
  {
    escenario: 'bosque',
    a: {
      imagen: 'Wide establishing shot among the enormous trunks of the ancient forest, the canopy so high the sky is only a rumour, moss, shafts of daylight coming down, completely empty, no people anywhere in frame',
      video: 'The shafts of daylight shift as the canopy moves far above. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de bosque. La escala es lo que cuenta el plano.',
    },
    b: {
      imagen: 'Close detail of moss on the base of an enormous trunk, one shaft of daylight falling across it, the forest floor dark beyond, no people',
      video: 'The shaft of light creeps across the moss and small particles drift through it. Very slow push in.',
      uso: 'Detalle de bosque. Un respiro entre dos escenas duras.',
    },
  },
  {
    escenario: 'bosque-lago',
    a: {
      imagen: 'Wide establishing shot of the still black lake inside the forest at night, moonlight lying on the water, reeds along the near edge, completely empty, no people anywhere in frame, no boats',
      video: 'The moonlight on the water breathes with the smallest movement of the surface. The reeds move once. Camera locked. Nothing else moves.',
      uso: 'Abrir la escena del lago. Casi no se usa, y por eso vale que sea el mismo plano.',
    },
    b: {
      imagen: 'Close detail of reeds at the edge of still black water at night, moonlight on the surface between them, no people',
      video: 'The reeds move in the night air and the reflection breaks and re-forms. Camera locked.',
      uso: 'Detalle del lago. El que se pone debajo de una voz que canta.',
    },
  },
  {
    escenario: 'bosque-cabana',
    a: {
      imagen: 'Wide establishing shot of the interior of the small raised wooden cabin: plain bed, herbs drying from the beams, green light coming through the window, completely empty, no people anywhere in frame',
      video: 'The hanging herbs turn slightly and the green light shifts on the floor. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir la escena de la cabaña.',
    },
    b: {
      imagen: 'Close detail of bunches of herbs drying from a wooden beam, green light through the window behind them, no people',
      video: 'The herbs turn very slowly on their strings. The green light moves behind them. Camera locked.',
      uso: 'Detalle de cabaña. Sirve de cierre suave.',
    },
  },
  {
    escenario: 'campamento',
    a: {
      figurantes_lejanos: true,
      imagen: 'Wide establishing shot of the refugee camp by the river outside the walls, seen from a distance: hundreds of cloth and mud tents, small fires, smoke, churned ground, distant anonymous figures far too small to make out, no faces visible anywhere',
      video: 'Smoke rises from the small fires and drifts across the tents. Camera locked. The distant figures do not come closer and none of them is ever in focus.',
      uso: 'Abrir cualquier escena de campamento. La escala del desastre, sin un solo primer plano.',
    },
    b: {
      imagen: 'Close detail of one small fire between cloth tent walls, churned mud around it, smoke rising, no people in frame',
      video: 'The fire burns low and the smoke rises and bends. Camera locked. Nothing else moves. No people enter.',
      uso: 'Detalle de campamento. Bajo una conversación de los que quedaron.',
    },
  },
  {
    escenario: 'orilla',
    a: {
      imagen: 'Wide establishing shot of the river bank below the camp: flat stones, reeds, grey water moving, the city wall far behind in the haze, completely empty, no people anywhere in frame',
      video: 'The grey water moves past and the reeds bend with it. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de la orilla. Es donde se dicen las cosas importantes.',
    },
    b: {
      imagen: 'Close detail of flat wet stones at the edge of grey moving water, reeds at the frame edge, no people',
      video: 'The water washes over the flat stones and pulls back. Camera locked. Nothing else moves.',
      uso: 'Detalle de orilla. Se usa mucho para dejar caer un silencio.',
    },
  },
  {
    escenario: 'casa-juego',
    a: {
      imagen: 'Wide establishing shot of the whole gambling house seen before it fills: crowded tables standing empty, low lamps, smoke still hanging, spilled drink on the boards, completely empty, no people anywhere in frame',
      video: 'The smoke drifts under the low lamps. One lamp flame moves. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir una escena de la casa de juego, antes del corte a la mesa llena.',
    },
    b: {
      imagen: 'Close detail of a table top in the gambling house: scattered tokens, a spilled cup, wet rings on the wood, smoke crossing the low lamp light above, no people, no hands in frame',
      video: 'Smoke crosses the lamp light above the table and the shadows move over the tokens. Camera locked. Nothing else moves.',
      uso: 'Detalle de casa de juego. El que se pone bajo una apuesta dicha en voz baja.',
    },
  },
  {
    escenario: 'puerto',
    a: {
      imagen: 'Wide establishing shot of the whole port warehouse at night: stacked crates receding into the dark, one lantern, water sounds implied outside, completely empty, no people anywhere in frame',
      video: 'The single lantern swings very slightly and the shadows of the crates move with it. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir la escena del almacén.',
    },
    b: {
      imagen: 'Close detail of stacked wooden crates in lantern light, the grain and the rope binding them, darkness beyond, no people',
      video: 'The lantern light swings across the crates and back. Nothing else moves. Camera locked.',
      uso: 'Detalle de puerto. Para una espera.',
    },
  },
  {
    escenario: 'camino-norte',
    a: {
      imagen: 'Wide establishing shot of the north road: bare hills, then stone, then snow further on, cold grey light, the road empty from edge to edge, completely empty, no people anywhere in frame, no carts',
      video: 'Wind moves across the bare hills and the loose snow drifts over the road. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena del camino. También sirve de paso de tiempo entre episodios.',
    },
    b: {
      imagen: 'Close detail of the stone surface of the north road with loose snow blowing across it, bare ground at the edge, cold grey light, no people, no footprints',
      video: 'Loose snow blows across the stone in gusts. Camera locked. Nothing else moves.',
      uso: 'Detalle del camino. El frío, sin enseñar a nadie pasándolo.',
    },
  },
  {
    escenario: 'kadre',
    a: {
      imagen: 'Wide establishing shot of the northern village: dark timber houses under heavy snow, smoke rising from the chimneys, the lane between them untouched, completely empty, no people anywhere in frame',
      video: 'Smoke rises steadily from the chimneys and fine snow drifts down. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de Kadre. El sitio donde nadie le tiene miedo.',
    },
    b: {
      imagen: 'Close detail of snow settled on the timber wall and sill of a village house, warm light showing at the edge of a shutter, no people',
      video: 'Fine snow drifts down past the timber and settles. The warm light at the shutter edge steadies. Camera locked.',
      uso: 'Detalle de Kadre. El calor visto desde fuera.',
    },
  },
  {
    escenario: 'casa-ilmen',
    a: {
      imagen: 'Wide establishing shot of the interior of the prosperous northern farmhouse: timber walls, the big hearth burning, the scrubbed table, boots by the door, warm firelight, completely empty, no people anywhere in frame',
      video: 'The hearth fire moves and the firelight shifts across the timber walls and the table. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir cualquier escena de la casa Ilmen. La casa que sí funciona.',
    },
    b: {
      imagen: 'Close detail of the big hearth burning, the stone surround, one pair of boots by the door out of focus at the frame edge, no people',
      video: 'The fire burns and settles, and one piece of wood shifts. The firelight moves across the stone. Camera locked.',
      uso: 'Detalle de la casa Ilmen. Bajo una conversación de familia.',
    },
  },
  {
    escenario: 'puerta-ciudad',
    a: {
      figurantes_lejanos: true,
      imagen: 'Wide establishing shot of the north gate of Feyrond at grey dawn, seen from a distance: a queue of carts along the road, the gate arch, distant anonymous figures far too small to make out, no faces visible anywhere',
      video: 'The queue does not move. Breath and dust hang in the cold air. Camera locked. The distant figures stay distant and none of them is ever in focus.',
      uso: 'Abrir cualquier escena de la puerta. La ciudad vista como un trámite.',
    },
    b: {
      imagen: 'Close detail of the great stone arch of the city gate at dawn, the ironwork, the worn edge of the road beneath it, no people in frame',
      video: 'Cold light strengthens very slightly on the stone as the dawn comes up. Camera locked. Nothing else moves.',
      uso: 'Detalle de la puerta. El paso de fuera a dentro, sin nadie.',
    },
  },
  {
    escenario: 'ciudad',
    a: {
      figurantes_lejanos: true,
      imagen: 'Wide high establishing shot of Feyrond working, seen from far above: the port, the gate, the grain carts on the roads, distant anonymous figures far too small to make out, no faces visible anywhere, wide and functional',
      video: 'The city works: smoke from the roofs, carts crawling along the roads. Camera locked and very high. The figures stay distant and none of them is ever in focus.',
      uso: 'El plano de ciudad. Se usa para abrir un episodio o para saltar de un sitio a otro.',
    },
    b: {
      imagen: 'Close detail of stacked grain sacks on a cart bed in the city, rope over them, worn boards, no people in frame, no hands',
      video: 'The cart rocks once as if loaded out of frame and settles. Dust lifts from the sacks. Camera locked.',
      uso: 'Detalle de ciudad. El comercio, que es de lo que se habla todo el rato.',
    },
  },
  {
    escenario: 'tunel',
    a: {
      imagen: 'Wide establishing shot down the flooded stone service tunnel: shallow standing water over worn flagstones, dripping vaulted brick, iron grates along the walls, faint cold daylight far ahead, completely empty, no people anywhere in frame',
      video: 'Drops fall from the vault into the standing water and rings spread. The far daylight steadies. Camera locked. Nothing else moves. No people enter.',
      uso: 'Abrir la escena del túnel inundado, o cualquier tránsito por debajo de la ciudad.',
    },
    b: {
      imagen: 'Close detail of shallow standing water over worn flagstones, an iron grate half submerged, drips falling from above, no people',
      video: 'One drop falls and the rings spread across the still water. Then another. Camera locked. Nothing else moves.',
      uso: 'Detalle de túnel. El que se pone bajo pasos que se oyen y no se ven.',
    },
  },
];

// ---------------------------------------------------------------------------
// De la tabla a las tomas
// ---------------------------------------------------------------------------

const escenarios = ((yaParcheada.escenarios && yaParcheada.escenarios.placas) || []).reduce(
  (mapa, placa) => mapa.set(placa.id, placa),
  new Map()
);

const tomas = [];
let reloj = 0;
for (const sitio of SITIOS) {
  const placa = escenarios.get(sitio.escenario);
  if (!placa) {
    console.error(`El escenario «${sitio.escenario}» no existe en escenarios.placas.`);
    process.exit(1);
  }
  for (const cual of ['a', 'b']) {
    const plano = sitio[cual];
    tomas.push({
      id: `arch-${sitio.escenario}-${cual}`,
      inicio: reloj,
      dur: DUR,
      // Un plano de ambiente no lleva a nadie ni cuenta nada: el nivel más
      // barato de Veo es exactamente para esto, y son 56 clips.
      veo: 'economico',
      luz: placa.luz,
      refs: [],
      encadena_con: null,
      imagen: plano.imagen,
      video: plano.video,
      dur_gen: DUR,
      recorte: [0, DUR],
      escenario: sitio.escenario,
      boca_visible: null,
      uso: plano.uso,
      // Hay tres sitios cuyo sentido ES la gente: la ciudad trabajando, la cola
      // de carros en la puerta, el campamento. Vacíos contarían lo contrario de
      // lo que son. Ahí se admiten figurantes a lo lejos, y se dice aquí para
      // que la comprobación sepa que es a propósito y no un descuido.
      ...(plano.figurantes_lejanos ? { figurantes_lejanos: true } : {}),
    });
    reloj += DUR;
  }
}

serie.piezas.archivo = {
  titulo: 'Archivo — planos de ambiente de la temporada',
  duracion_s: reloj,
  fija: true,
  archivo: true,
  nota_fija:
    'No es una pieza que se monte: es una BIBLIOTECA. Se generan una vez para toda la ' +
    'temporada y se reutilizan en los doce episodios, como el opening, el ending y el banco de ' +
    'música. Por eso no sale en Montaje, ni en Audio, ni en Desglose: solo en Tomas, que es ' +
    'donde se generan y se aprueban.',
  por_que:
    'La cripta sale en 24 escenas de 8 episodios; los túneles, en 46 de 11. Sin archivo, cada ' +
    'una de las 289 escenas paga su propio plano de ambiente. Con archivo son 56, y el ' +
    'espectador no lo nota porque un plano de ambiente no cuenta nada: dice dónde estamos y se ' +
    'quita.',
  regla:
    'Nada con un personaje dentro, nada que pase una sola vez, y nada que cuente algo. Si en un ' +
    'plano de archivo ocurre algo, no se puede repetir en el episodio 9 sin que vuelva a ' +
    'ocurrir. Dos por sitio: un general vacío para abrir, y un detalle que se mueve solo.',
  tomas,
};

writeFileSync(ruta, `${JSON.stringify(serie, null, 2)}\n`);
console.log(`Escritos ${tomas.length} planos de archivo en ${SITIOS.length} sitios.`);
console.log(`Duración total de la biblioteca: ${reloj} s.`);
