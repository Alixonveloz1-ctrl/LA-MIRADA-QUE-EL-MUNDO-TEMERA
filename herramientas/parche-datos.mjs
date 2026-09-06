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
    encuadre: 'Medium shot from directly behind: back of the head and shoulders only, immaculate dark noble coat with the collar turned down and low, the nape of the neck bare, short black hair hacked off unevenly at the back, face not visible',
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
    encuadre: 'Close detail of a young child\'s hands only, small, a little dust across the knuckles, no face in frame',
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
    encuadre: 'Close detail of both adult female hands only, thin and worn, old and recent chafe marks from restraints ringing both wrists, no face in frame',
    detalle: true,
    instruccion_referencia: DETALLE(
      'the mother',
      'the exact skin tone (pale olive), how thin and worn the hands are, and the old and recent chafe marks ringing both wrists',
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

// LA REGIÓN DE LA VOZ, DECLARADA. Sin declararla, cada grafía se pide a la que
// le tocaría por su nombre —«global» las 3.x, la región de la cuenta las 2.5— y
// las dos últimas se irían a un sitio donde no están. Gemini TTS se sirve desde
// «global» en las dos generaciones: es lo que hay funcionando hoy en producción
// en studio.LegadodeHierro, que llama a gemini-2.5-flash-tts en
// /locations/global/. Declarada aquí, manda para las cuatro.
if (!serie.voces.modelo.region) {
  serie.voces.modelo.region = 'global';
  anota('región de la voz: global, para las cuatro grafías');
}

// UN MODELO RÁPIDO PARA LO CORTO, Y NO ES UN LUJO: ERA UN FALLO.
//
// Había un solo modelo de texto, «gemini-3.1-pro», declarado para el DESGLOSE
// —convertir una escena en diecisiete planos—, que sí necesita razonar. Pero se
// estaba usando también para traducir al japonés una frase suelta, con un límite
// de veinte segundos, y un modelo de razonamiento no cabe ahí: la llamada se
// cortaba a los 20 s y el personaje se quedaba sin poder generar NI UNA voz,
// porque la traducción es el primer paso de todas.
//
// Traducir una línea es trabajo de un flash: tarda un par de segundos, cuesta
// una fracción y deja sitio de sobra para la síntesis de voz dentro de la misma
// petición. El pro se queda donde hace falta.
if (serie.modelos && !serie.modelos.texto_rapido) {
  serie.modelos.texto_rapido = {
    id: 'gemini-3.1-flash-preview',
    ids: ['gemini-3.1-flash-preview', 'gemini-3.1-flash', 'gemini-2.5-flash'],
    region: 'global',
    protocolo: 'generateContent',
    nota:
      'Para lo corto y lo que corre: traducir una línea al japonés. NO para el desglose, que es ' +
      'donde hace falta razonar y para eso está modelos.texto. Los Gemini 3.x solo se sirven ' +
      'desde "global".',
  };
  anota('modelo de texto rápido añadido (traducciones), separado del pro del desglose');
}

// Texto: «gemini-3-pro» no existe. El que hay es «gemini-3.1-pro».
if (serie.modelos.texto && !serie.modelos.texto.ids) {
  serie.modelos.texto.ids = ['gemini-3.1-pro-preview', 'gemini-3.1-pro', 'gemini-2.5-pro'];
  serie.modelos.texto.id = 'gemini-3.1-pro-preview';
  anota('modelo de texto: gemini-3-pro no existe → gemini-3.1-pro(-preview)');
}

// Música: el modelo estaba BIEN. Lo que estaba mal era la REGIÓN.
//
// serie.base.json declara la música sin región, así que se pedía a la de por
// defecto (us-central1) y Vertex contestaba 404 — el mismo 404 que dan los
// Gemini 3.x fuera de «global», y que se lee como «tu cuenta no lo tiene».
//
// Lyria 3 Pro se sirve SOLO desde «global». Y no tiene endpoint propio: se pide
// como un Gemini, con «:generateContent» y responseModalities ['AUDIO','TEXT'].
// La duración no es un parámetro: se pide en prosa dentro del propio encargo.
//
// Comprobado contra studio.LegadodeHierro, del mismo autor, que genera piezas de
// 80 s con este modelo en producción. Llega a 184 s.
if (!serie.musica.modelo.region) {
  serie.musica.modelo.region = 'global';
  serie.musica.modelo.protocolo = 'generateContent';
  serie.musica.modelo.maximo_s = 184;
  serie.musica.modelo.modalidades = ['AUDIO', 'TEXT'];
  serie.musica.modelo.nota =
    'Lyria 3 Pro. SOLO se sirve desde la región «global»: pedirlo a una región ' +
    'concreta devuelve un 404 que parece falta de acceso y no lo es. Se pide como ' +
    'un Gemini, con :generateContent y responseModalities [AUDIO, TEXT]. La ' +
    'duración no es un parámetro: va en prosa dentro del encargo. Llega a 184 s.';
  anota('música: región «global» —ese era el 404— y máximo 184 s');
}


// ---------------------------------------------------------------------------
// 6. Las voces de Gemini, y el género de cada personaje.
//
// El plan descarta Chirp de todo el proyecto —«Chirp lee, este actúa»— y sin
// embargo la pantalla enseñaba voces «ja-JP-Chirp3-HD-…». La causa: las voces se
// pedían a texttospeech.googleapis.com, que es el servicio de Cloud TTS y
// devuelve justo las que no se quieren. Las de Gemini NO se listan por API: son
// treinta, fijas, y viven en datos/voces-gemini.json.
//
// Y el género del personaje, para no enseñar voces femeninas a un personaje
// masculino. Sale de su propia identidad, que ya lo dice en la primera línea.
// ---------------------------------------------------------------------------

serie.voces.catalogo = JSON.parse(
  readFileSync(join(raiz, 'datos/voces-gemini.json'), 'utf8'),
).voces;
anota(`catálogo de ${serie.voces.catalogo.length} voces de Gemini (Chirp fuera)`);

const GENERO = {
  femenina: /\b(woman|girl|female|her daughter|mother)\b/i,
  masculina: /\b(man|boy|male|priest|clerk|infant)\b/i,
};

let conGenero = 0;
for (const [id, ficha] of Object.entries(serie.personajes)) {
  if (ficha.genero) continue;
  const texto = String(ficha.identidad || '');
  // Se mira femenino primero: «young woman» y «man» conviven en más de una
  // identidad, y quien manda es el sujeto, que va al principio.
  const primeraF = texto.search(GENERO.femenina);
  const primeraM = texto.search(GENERO.masculina);
  ficha.genero =
    primeraF >= 0 && (primeraM < 0 || primeraF < primeraM) ? 'femenina'
    : primeraM >= 0 ? 'masculina'
    : 'sin decidir';
  conGenero += 1;
}
anota(`género puesto a ${conGenero} personajes, sacado de su identidad`);

// EL GÉNERO DE LOS QUE HABLAN Y NO TIENEN FICHA.
//
// Once personajes del reparto NO están en `serie.personajes`: están en
// `personajes_figurantes.ids`, que es una lista de ids pelados —sin identidad y
// sin género, porque a un figurante le basta un ancla genérica—. El bucle de
// arriba recorre `serie.personajes`, así que a estos no los miraba: se quedaban
// sin género y la pantalla les enseñaba las treinta voces, que es exactamente lo
// que no se quería.
//
// Se pone a mano y uno a uno, no con una regla sobre el nombre, porque la regla
// se equivocaría en el que importa: «voz» es palabra femenina en español y el
// guion dice de ella, literalmente, «voz interior, sin cuerpo, sin género
// claro». Eso es una decisión de la historia y no se toca.
const GENERO_FIGURANTE = {
  hombre: 'masculina',          // ep3 y ep4: el guion lo trata en masculino
  concejal: 'masculina',
  'otro concejal': 'masculina',
  invitado: 'masculina',
  invitada: 'femenina',
  sacerdote: 'masculina',
  administrador: 'masculina',
  criado: 'masculina',
  secretario: 'masculina',
  encargado: 'masculina',
  voz: 'sin decidir',           // ep5/13: «voz interior, sin cuerpo, sin género claro»
};

// ---------------------------------------------------------------------------
// LA FRASE DE MUESTRA DE TODO EL QUE HABLA.
//
// Para elegirle voz a un personaje hay que oírle decir algo, y lo que dice sale
// de `voces.reparto[].muestra`. Once de los veintinueve no la traían escrita:
// figurantes con dos o tres líneas.
//
// LO QUE PASABA ANTES, Y ESTABA MAL. La pantalla de Voces SÍ les buscaba su
// línea más difícil en los guiones y la enseñaba —con su episodio, su escena y
// por qué esa—, pero el botón de probar voces salía apagado y en su sitio había
// un recuadro con un JSON y un botón de «copiar para serie.json». Es decir: la
// herramienta tenía la frase delante, la estaba pintando en la pantalla, y aun
// así mandaba a editar un archivo a mano y a volver a desplegar. Si algo se
// puede hacer aquí, se hace aquí.
//
// Se cierra en el origen, que es donde toca: la frase se escribe EN EL DATO, con
// el mismo criterio con el que la pantalla la elegía. Así el servidor no cambia
// —sigue leyendo `voces.reparto[].muestra` y nada más—, la pantalla deja de
// tener un callejón sin salida, y el criterio vive escrito UNA vez.
//
// EL CRITERIO, para que se pueda discutir:
//   1. la línea que el guion marca de riesgo alto, que son las que ningún TTS
//      lleva bien y por tanto las que más hay que oír antes de decidir;
//   2. si no hay ninguna, la que lleva la intención más detallada, que es la que
//      más le pide a la voz;
//   3. a igualdad, la más larga.
//
// Lo que NO se hace jamás es inventar una frase. Quien no habla ni una vez en
// los guiones se queda sin muestra, y la pantalla lo dice con esas palabras.
// ---------------------------------------------------------------------------

const guiones = JSON.parse(readFileSync(join(raiz, 'datos/guiones.json'), 'utf8'));

/**
 * Cuántos caracteres tiene que tener una frase para servir de muestra.
 *
 * Con menos no se oye una interpretación, se oye un ruido: «¿Cómo?» no deja
 * juzgar una entrada, un cuerpo y un cierre, que es lo que se está comparando
 * entre treinta voces. Veinte caracteres son unas cuatro palabras.
 */
const LARGO_MINIMO_DE_MUESTRA = 20;

/**
 * ¿Esta frase está cortada? Empieza por puntos suspensivos, o acaba sin cerrar.
 *
 * Importa por dos motivos, y los dos se pagaron:
 *
 *   1. COMO MUESTRA NO SIRVE. Media frase no deja juzgar una voz: no hay
 *      entrada, no hay cierre, y lo que se oye es un trozo suelto.
 *   2. Y ROMPE LA TRADUCCIÓN. Al modelo se le pide la frase en japonés «sin
 *      explicación y sin notas»; ante un texto cortado contesta una nota
 *      avisando de que está incompleta, la comprobación de «esto no está en
 *      japonés» salta, y ese personaje se queda sin poder generar NADA —la
 *      traducción es el primer paso de todas sus voces—. Le pasaba a Iven, cuya
 *      frase acababa en «y sin un solo».
 *
 * En el guion esas interrupciones se quedan como están: son la escena. Lo que
 * cambia es cuál se elige para ESCUCHAR.
 */
function fraseCortada(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  return /^[.…]/.test(t) || !/[.!?…»)"']$/.test(t);
}

/** La línea más difícil de un personaje en los guiones, con el criterio de arriba. */
function lineaMasDificil(id) {
  // −Infinity y no −1: con los castigos de abajo una nota puede salir negativa,
  // y arrancando en −1 un personaje cuya ÚNICA línea esté cortada se quedaría
  // sin ninguna. Peor una frase mala que ninguna frase: sin ella no se le puede
  // elegir voz de ningún modo.
  let mejor = null;
  let mejorNota = -Infinity;
  let cuantas = 0;
  let deRiesgo = 0;

  for (const episodio of guiones.guiones || []) {
    for (const escena of (episodio && episodio.escenas) || []) {
      for (const linea of (escena && escena.dialogo) || []) {
        if (!linea || linea.quien !== id) continue;
        const texto = typeof linea.texto === 'string' ? linea.texto.trim() : '';
        if (!texto) continue;

        cuantas += 1;
        const riesgo = String(linea.riesgo || '').trim().toLowerCase() === 'alto';
        if (riesgo) deRiesgo += 1;

        const intencion = typeof linea.intencion === 'string' ? linea.intencion.trim() : '';

        // DOS CASTIGOS, y el orden entre ellos importa.
        //
        //   · Cortada: pierde SIEMPRE. No se puede juzgar una voz con media
        //     frase, y además rompe la traducción al japonés, que es el primer
        //     paso de todas las voces de ese personaje.
        //   · Muy corta: pierde casi siempre. «¿Cómo?» son dos palabras: no dan
        //     para oír una entrada, un cuerpo y un cierre, que es lo que se está
        //     juzgando. Y la intención más detallada suele estar justo en las
        //     líneas más cortas —«desconcertado; no esperaba que alguien
        //     escuchara» para decir «¿Cómo?»—, así que sin este castigo la regla
        //     las prefiere, que es lo contrario de lo que hace falta.
        //
        // Cortada castiga más que corta: una frase entera y corta se puede oír;
        // una cortada ni se oye bien ni se traduce.
        const castigo =
          (fraseCortada(texto) ? 1_000_000 : 0) +
          (texto.length < LARGO_MINIMO_DE_MUESTRA ? 500_000 : 0);

        const nota = (riesgo ? 100000 : 0) + intencion.length * 100 + texto.length - castigo;

        if (nota > mejorNota) {
          mejorNota = nota;
          mejor = { texto, intencion: intencion || null, ep: episodio.episodio, escena: String(escena.escena), riesgo };
        }
      }
    }
  }

  if (!mejor) return null;

  mejor.porque = mejor.riesgo
    ? (deRiesgo === 1
        ? 'Elegida por ser su única línea marcada de riesgo alto en el guion.'
        : `Elegida por ser una de sus ${deRiesgo} líneas marcadas de riesgo alto en el guion.`)
    : `Elegida por ser, de sus ${cuantas === 1 ? 'única línea' : `${cuantas} líneas`}, la que ` +
      'lleva la intención más detallada.';
  return mejor;
}

let conMuestra = 0;
let rescatados = 0;
const mudos = [];
const sinRecambio = [];

for (const ficha of serie.voces.reparto || []) {
  const escrita = ficha.muestra && typeof ficha.muestra.texto === 'string' ? ficha.muestra.texto.trim() : '';

  // Una muestra escrita a mano se respeta... salvo que esté CORTADA. Cinco lo
  // estaban, y con esas no se puede ni juzgar la voz ni traducir la frase: el
  // personaje se queda sin poder generar nada. Si el guion tiene una línea
  // entera suya, se cambia por esa y se deja dicho.
  if (escrita && !fraseCortada(escrita)) continue;

  const delGuion = lineaMasDificil(String(ficha.personaje));

  if (escrita && (!delGuion || fraseCortada(delGuion.texto))) {
    // Está cortada y no hay ninguna entera con la que sustituirla. Se deja como
    // está —es lo único que dice ese personaje— y se avisa, porque va a fallar.
    sinRecambio.push(String(ficha.personaje));
    continue;
  }

  if (escrita) {
    ficha.muestra = {
      ep: delGuion.ep,
      escena: delGuion.escena,
      texto: delGuion.texto,
      intencion: delGuion.intencion,
      del_guion: true,
      porque: `${delGuion.porque} La que tenía escrita estaba cortada a media frase, y con media ` +
        'frase no se puede juzgar una voz ni traducirla al japonés.',
    };
    rescatados += 1;
    continue;
  }

  if (!delGuion) {
    mudos.push(String(ficha.personaje));
    continue;
  }

  // Si lo mejor que dice es una frase cortada, se le pone igual —peor sería
  // dejarlo sin nada— pero queda avisado: es la que más veces hace que el modelo
  // conteste una nota en vez de traducir.
  if (fraseCortada(delGuion.texto)) sinRecambio.push(String(ficha.personaje));

  ficha.muestra = {
    ep: delGuion.ep,
    escena: delGuion.escena,
    texto: delGuion.texto,
    intencion: delGuion.intencion,
    // De dónde salió y por qué, para que la pantalla lo pueda decir. Una frase
    // sacada del guion no es lo mismo que una escrita a mano para esto, y quien
    // elige la voz tiene derecho a saber cuál de las dos está oyendo.
    del_guion: true,
    porque: delGuion.porque,
  };
  conMuestra += 1;
}
anota(`frase de muestra sacada del guion para ${conMuestra} personajes que no la tenían`);
if (rescatados) anota(`${rescatados} frases de muestra cambiadas por estar cortadas a media frase`);
if (mudos.length) anota(`sin frase de muestra (no hablan en los guiones): ${mudos.join(', ')}`);
if (sinRecambio.length) {
  anota(`OJO — siguen con la frase cortada porque no dicen ninguna entera: ${sinRecambio.join(', ')}`);
}

// ---------------------------------------------------------------------------
// UNA VOZ, UN PERSONAJE — Y QUIÉN PUEDE SALTARSE ESA REGLA.
//
// La regla es que dos personajes no compartan timbre: para el oído serían el
// mismo personaje, y en doce capítulos eso solo se arregla volviendo a grabar.
//
// PERO LOS NÚMEROS NO DAN. Con el género bien puesto salen 21 personajes
// masculinos y el catálogo de Gemini tiene 16 voces masculinas. Faltan cinco, y
// no hay más voces: son treinta y son fijas.
//
// LA SALIDA, que es la del doblaje de toda la vida: el que se oye de verdad
// tiene voz propia; el que dice una o dos líneas puede compartir, pero SOLO con
// alguien que no salga en ninguna de sus escenas. Dos personajes de dos líneas
// en episodios distintos con el mismo timbre no los distingue nadie, porque
// nadie los tiene los dos en la cabeza a la vez.
//
// Aquí se calcula lo que hace falta para poder aplicarla, y se calcula del
// guion, que es quien sabe quién sale con quién:
//
//   genero    · de la ficha si la tiene, y de la tabla de arriba si no.
//   lineas    · ya venía.
//   comparte  · si dice una o dos líneas en toda la serie.
//   con       · con quién comparte escena, aunque sea una sola.
//
// Con esos dos últimos la regla se escribe en una línea y vale igual en el
// servidor y en la pantalla: dos personajes pueden compartir voz si los dos
// tienen `comparte` y ninguno está en el `con` del otro.
// ---------------------------------------------------------------------------

/** Hasta cuántas líneas se considera que a alguien no se le llega a reconocer. */
const LINEAS_PARA_COMPARTIR = 2;

const conQuienSale = {};
for (const episodio of guiones.guiones || []) {
  for (const escena of (episodio && episodio.escenas) || []) {
    const enEsta = new Set();
    for (const linea of (escena && escena.dialogo) || []) {
      if (linea && typeof linea.quien === 'string' && String(linea.texto || '').trim()) {
        enEsta.add(linea.quien);
      }
    }
    for (const uno of enEsta) {
      for (const otro of enEsta) {
        if (uno !== otro) (conQuienSale[uno] = conQuienSale[uno] || new Set()).add(otro);
      }
    }
  }
}

let deLaTabla = 0;
let comparten = 0;
const sinGeneroNinguno = [];

for (const ficha of serie.voces.reparto || []) {
  const id = String(ficha.personaje);
  const conFicha = serie.personajes[id];

  if (conFicha && conFicha.genero) {
    ficha.genero = conFicha.genero;
  } else if (GENERO_FIGURANTE[id]) {
    ficha.genero = GENERO_FIGURANTE[id];
    deLaTabla += 1;
  } else {
    ficha.genero = 'sin decidir';
  }
  if (ficha.genero === 'sin decidir') sinGeneroNinguno.push(id);

  ficha.comparte = Number(ficha.lineas || 0) <= LINEAS_PARA_COMPARTIR;
  if (ficha.comparte) comparten += 1;

  ficha.con = [...(conQuienSale[id] || [])].sort();
}

anota(`género puesto a los ${deLaTabla} del reparto que no tienen ficha de personaje`);
anota(`${comparten} personajes de ${LINEAS_PARA_COMPARTIR} líneas o menos pueden compartir voz`);
if (sinGeneroNinguno.length) {
  anota(`sin género a propósito: ${sinGeneroNinguno.join(', ')} —así lo dice el guion—`);
}

serie.voces.regla_de_voz = {
  lineas_para_compartir: LINEAS_PARA_COMPARTIR,
  como: 'Dos personajes pueden compartir voz solo si los dos tienen "comparte" y ninguno está ' +
        'en el "con" del otro. El que se oye de verdad tiene voz propia; el que dice una o dos ' +
        'líneas puede repetir timbre con alguien que no salga en ninguna de sus escenas.',
  por_que: 'Con el género bien puesto hay 21 personajes masculinos y el catálogo de Gemini solo ' +
           'tiene 16 voces masculinas. No hay más voces: son treinta y son fijas.',
};

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
