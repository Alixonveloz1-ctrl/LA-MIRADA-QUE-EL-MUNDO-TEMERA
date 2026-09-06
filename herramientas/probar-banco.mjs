// ¿SE VE EL BANCO DE LA TEMPORADA, Y SE VE DONDE TIENE QUE VERSE?
//
// El banco es la música que suena DENTRO de los doce episodios: dieciocho
// piezas que se componen una vez y se reutilizan, igual que el opening y el
// ending. Y tiene una manera muy silenciosa de desaparecer.
//
// La pantalla de Audio empareja cada pieza de música con la pieza de la serie
// que se esté produciendo. Antes lo hacía por el prefijo del id —«teaser-lecho»
// es del teaser porque empieza por «teaser-»—, que funcionaba porque la única
// pieza era el teaser. Con el banco eso se rompe de dos maneras a la vez:
//
//   · Una pieza del banco no empieza por el id de ninguna pieza, así que con el
//     prefijo no aparecería NUNCA en pantalla. Escrita, pagada de mantener, y
//     sin ningún botón que la genere.
//   · Y si apareciera colgada de una pieza, estaría diciendo lo contrario de lo
//     que es: que hay que rehacerla en cada episodio. Doce veces lo mismo.
//
// Así que aquí se comprueba lo aburrido: que el banco salga entero, que no se
// cuele en la lista de ninguna pieza, que las cuatro de siempre sigan saliendo
// donde salían, y que cada una se pida a nombre de quien tiene que pedirse.
//
// Se prueba contra datos/serie.json de verdad, no contra un ejemplo: lo que
// puede estar mal es justamente el archivo.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

/**
 * Carga un módulo del navegador sin sus importaciones y sin DOM: solo se quieren
 * las funciones que deciden, no las que pintan.
 */
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

const serie = JSON.parse(readFileSync(`${RAIZ}datos/serie.json`, 'utf8'));

const aud = await suelto(
  'app/pantallas/audio.js',
  `
const ErrorDeCara = class extends Error {}, llamar = async () => ({});
const actual = () => ({}), alCambiar = () => {}, cambiar = () => {};
const encolar = () => {}, encolarVarios = () => {};
const aviso = () => null, barra = () => null, boton = () => null, confirmar = () => {};
const espera = () => null, filtro = () => null, h = () => null, pantalla = () => null;
const seccion = () => null, tarjeta = () => null, vaciar = () => {};
const plural = () => '', segundos = () => '';
`,
  'bancoDeLaTemporada, musicaDeLaPieza, todaLaMusica, aNombreDeQuien, piezasDeLaSerie, PIEZA_DE_LA_TEMPORADA'
);

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nEL BANCO DE LA TEMPORADA\n');

const banco = aud.bancoDeLaTemporada(serie);
const todas = aud.todaLaMusica(serie);

di(banco.length > 0, 'Hay banco escrito', `${banco.length} piezas`);
di(
  banco.every((una) => String(una.id).startsWith('bso-')),
  'Todas las del banco se llaman «bso-…», que es lo que impide que el ' +
    'emparejamiento por prefijo se las cuelgue a una pieza'
);

const maximo = Number(serie.musica.modelo.maximo_s);
di(
  banco.every((una) => Number(una.duracion_s) > 0 && Number(una.duracion_s) <= maximo),
  `Ninguna se pasa de los ${maximo} s de Lyria`,
  `la más larga pide ${Math.max(...banco.map((u) => Number(u.duracion_s)))} s`
);

di(
  banco.every((una) => String(una.funcion || '').trim() && String(una.donde || '').trim()),
  'Cada una dice para qué sirve y dónde suena'
);

// Lo que de verdad se rompía: que el banco se cuele en la lista de una pieza.
const piezas = Object.keys(serie.piezas);
let coladas = 0;
for (const idPieza of piezas) {
  const suya = aud.musicaDeLaPieza(serie, idPieza, piezas.length);
  coladas += suya.lista.filter((una) => una.temporada === true).length;
}
di(coladas === 0, 'El banco no se cuela en la lista de ninguna pieza', `coladas: ${coladas}`);

// Y lo contrario: que las de siempre sigan saliendo donde salían.
const delTeaser = aud.musicaDeLaPieza(serie, 'teaser', piezas.length);
di(
  delTeaser.lista.length === 2 &&
    delTeaser.lista.map((u) => u.id).join(',') === 'teaser-lecho,teaser-canto',
  'El teaser sigue teniendo su lecho y su canto',
  delTeaser.lista.map((u) => u.id).join(', ') || 'ninguna'
);
di(delTeaser.como === 'campo', 'Y ya se emparejan por el campo «pieza», no adivinando por el id');

for (const idPieza of ['opening', 'ending']) {
  const suya = aud.musicaDeLaPieza(serie, idPieza, piezas.length);
  di(suya.lista.length === 1, `«${idPieza}» tiene su tema`, suya.lista.map((u) => u.id).join(', '));
}

// Que ninguna se quede sin sitio: si no está en el banco ni en una pieza, está
// escrita y no se puede generar.
const enAlgunaPieza = new Set();
for (const idPieza of piezas) {
  for (const una of aud.musicaDeLaPieza(serie, idPieza, piezas.length).lista) {
    enAlgunaPieza.add(una.id);
  }
}
const sinSitio = todas.filter((una) => una.temporada !== true && !enAlgunaPieza.has(una.id));
di(sinSitio.length === 0, 'Ninguna pieza de música se queda sin pantalla donde salir',
  sinSitio.map((u) => u.id).join(', ') || 'ninguna suelta');

// A nombre de quién se pide cada una. Las del banco no son de ninguna pieza.
const piezaFalsa = { id: 'teaser' };
di(
  banco.every((una) => aud.aNombreDeQuien(una, piezaFalsa) === aud.PIEZA_DE_LA_TEMPORADA),
  'Las del banco se piden a nombre de «temporada», no de la pieza que se esté mirando'
);
di(
  aud.aNombreDeQuien({ id: 'teaser-lecho', pieza: 'teaser' }, { id: 'opening' }) === 'teaser',
  'Y una que dice de quién es se pide a su nombre aunque en pantalla haya otra'
);

// La suma, que es lo que decide si esto es una banda sonora o un adorno.
const total = banco.reduce((n, una) => n + Number(una.duracion_s), 0);
di(total >= 900, 'El banco da para una temporada entera', `${Math.round(total / 60)} minutos de música`);

// ── EL ARCHIVO DE PLANOS DE AMBIENTE ───────────────────────────────────────
//
// La otra biblioteca: 56 planos de ambiente que se generan una vez y se
// reutilizan en los doce episodios. Vive dentro de `piezas` porque así toda la
// maquinaria de Tomas, la cola y el estado le sirve sin tocar una línea. El
// precio de esa decisión es que las pantallas que NO tienen que ofrecerlo
// tienen que decirlo, y ahí es donde esto se rompería en silencio: Montaje
// ofrecería montar un rollo de cuatro minutos que nadie va a ver, pagado
// entero, y Audio ofrecería una pieza que solo puede decir que no tiene música.
console.log('\n  EL ARCHIVO DE PLANOS DE AMBIENTE\n');

const piezasCrudas = serie.piezas || {};
const deArchivo = Object.keys(piezasCrudas).filter((id) => piezasCrudas[id].archivo === true);
di(deArchivo.length === 1, 'Hay exactamente una pieza de archivo', deArchivo.join(', ') || 'ninguna');

const elArchivo = piezasCrudas[deArchivo[0]] || { tomas: [] };
di(elArchivo.tomas.length >= 50, 'Con planos suficientes para cubrir los sitios',
  `${elArchivo.tomas.length} planos`);

const sitiosCubiertos = new Set(elArchivo.tomas.map((una) => una.escenario));
const sitiosQueHay = new Set((serie.escenarios.placas || []).map((una) => una.id));
const sinCubrir = [...sitiosQueHay].filter((id) => !sitiosCubiertos.has(id));
di(sinCubrir.length === 0, 'Todos los escenarios de la serie tienen planos de archivo',
  sinCubrir.join(', ') || `${sitiosCubiertos.size} sitios`);

const dosPorSitio = [...sitiosCubiertos].every(
  (id) => elArchivo.tomas.filter((una) => una.escenario === id).length === 2
);
di(dosPorSitio, 'Dos por sitio: un general para abrir y un detalle que se mueve solo');

di(elArchivo.tomas.every((una) => una.veo === 'economico'),
  'Todos se piden con el Veo más barato: un plano de ambiente no lleva a nadie');

// Y las pantallas.
const mon = await suelto(
  'app/pantallas/montaje.js',
  `
const ErrorDeCara = class extends Error {}, llamar = async () => ({});
const actual = () => ({}), alCambiar = () => {}, cambiar = () => {};
const encolar = () => {}, encolarVarios = () => {}, detener = () => {};
const aviso = () => null, barra = () => null, boton = () => null, confirmar = () => {};
const espera = () => null, filtro = () => null, h = () => null, pantalla = () => null;
const seccion = () => null, tarjeta = () => null, vaciar = () => {};
const plural = () => '', segundos = () => '', fecha = () => '', pesoLegible = () => '';
`,
  'piezasDeLaSerie'
);

const ofreceMontaje = mon.piezasDeLaSerie(serie).map((una) => una.id);
di(!ofreceMontaje.includes(deArchivo[0]),
  'Montaje NO ofrece montar el archivo: es una biblioteca, no una película',
  ofreceMontaje.join(', '));

const ofreceAudio = aud.piezasDeLaSerie
  ? aud.piezasDeLaSerie(serie).map((una) => una.id)
  : null;
di(ofreceAudio && !ofreceAudio.includes(deArchivo[0]),
  'Audio tampoco lo ofrece: el archivo no tiene ni música ni diálogo',
  ofreceAudio ? ofreceAudio.join(', ') : 'no se pudo leer');

// Pero Tomas SÍ tiene que enseñarlo: es la única pantalla donde se generan.
di(Object.keys(serie.piezas).includes(deArchivo[0]),
  'Y sigue estando en «piezas», que es lo que hace que Tomas lo enseñe sin tocar nada');

// Lo que de verdad importa del ahorro: cuántos planos se dejan de pagar.
const escenas = (JSON.parse(readFileSync(`${RAIZ}datos/guiones.json`, 'utf8')).guiones || [])
  .reduce((n, ep) => n + ep.escenas.length, 0);
di(elArchivo.tomas.length < escenas,
  'El archivo cuesta menos que darle a cada escena su propio plano de ambiente',
  `${elArchivo.tomas.length} planos en vez de ${escenas}: ${escenas - elArchivo.tomas.length} menos`);

// ── LA CADENA ENTERA: DEL PUNTERO AL CLIP ──────────────────────────────────
//
// Lo de arriba comprueba que el archivo existe. Esto comprueba que SIRVE, que
// es otra cosa. Un plano de episodio que apunta al archivo tiene que:
//
//   · leer su material a nombre del archivo y no del episodio,
//   · no ofrecer ningún botón de generar —ya está pagado—,
//   · y llegar al manifiesto del montaje con la ruta del clip que existe.
//
// Si cualquiera de las tres se rompe, no falla nada: sale un episodio con un
// salto donde tenía que haber un plano. Por eso se ejecuta y no se lee.
console.log('\n  DEL PUNTERO AL CLIP\n');

const pl = await suelto('app/planos.js', '', 'claveDelMaterial, esDeArchivo, PIEZA_DEL_ARCHIVO');

const unPlanoNormal = { id: '12-3' };
const unPlanoDeArchivo = { id: '12-1', de_archivo: 'arch-cripta-a' };

di(pl.claveDelMaterial('ep01', unPlanoNormal) === 'ep01/12-3',
  'Un plano normal lee su material a su nombre');
di(pl.claveDelMaterial('ep01', unPlanoDeArchivo) === 'archivo/arch-cripta-a',
  'Y uno de archivo lo lee a nombre del archivo, que es donde está de verdad',
  pl.claveDelMaterial('ep01', unPlanoDeArchivo));
di(!pl.esDeArchivo(unPlanoNormal) && pl.esDeArchivo(unPlanoDeArchivo),
  'Se distingue uno de otro por el campo, no por el nombre');
di(pl.claveDelMaterial('ep01', { id: 'x', de_archivo: '   ' }) === 'ep01/x',
  'Un «de_archivo» en blanco no cuenta: es un plano normal');

// La comprobación del desglose, que es la que impide encargar lo ya hecho.
const txt = await suelto(
  'api/_lib/texto.js',
  `
const serie = ${JSON.stringify(serieParaTexto())};
class ErrorDeCara extends Error { constructor(m,o={}){super(m);this.mensaje=m;Object.assign(this,o);} }
const escenaDeGuion = () => ({});
const guiones = { guiones: [] };
`,
  'COMPROBACIONES'
);

function serieParaTexto() {
  return { piezas: serie.piezas, banco: serie.banco, escenarios: serie.escenarios, luces: serie.luces };
}

const delPuntero = txt.COMPROBACIONES.find((una) => una.nombre === 'el-archivo-se-usa-como-puntero');
di(Boolean(delPuntero), 'El desglose trae la comprobación del archivo');

const archivoDeLaCripta = serie.piezas.archivo.tomas.filter((una) => una.escenario === 'cripta');
const ctxFalso = { archivo: archivoDeLaCripta, escena: '1' };

const bienUsado = [{
  id: '1-1', de_archivo: 'arch-cripta-a', imagen: '', video: '', refs: [],
  boca_visible: null, encadena_con: null, dur: 4, dur_gen: 4,
}];
di(delPuntero.revisar(bienUsado, ctxFalso).length === 0,
  'Un plano que usa bien el archivo pasa');

const inventado = [{ ...bienUsado[0], de_archivo: 'arch-de-la-nada' }];
di(delPuntero.revisar(inventado, ctxFalso).length > 0,
  'Inventarse un id de archivo se rechaza: ese plano se montaría con un hueco');

const descrito = [{ ...bienUsado[0], imagen: 'A wide shot of the crypt' }];
di(delPuntero.revisar(descrito, ctxFalso).length > 0,
  'Usar el archivo Y describirlo se rechaza: alguien acabaría pagándolo otra vez');

const conGente = [{ ...bienUsado[0], refs: ['saharis-ancla'] }];
di(delPuntero.revisar(conGente, ctxFalso).length > 0,
  'Meter un personaje en un plano de archivo se rechaza: saldría en cuatro episodios');

const demasiado = [{ ...bienUsado[0], dur: 9 }];
di(delPuntero.revisar(demasiado, ctxFalso).length > 0,
  'Pedir más segundos de los que dura el clip se rechaza',
  `pide 9 s de uno de ${archivoDeLaCripta[0].dur} s`);

const menos = [{ ...bienUsado[0], dur: 2, recorte: [0, 2] }];
di(delPuntero.revisar(menos, ctxFalso).length === 0,
  'Pero usar MENOS sí vale: coger dos segundos de cuatro es montar, y es gratis');

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
