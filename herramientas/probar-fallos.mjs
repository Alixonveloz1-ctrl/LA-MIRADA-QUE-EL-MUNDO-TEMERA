// EL AVISO QUE NO SE CALLABA.
//
// El estudio recoge los fallos que nadie atrapa y los pinta arriba, porque quien
// usa esto desde el móvil no va a abrir la consola del navegador. Bien. El
// problema es lo que pasaba cuando el fallo NO ocurría una vez, sino cada pocos
// segundos —un error que salta con cada latido de la cola, por ejemplo—:
//
//   · Solo se comparaba con EL ÚLTIMO, así que dos fallos distintos alternando
//     se repintaban los dos, uno detrás de otro, para siempre.
//   · Y «Entendido» BORRABA esa memoria. Cerrabas el aviso y el siguiente latido
//     lo traía de vuelta. Se cerraba y volvía. Se cerraba y volvía.
//
// Encima, el fallo que más se repetía era el que el navegador se niega a
// identificar («Script error.»), que por definición NO viene de este estudio:
// una extensión, un bloqueador. O sea que una tarjeta roja tapaba el plano que
// estabas mirando, con un botón de recargar que no iba a arreglar nada, por algo
// que no podemos tocar.
//
// Aquí se ejecuta el recogedor de verdad, con un DOM de mentira, y se comprueba
// lo aburrido: que el mismo fallo cien veces sea UNA tarjeta con un contador, y
// que cerrarla sea cerrarla.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Un DOM del tamaño justo
// ---------------------------------------------------------------------------

/** Un nodo: lo mínimo que usa el recogedor de fallos. */
function nodo(etiqueta) {
  const yo = {
    etiqueta,
    hijos: [],
    padre: null,
    texto: '',
    get isConnected() {
      let actual = yo;
      while (actual.padre) actual = actual.padre;
      return actual === cuerpo;
    },
    get childElementCount() {
      return yo.hijos.length;
    },
    get firstChild() {
      return yo.hijos[0] || null;
    },
    get firstElementChild() {
      return yo.hijos[0] || null;
    },
    appendChild(hijo) {
      if (!hijo) return hijo;
      hijo.padre = yo;
      yo.hijos.push(hijo);
      return hijo;
    },
    remove() {
      if (!yo.padre) return;
      yo.padre.hijos = yo.padre.hijos.filter((h) => h !== yo);
      yo.padre = null;
    },
    setAttribute() {},
    classList: { add() {}, remove() {} },
    /** Todo el texto que hay dentro, para poder leer lo que saldría en pantalla. */
    get todoElTexto() {
      return [yo.texto, ...yo.hijos.map((h) => h.todoElTexto)].join(' ');
    },
  };
  return yo;
}

const cuerpo = nodo('body');
const botonesPuestos = [];

const PRESTADO = `
const ErrorDeCara = class extends Error {
  constructor(m, o = {}) { super(m); this.mensaje = m; Object.assign(this, o); }
};
const document = globalThis.__doc;
const window = globalThis.__win;
const h = (etiqueta, atributos, ...hijos) => {
  const n = globalThis.__nodo(etiqueta);
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    // El h() de verdad admite texto suelto como hijo, y el recogedor lo usa.
    n.appendChild(typeof hijo === 'object' ? hijo : globalThis.__texto(hijo));
  }
  return n;
};
const aviso = (mensaje, opciones = {}) => {
  const n = globalThis.__nodo('aviso');
  n.texto = String(mensaje);
  n.tono = (opciones && opciones.tono) || 'nota';
  return n;
};
const boton = (texto, alPulsar) => {
  const n = globalThis.__nodo('boton');
  n.texto = String(texto);
  n.pulsar = alPulsar;
  globalThis.__botones.push(n);
  return n;
};
const espera = () => globalThis.__nodo('espera');
const pantalla = () => globalThis.__nodo('pantalla');
const seccion = () => globalThis.__nodo('seccion');
const vaciar = (n) => { if (n) { n.hijos = []; n.texto = ''; } };
const EVENTO_FALLO_SUELTO = 'fallo-suelto';
`;

globalThis.__doc = {
  body: cuerpo,
  createTextNode: (t) => {
    const n = nodo('#texto');
    n.texto = String(t);
    return n;
  },
};
globalThis.__win = { location: { reload() {} }, addEventListener() {} };
globalThis.__nodo = nodo;
globalThis.__texto = (t) => {
  const n = nodo('#texto');
  n.texto = String(t);
  return n;
};
globalThis.__botones = botonesPuestos;

// ---------------------------------------------------------------------------
// El recogedor, suelto
// ---------------------------------------------------------------------------

const codigo = readFileSync(`${RAIZ}app/main.js`, 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '')
  // El arranque llama a la aplicación entera y aquí no se prueba la aplicación:
  // se prueba el recogedor. Es la única línea que se quita, y se dice.
  .replace(/^arrancarElEstudio\(\);$/m, '')
  .replace(/^export (?=(async )?function |const |class )/gm, '');

const carpeta = mkdtempSync(join(tmpdir(), 'mirada-'));
const archivo = join(carpeta, 'x.mjs');
writeFileSync(archivo, `${PRESTADO}\n${codigo}\nexport { contarFalloSuelto };\n`);
const main = await import(pathToFileURL(archivo).href);

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

/** Las tarjetas de fallo que hay ahora mismo en pantalla. */
const enPantalla = () => (cuerpo.hijos[0] ? cuerpo.hijos[0].hijos : []);

/** El botón de una tarjeta por su texto. */
const botonDe = (tarjeta, texto) =>
  botonesPuestos.find((b) => b.texto === texto && dentroDe(b, tarjeta)) || null;

const dentroDe = (n, raiz) => {
  let actual = n;
  while (actual) {
    if (actual === raiz) return true;
    actual = actual.padre;
  }
  return false;
};

// El recogedor escribe cada fallo en la consola del navegador, que es donde
// tiene que estar. Aquí estorba: lo que se lee es el resultado, no el ruido.
console.error = () => {};

console.log('\nEL AVISO DE FALLOS QUE NO SE CALLABA\n');

// UN FALLO QUE SE REPITE, QUE ES EL CASO QUE SE VIO EN EL TELÉFONO.
for (let i = 0; i < 12; i += 1) main.contarFalloSuelto('Script error.');

di(enPantalla().length === 1,
  'El mismo fallo doce veces seguidas es UNA tarjeta, no doce',
  `${enPantalla().length} tarjetas`);

const laDelScript = enPantalla()[0];
di(/vuelto a pasar 12 veces/.test(laDelScript.todoElTexto),
  'Y dice cuántas veces ha vuelto a pasar, en vez de apilarse');

di(/NO viene de este estudio/.test(laDelScript.todoElTexto),
  'Dice con todas las letras que ese fallo no es del estudio');

const avisoDelScript = laDelScript.hijos.find((n) => n.etiqueta === 'aviso');
di(avisoDelScript && avisoDelScript.tono === 'nota',
  'Y se pinta como NOTA, no como error rojo: no es nuestro y no se puede tocar',
  avisoDelScript ? avisoDelScript.tono : 'no hay aviso');

di(!botonDe(laDelScript, 'Recargar la aplicación'),
  'Sin botón de recargar: recargar no arregla una extensión, y tira lo que estés mirando');

// CERRARLO ES CERRARLO. Esto es lo que de verdad fallaba.
const entendido = botonDe(laDelScript, 'Entendido');
di(Boolean(entendido), 'Tiene su botón de «Entendido»');
entendido.pulsar();
di(enPantalla().length === 0 || !cuerpo.hijos.length, 'Al cerrarlo, desaparece');

for (let i = 0; i < 20; i += 1) main.contarFalloSuelto('Script error.');
di(!cuerpo.hijos.length || enPantalla().length === 0,
  'Y veinte repeticiones después NO vuelve: cerrarlo fue decir «ya lo he visto»',
  `${cuerpo.hijos.length ? enPantalla().length : 0} tarjetas`);

// UN FALLO DE VERDAD DEL ESTUDIO SÍ TIENE QUE GRITAR.
main.contarFalloSuelto(new TypeError('no se puede leer «tomas» de undefined'));
di(enPantalla().length === 1, 'Un fallo del propio estudio sí se pinta');

const laNuestra = enPantalla()[0];
const avisoNuestro = laNuestra.hijos.find((n) => n.etiqueta === 'aviso');
di(avisoNuestro && avisoNuestro.tono === 'error',
  'Y esa sí es roja, porque es nuestra y hay que arreglarla',
  avisoNuestro ? avisoNuestro.tono : 'no hay aviso');
di(Boolean(botonDe(laNuestra, 'Recargar la aplicación')),
  'Y ofrece recargar, porque puede haber dejado algo a medias');
di(/no se puede leer/.test(laNuestra.todoElTexto),
  'Y enseña lo que dijo el navegador, sin tener que abrir nada');

// Dos fallos DISTINTOS son dos tarjetas: eso no se toca.
main.contarFalloSuelto(new RangeError('otra cosa distinta'));
di(enPantalla().length === 2, 'Dos fallos distintos siguen siendo dos tarjetas',
  `${enPantalla().length}`);

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
