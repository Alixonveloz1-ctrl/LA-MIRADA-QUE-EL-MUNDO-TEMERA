#!/usr/bin/env node
// Genera datos/serie.json a partir de datos/serie.base.json.
//
// serie.base.json es el archivo tal y como llegó. Tiene tres huecos que impiden
// producir el teaser el primer día, y este script los cierra de forma explícita
// y repetible. Cada cambio está justificado abajo y verificado al final: si el
// resultado no cumple los invariantes, el script falla y no escribe nada.
//
//   node herramientas/parche-datos.mjs
//
// El detalle en prosa está en docs/patch-datos.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const serie = JSON.parse(readFileSync(join(raiz, 'datos/serie.base.json'), 'utf8'));

const cambios = [];
const anota = (t) => cambios.push(t);

// ---------------------------------------------------------------------------
// 1. Escenarios del teaser que no existían con ese id.
//
// Tres son el mismo sitio con otro nombre: se reescriben al id canónico para no
// generar dos placas del mismo lugar (dos placas = dos sitios distintos en
// pantalla, y el doble de dinero). El cuarto, el túnel inundado, es un sitio
// que de verdad no estaba: se añade como placa nueva.
// ---------------------------------------------------------------------------

const RENOMBRA_ESCENARIO = {
  celda: 'cripta-celda',            // B1/B4/B5: la celda de la cripta
  'salon-noble': 'elserath-salon',  // D2/D3/D4/D5/E1: el salón de la casa
  'despacho-noble': 'elserath-despacho', // D1: la firma sobre el escritorio
};

const ESCENARIO_NUEVO = {
  id: 'tunel',
  luz: 'BARRIO',
  descripcion:
    'A flooded stone service tunnel under the city: shallow standing water over ' +
    'worn flagstones, dripping vaulted brick, iron grates, faint cold daylight far ahead',
  encuadre: 'Wide establishing shot of the whole space',
  escenas: 1,
  origen: 'parche: la huida de C4 no ocurre en ninguno de los 27 escenarios del guion',
  no_fusionar_con: 'tuneles',
  nota:
    'OJO: "tunel" y "tuneles" son DOS SITIOS DISTINTOS con nombres casi iguales. ' +
    'Este es el canal inundado por el que Saharis escapa a los diez años: agua, ' +
    'ladrillo, rejas, se cruza corriendo. No tiene nada dentro. ' +
    'No se fusionan nunca, por parecido que suene el nombre.',
};

// El gemelo del anterior. Lleva la misma advertencia por el otro lado, para que
// quien lea cualquiera de los dos vea que el otro existe y es diferente.
const NOTA_TUNELES = {
  no_fusionar_con: 'tunel',
  nota:
    'OJO: "tuneles" y "tunel" son DOS SITIOS DISTINTOS con nombres casi iguales. ' +
    'Este es la habitación de Saharis bajo la ciudad: seca, con catre, mesa, un ' +
    'farol y la pared entera cubierta de papeles, mapas, listas y cordel. Se ' +
    'habita, no se cruza. No se fusionan nunca, por parecido que suene el nombre.',
};

// ---------------------------------------------------------------------------
// 2. Referencias del teaser que no existían como placa del banco.
//
// Dos casos distintos:
//   a) La placa existe con otro nombre (el teaser llama al niño "nino5" y el
//      banco lo llama "saharis-5"). Es la misma persona: se reescribe la
//      referencia. Generar las dos series por separado daría dos niños
//      distintos y rompería los flashbacks, que es justo lo que el banco de
//      edades existe para evitar.
//   b) La placa es de detalle (manos, nuca, espalda, escorzo) y no estaba en
//      ninguna forma. Se añade al banco, encadenada al ancla de su personaje.
// ---------------------------------------------------------------------------

const RENOMBRA_REF = {
  'nino5-cripta': 'saharis-5-cripta',
  'nino5-barrio': 'saharis-5-barrio',
  'nino5-manos': 'saharis-5-manos',
  'nino10-barrio-espalda': 'saharis-10-espalda',
  'bebe-cripta': 'saharis-bebe-cripta',
  'bebe-ancla': 'saharis-bebe-ancla',
  'madre-barrio-34': 'madre-barrio',
  'madre-barrio-espalda': 'madre-espalda',
};

// Las placas de detalle encadenan a su ancla EXACTAMENTE IGUAL que las demás:
// no son ancla, así que promptPlaca() les adjunta el ancla de su personaje. Si
// saharis-manos se generase suelta, las manos no serían las mismas manos.
//
// Pero la instrucción genérica del banco habla de cara, pelo y ojos, y en una
// placa de manos o de nuca no hay cara. Una referencia sin propósito hace que el
// modelo copie el encuadre en vez de la identidad —es una de las trampas ya
// pagadas—, así que cada placa de detalle lleva su propia línea diciendo qué
// copiar del ancla y, sobre todo, qué NO dibujar.
const DETALLE = (nombre, queCopiar, queNoDibujar) =>
  `CHARACTER ANCHOR above: this is ${nombre}. This new plate shows ONLY ${queNoDibujar.parte}. ` +
  `Copy from the anchor exactly: ${queCopiar}. ` +
  `Do NOT draw ${queNoDibujar.nada} — it is not in frame in this plate. ` +
  `Do NOT copy the pose, the framing, the scale or the background: redraw them as this plate describes.`;

const PLACAS_NUEVAS = [
  {
    id: 'saharis-34',
    personaje: 'saharis',
    luz: 'NEUTRA',
    encuadre: 'Medium shot, three-quarter view, neutral dark background, even directional light, no expression',
  },
  {
    id: 'saharis-noble-frontal',
    personaje: 'saharis',
    luz: 'NOBLE',
    encuadre: 'Close up portrait, front facing, half the face in warm gold light and half in complete shadow, no expression',
  },
  {
    id: 'saharis-noble-nuca',
    personaje: 'saharis',
    luz: 'NOBLE',
    encuadre: 'Medium shot from directly behind: back of the head and shoulders only, immaculate dark noble coat with a high collar, face not visible',
    detalle: true,
    instruccion_referencia: DETALLE(
      'Saharis',
      'the exact hair colour, the short neat cut and its hairline at the nape, the head and shoulder proportions, the build, the collar and cut of the charcoal noble coat',
      { parte: 'the back of his head and shoulders', nada: 'his face, his eyes or any part of the front of his head' },
    ),
  },
  {
    id: 'saharis-manos',
    personaje: 'saharis',
    luz: 'NOBLE',
    encuadre: 'Close detail of both adult male hands only, clean, a silver signet ring, a long old ritual scar across the left palm, no face in frame',
    detalle: true,
    instruccion_referencia: DETALLE(
      'Saharis',
      'the exact skin tone (pale olive), the age and build of the hands, the silver signet ring and the long old ritual scar across the left palm',
      { parte: 'his hands', nada: 'his face, his head or his body' },
    ),
  },
  {
    id: 'saharis-5-manos',
    personaje: 'saharis-5',
    luz: 'CRIPTA',
    encuadre: 'Close detail of a small five year old child\'s hands only, filthy and thin, dirt in every crease, no face in frame',
    detalle: true,
    instruccion_referencia: DETALLE(
      'Saharis at five',
      'the exact skin tone (pale olive), how thin and undernourished the hands are, the size and proportions of a five year old\'s hands, the dirt worked into every crease',
      { parte: 'his hands', nada: 'his face, his head or his body' },
    ),
  },
  {
    id: 'saharis-10-espalda',
    personaje: 'saharis-10',
    luz: 'BARRIO',
    encuadre: 'Medium shot from directly behind: a ten year old boy in thin scavenged dark clothing, face not visible',
    detalle: true,
    instruccion_referencia: DETALLE(
      'Saharis at ten',
      'the exact hair colour and its length to the jaw, the wiry build and height of a ten year old, the thin scavenged dark clothing and the cloth wraps on his feet',
      { parte: 'his back, seen from behind', nada: 'his face or any part of the front of his head' },
    ),
  },
  {
    id: 'madre-manos',
    personaje: 'madre',
    luz: 'BARRIO',
    encuadre: 'Close detail of both adult female hands only, very thin, old and fresh scars across both wrists, no face in frame',
    detalle: true,
    instruccion_referencia: DETALLE(
      'the mother',
      'the exact skin tone (pale olive), how very thin and worn the hands are, and the old and fresh scars across both wrists',
      { parte: 'her hands', nada: 'her face, her head or her body' },
    ),
  },
  {
    id: 'madre-espalda',
    personaje: 'madre',
    luz: 'BARRIO',
    encuadre: 'Medium shot from directly behind: a gaunt young woman sitting, long matted dark brown hair, torn undyed linen shift, face not visible',
    detalle: true,
    instruccion_referencia: DETALLE(
      'the mother',
      'the exact hair colour and its long matted unwashed texture, the gaunt build and narrow shoulders, and the torn undyed linen shift',
      { parte: 'her back, seen from behind', nada: 'her face or any part of the front of her head' },
    ),
  },
];

// ---------------------------------------------------------------------------
// 3. Modelo de texto para el desglose.
//
// El plan pide una llamada de texto por escena y serie.base.json no declara
// ningún modelo de texto. Sin esta entrada el desglose no tendría a quién
// preguntar, y un id escrito en el código sería justo lo que la sección de
// modelos prohíbe.
// ---------------------------------------------------------------------------

const MODELO_TEXTO = {
  id: 'gemini-3-pro',
  region: 'global',
  protocolo: 'generateContent',
  nota: 'Solo para el desglose de guion a planos. No genera imagen ni vídeo. Los Gemini 3.x solo se sirven desde "global".',
};

// === aplicación ============================================================

for (const [viejo, nuevo] of Object.entries(RENOMBRA_ESCENARIO)) {
  let n = 0;
  for (const pieza of Object.values(serie.piezas)) {
    for (const toma of pieza.tomas) {
      if (toma.escenario === viejo) { toma.escenario = nuevo; n++; }
    }
  }
  if (n) anota(`escenario "${viejo}" → "${nuevo}" en ${n} tomas`);
}

if (!serie.escenarios.placas.some((e) => e.id === ESCENARIO_NUEVO.id)) {
  serie.escenarios.placas.push(ESCENARIO_NUEVO);
  anota(`escenario nuevo "${ESCENARIO_NUEVO.id}"`);
}

const tuneles = serie.escenarios.placas.find((e) => e.id === 'tuneles');
if (tuneles && !tuneles.no_fusionar_con) {
  Object.assign(tuneles, NOTA_TUNELES);
  anota('aviso de no fusionar puesto en "tuneles" y en "tunel"');
}

for (const [viejo, nuevo] of Object.entries(RENOMBRA_REF)) {
  let n = 0;
  for (const pieza of Object.values(serie.piezas)) {
    for (const toma of pieza.tomas) {
      toma.refs = (toma.refs || []).map((r) => (r === viejo ? (n++, nuevo) : r));
    }
  }
  if (n) anota(`referencia "${viejo}" → "${nuevo}" en ${n} tomas`);
}

const yaEstan = new Set(serie.banco.placas.map((p) => p.id));
for (const placa of PLACAS_NUEVAS) {
  if (yaEstan.has(placa.id)) continue;
  serie.banco.placas.push(placa);
  anota(`placa nueva "${placa.id}" (${placa.personaje}, ${placa.luz})`);
}

if (!serie.modelos.texto) {
  serie.modelos.texto = MODELO_TEXTO;
  serie.modelos.sustituible_por_entorno.push('TEXTO_MODEL');
  anota('modelos.texto añadido (desglose)');
}

// ---------------------------------------------------------------------------
// 4. El opening y el ending.
//
// Faltaban, y son estructurales: un animé los tiene y son LOS MISMOS en los doce
// episodios. Se generan UNA VEZ —27 planos el opening, 15 el ending— y a partir
// de ahí se pegan como capa en cada montaje. Nunca se regeneran por episodio: a
// 400 planos por episodio, regenerarlos doce veces serían 504 planos tirados y,
// peor, doce openings ligeramente distintos.
//
// Viven en datos/opening-ending.json para que se puedan leer y corregir sin
// bucear en este script.
// ---------------------------------------------------------------------------

const opEd = JSON.parse(readFileSync(join(raiz, 'datos/opening-ending.json'), 'utf8'));

for (const pieza of ['opening', 'ending']) {
  if (serie.piezas[pieza]) continue;
  serie.piezas[pieza] = opEd[pieza];
  anota(`pieza «${pieza}» añadida (${opEd[pieza].tomas.length} planos, ${opEd[pieza].duracion_s} s)`);
}

const yaSuena = new Set(serie.musica.piezas.map((m) => m.id));
for (const tema of opEd.musica) {
  if (yaSuena.has(tema.id)) continue;
  serie.musica.piezas.push(tema);
  anota(`música «${tema.id}» añadida (${tema.duracion_s} s)`);
}

if (!serie.episodios.opening_ending) {
  serie.episodios.opening_ending = {
    regla:
      'El opening y el ending se generan UNA VEZ para toda la serie y se pegan como capa en cada ' +
      'episodio. No se regeneran nunca por episodio.',
    montaje:
      'El montaje de un episodio es: opening + acto I + acto II + ... + ending, y todos entran por ' +
      'capas_previas ya montados. La capa de episodio solo concatena.',
    por_que:
      'A 400 planos por episodio, regenerarlos doce veces serían 504 planos tirados y doce ' +
      'openings ligeramente distintos, que es lo que hace que una serie parezca hecha a trozos.',
    orden: ['opening', 'actos', 'ending'],
  };
  anota('episodios.opening_ending: la regla de generarlos una vez');
}

// ---------------------------------------------------------------------------
// 5. Las GRAFÍAS de cada modelo, y los ids que de verdad existen.
//
// Esto sale de un despliegue real: Salud dio 404 en voz, música y texto, con el
// mismo mensaje —«not found or your project does not have access to it»— aunque
// la cuenta estaba bien y las voces de TTS sí se listaron.
//
// Dos causas, las dos comprobadas contra un proyecto del mismo autor que ya
// funciona en producción (Prisma-Negro):
//
//   a) VERTEX PUBLICA EL MISMO MODELO CON DOS GRAFÍAS: la de preview y la
//      definitiva. Las dos existen, y cuál contesta depende del proyecto. Pedir
//      solo una y recibir 404 se lee como «no lo tienes», y es mentira. Así que
//      cada modelo pasa a tener una LISTA de grafías que se prueban en orden.
//
//   b) TRES IDS ESTABAN SENCILLAMENTE MAL. El de música era el peor: se pedía
//      «lyria-3-pro-preview», que no existe. El que hay es «lyria-002», y no es
//      el mismo trato: usa `:predict` en vez de `:generateContent` y NO ADMITE
//      DURACIÓN — devuelve unos 30 s pase lo que pase.
// ---------------------------------------------------------------------------

const GRAFIAS = {
  'imagen.calidad':   ['gemini-3-pro-image', 'gemini-3-pro-image-preview'],
  'imagen.medio':     ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview'],
  'imagen.economico': ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'],
  'video.calidad':    ['veo-3.1-generate-001', 'veo-3.1-generate-preview'],
  'video.medio':      ['veo-3.1-fast-generate-001', 'veo-3.1-fast-generate-preview'],
  'video.economico':  ['veo-3.1-lite-generate-001', 'veo-3.1-lite-generate-preview'],
};

for (const [camino, ids] of Object.entries(GRAFIAS)) {
  const [familia, nivel] = camino.split('.');
  const entrada = serie.modelos[familia] && serie.modelos[familia][nivel];
  if (!entrada || entrada.ids) continue;
  entrada.ids = ids;
  if (entrada.id !== ids[0]) entrada.id = ids[0];
  anota(`grafías de ${camino}: ${ids.join(', ')}`);
}

// Voz: la de preview es la que contesta en los proyectos nuevos.
if (!serie.voces.modelo.ids) {
  serie.voces.modelo.ids = ['gemini-3.1-flash-tts-preview', 'gemini-3.1-flash-tts',
                            'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts'];
  anota('grafías de voz: 4, empezando por la de preview');
}

// Texto: «gemini-3-pro» no existe. El que hay es «gemini-3.1-pro».
if (serie.modelos.texto && !serie.modelos.texto.ids) {
  serie.modelos.texto.ids = ['gemini-3.1-pro-preview', 'gemini-3.1-pro', 'gemini-2.5-pro'];
  serie.modelos.texto.id = 'gemini-3.1-pro-preview';
  anota('modelo de texto: gemini-3-pro no existe → gemini-3.1-pro(-preview)');
}

// Música: otro modelo, otro protocolo y otro límite.
if (serie.musica.modelo.id !== 'lyria-002') {
  serie.musica.modelo = {
    id: 'lyria-002',
    ids: ['lyria-002'],
    protocolo: 'predict',
    maximo_s: 30,
    nota:
      'Lyria 2. Se pide con «:predict» —instances[{prompt, negative_prompt}] y ' +
      'parameters{sample_count}—, NO con generateContent. Y NO admite duración: ' +
      'pidiéndole 120 s devuelve 30. Una pieza más larga se compone de varios ' +
      'trozos unidos con fundidos en el montaje.',
  };
  anota('música: lyria-3-pro-preview no existe → lyria-002 (:predict, ~30 s)');
}

// ---------------------------------------------------------------------------
// 6. Partir las piezas de música que ya no caben.
//
// Con lyria-3-pro (3 minutos) una pieza de 90 s era una sola generación. Con
// lyria-002 el tope real son ~30 s y NO admite duración: pedirle 90 devuelve 30
// sin decir nada. Así que cada pieza larga pasa a ser varios TROZOS que el
// montaje une con fundidos de 2,5 s —los cortos suenan a tajo—.
//
// A cada trozo se le dice en qué punto de la pieza está y qué le tocaba sonar
// ahí, para que el encargo siga teniendo sentido por sí solo: un trozo que no
// sabe que es el estribillo suena a introducción.
//
// La letra se reparte: cada trozo canta los versos que caen dentro de él.
// ---------------------------------------------------------------------------

const TOPE = serie.musica.modelo.maximo_s || 30;

const TRAMOS = {
  'teaser-lecho': [
    [0, 26, 'the opening third: low sustained strings alone, oppressive, no percussion at all'],
    [26, 52, 'the middle third: the solo wooden flute carries its broken folk melody over the strings, and a dry hand-drum pulse with no reverb enters and grows'],
    [52, 78, 'the final third: the drum and strings build, then stop dead into complete silence, and one last flute fragment is cut off mid-note'],
  ],
  'opening-tema': [
    [0, 30, 'the opening third: solo wooden flute alone with a broken folk melody, low strings entering underneath, the female vocal beginning'],
    [30, 60, 'the middle third: a dry hand-drum pulse with no reverb driving underneath, the vocal in full verse, building toward the chorus'],
    [60, 90, 'the final third: the chorus, full ensemble, the vocal exhausted rather than triumphant, ending on an unresolved chord that hangs'],
  ],
  'ending-tema': [
    [0, 30, 'the opening third: a solo female voice almost unaccompanied, close and dry, a single sustained low string joining underneath'],
    [30, 60, 'the middle third: the same voice and the same unmoving string, no build of any kind'],
    [60, 90, 'the final third: a wooden flute answers the voice once, quietly, does not finish its phrase, and everything fades to nothing'],
  ],
};

const piezasDeMusica = [];
const renombra = {};

for (const pieza of serie.musica.piezas) {
  const tramos = TRAMOS[pieza.id];
  if (!tramos || pieza.duracion_s <= TOPE) { piezasDeMusica.push(pieza); continue; }

  const letra = (serie.piezas[pieza.id.replace(/-tema$/, '')] || {}).letra || [];
  renombra[pieza.id] = [];

  tramos.forEach(([desde, hasta, queSuena], i) => {
    const mios = letra.filter((l) => l.t >= desde && l.t < hasta);
    const versos = mios.map((l) => l.ja).join('\n');
    const id = `${pieza.id}-${i + 1}`;

    piezasDeMusica.push({
      ...pieza,
      id,
      duracion_s: Math.min(TOPE, hasta - desde),
      parte: { de: pieza.id, n: i + 1, total: tramos.length, desde, hasta, fundido_s: 2.5 },
      encargo:
        `${pieza.encargo.split('The song is sung in JAPANESE')[0].trim()}\n\n` +
        `THIS IS PART ${i + 1} OF ${tramos.length} of a ninety-second piece, covering seconds ` +
        `${desde} to ${hasta}. Write ONLY ${queSuena}. It must start and end so that it can be ` +
        `cross-faded into the neighbouring parts.` +
        (versos ? `\n\nSung in JAPANESE, with these exact lyrics and no others:\n${versos}` : '') +
        '\n\nClear diction. No English anywhere in the vocal.',
      nota:
        `Trozo ${i + 1} de ${tramos.length} de «${pieza.id}». Lyria 2 da unos 30 s por generación ` +
        'y no admite duración, así que la pieza se compone de trozos unidos con fundidos de 2,5 s.',
    });
    renombra[pieza.id].push(id);
  });
  anota(`música «${pieza.id}» (${pieza.duracion_s} s) partida en ${tramos.length} trozos de ${TOPE} s`);
}

serie.musica.piezas = piezasDeMusica;

// Las piezas que la nombraban pasan a nombrar sus trozos, en orden.
for (const pieza of Object.values(serie.piezas)) {
  const lista = pieza.audio && Array.isArray(pieza.audio.musica) ? pieza.audio.musica : null;
  if (!lista) continue;
  pieza.audio.musica = lista.flatMap((id) => renombra[id] || [id]);
}

serie.meta.version_datos = (serie.meta.version_datos || 0) + 1;
serie.meta.parche = {
  de: 'datos/serie.base.json',
  con: 'herramientas/parche-datos.mjs',
  por_que: 'Cerrar los huecos que impedían producir el teaser el primer día. Ver docs/patch-datos.md.',
  cambios,
};

// === verificación ==========================================================
// Si el parche no deja el archivo válido, no se escribe.

const placas = new Set(serie.banco.placas.map((p) => p.id));
const escenarios = new Set(serie.escenarios.placas.map((e) => e.id));
const quejas = [];

for (const [idPieza, pieza] of Object.entries(serie.piezas)) {
  for (const toma of pieza.tomas) {
    for (const ref of toma.refs || []) {
      if (!placas.has(ref)) quejas.push(`${idPieza}/${toma.id}: la referencia "${ref}" no existe en el banco`);
    }
    if (toma.escenario && !escenarios.has(toma.escenario)) {
      quejas.push(`${idPieza}/${toma.id}: el escenario "${toma.escenario}" no existe`);
    }
    // Una toma sin escenario solo vale si es la cartela: un fotograma negro con
    // el título compuesto en el montaje, que no es un sitio que se genere.
    const esCartela = toma.cartela === true || serie.cartela?.toma === toma.id;
    if (!toma.escenario && !esCartela) {
      quejas.push(`${idPieza}/${toma.id}: no tiene escenario y no está marcada como cartela`);
    }
  }
}
for (const placa of serie.banco.placas) {
  if (!serie.personajes[placa.personaje]) quejas.push(`placa "${placa.id}": el personaje "${placa.personaje}" no existe`);
  if (placa.encadena_a && !placas.has(placa.encadena_a)) quejas.push(`placa "${placa.id}": encadena a "${placa.encadena_a}", que no existe`);

  // Una placa de detalle que fuera ancla se generaría solo con texto y sin
  // referencia: las manos no serían las mismas manos. Que no pueda pasar.
  if (placa.detalle) {
    if (placa.ancla) quejas.push(`placa "${placa.id}": es de detalle y está marcada como ancla; una placa de detalle nunca es ancla`);
    const ancla = serie.banco.placas.find((p) => p.personaje === placa.personaje && p.ancla);
    if (!ancla) quejas.push(`placa "${placa.id}": es de detalle y su personaje "${placa.personaje}" no tiene ancla a la que encadenar`);
    if (!placa.instruccion_referencia) quejas.push(`placa "${placa.id}": es de detalle y no dice qué copiar del ancla`);
  }
}

// Los dos sitios de nombre casi igual siguen siendo dos.
const tunelSuelto = serie.escenarios.placas.find((e) => e.id === 'tunel');
const tunelesRoom = serie.escenarios.placas.find((e) => e.id === 'tuneles');
if (!tunelSuelto || !tunelesRoom) {
  quejas.push('han desaparecido "tunel" o "tuneles": son dos sitios distintos y los dos tienen que existir');
} else if (tunelSuelto.descripcion === tunelesRoom.descripcion) {
  quejas.push('"tunel" y "tuneles" han acabado con la misma descripción: alguien los ha fusionado');
}

if (quejas.length) {
  console.error('El parche no deja los datos válidos. No se ha escrito nada:\n');
  for (const q of quejas) console.error('  · ' + q);
  process.exit(1);
}

writeFileSync(join(raiz, 'datos/serie.json'), JSON.stringify(serie, null, 2) + '\n');
console.log(`datos/serie.json escrito. ${cambios.length} cambios:\n`);
for (const c of cambios) console.log('  · ' + c);
