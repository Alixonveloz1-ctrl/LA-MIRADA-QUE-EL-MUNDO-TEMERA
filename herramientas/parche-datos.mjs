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
  },
  {
    id: 'saharis-manos',
    personaje: 'saharis',
    luz: 'NOBLE',
    encuadre: 'Close detail of both adult male hands only, clean, a silver signet ring, a long old ritual scar across the left palm, no face in frame',
  },
  {
    id: 'saharis-5-manos',
    personaje: 'saharis-5',
    luz: 'CRIPTA',
    encuadre: 'Close detail of a small five year old child\'s hands only, filthy and thin, dirt in every crease, no face in frame',
  },
  {
    id: 'saharis-10-espalda',
    personaje: 'saharis-10',
    luz: 'BARRIO',
    encuadre: 'Medium shot from directly behind: a ten year old boy in thin scavenged dark clothing, face not visible',
  },
  {
    id: 'madre-manos',
    personaje: 'madre',
    luz: 'BARRIO',
    encuadre: 'Close detail of both adult female hands only, very thin, old and fresh scars across both wrists, no face in frame',
  },
  {
    id: 'madre-espalda',
    personaje: 'madre',
    luz: 'BARRIO',
    encuadre: 'Medium shot from directly behind: a gaunt young woman sitting, long matted dark brown hair, torn undyed linen shift, face not visible',
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
  }
}
for (const placa of serie.banco.placas) {
  if (!serie.personajes[placa.personaje]) quejas.push(`placa "${placa.id}": el personaje "${placa.personaje}" no existe`);
  if (placa.encadena_a && !placas.has(placa.encadena_a)) quejas.push(`placa "${placa.id}": encadena a "${placa.encadena_a}", que no existe`);
}

if (quejas.length) {
  console.error('El parche no deja los datos válidos. No se ha escrito nada:\n');
  for (const q of quejas) console.error('  · ' + q);
  process.exit(1);
}

writeFileSync(join(raiz, 'datos/serie.json'), JSON.stringify(serie, null, 2) + '\n');
console.log(`datos/serie.json escrito. ${cambios.length} cambios:\n`);
for (const c of cambios) console.log('  · ' + c);
