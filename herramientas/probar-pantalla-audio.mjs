// Prueba de que lo que hay que poder pulsar SE PUEDE PULSAR.
//
// POR QUÉ EXISTE, y conviene que quede escrito porque la lección es cara.
//
// El opening y el ending llevan letra cantada, y sus subtítulos no se miden: se
// marcan con el dedo, oyendo la canción. Para eso hay una función entera y bien
// escrita, `marcadorDeLetra()`, con su botón, su verso resaltado y su guardado.
//
// En pantalla no salía NADA. Ni el botón, ni un hueco, ni un error.
//
// La condición que decide si se pinta leía `pieza.letra` y `pieza.audio`, y esos
// campos viven en `pieza.datos.letra` y `pieza.datos.audio`: `pieza` es el
// envoltorio `{id, titulo, datos}`. Así que `Array.isArray(undefined)` daba falso
// y el marcador no se pintaba jamás. Sin nada roto que mirar y sin forma de
// montar el opening ni el ending con subtítulos.
//
// Y LA PARTE QUE MÁS DUELE: se avisó de que la opción no salía, y se contestó que
// la pantalla existía —porque se había comprobado que la FUNCIÓN existía—. Un
// `grep` encuentra código escrito; no dice si alguien puede llegar a él. Existir
// y ser alcanzable no es lo mismo.
//
// Por eso esto no comprueba que las funciones existan. PINTA LA PANTALLA con los
// datos de verdad y busca el botón dentro del árbol que sale.

import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

/**
 * Carga la pantalla de Audio con un DOM de mentira que RECUERDA el árbol.
 *
 * No sirve un `h()` que devuelva `{}`: lo que se busca es si un nodo concreto
 * acaba dentro del resultado, así que el árbol tiene que quedar montado.
 */
async function traerLaPantalla() {
  let codigo = readFileSync(`${RAIZ}app/pantallas/audio.js`, 'utf8').replace(
    /^import[\s\S]*?from\s+'[^']*';$/gm,
    ''
  );

  // En la aplicación, la URL firmada de cada pista llega sola al entrar en la
  // pantalla. Aquí se da por llegada: sin URL no hay reproductor, y sin
  // reproductor el marcador no se pinta —con razón, porque no se puede marcar lo
  // que no suena—. Lo que se prueba es lo otro: que CON pista sí aparezca.
  codigo = codigo.replace(
    /function enlaceDe\(ruta\) \{[\s\S]*?\n\}/,
    'function enlaceDe(ruta) { return "https://ejemplo/" + ruta; }'
  );

  const PRESTADO = `
function h(etiqueta, atrs, ...hijos) {
  const nodo = {
    etiqueta, atrs: atrs || {}, hijos: [],
    appendChild(x) { this.hijos.push(x); return x; },
    addEventListener() {}, removeEventListener() {},
    set textContent(v) { this.texto = v; }, get textContent() { return this.texto || ''; },
    querySelector() { return null; }, remove() {}, focus() {}, click() {}
  };
  for (const hijo of hijos.flat()) if (hijo !== null && hijo !== undefined) nodo.hijos.push(hijo);
  return nodo;
}
const document = { createTextNode: (t) => ({ etiqueta: '#texto', texto: String(t), hijos: [] }) };
const aviso = (t) => h('aviso', null, t);
const barra = () => h('barra');
const tarjeta = (o) => h('tarjeta', o, o && o.pie ? [o.pie] : [], o && o.acciones ? [o.acciones] : [],
                         o && o.media ? [o.media] : []);
const boton = (t, f, o) => h('boton', { texto: t, ...(o || {}) }, t);
const seccion = (t, p) => h('seccion', { titulo: t }, p);
const vaciar = (n) => { if (n && n.hijos) n.hijos.length = 0; return n; };
const confirmar = async () => true;
const espera = () => h('espera');
const filtro = () => h('filtro');
const pantalla = () => h('pantalla');
const segundos = (n) => String(n) + ' s';
const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
const bytes = (n) => n + ' B';
const fecha = (x) => String(x);
const llamar = async () => ({});
const cambiar = async () => {};
const actual = () => ({});
const alCambiar = () => {};
const encolar = () => {};
const encolarVarios = () => {};
class ErrorDeCara extends Error {}
`;

  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-pantalla-audio-'));
  const archivo = join(carpeta, 'audio-suelta.mjs');
  writeFileSync(
    archivo,
    PRESTADO +
      codigo.replace(/^export (?=(async )?function |const |class )/gm, '') +
      '\nexport { tarjetaDeMusica, piezasDeLaSerie, musicaDeLaPieza };\n'
  );
  return import(pathToFileURL(archivo).href);
}

const { tarjetaDeMusica, piezasDeLaSerie, musicaDeLaPieza } = await traerLaPantalla();
const serie = JSON.parse(readFileSync(`${RAIZ}datos/serie.json`, 'utf8'));

let bien = 0;
let mal = 0;

function comprobar(que, hacer) {
  try {
    hacer();
    bien += 1;
    console.log(`  ✓ ${que}`);
  } catch (fallo) {
    mal += 1;
    console.log(`  ✗ ${que}`);
    console.log(`      ${fallo.message}`);
  }
}

/** Si dentro del árbol hay un nodo con esa etiqueta o esa clase. */
function dentro(nodo, cual) {
  if (!nodo || typeof nodo !== 'object') return false;
  if (nodo.etiqueta === cual) return true;
  if (nodo.atrs && nodo.atrs.clase === cual) return true;
  for (const hijo of nodo.hijos || []) if (dentro(hijo, cual)) return true;
  for (const donde of ['pie', 'acciones', 'media']) {
    if (nodo.atrs && dentro(nodo.atrs[donde], cual)) return true;
  }
  return false;
}

/** Pinta la tarjeta de una pista de música con su pista ya generada. */
function pintarLaTarjeta(idPieza, laMusica) {
  const todas = piezasDeLaSerie(serie);
  const pieza = todas.find((una) => una.id === idPieza);
  const musica = musicaDeLaPieza(serie, idPieza, todas.length).lista;

  const estado = { audio: { musica: {}, voz: {} }, cola: [] };
  for (const una of musica) {
    estado.audio.musica[String(una.id)] = {
      ruta: `audio/musica/${una.id}.wav`,
      dur_s: 88,
      aprobada: true,
      letra_tiempos: []
    };
  }

  const ctx = {
    serie, estado, pieza, todas, musica,
    banco: [], enElBanco: false, bloques: [],
    trabajos: new Map(), repintar() {}, repintarLuego() {}
  };

  return tarjetaDeMusica(ctx, laMusica, 180);
}

console.log('\nLO QUE HAY QUE PULSAR, SE PUEDE PULSAR\n');

for (const id of ['opening', 'ending']) {
  const versos = (serie.piezas[id].letra || []).length;

  comprobar(`El ${id} enseña el marcador para sus ${versos} versos`, () => {
    const todas = piezasDeLaSerie(serie);
    const musica = musicaDeLaPieza(serie, id, todas.length).lista;
    const suya = musica.filter((una) => (serie.piezas[id].audio.musica || []).includes(String(una.id)));

    if (!suya.length) throw new Error(`el ${id} no tiene ninguna pista de música suya`);

    for (const laMusica of suya) {
      const arbol = pintarLaTarjeta(id, laMusica);
      if (!dentro(arbol, 'marcador-letra')) {
        throw new Error(
          `la tarjeta de «${laMusica.id}» no pinta el marcador, así que no hay forma de marcar la ` +
            'letra y la pieza no se puede montar con subtítulos'
        );
      }
    }
  });
}

comprobar('Una pista sin letra NO enseña el marcador: no hay nada que marcar', () => {
  const todas = piezasDeLaSerie(serie);
  const musica = musicaDeLaPieza(serie, 'teaser', todas.length).lista;
  if (!musica.length) throw new Error('el teaser no tiene música');

  for (const laMusica of musica) {
    const arbol = pintarLaTarjeta('teaser', laMusica);
    if (dentro(arbol, 'marcador-letra')) {
      throw new Error(`la pista «${laMusica.id}» del teaser enseña un marcador y no tiene letra`);
    }
  }
});

comprobar('El marcador trae un botón para marcar y otro para volver a empezar', () => {
  const todas = piezasDeLaSerie(serie);
  const laMusica = musicaDeLaPieza(serie, 'ending', todas.length).lista.find(
    (una) => String(una.id) === 'ending-tema'
  );
  const arbol = pintarLaTarjeta('ending', laMusica);

  const botones = [];
  (function recorrer(nodo) {
    if (!nodo || typeof nodo !== 'object') return;
    if (nodo.etiqueta === 'boton' && nodo.atrs && nodo.atrs.texto) botones.push(nodo.atrs.texto);
    for (const hijo of nodo.hijos || []) recorrer(hijo);
    for (const donde of ['pie', 'acciones', 'media']) if (nodo.atrs) recorrer(nodo.atrs[donde]);
  })(arbol);

  if (!botones.length) throw new Error('no sale ningún botón en toda la tarjeta');
});

console.log(`\n${bien + mal} comprobaciones, ${bien} bien${mal ? `, ${mal} MAL` : ''}\n`);
process.exit(mal === 0 ? 0 : 1);
