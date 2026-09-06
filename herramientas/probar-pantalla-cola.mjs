// LA PANTALLA DE COLA, CON UN VÍDEO EN VUELO.
//
// Este archivo existe por un fallo concreto y por lo que ese fallo enseñó.
//
// La pantalla de Cola reventaba entera —«Can't find variable: operacion»— y solo
// cuando había un clip de Veo generándose. Un campo escrito en forma corta
// (`{ pieza, toma, operacion }`) que nombraba una variable que se había quitado
// meses antes, cuando se decidió que el nombre de la operación no viajara al
// navegador. La sintaxis era perfecta, así que `node --check` no veía nada, y
// ninguna prueba construía nunca ese estado: uno con `operacion_en_curso`
// puesto. El fallo esperaba, escrito, a que alguien lanzara un vídeo.
//
// Y ahí está lo peor: para verlo hay que haber pagado el clip. La pantalla que
// existe para vigilar lo que se está generando era la que se caía justo cuando
// había algo que vigilar.
//
// Así que aquí no se lee el código: se EJECUTA la pantalla contra estados que sí
// tienen cosas dentro. Un estado vacío no prueba nada, porque casi todas las
// funciones de una pantalla salen por la puerta de «no hay nada que enseñar».
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

/** Carga un módulo del navegador sin sus importaciones y sin DOM. */
function suelto(ruta, extra, exporta) {
  const codigo = readFileSync(RAIZ + ruta, 'utf8').replace(
    /^import[\s\S]*?from\s+'[^']*';$/gm,
    ''
  );
  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-'));
  const archivo = join(carpeta, 'x.mjs');
  const sinExportar = codigo.replace(/^export (?=(async )?function |const |class )/gm, '');
  writeFileSync(archivo, `${extra}\n${sinExportar}\nexport { ${exporta} };\n`);
  return import(pathToFileURL(archivo).href);
}

// Un DOM de mentira, del tamaño justo: lo que se prueba es qué DATOS calcula la
// pantalla, no cómo los pinta. `h()` devuelve un objeto que recuerda lo que se
// le pidió, así que además se puede mirar qué texto habría salido.
const PRESTADO = `
const ErrorDeCara = class extends Error {};
const actual = () => ({}), alCambiar = () => {}, cambiar = async () => {};
const EVENTO_FALLO_DE_COLA = 'fallo-de-cola';
const corriendo = () => true, detener = () => {}, encolarVarios = () => {};
const reanudar = () => {}, resumen = () => ({ pendientes: 0, enCurso: 0, fallidos: 0 });
const aviso = (t) => ({ etiqueta: 'aviso', texto: t });
const barra = () => ({ etiqueta: 'barra' });
const boton = (t) => ({ etiqueta: 'boton', texto: t });
const confirmar = async () => true;
const espera = (t) => ({ etiqueta: 'espera', texto: t });
const filtro = () => ({ etiqueta: 'filtro' });
const h = (tipo, atributos, ...hijos) => ({ etiqueta: tipo, atributos, hijos });
const pantalla = (titulo, ...secciones) => ({ etiqueta: 'pantalla', titulo, secciones });
const seccion = (titulo, ...hijos) => ({ etiqueta: 'seccion', titulo, hijos });
const vaciar = () => {};
const fecha = () => '', plural = (n, u, m) => \`\${n} \${n === 1 ? u : m}\`;
const enSegundos = (n) => \`\${n} s\`;
`;

const cola = await suelto(
  'app/pantallas/cola.js',
  PRESTADO,
  'seccionOperaciones, operacionesEnVuelo'
);

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nLA PANTALLA DE COLA CON UN VÍDEO EN VUELO\n');

// EL ESTADO QUE NUNCA SE CONSTRUÍA: una toma con operación de Veo apuntada.
//
// Llega como `true` y no como el nombre, que es lo que hace el servidor: el
// nombre lleva el project id dentro y se queda en el bucket.
const conVideoEnVuelo = {
  tomas: {
    'teaser/C2': {
      keyframe_aprobado: 'keyframes/teaser/C2/1.png',
      intentos_keyframe: ['keyframes/teaser/C2/1.png'],
      clip_elegido: null,
      intentos_clip: [],
      operacion_en_curso: true
    },
    'teaser/A1': {
      keyframe_aprobado: null,
      intentos_keyframe: [],
      clip_elegido: null,
      intentos_clip: [],
      operacion_en_curso: null
    }
  }
};

const trabajos = [
  {
    tipo: 'clip-consultar',
    estado: 'pendiente',
    creado: '2026-09-06T11:00:00.000Z',
    consultas: 3,
    args: { pieza: 'teaser', id: 'C2' }
  }
];

let enVuelo = null;
try {
  enVuelo = cola.operacionesEnVuelo(conVideoEnVuelo, trabajos);
  di(true, 'Con un vídeo en vuelo, la pantalla NO revienta');
} catch (fallo) {
  di(false, 'Con un vídeo en vuelo, la pantalla NO revienta', String(fallo && fallo.message));
}

if (enVuelo) {
  di(enVuelo.length === 1, 'Y encuentra exactamente el que está en vuelo', `${enVuelo.length}`);
  di(enVuelo[0].pieza === 'teaser' && enVuelo[0].toma === 'C2',
    'Con su pieza y su toma bien partidas de la clave',
    `${enVuelo[0].pieza} / ${enVuelo[0].toma}`);
  di(enVuelo[0].consultas === 3, 'Y lo que se sabe de su consulta en la cola');

  // Que no lleve el nombre de la operación NO es un descuido: lleva el project
  // id dentro y por eso se queda en el bucket. Si algún día alguien lo vuelve a
  // meter aquí, esta línea lo dice.
  di(!('operacion' in enVuelo[0]),
    'Y NO trae el nombre de la operación, que lleva el project id dentro',
    Object.keys(enVuelo[0]).join(', '));
}

// La sección entera, que es lo que de verdad se cayó en pantalla.
try {
  const pintada = cola.seccionOperaciones({ estado: conVideoEnVuelo, trabajos });
  di(pintada !== null && pintada.etiqueta === 'seccion',
    'La sección «Vídeos en marcha» se pinta entera sin romperse',
    pintada && pintada.titulo);
} catch (fallo) {
  di(false, 'La sección «Vídeos en marcha» se pinta entera sin romperse',
    String(fallo && fallo.message));
}

// Y sin nada en vuelo, que es el camino por el que sí pasaba antes y por eso
// nadie veía el fallo.
try {
  const vacia = cola.seccionOperaciones({ estado: { tomas: {} }, trabajos: [] });
  di(vacia === null, 'Sin ningún vídeo en vuelo, la sección no se pinta');
} catch (fallo) {
  di(false, 'Sin ningún vídeo en vuelo, la sección no se pinta', String(fallo && fallo.message));
}

// Y con basura dentro, que es lo que llega de un estado viejo.
try {
  cola.operacionesEnVuelo(
    { tomas: { 'sin-barra': { operacion_en_curso: true }, mala: null, 'a/b': 7 } },
    []
  );
  di(true, 'Un estado con basura dentro no la tumba');
} catch (fallo) {
  di(false, 'Un estado con basura dentro no la tumba', String(fallo && fallo.message));
}

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
