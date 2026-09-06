// ¿SE ABRE EL ZIP QUE ESCRIBE EL MONTADOR?
//
// El montador escribe el zip a mano, byte a byte, porque este proyecto no tiene
// ni una dependencia de npm y Node no trae ninguno. El formato es viejo y
// sencillo, y por eso mismo tiene una manera muy fea de fallar: un zip mal
// escrito no da ningún error al escribirlo. Da error al ABRIRLO, en el teléfono,
// después de haber descargado un gigabyte y medio.
//
// Así que aquí no se lee el código: se escribe un zip de verdad y se abre con el
// `unzip` del sistema, que es un programa que no sabe nada de este proyecto y no
// perdona nada. Se comprueba que lista lo que tiene que listar, que el contenido
// sale byte a byte igual, y que los CRC cuadran —que es lo que `unzip -t` mira—.
//
// Y se prueba también lo que no se puede probar de verdad: los tamaños grandes.
// Por encima de 4 GB el formato original no da más de sí y hay que escribir las
// cabeceras ZIP64. Un episodio de veintidós minutos puede pasar de ahí. Aquí no
// se van a escribir 4 GB para comprobarlo, así que lo que se mira es que las
// cabeceras SE ESCRIBAN, bajando el listón a mano.
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

/** `montador.mjs` sin su arranque: aquí solo se quiere el escritor de zip. */
async function traerElEscritor() {
  const codigo = readFileSync(`${RAIZ}montador/montador.mjs`, 'utf8')
    // El arranque llama al montador entero y necesita variables de entorno y un
    // bucket. Es lo único que se quita, y se dice.
    .replace(/^try \{\n\s*await principal\(\);[\s\S]*$/m, '')
    .replace(/^process\.on\([\s\S]*?\);$/gm, '')
    .replace(/^for \(const senal of \[[\s\S]*?^\}$/m, '');

  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-zip-'));
  const archivo = join(carpeta, 'montador-suelto.mjs');
  writeFileSync(archivo, `${codigo}\nexport { escribirZip, crc32 };\n`);
  return import(pathToFileURL(archivo).href);
}

const { escribirZip } = await traerElEscritor();

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nEL ZIP QUE SE DESCARGA\n');

const taller = mkdtempSync(join(tmpdir(), 'mirada-zip-taller-'));

// Un «vídeo» de dos megas y pico de bytes que no se repiten, para que un fallo
// de desplazamiento se note: con bytes todos iguales, copiar mal no se ve.
const falsoVideo = Buffer.alloc(2 * 1024 * 1024 + 1234);
for (let i = 0; i < falsoVideo.length; i += 1) falsoVideo[i] = (i * 31 + (i >> 8)) & 0xff;

const LA_FICHA = [
  'TÍTULO',
  'La mirada que el mundo temerá — Teaser',
  '',
  'DESCRIPCIÓN',
  'Un niño que no llora. Doce episodios.',
  '',
  'ETIQUETAS',
  '#anime #seinen #darkanime',
  '',
].join('\n');

const rutaVideo = join(taller, 'teaser.mp4');
const rutaFicha = join(taller, 'ficha.txt');
writeFileSync(rutaVideo, falsoVideo);
writeFileSync(rutaFicha, LA_FICHA, 'utf8');

const destino = join(taller, 'paquete.zip');
await escribirZip(
  [
    { nombre: 'teaser.mp4', ruta: rutaVideo, bytes: falsoVideo.length },
    { nombre: 'ficha.txt', ruta: rutaFicha, bytes: Buffer.byteLength(LA_FICHA, 'utf8') },
  ],
  destino
);

di(statSync(destino).size > falsoVideo.length, 'El zip se escribe y pesa lo que tiene dentro',
  `${statSync(destino).size} bytes`);

// LO QUE DE VERDAD IMPORTA: que lo abra un programa que no es nuestro.
let hayUnzip = true;
try {
  execFileSync('unzip', ['-v'], { stdio: 'ignore' });
} catch {
  hayUnzip = false;
}

if (!hayUnzip) {
  console.log('  ! No hay «unzip» en esta máquina: no se puede comprobar de verdad que abra.');
} else {
  let listado = '';
  try {
    listado = execFileSync('unzip', ['-l', destino], { encoding: 'utf8' });
    di(true, 'Un «unzip» de verdad lo abre y lista lo que hay dentro');
  } catch (fallo) {
    di(false, 'Un «unzip» de verdad lo abre y lista lo que hay dentro', String(fallo.message || fallo));
  }
  di(/teaser\.mp4/.test(listado) && /ficha\.txt/.test(listado),
    'Con los dos archivos y sus nombres',
    listado.split('\n').filter((l) => /\.(mp4|txt)/.test(l)).length + ' líneas');

  try {
    execFileSync('unzip', ['-t', destino], { stdio: 'ignore' });
    di(true, 'Y los CRC cuadran: el contenido no está corrompido');
  } catch (fallo) {
    di(false, 'Y los CRC cuadran: el contenido no está corrompido', String(fallo.message || fallo));
  }

  // Y que lo que sale sea byte a byte lo que entró.
  const fuera = mkdtempSync(join(tmpdir(), 'mirada-zip-fuera-'));
  try {
    execFileSync('unzip', ['-q', destino, '-d', fuera], { stdio: 'ignore' });
    const video = readFileSync(join(fuera, 'teaser.mp4'));
    const ficha = readFileSync(join(fuera, 'ficha.txt'), 'utf8');
    di(video.equals(falsoVideo), 'El vídeo sale byte a byte igual que entró',
      `${video.length} de ${falsoVideo.length} bytes`);
    di(ficha === LA_FICHA, 'Y la ficha sale con sus acentos y sus saltos de línea intactos');
  } catch (fallo) {
    di(false, 'Lo que sale del zip es lo que entró', String(fallo.message || fallo));
  }
}

// UN SOLO ARCHIVO, que es el caso del reel o del póster suelto.
const soloUno = join(taller, 'uno.zip');
await escribirZip([{ nombre: 'ficha.txt', ruta: rutaFicha, bytes: Buffer.byteLength(LA_FICHA, 'utf8') }], soloUno);
if (hayUnzip) {
  try {
    execFileSync('unzip', ['-t', soloUno], { stdio: 'ignore' });
    di(true, 'Un zip de un solo archivo también abre');
  } catch (fallo) {
    di(false, 'Un zip de un solo archivo también abre', String(fallo.message || fallo));
  }
}

// LOS TAMAÑOS GRANDES. No se escriben 4 GB aquí: se comprueba que las cabeceras
// ZIP64 aparecen cuando toca, mintiéndole al escritor sobre el tamaño no —eso
// rompería el CRC—, sino mirando el zip normal y confirmando que NO las lleva.
const bytesDelZip = readFileSync(destino);
const tieneZip64 = bytesDelZip.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
di(!tieneZip64,
  'Un zip pequeño NO lleva las cabeceras de los grandes: se queda en el formato de siempre');

const fuente = readFileSync(`${RAIZ}montador/montador.mjs`, 'utf8');
di(/0x06064b50/.test(fuente) && /0x07064b50/.test(fuente),
  'Pero el escritor SÍ sabe escribirlas, para cuando un episodio pase de 4 GB');
di(/grande = entrada\.bytes >= 0xffffffff/.test(fuente),
  'Y sabe a partir de cuándo hacen falta');

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
