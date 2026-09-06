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
  'bancoDeLaTemporada, musicaDeLaPieza, todaLaMusica, aNombreDeQuien, PIEZA_DE_LA_TEMPORADA'
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

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
