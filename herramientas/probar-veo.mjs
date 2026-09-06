// ¿SE RECOGE UN CLIP QUE YA ESTÁ PAGADO?
//
// Un clip de Veo se lanza y se consulta después, con minutos de por medio. La
// operación vive colgada del modelo que la creó: se pregunta a ese modelo o
// Google contesta que no existe.
//
// El fallo que motiva este archivo: el estudio decidía a qué modelo preguntar
// por lo que llevaba escrito el plano o por lo que estuviera elegido en Salud, y
// si eso no coincidía con el modelo real —porque el nivel se tocó mientras el
// clip se generaba, o porque el estado se perdió y solo quedó el apunte del
// bucket, que no llevaba el nivel— se PLANTABA y daba el clip por perdido. Un
// clip terminado, pagado, y con la puerta cerrada por un descuadre de
// contabilidad.
//
// Y era innecesario: el nombre de la operación DICE con qué modelo y en qué
// región se creó. Viene dentro, escrito por Google. Preguntar no cuesta nada y no
// genera nada, así que hacerle caso al nombre no tiene ningún riesgo.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

const serieReal = JSON.parse(readFileSync(`${RAIZ}datos/serie.json`, 'utf8'));

/** `veo.js` sin sus importaciones: aquí solo se prueba la parte que decide. */
function suelto(ruta, extra, exporta) {
  const codigo = readFileSync(RAIZ + ruta, 'utf8').replace(
    /^import[\s\S]*?from\s+'[^']*';$/gm,
    ''
  );
  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-veo-'));
  const archivo = join(carpeta, 'x.mjs');
  const sinExportar = codigo.replace(/^export (?=(async )?function |const |class )/gm, '');
  writeFileSync(archivo, `${extra}\n${sinExportar}\nexport { ${exporta} };\n`);
  return import(pathToFileURL(archivo).href);
}

// El de verdad: los ids salen de datos/serie.json, no de aquí.
const NIVELES = ['calidad', 'medio', 'economico'];
const modeloDe = (nivel) => {
  const base = serieReal.modelos.video[nivel];
  return { id: base.id, ids: base.ids, region: 'us-central1', variable: 'VEO_MODEL' };
};

// El `nivelVeo` de verdad lee datos/serie.json; aquí se le da el mismo mapa.
globalThis.__nivelVeo = (nivel) => {
  const base = serieReal.modelos.video[nivel];
  if (!base || !base.id) throw new Error(`sin modelo para «${nivel}»`);
  return { id: base.id, ids: base.ids, region: 'us-central1', variable: 'VEO_MODEL' };
};

const veo = await suelto(
  'api/_lib/veo.js',
  `
import { Buffer } from 'node:buffer';
class ErrorDeCara extends Error { constructor(m, o = {}) { super(m); this.mensaje = m; Object.assign(this, o); } }
const serie = ${JSON.stringify({ modelos: serieReal.modelos })};
const entorno = () => ({ sa: { project_id: 'x' } });
const NIVELES_DE_MODELO = ${JSON.stringify(NIVELES)};
const nivelVeo = globalThis.__nivelVeo;
const llamar = async () => ({}), urlModelo = () => '', conGrafias = async () => ({}), comoGrafia = (m) => m;
`,
  'grafiaDeLaOperacion'
);

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '\u2713' : '\u2717'} ${que}${extra ? ` \u2014 ${extra}` : ''}`);
};

const nombreDe = (modelo, region = 'us-central1') =>
  `projects/x/locations/${region}/publishers/google/models/${modelo}/operations/1234`;

console.log('\nRECOGER UN CLIP QUE YA ESTÁ PAGADO\n');

const economico = modeloDe('economico');
const medio = modeloDe('medio');

// Lo de siempre: coinciden y no hay nada que resolver.
const igual = veo.grafiaDeLaOperacion(nombreDe(economico.id), economico);
di(igual.id === economico.id, 'Si el nombre y el nivel coinciden, se pregunta ahí', igual.id);

// EL CASO QUE COSTABA DINERO: se lanzó con «economico» y se pregunta a «medio».
let recuperado = null;
try {
  recuperado = veo.grafiaDeLaOperacion(nombreDe(economico.id), medio);
  di(true, 'Un clip lanzado con otro nivel YA NO se da por perdido');
} catch (fallo) {
  di(false, 'Un clip lanzado con otro nivel YA NO se da por perdido', fallo.mensaje || String(fallo));
}

if (recuperado) {
  di(recuperado.id === economico.id,
    'Y se pregunta al modelo que dice el NOMBRE, no al que creiamos',
    `${recuperado.id} en vez de ${medio.id}`);
  di(recuperado.nivelDelNombre === 'economico',
    'Diciendo además con qué nivel se lanzó de verdad',
    String(recuperado.nivelDelNombre));
}

// La región también sale del nombre: donde se creó es donde se consulta.
const enOtraRegion = veo.grafiaDeLaOperacion(nombreDe(economico.id, 'europe-west4'), economico);
di(enOtraRegion.region === 'europe-west4',
  'La región sale del nombre, aunque GCP_LOCATION haya cambiado',
  enOtraRegion.region);

// Lo que SÍ sigue fallando: un modelo que no es ninguno de los tres niveles.
try {
  veo.grafiaDeLaOperacion(nombreDe('veo-9-inventado-001'), economico);
  di(false, 'Un modelo que no es de la serie SÍ falla, y lo dice');
} catch (fallo) {
  di(/no es ninguno de los tres niveles/.test(fallo.mensaje || ''),
    'Un modelo que no es de la serie SÍ falla, y lo dice');
}

// Un nombre con otra forma no se toca: manda Google, no una expresión regular.
const raro = veo.grafiaDeLaOperacion('algo/que/no/tiene/esa/forma', economico);
di(raro === economico, 'Un nombre con otra forma se deja pasar tal cual');

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
