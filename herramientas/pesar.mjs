#!/usr/bin/env node
// herramientas/pesar.mjs
//
// EL INVARIANTE QUE NO SE COMPRUEBA LEYENDO.
//
// La plataforma corta a 4,5 MB por petición y por respuesta. De los dos, el de
// la respuesta es el traicionero: pasarse no da un «no cabe», da un corte que
// parece un tiempo agotado, y entonces se busca el fallo en la cuota de Vertex,
// en la región del modelo o en la red, que es justo donde no está.
//
// Eso no se ve razonando sobre el código. Se ve MIDIENDO. Así que esta
// herramienta fabrica material del tamaño real —un PNG de 2K de verdad, WAVs de
// verdad, un estado con las 400 tomas de un episodio, 200 URLs firmadas con la
// longitud que tienen las de verdad—, construye con él la respuesta que
// devolvería cada modo del contrato §2, la serializa con JSON.stringify y cuenta
// los BYTES REALES en UTF-8. No estima ninguno.
//
//   node herramientas/pesar.mjs        (o: npm run pesar)
//
// Sale con 0 si todo cabe. Sale con 1, y en rojo, si algo no cabe.
//
// QUÉ ES MEDIDO Y QUÉ ES SUPUESTO. Esta distinción es la mitad del valor de la
// herramienta, así que va escrita en la propia salida, material por material:
//
//   · MEDIDO — el byte está contado sobre un archivo que existe en memoria. El
//     PNG de 2K se comprime aquí con zlib y pesa lo que pesa; los WAV se
//     fabrican muestra a muestra; el base64 se calcula de verdad y no con la
//     regla del tercio, que redondea mal.
//   · SUPUESTO — el tamaño se ha elegido, no medido, porque aquí no se puede
//     obtener. Solo hay uno: el JPEG de 1280 px que el navegador saca del master
//     con un canvas. En Node no hay canvas y no se admiten dependencias, así que
//     se fabrica un JPEG sintético del tamaño que app/imagen.js dice que tienen
//     esas copias (200-400 KB) y se toma el peor. Para que la conclusión no
//     dependa de ese número, se barre un abanico entero de tamaños y se dice a
//     partir de cuál dejaría de caber. Ese barrido es lo que convierte un
//     supuesto en una respuesta.
//
// POR QUÉ EL TOPE ES 4.500.000 Y NO 4,5 MiB. Se manejan dos números: 4,5 MB
// decimales (4.500.000) y 4,5 MiB (4.718.592, que es lo que usa api/g.js para
// cortar el cuerpo de entrada). Aquí se pesa contra el pequeño, porque quien
// pasa por el pequeño pasa por los dos.
//
// LO QUE ESTA HERRAMIENTA NO HACE. No toca la red, no lee credenciales, no
// escribe nada y no importa ni un módulo de api/: solo lee datos/serie.json,
// igual que herramientas/invariantes.mjs. Si algún día hace falta ejecutarla en
// el despliegue, se ejecuta igual, porque no necesita nada de allí.

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// ===========================================================================
// Números fijos
// ===========================================================================

/** El tope de la plataforma, en bytes exactos. Ver la cabecera. */
const TOPE = 4_500_000;

/** Ancho útil del texto: un móvil en vertical con Cloud Shell da poco más. */
const ANCHO = 46;

/** El master que se genera y que NO viaja nunca (contrato §2, modo `imagen`). */
const ANCHO_2K = 2048;
const ALTO_2K = 1152;

/** La copia que sí viaja, la que hace el navegador (app/imagen.js). */
const ANCHO_VEO = 1280;
const ALTO_VEO = 720;

/**
 * Lo que se supone que pesa esa copia. app/imagen.js dice «unos 200-400 KB» a
 * 1280 px y calidad 0,86. Se coge el peor de los dos, no el medio: un supuesto
 * que se elige por lo alto es un supuesto que no engaña.
 */
const JPEG_SUPUESTO = 400 * 1024;

/** El abanico con el que se comprueba que la conclusión no depende del supuesto. */
const JPEG_ABANICO = [150 * 1024, 250 * 1024, 400 * 1024, 800 * 1024, 1_200_000, 2_000_000];

/** Lo que pide el encargo del estado: un episodio entero en producción. */
const TOMAS_DE_UN_EPISODIO = 400;
const ESCENAS_DE_UN_EPISODIO = 24;
const PLANOS_POR_ESCENA = 17;
const TRABAJOS_EN_COLA = 400;
const EPISODIOS_DE_LA_SERIE = 12;

/** El tope de `firmar` y de `borrar` (api/_lib/modos.js). */
const RUTAS_POR_LLAMADA = 200;

/** Duraciones del material de audio, tal como las pide el encargo. */
const SEGUNDOS_DE_VOZ = 45;
const SEGUNDOS_DE_MUSICA = 78;

/** Formato del TTS: PCM mono de 16 bits a 24 kHz (plan §5). */
const VOZ_HZ = 24_000;
const VOZ_CANALES = 1;
const VOZ_BITS = 16;

/** Formato de Lyria, en su caso más pesado: 48 kHz en estéreo. */
const MUSICA_HZ = 48_000;
const MUSICA_CANALES = 2;
const MUSICA_BITS = 16;

// Cuatro nombres de mentira que solo existen para que las URLs firmadas y las
// rutas tengan la LONGITUD que tienen las de verdad. No identifican ninguna
// cuenta, ningún proyecto y ningún almacén: son del mismo largo y nada más.
const BUCKET_DE_MENTIRA = 'bucket-de-ejemplo-para-medir';
const PREFIJO_DE_MENTIRA = 'prefijo-del-proyecto';
const CUENTA_DE_MENTIRA = 'cuenta-de-ejemplo';
const PROYECTO_DE_MENTIRA = 'proyecto-de-ejemplo-4711';

/** La pieza con la que se pesa todo lo grande: un episodio desglosado. */
const PIEZA = 'ep01';

// ===========================================================================
// Escribir en la pantalla de un teléfono
// ===========================================================================

/** El color se apaga solo cuando la salida no es una terminal. */
const HAY_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

/** Rojo, y solo para lo que no cabe. Se aplica DESPUÉS de rellenar columnas. */
function rojo(texto) {
  return HAY_COLOR ? `\u001b[31m${texto}\u001b[0m` : texto;
}

/** Apagado, para lo que acompaña sin ser el dato. */
function tenue(texto) {
  return HAY_COLOR ? `\u001b[2m${texto}\u001b[0m` : texto;
}

/**
 * Parte un texto en líneas que caben a lo ancho, con sangría.
 * @param {string} texto
 * @param {number} ancho
 * @param {string} sangria
 * @returns {string[]}
 */
function envolver(texto, ancho, sangria = '') {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    if (!actual) actual = palabra;
    else if (actual.length + 1 + palabra.length <= ancho) actual += ` ${palabra}`;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  if (!lineas.length) lineas.push('');
  return lineas.map((linea) => sangria + linea);
}

/** Un párrafo suelto, ya envuelto. */
function decir(texto, sangria = '') {
  for (const linea of envolver(texto, ANCHO - sangria.length, sangria)) console.log(linea);
}

/** Título de bloque, con una línea en blanco por delante. */
function bloque(titulo) {
  console.log('');
  console.log(titulo.toUpperCase());
}

// ===========================================================================
// Números en español
// ===========================================================================

/** 1234567 → «1.234.567». */
function conPuntos(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 12.5 → «12,5». */
function conComa(n, decimales) {
  return n.toFixed(decimales).replace('.', ',');
}

/** Un tamaño legible de un vistazo: «6,93 MB», «412,3 KB», «180 B». */
function tamano(bytes) {
  if (bytes >= 1_000_000) return `${conComa(bytes / 1_000_000, 2)} MB`;
  if (bytes >= 1000) return `${conComa(bytes / 1000, 1)} KB`;
  return `${conPuntos(bytes)} B`;
}

/** El porcentaje del tope, que es lo que de verdad se mira. */
function porcentaje(bytes) {
  const cuanto = (bytes / TOPE) * 100;
  if (cuanto >= 100) return `${conComa(cuanto, 0)} %`;
  if (cuanto < 0.1) return '<0,1 %';
  return `${conComa(cuanto, 1)} %`;
}

// ===========================================================================
// Medir de verdad
// ===========================================================================

/**
 * Lo que pesa un valor una vez serializado, en bytes UTF-8. Esta es LA función
 * de la herramienta: todo lo demás existe para darle algo real que pesar.
 *
 * Se mide sobre `JSON.stringify` sin sangrado, que es exactamente lo que manda
 * `api/g.js` en `X-Peso-Respuesta`.
 *
 * @param {any} valor
 * @returns {number} bytes.
 */
function pesar(valor) {
  return Buffer.byteLength(JSON.stringify(valor), 'utf8');
}

/**
 * Lo que ocupa un archivo binario metido dentro de un JSON como base64.
 *
 * NO se estima con la regla del tercio: se codifica de verdad y se cuenta. La
 * regla redondea por debajo y aquí redondear por debajo es mentir en la
 * dirección peligrosa.
 *
 * @param {Buffer} datos
 * @returns {number} bytes del texto base64.
 */
function pesarBase64(datos) {
  return Buffer.byteLength(datos.toString('base64'), 'utf8');
}

// ===========================================================================
// Azar repetible
//
// Las mismas cifras en cada ejecución. Un peso que cambia de una vez a otra no
// se puede comparar con el de ayer, y comparar con el de ayer es medio oficio.
// ===========================================================================

/**
 * Un generador xorshift de 32 bits. No hace falta que sea bueno; hace falta que
 * sea el mismo siempre.
 * @param {number} semilla
 * @returns {() => number} un entero de 0 a 255.
 */
function azarCon(semilla) {
  let estado = semilla >>> 0 || 0x2f6e2b1;
  return () => {
    estado ^= estado << 13;
    estado >>>= 0;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    estado >>>= 0;
    return estado & 0xff;
  };
}

// ===========================================================================
// Fabricar un PNG de 2K de verdad
// ===========================================================================

/** La tabla del CRC-32 que pide el formato PNG. Se calcula una vez. */
const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

/**
 * @param {Buffer} datos
 * @returns {number} el CRC-32 del bloque, sin signo.
 */
function crc32(datos) {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i += 1) {
    c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Un trozo de PNG: longitud, nombre, cuerpo y CRC.
 * @param {string} tipo cuatro letras: «IHDR», «IDAT», «IEND».
 * @param {Buffer} cuerpo
 * @returns {Buffer}
 */
function trozoPng(tipo, cuerpo) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(cuerpo.length, 0);
  const nombre = Buffer.from(tipo, 'ascii');
  const suma = Buffer.alloc(4);
  suma.writeUInt32BE(crc32(Buffer.concat([nombre, cuerpo])), 0);
  return Buffer.concat([largo, nombre, cuerpo, suma]);
}

/**
 * Un PNG de verdad, del tamaño de un master de la serie: 2048×1152, RGB de 8
 * bits, sin entrelazar. Cabecera IHDR, un IDAT con los datos comprimidos por
 * zlib y su IEND. Se puede volcar a un archivo y se abre.
 *
 * QUÉ SE DIBUJA DENTRO, Y POR QUÉ IMPORTA. Un PNG de ruido puro no se comprime
 * nada y sale más grande que un fotograma real; uno de color plano se comprime
 * a nada y saldría ridículamente pequeño. Ni uno ni otro sirven para medir. Lo
 * que se pinta aquí es lo que se parece a un fotograma de este animé: un fondo
 * que varía despacio —que es lo que el compresor sí aprovecha— con grano encima
 * —que es lo que no—. El resultado cae donde tiene que caer, en el entorno de
 * los 6,8 MB que dice el plan §10, y la salida enseña los bits por píxel para
 * que cualquiera pueda juzgar si el material es honesto.
 *
 * @param {number} ancho
 * @param {number} alto
 * @returns {Buffer} el archivo PNG entero.
 */
function fabricarPng(ancho, alto) {
  const azar = azarCon(0x5a4a1a15);
  const porFila = 1 + ancho * 3; // el byte de filtro va delante de cada fila
  const crudo = Buffer.allocUnsafe(porFila * alto);

  for (let y = 0; y < alto; y += 1) {
    let i = y * porFila;
    crudo[i] = 0; // filtro «ninguno»: lo que se mide es la compresión, no el filtro
    i += 1;
    for (let x = 0; x < ancho; x += 1) {
      // El fondo que varía despacio. Son las zonas que un compresor aprovecha,
      // igual que en un cielo, en una pared de piedra o en una sombra.
      const fondo = ((x >> 3) + (y >> 4)) & 0x3f;
      // Y el grano encima, que es lo que no se deja comprimir. La cadena de
      // acabado de la serie mete `noise=alls=7`, así que esto no es un adorno.
      const grano = azar() & 0x7f;
      crudo[i] = (fondo * 3 + grano) & 0xff;
      crudo[i + 1] = (fondo * 2 + (grano >> 1)) & 0xff;
      crudo[i + 2] = (fondo + grano) & 0xff;
      i += 3;
    }
  }

  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8; // bits por muestra
  cabecera[9] = 2; // color verdadero, tres muestras por píxel
  cabecera[10] = 0; // compresión: la única que existe
  cabecera[11] = 0; // filtrado: el estándar
  cabecera[12] = 0; // sin entrelazar

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozoPng('IHDR', cabecera),
    trozoPng('IDAT', deflateSync(crudo)),
    trozoPng('IEND', Buffer.alloc(0))
  ]);
}

// ===========================================================================
// Fabricar el JPEG reducido — el único material SUPUESTO
// ===========================================================================

/**
 * Un JPEG con la estructura de uno de verdad —SOI, JFIF, tablas, SOF0 con su
 * ancho y su alto, SOS y EOI— y del tamaño que se le pida.
 *
 * ESTO ES UN SUPUESTO Y SE DICE ASÍ EN LA SALIDA. La reducción a 1280 px la
 * hace el navegador con un canvas (app/imagen.js) y en Node no hay canvas ni se
 * admiten dependencias, así que aquí no se puede medir cuánto pesa esa copia:
 * se elige. Lo que sí es medido es todo lo que se hace después con ella —el
 * base64, el JSON, el total de la petición—, y como el número elegido gobierna
 * el resultado, `barrerElAbanico()` repite la cuenta con seis tamaños distintos
 * y dice a partir de cuál dejaría de caber. Un supuesto acotado por los dos
 * lados vale tanto como una medida.
 *
 * Los bytes de entropía no son una imagen: son relleno sin ningún 0xFF, para
 * que ninguno se lea como el principio de un marcador. Para pesar da igual —el
 * base64 de N bytes ocupa lo mismo sea lo que sea lo que lleven dentro— y para
 * mirarlo no sirve, que es justo lo que la etiqueta dice.
 *
 * @param {number} bytesObjetivo
 * @param {number} ancho
 * @param {number} alto
 * @returns {Buffer}
 */
function fabricarJpeg(bytesObjetivo, ancho, alto) {
  const marcador = (codigo, cuerpo) =>
    Buffer.concat([
      Buffer.from([0xff, codigo]),
      (() => {
        const largo = Buffer.alloc(2);
        largo.writeUInt16BE(cuerpo.length + 2, 0);
        return largo;
      })(),
      cuerpo
    ]);

  // JFIF: versión 1.1, sin unidades, densidad 1×1, sin miniatura.
  const jfif = Buffer.concat([
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  ]);

  // Dos tablas de cuantización, la de luminancia y la de crominancia. Los
  // valores son planos a propósito: no se va a decodificar nada.
  const cuantizacion = (id) =>
    Buffer.concat([Buffer.from([id]), Buffer.alloc(64, id === 0 ? 16 : 24)]);

  // El comienzo de fotograma, que es el marcador del que `medidaDeImagen()` de
  // api/_lib/modos.js saca el ancho y el alto. Aquí van los de verdad.
  const comienzo = Buffer.alloc(15);
  comienzo[0] = 8; // ocho bits por muestra
  comienzo.writeUInt16BE(alto, 1);
  comienzo.writeUInt16BE(ancho, 3);
  comienzo[5] = 3; // tres componentes: Y, Cb, Cr
  comienzo[6] = 1;
  comienzo[7] = 0x22; // luminancia, submuestreo 2×2
  comienzo[8] = 0;
  comienzo[9] = 2;
  comienzo[10] = 0x11;
  comienzo[11] = 1;
  comienzo[12] = 3;
  comienzo[13] = 0x11;
  comienzo[14] = 1;

  // Una tabla de Huffman mínima por clase y por componente: un solo código.
  const huffman = (clase, id) =>
    Buffer.concat([
      Buffer.from([(clase << 4) | id]),
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from([0x00])
    ]);

  // El comienzo del barrido: tres componentes con sus tablas.
  const barrido = Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00]);

  const cabecera = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    marcador(0xe0, jfif),
    marcador(0xdb, cuantizacion(0)),
    marcador(0xdb, cuantizacion(1)),
    marcador(0xc0, comienzo),
    marcador(0xc4, huffman(0, 0)),
    marcador(0xc4, huffman(1, 0)),
    marcador(0xc4, huffman(0, 1)),
    marcador(0xc4, huffman(1, 1)),
    marcador(0xda, barrido)
  ]);

  const cuantosDeRelleno = Math.max(0, bytesObjetivo - cabecera.length - 2);
  const relleno = Buffer.allocUnsafe(cuantosDeRelleno);
  const azar = azarCon(0x1f2e3d4c);
  for (let i = 0; i < cuantosDeRelleno; i += 1) {
    const byte = azar();
    relleno[i] = byte === 0xff ? 0xfe : byte;
  }

  return Buffer.concat([cabecera, relleno, Buffer.from([0xff, 0xd9])]);
}

// ===========================================================================
// Fabricar los WAV
// ===========================================================================

/**
 * Un WAV PCM entero, con su cabecera RIFF de 44 bytes y sus muestras dentro.
 * Es el mismo formato que devuelve `envolverWav()` en api/_lib/audio.js.
 *
 * Las muestras son una onda con grano encima —ni silencio, que se comprimiría
 * en cualquier sitio, ni ruido puro—, pero para el peso da igual: el PCM ocupa
 * lo que ocupa, muestra a muestra, y esa es la gracia de este formato y la
 * razón de que el audio tampoco pueda viajar por la función.
 *
 * @param {{hz:number, canales:number, bits:number, segundos:number}} formato
 * @returns {Buffer}
 */
function fabricarWav({ hz, canales, bits, segundos }) {
  const porMuestra = Math.ceil(bits / 8);
  const cuantasMuestras = Math.round(hz * segundos);
  const bytesDeDatos = cuantasMuestras * canales * porMuestra;

  const wav = Buffer.alloc(44 + bytesDeDatos);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + bytesDeDatos, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16); // longitud del trozo «fmt »
  wav.writeUInt16LE(1, 20); // 1 = PCM sin comprimir
  wav.writeUInt16LE(canales, 22);
  wav.writeUInt32LE(hz, 24);
  wav.writeUInt32LE(hz * canales * porMuestra, 28);
  wav.writeUInt16LE(canales * porMuestra, 32);
  wav.writeUInt16LE(bits, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(bytesDeDatos, 40);

  const azar = azarCon(0x7c3d51a9);
  let i = 44;
  for (let n = 0; n < cuantasMuestras; n += 1) {
    // Una onda lenta con grano: se parece más a una voz que el silencio y no
    // cuesta nada. El tamaño no depende de esto en absoluto.
    const onda = Math.round(Math.sin((n / hz) * 2 * Math.PI * 110) * 9000);
    for (let c = 0; c < canales; c += 1) {
      wav.writeInt16LE(Math.max(-32768, Math.min(32767, onda + (azar() - 128) * 8)), i);
      i += 2;
    }
  }
  return wav;
}

/** Los segundos que dura un WAV según su cabecera, para comprobar el material. */
function duracionDeWav(wav) {
  const hz = wav.readUInt32LE(24);
  const canales = wav.readUInt16LE(22);
  const bits = wav.readUInt16LE(34);
  const bytesDeDatos = wav.readUInt32LE(40);
  return bytesDeDatos / (hz * canales * Math.ceil(bits / 8));
}

// ===========================================================================
// Comprobar el material fabricado
//
// Un material que no es lo que dice no mide nada. Estas dos funciones son las
// mismas cuentas que hace `medidaDeImagen()` en api/_lib/modos.js: si el PNG y
// el JPEG que se fabrican aquí no se leen desde fuera, no valen para pesar.
// ===========================================================================

/** Ancho y alto de un PNG, leídos de su IHDR. */
function medidaDePng(datos) {
  return { ancho: datos.readUInt32BE(16), alto: datos.readUInt32BE(20) };
}

/** Ancho y alto de un JPEG, buscando su comienzo de fotograma. */
function medidaDeJpeg(datos) {
  let i = 2;
  while (i + 9 < datos.length) {
    if (datos[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marca = datos[i + 1];
    if (marca === 0xff || marca === 0x01 || marca === 0xd8 || (marca >= 0xd0 && marca <= 0xd7)) {
      i += 2;
      continue;
    }
    const largo = datos.readUInt16BE(i + 2);
    if (largo < 2) break;
    const esComienzoDeFotograma =
      marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc;
    if (esComienzoDeFotograma) {
      return { alto: datos.readUInt16BE(i + 5), ancho: datos.readUInt16BE(i + 7) };
    }
    i += 2 + largo;
  }
  return { ancho: null, alto: null };
}

// ===========================================================================
// Los datos de la serie
//
// Se leen para que el material se parezca a lo que de verdad va a viajar: los
// ids de las placas, los ids de modelo, el reparto de voces y —esto importa
// para el peso— las líneas en japonés, que en UTF-8 ocupan tres bytes por
// carácter. Inventarlas en español mediría de menos.
// ===========================================================================

/** @returns {any} datos/serie.json ya parseado. */
function leerLaSerie() {
  try {
    return JSON.parse(readFileSync(join(raiz, 'datos/serie.json'), 'utf8'));
  } catch (fallo) {
    console.log('');
    decir(
      '✗ No se puede leer datos/serie.json, y sin él no hay material con el que ' +
        'pesar nada: de ahí salen los ids de las placas, los del reparto y las ' +
        'líneas en japonés, que son las que hacen que un byte no sea un carácter. ' +
        `Lo que dijo el lector: ${fallo && fallo.message ? fallo.message : String(fallo)}`
    );
    console.log('');
    process.exit(1);
  }
  return null;
}

const serie = leerLaSerie();

const placasDelBanco = ((serie.banco && serie.banco.placas) || []).filter((p) => p && p.id);
const placasDeEscenario = ((serie.escenarios && serie.escenarios.placas) || []).filter(
  (e) => e && e.id
);
const repartoDeVoces = ((serie.voces && serie.voces.reparto) || []).filter(
  (r) => r && r.personaje
);
const lineasDelTeaser =
  (serie.piezas && serie.piezas.teaser && serie.piezas.teaser.audio && serie.piezas.teaser.audio.voz) ||
  [];
const tomasDelTeaser = (serie.piezas && serie.piezas.teaser && serie.piezas.teaser.tomas) || [];

/** Un elemento de una lista, dando la vuelta cuando se acaba. */
function delCiclo(lista, i, siEstaVacia) {
  if (!lista.length) return siEstaVacia;
  return lista[i % lista.length];
}

// ===========================================================================
// Las piezas de una respuesta
// ===========================================================================

/**
 * Una URL firmada V4 con la forma y la longitud exactas de las que compone
 * `firmar()` en api/_lib/gcs.js: host, bucket, objeto, los cinco parámetros de
 * la firma y detrás la firma RSA-2048 en hexadecimal, que son 512 caracteres
 * clavados. Es la cadena más larga que devuelve el estudio y va en casi todas
 * las respuestas, así que su longitud no es un detalle.
 *
 * El correo y el proyecto van codificados igual que en una URL de verdad
 * (`%40`, `%2F`) y son de mentira: lo único que se copia de una URL real es el
 * número de caracteres.
 *
 * @param {string} ruta ruta lógica dentro del bucket.
 * @param {number} semilla para que dos URLs no salgan idénticas.
 * @returns {string}
 */
function urlFirmada(ruta, semilla) {
  const azar = azarCon(0x9e3779b9 ^ (semilla >>> 0));
  let firma = '';
  for (let i = 0; i < 256; i += 1) firma += azar().toString(16).padStart(2, '0');

  const credencial =
    `${CUENTA_DE_MENTIRA}%40${PROYECTO_DE_MENTIRA}.iam.gserviceaccount.com` +
    '%2F20260905%2Fus-central1%2Fstorage%2Fgoog4_request';

  return (
    `https://storage.googleapis.com/${BUCKET_DE_MENTIRA}/${PREFIJO_DE_MENTIRA}/${ruta}` +
    '?X-Goog-Algorithm=GOOG4-RSA-SHA256' +
    `&X-Goog-Credential=${credencial}` +
    '&X-Goog-Date=20260905T094012Z' +
    '&X-Goog-Expires=21600' +
    '&X-Goog-SignedHeaders=host' +
    `&X-Goog-Signature=${firma}`
  );
}

/** Una marca de tiempo con la forma que escriben el bucket y la cola. */
function cuando(minuto) {
  const base = Date.UTC(2026, 8, 5, 9, 0, 0) + minuto * 60_000;
  return new Date(base).toISOString();
}

/** El id de la toma número `i` de un episodio: «{escena}-{plano}». */
function idDeToma(i) {
  const escena = Math.floor(i / PLANOS_POR_ESCENA) + 1;
  const plano = (i % PLANOS_POR_ESCENA) + 1;
  return `${escena}-${plano}`;
}

/** Las rutas del bucket, tal como las escribe api/_lib/modos.js. */
const rutaDeKeyframe = (idPieza, idToma, n) => `keyframes/${idPieza}/${idToma}/${n}.png`;
const rutaDeClip = (idPieza, idToma, n, sello) => `veo/${idPieza}/${idToma}/${n}/${sello}-0.mp4`;

// ===========================================================================
// El estado de la producción
// ===========================================================================

/**
 * Un `estado.json` con la forma exacta del contrato §5, del tamaño que tiene
 * cuando hay episodios de verdad en producción.
 *
 * Se llena como está a mitad de un episodio, que es el caso pesado: casi todas
 * las tomas con dos o tres intentos de keyframe apuntados y dos de clip, unas
 * cuantas con operación de Veo en vuelo, y las que fallaron con su mensaje en
 * español dentro de la cola —que es lo que de verdad engorda la cola, porque un
 * mensaje que se lee en pantalla ocupa mucho más que un identificador—.
 *
 * @param {{episodios:number, tomasPorEpisodio:number, cola:number}} cuanto
 * @returns {object}
 */
function fabricarEstado({ episodios, tomasPorEpisodio, cola }) {
  const estado = {
    version: 1,
    pieza_activa: PIEZA,
    banco: {},
    escenarios: {},
    tomas: {},
    audio: { musica: {}, voz: {} },
    voces: {},
    montajes: [],
    cola: [],
    gasto: {
      imagen: { calidad: 812, medio: 1435, economico: 2210 },
      video_s: { calidad: 1284, medio: 3160, economico: 4408 },
      musica_s: 1872,
      voz_s: 2640
    },
    pesos: {}
  };

  // El banco es de la serie entera y no crece con los episodios: son las placas
  // que hay escritas en datos/serie.json.
  placasDelBanco.forEach((placa, i) => {
    const carpeta = `banco/${placa.personaje}/${placa.id}`;
    estado.banco[placa.id] = {
      aprobada: `${carpeta}/${(i % 3) + 1}.png`,
      intentos: Array.from({ length: (i % 3) + 1 }, (_, n) => `${carpeta}/${n + 1}.png`)
    };
  });

  placasDeEscenario.forEach((escenario, i) => {
    const carpeta = `escenarios/${escenario.id}`;
    estado.escenarios[escenario.id] = {
      aprobada: `${carpeta}/${(i % 2) + 1}.png`,
      intentos: Array.from({ length: (i % 2) + 1 }, (_, n) => `${carpeta}/${n + 1}.png`)
    };
  });

  for (let e = 1; e <= episodios; e += 1) {
    const idPieza = `ep${String(e).padStart(2, '0')}`;

    for (let i = 0; i < tomasPorEpisodio; i += 1) {
      const idToma = idDeToma(i);
      const cuantosKeyframes = (i % 3) + 1;
      const cuantosClips = (i % 2) + 1;
      const enVuelo = i % 40 === 7;

      estado.tomas[`${idPieza}/${idToma}`] = {
        keyframe_aprobado: rutaDeKeyframe(idPieza, idToma, cuantosKeyframes),
        intentos_keyframe: Array.from({ length: cuantosKeyframes }, (_, n) =>
          rutaDeKeyframe(idPieza, idToma, n + 1)
        ),
        clip_elegido: enVuelo ? null : rutaDeClip(idPieza, idToma, cuantosClips, 1757068812345 + i),
        intentos_clip: Array.from({ length: enVuelo ? 0 : cuantosClips }, (_, n) =>
          rutaDeClip(idPieza, idToma, n + 1, 1757068812345 + i)
        ),
        operacion_en_curso: enVuelo
          ? `projects/${PROYECTO_DE_MENTIRA}/locations/us-central1/publishers/google/models/` +
            `veo/operations/a1b2c3d4-e5f6-4a7b-8c9d-${String(100000000000 + i).slice(0, 12)}`
          : null,
        operacion_prefijo: enVuelo ? `veo/${idPieza}/${idToma}/${cuantosClips + 1}/` : null
      };
    }

    // Un bloque de voz por escena, con un tiempo medido por línea dentro.
    for (let escena = 1; escena <= ESCENAS_DE_UN_EPISODIO; escena += 1) {
      const cuantasLineas = 6 + (escena % 9);
      estado.audio.voz[`${idPieza}/esc-${escena}`] = {
        ruta: `audio/voz/${idPieza}/esc-${escena}.wav`,
        dur_s: 18.4 + escena,
        aprobada: escena % 5 !== 0,
        lineas: Array.from({ length: cuantasLineas }, (_, n) => ({
          inicio: Number((n * 2.4).toFixed(2)),
          fin: Number((n * 2.4 + 1.9).toFixed(2))
        })),
        intentos: [`audio/voz/${idPieza}/esc-${escena}.wav`]
      };
    }

    // La música de un episodio son varias piezas, una por acto o por bloque:
    // Lyria no pasa de tres minutos por pieza (plan §5).
    for (let n = 1; n <= 8; n += 1) {
      estado.audio.musica[`${idPieza}-lecho-${n}`] = {
        ruta: `audio/musica/${idPieza}-lecho-${n}.wav`,
        dur_s: 168.5,
        aprobada: true,
        intentos: [`audio/musica/${idPieza}-lecho-${n}.wav`]
      };
    }

    // Montaje por capas: una salida por escena, una por acto y una del episodio.
    for (let escena = 1; escena <= ESCENAS_DE_UN_EPISODIO; escena += 1) {
      estado.montajes.push({
        ruta: `montaje/${idPieza}-esc-${escena}.mp4`,
        capa: 'escena',
        id: `${idPieza}/${escena}`,
        cuando: cuando(escena * 7)
      });
    }
    for (let acto = 1; acto <= 4; acto += 1) {
      estado.montajes.push({
        ruta: `montaje/${idPieza}-acto-${acto}.mp4`,
        capa: 'acto',
        id: `${idPieza}/acto-${acto}`,
        cuando: cuando(200 + acto * 11)
      });
    }
    estado.montajes.push({
      ruta: `montaje/${idPieza}-1.mp4`,
      capa: 'episodio',
      id: idPieza,
      cuando: cuando(400)
    });
  }

  // Las piezas de música de la serie que ya están escritas en los datos.
  for (const pieza of (serie.musica && serie.musica.piezas) || []) {
    if (!pieza || !pieza.id) continue;
    estado.audio.musica[pieza.id] = {
      ruta: `audio/musica/${pieza.id}.wav`,
      dur_s: Number(pieza.duracion_s) || 0,
      aprobada: true,
      intentos: [`audio/musica/${pieza.id}.wav`]
    };
  }

  // El reparto: la voz elegida, la frase de muestra ya traducida —en japonés,
  // que son tres bytes por carácter— y las candidatas que se llegaron a oír.
  repartoDeVoces.forEach((quien, i) => {
    const muestras = {};
    for (let n = 0; n < 6; n += 1) {
      const vozId = `ja-JP-Chirp3-HD-${['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir', 'Leda'][n]}`;
      muestras[vozId] = `muestras/${quien.personaje}/${vozId}.wav`;
    }
    estado.voces[quien.personaje] = {
      voz_id: `ja-JP-Chirp3-HD-${['Aoede', 'Kore', 'Puck'][i % 3]}`,
      ja: delCiclo(lineasDelTeaser, i, { ja: '' }).ja || null,
      muestras
    };
  });

  // La cola. Uno de cada diez trabajos ha fallado y guarda su porqué en
  // español, que es lo que se pinta en pantalla y lo que pesa.
  const tipos = ['keyframe', 'clip', 'clip-consultar', 'voz', 'alinear', 'musica', 'montaje'];
  const queja =
    'Veo dice que ha terminado, pero en esa carpeta no hay ningún vídeo. Casi siempre es el ' +
    'filtro de contenido, que se queda con el clip y da la operación por buena igualmente: hay ' +
    'que cambiar lo que se le pide a esa toma en datos/serie.json.';
  for (let i = 0; i < cola; i += 1) {
    const idToma = idDeToma(i);
    const fallado = i % 10 === 3;
    estado.cola.push({
      id: `${tipos[i % tipos.length]}-${PIEZA}-${idToma}-1`,
      tipo: tipos[i % tipos.length],
      args: { pieza: PIEZA, id: idToma },
      estado: fallado ? 'fallido' : i % 3 === 0 ? 'hecho' : 'pendiente',
      intentos: fallado ? 4 : 1,
      error: fallado ? queja : null,
      operacion: null,
      creado: cuando(i / 4),
      actualizado: cuando(i / 4 + 2)
    });
  }

  // Los pesos por modo: lo que esta misma herramienta mide, pero en producción,
  // guardado por el navegador desde la cabecera X-Peso-Respuesta.
  for (const modo of [
    'salud',
    'voces',
    'voz-muestra',
    'imagen',
    'veo-lanzar',
    'veo-consultar',
    'musica',
    'voz',
    'alinear',
    'desglosar-escena',
    'estado-leer',
    'estado-escribir',
    'firmar',
    'listar',
    'borrar',
    'guardar-texto',
    'montar',
    'montaje-estado'
  ]) {
    estado.pesos[modo] = 1024;
  }

  return estado;
}

// ===========================================================================
// El desglose
// ===========================================================================

/**
 * Los planos de una escena, con la forma exacta que valida `_lib/desglose.js`
 * y con textos de la longitud que tienen los de datos/serie.json: los prompts
 * de imagen y de vídeo van en inglés porque van a un modelo de imagen y a uno
 * de vídeo, que es la única excepción del idioma.
 *
 * @param {number} escena
 * @param {number} cuantos
 * @returns {object[]}
 */
function planosDeUnaEscena(escena, cuantos) {
  const planos = [];
  for (let n = 1; n <= cuantos; n += 1) {
    const modelo = delCiclo(tomasDelTeaser, escena * 7 + n, {
      imagen: 'Close detail of ritual symbols painted in fresh dark blood on a damp stone wall',
      video: 'A droplet of blood slowly runs down the wall. Very slow push in. Nothing else moves.',
      luz: 'CRIPTA',
      escenario: 'cripta'
    });
    // El material cumple las reglas del desglose (contrato §6) aunque para el
    // peso dé igual: un plano encadenado se usa entero (dur == dur_gen) y uno
    // con la boca en cuadro dura entre 2 y 4 s. Un ejemplo que rompe las reglas
    // que la herramienta está defendiendo se lee como un descuido.
    const encadena = n % 7 === 0;
    const laBoca = n % 5 === 0 ? 'saharis' : null;
    const dur = encadena ? 4 : laBoca ? 3 : 2 + (n % 4);
    const durGen = dur <= 4 ? 4 : dur <= 6 ? 6 : 8;
    planos.push({
      id: `${escena}-${n}`,
      imagen: modelo.imagen,
      video: modelo.video,
      dur,
      dur_gen: durGen,
      recorte: [0, dur],
      veo: ['economico', 'medio', 'calidad'][n % 3],
      luz: modelo.luz,
      escenario: modelo.escenario,
      refs: n % 3 === 0 ? [] : [delCiclo(placasDelBanco, n, { id: 'saharis-ancla' }).id],
      boca_visible: laBoca,
      encadena_con: encadena ? `${escena}-${n + 1}` : null
    });
  }
  return planos;
}

// ===========================================================================
// El material, fabricado de una vez
// ===========================================================================

const png2k = fabricarPng(ANCHO_2K, ALTO_2K);
const jpeg1280 = fabricarJpeg(JPEG_SUPUESTO, ANCHO_VEO, ALTO_VEO);
const wavDeVoz = fabricarWav({
  hz: VOZ_HZ,
  canales: VOZ_CANALES,
  bits: VOZ_BITS,
  segundos: SEGUNDOS_DE_VOZ
});
const wavDeMusica = fabricarWav({
  hz: MUSICA_HZ,
  canales: MUSICA_CANALES,
  bits: MUSICA_BITS,
  segundos: SEGUNDOS_DE_MUSICA
});

const estadoDeUnEpisodio = fabricarEstado({
  episodios: 1,
  tomasPorEpisodio: TOMAS_DE_UN_EPISODIO,
  cola: TRABAJOS_EN_COLA
});

const rutasParaFirmar = Array.from({ length: RUTAS_POR_LLAMADA }, (_, i) =>
  rutaDeKeyframe(PIEZA, idDeToma(i), (i % 3) + 1)
);
const urlsFirmadas = {};
rutasParaFirmar.forEach((ruta, i) => {
  urlsFirmadas[ruta] = urlFirmada(ruta, i + 1);
});

const desgloseDeUnaEscena = planosDeUnaEscena(7, PLANOS_POR_ESCENA);
const desgloseDelEpisodio = [];
for (let escena = 1; escena <= ESCENAS_DE_UN_EPISODIO; escena += 1) {
  desgloseDelEpisodio.push(...planosDeUnaEscena(escena, PLANOS_POR_ESCENA));
}

/** Lo que devuelve `listar` para todo lo que un episodio deja en el bucket. */
function objetosDelBucket(episodios) {
  const objetos = [];
  for (let e = 1; e <= episodios; e += 1) {
    const idPieza = `ep${String(e).padStart(2, '0')}`;
    for (let i = 0; i < TOMAS_DE_UN_EPISODIO; i += 1) {
      const idToma = idDeToma(i);
      for (let n = 1; n <= (i % 3) + 1; n += 1) {
        objetos.push({
          ruta: rutaDeKeyframe(idPieza, idToma, n),
          bytes: 6_912_345,
          actualizado: cuando(i)
        });
      }
      for (let n = 1; n <= (i % 2) + 1; n += 1) {
        objetos.push({
          ruta: rutaDeClip(idPieza, idToma, n, 1757068812345 + i),
          bytes: 34_567_890,
          actualizado: cuando(i + 1)
        });
      }
    }
  }
  return objetos;
}

const objetosDeUnEpisodio = objetosDelBucket(1);

// Las voces reales de Google para el idioma de la serie. La lista se pide a la
// API y se enseña entera en la pantalla de Voces; se pesa con holgura.
const vocesDeLaApi = Array.from({ length: 60 }, (_, i) => ({
  id: `ja-JP-Chirp3-HD-${['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir', 'Leda'][i % 6]}-${i}`,
  genero: i % 2 === 0 ? 'femenino' : 'masculino',
  idiomas: ['ja-JP']
}));

/** Las líneas de un bloque de voz de una escena de episodio, con su japonés. */
const lineasDeUnBloque = Array.from({ length: 14 }, (_, i) => {
  const modelo = delCiclo(lineasDelTeaser, i, {
    quien: 'saharis',
    ja: '',
    es: 'No dejes que te vean.'
  });
  return {
    quien: modelo.quien,
    ja: modelo.ja,
    es: modelo.es,
    t: Number((i * 3.2).toFixed(2)),
    hasta: Number((i * 3.2 + 2.4).toFixed(2))
  };
});

// El texto que Google devuelve cuando algo falla, recortado a lo que deja pasar
// api/_lib/salud.js. Sirve para pesar el peor caso de una respuesta con quejas.
const LO_QUE_DICE_GOOGLE =
  'Publisher Model is not found or your project does not have access to it. Please ensure you ' +
  'are using a valid model name and that the model is available in the location you requested. ' +
  'Note that the Gemini 3.x family of models is served exclusively from the global endpoint.';

// ===========================================================================
// El manifiesto de montaje (contrato §7)
// ===========================================================================

/**
 * El manifiesto de un episodio entero. No viaja en ninguna respuesta —el modo
 * `montar` solo devuelve la ejecución y la ruta— pero sí viaja en la PETICIÓN,
 * y ahí es donde hay que pesarlo.
 * @returns {object}
 */
function fabricarManifiesto() {
  const video = [];
  let reloj = 0;
  for (let i = 0; i < TOMAS_DE_UN_EPISODIO; i += 1) {
    const idToma = idDeToma(i);
    const dur = 2 + (i % 4);
    video.push({
      id: idToma,
      origen: rutaDeClip(PIEZA, idToma, (i % 2) + 1, 1757068812345 + i),
      desde: 0,
      hasta: dur,
      en: Number(reloj.toFixed(2)),
      paso_de_dos: i % 3 === 0
    });
    reloj += dur;
  }

  const audio = [];
  for (let n = 1; n <= 8; n += 1) {
    audio.push({
      pista: 'musica',
      origen: `audio/musica/${PIEZA}-lecho-${n}.wav`,
      desde: 0,
      hasta: 168.5,
      en: (n - 1) * 165,
      ganancia_db: -6,
      agacha: true
    });
  }
  for (let escena = 1; escena <= ESCENAS_DE_UN_EPISODIO; escena += 1) {
    audio.push({
      pista: 'voz',
      origen: `audio/voz/${PIEZA}/esc-${escena}.wav`,
      desde: 0,
      hasta: 18.4 + escena,
      en: escena * 52,
      ganancia_db: 0,
      agacha: false
    });
  }

  // Los subtítulos de un episodio: en español, quemados, con los tiempos reales
  // medidos por `alinear`. No hay ni un carácter japonés en pantalla.
  const subtitulos = [];
  for (let i = 0; i < 340; i += 1) {
    const modelo = delCiclo(lineasDelTeaser, i, { es: 'No dejes que te vean.' });
    subtitulos.push({
      desde: Number((i * 3.7).toFixed(2)),
      hasta: Number((i * 3.7 + 2.6).toFixed(2)),
      texto: modelo.es
    });
  }

  const acabado = (serie.piezas && serie.piezas.teaser && serie.piezas.teaser.acabado) || {};

  return {
    trabajo: `${PIEZA}-3`,
    capa: 'episodio',
    salida: `montaje/${PIEZA}-3.mp4`,
    formato: { ancho: 1920, alto: 1080, fps: 24 },
    acabado: {
      cadena: acabado.cadena_ffmpeg || '',
      paso_de_dos: video.filter((v) => v.paso_de_dos).map((v) => v.id)
    },
    video,
    audio,
    silencios: Array.from({ length: 24 }, (_, i) => [i * 52 + 44, i * 52 + 47]),
    subtitulos,
    cartela: {
      en: 1310,
      dur: 3,
      texto: (serie.cartela && serie.cartela.texto) || 'LA MIRADA QUE EL MUNDO TEMERÁ',
      fundido: 0.5
    },
    capas_previas: Array.from(
      { length: ESCENAS_DE_UN_EPISODIO },
      (_, i) => `montaje/${PIEZA}-esc-${i + 1}.mp4`
    )
  };
}

const manifiesto = fabricarManifiesto();

// ===========================================================================
// Las respuestas de cada modo (contrato §2)
//
// Cada una es lo que devolvería la puerta con este material, con el `ok:true`
// que le pone api/g.js delante. Nada está inventado a ojo: los campos son los
// del contrato §2 y los que devuelve api/_lib/modos.js, uno por uno.
// ===========================================================================

/** @type {{modo:string, que:string, respuesta:any, remedio:string}[]} */
const RESPUESTAS = [
  {
    modo: 'salud',
    que: 'nueve modelos, el bucket y las voces del idioma',
    remedio:
      'Recortar lo que dijo Google por modelo, que ya se recorta a 600 caracteres en salud.js.',
    respuesta: {
      ok: true,
      cuenta: {
        correo: 'cue…plo',
        proyecto: 'pro…711',
        bucket: 'buc…dir',
        prefijo: 'pre…cto'
      },
      credenciales: { ok: true, error: null },
      bucket: { lectura: true, escritura: true, error: null },
      prueba_cors: { ruta: 'salud/cors.png', url: urlFirmada('salud/cors.png', 991) },
      montaje: {
        configurado: true,
        job: 'montador',
        region: 'us-central1',
        variable: 'MONTAJE_JOB',
        error: null
      },
      modelos: [
        ...['calidad', 'medio', 'economico'].map((nivel) => ({
          clave: `imagen.${nivel}`,
          id: ((serie.modelos && serie.modelos.imagen && serie.modelos.imagen[nivel]) || {}).id,
          region:
            ((serie.modelos && serie.modelos.imagen && serie.modelos.imagen[nivel]) || {}).region ||
            'us-central1',
          variable: 'IMAGE_MODEL',
          ok: false,
          error: `No se ha podido usar este modelo. Google ha dicho, literalmente: ${LO_QUE_DICE_GOOGLE}`
        })),
        ...['calidad', 'medio', 'economico'].map((nivel) => ({
          clave: `veo.${nivel}`,
          id: ((serie.modelos && serie.modelos.video && serie.modelos.video[nivel]) || {}).id,
          region: 'us-central1',
          variable: 'VEO_MODEL',
          ok: false,
          error: `No se ha podido usar este modelo. Google ha dicho, literalmente: ${LO_QUE_DICE_GOOGLE}`
        })),
        ...[
          ['tts', (serie.voces && serie.voces.modelo) || {}, 'TTS_MODEL'],
          ['musica', (serie.musica && serie.musica.modelo) || {}, 'MUSIC_MODEL'],
          ['texto', (serie.modelos && serie.modelos.texto) || {}, 'TEXTO_MODEL']
        ].map(([clave, modelo, variable]) => ({
          clave,
          id: modelo.id ?? null,
          region: modelo.region || 'us-central1',
          variable,
          ok: false,
          error: `No se ha podido usar este modelo. Google ha dicho, literalmente: ${LO_QUE_DICE_GOOGLE}`
        }))
      ],
      voces: vocesDeLaApi,
      voces_error: null
    }
  },

  {
    modo: 'voces',
    que: 'la lista entera de voces del idioma de la serie',
    remedio: 'Devolver solo las voces del idioma, que es lo que ya hace audio.js.',
    respuesta: { ok: true, voces: vocesDeLaApi }
  },

  {
    modo: 'voz-muestra',
    que: 'una frase de muestra: rutas y enlace, el WAV se queda en el bucket',
    remedio: 'El WAV no puede viajar: tiene que quedarse en el bucket y volver solo su URL.',
    respuesta: {
      ok: true,
      es: ((repartoDeVoces[0] || {}).muestra || {}).texto || '',
      ja: (lineasDelTeaser[0] || {}).ja || '',
      ruta: 'muestras/saharis/ja-JP-Chirp3-HD-Aoede.wav',
      url: urlFirmada('muestras/saharis/ja-JP-Chirp3-HD-Aoede.wav', 12),
      dur_s: 4.32
    }
  },

  {
    modo: 'imagen',
    que: 'un keyframe de 2K: ruta y enlace, el PNG se queda en el bucket',
    remedio:
      'El master 2K tiene que quedarse en el bucket y viajar solo la ruta y la URL firmada.',
    respuesta: {
      ok: true,
      ruta: rutaDeKeyframe(PIEZA, '7-4', 2),
      url: urlFirmada(rutaDeKeyframe(PIEZA, '7-4', 2), 7),
      intento: 2,
      bytes: png2k.length,
      ancho: ANCHO_2K,
      alto: ALTO_2K
    }
  },

  {
    modo: 'veo-lanzar',
    que: 'el nombre de la operación y dónde va a dejar Veo el MP4',
    remedio: 'Devolver solo el nombre de la operación, nunca el vídeo.',
    respuesta: {
      ok: true,
      operacion:
        `projects/${PROYECTO_DE_MENTIRA}/locations/us-central1/publishers/google/models/veo/` +
        'operations/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      prefijo: `veo/${PIEZA}/7-4/2/`,
      intento: 2,
      aviso_sin_lastframe: false
    }
  },

  {
    modo: 'veo-consultar',
    que: 'un clip terminado: ruta y enlace, el MP4 no pasa por la función',
    remedio: 'El MP4 se queda en el bucket y se reproduce desde su URL firmada.',
    respuesta: {
      ok: true,
      hecho: true,
      ruta: rutaDeClip(PIEZA, '7-4', 2, 1757068812345),
      url: urlFirmada(rutaDeClip(PIEZA, '7-4', 2, 1757068812345), 31)
    }
  },

  {
    modo: 'musica',
    que: 'una pieza de Lyria: ruta, enlace y la duración medida del WAV',
    remedio: 'El WAV se queda en el bucket; solo viaja su URL.',
    respuesta: {
      ok: true,
      ruta: `audio/musica/${PIEZA}-lecho-3.wav`,
      url: urlFirmada(`audio/musica/${PIEZA}-lecho-3.wav`, 44),
      dur_s: duracionDeWav(wavDeMusica)
    }
  },

  {
    modo: 'voz',
    que: 'un bloque de escena entero, con sus líneas en japonés y en español',
    remedio: 'Devolver las líneas por bloque y nunca el audio.',
    respuesta: {
      ok: true,
      ruta: `audio/voz/${PIEZA}/esc-7.wav`,
      url: urlFirmada(`audio/voz/${PIEZA}/esc-7.wav`, 58),
      dur_s: duracionDeWav(wavDeVoz),
      lineas: lineasDeUnBloque
    }
  },

  {
    modo: 'alinear',
    que: 'la entrada y la salida de cada intervención del bloque',
    remedio: 'Alinear por bloque y no por episodio, que ya es lo que impone el límite de la v1.',
    respuesta: {
      ok: true,
      lineas: lineasDeUnBloque.map((linea) => ({ inicio: linea.t, fin: linea.hasta }))
    }
  },

  {
    modo: 'desglosar-escena',
    que: `los ${PLANOS_POR_ESCENA} planos de UNA escena (contrato §13.3)`,
    remedio:
      'Seguir desglosando una escena por llamada: por episodio no cabe ni en la ventana del modelo.',
    respuesta: { ok: true, planos: desgloseDeUnaEscena }
  },

  {
    modo: 'estado-leer',
    que: `el estado con ${TOMAS_DE_UN_EPISODIO} tomas, ${placasDelBanco.length} placas, ${placasDeEscenario.length} escenarios y ${TRABAJOS_EN_COLA} trabajos`,
    remedio:
      'Partir el estado: la cola y los intentos por separado, y que estado-leer devuelva solo lo que la pantalla necesita.',
    respuesta: { ok: true, estado: estadoDeUnEpisodio, generacion: '17' }
  },

  {
    modo: 'estado-escribir',
    que: 'la generación nueva y nada más',
    remedio: 'Devolver solo la generación.',
    respuesta: { ok: true, generacion: '18' }
  },

  {
    modo: 'estado-escribir 409',
    que: 'la carrera: vuelve el estado bueno entero para reaplicar el cambio encima',
    remedio:
      'Ante un 409, devolver solo la generación y que el navegador vuelva a pedir el estado con estado-leer.',
    respuesta: {
      ok: false,
      error: {
        mensaje:
          'Alguien ha guardado el estado de la producción mientras tú trabajabas, así que lo tuyo ' +
          'se ha aplicado encima de lo suyo y se vuelve a intentar. No se ha perdido nada.',
        detalle: null,
        reintentable: true,
        http: 409
      },
      estado: estadoDeUnEpisodio,
      generacion: '18'
    }
  },

  {
    modo: 'firmar',
    que: `${RUTAS_POR_LLAMADA} URLs firmadas V4, que es el tope por llamada`,
    remedio: 'Bajar el tope de rutas por llamada y pedirlas por tandas.',
    respuesta: { ok: true, urls: urlsFirmadas }
  },

  {
    modo: 'listar',
    que: `lo que un episodio deja en el bucket: ${conPuntos(objetosDeUnEpisodio.length)} objetos`,
    remedio:
      'Poner tope y cursor a listar, que hoy es el único modo de lista sin límite escrito.',
    respuesta: { ok: true, objetos: objetosDeUnEpisodio }
  },

  {
    modo: 'borrar',
    que: 'cuántas se borraron',
    remedio: 'Devolver solo la cuenta.',
    respuesta: { ok: true, borradas: RUTAS_POR_LLAMADA }
  },

  {
    modo: 'guardar-texto',
    que: 'la ruta y lo que ocupó',
    remedio: 'Devolver solo la ruta y los bytes.',
    respuesta: {
      ok: true,
      ruta: `montaje/manifiesto-${PIEZA}-3.json`,
      bytes: pesar(manifiesto)
    }
  },

  {
    modo: 'montar',
    que: 'la ejecución del Job y dónde quedó el manifiesto',
    remedio: 'Devolver solo la ejecución y la ruta del manifiesto.',
    respuesta: {
      ok: true,
      ejecucion: `projects/${PROYECTO_DE_MENTIRA}/locations/us-central1/jobs/montador/executions/montador-x8k2p`,
      manifiesto_ruta: `montaje/${PIEZA}-3/manifiesto.json`
    }
  },

  {
    modo: 'montaje-estado',
    que: 'cómo fue, la queja del montador y las salidas de las capas',
    remedio: 'Recortar la queja del montador antes de devolverla.',
    respuesta: {
      ok: true,
      hecho: true,
      bien: false,
      queja:
        'ffmpeg ha parado al mezclar el audio de la escena 14: la pista de voz ' +
        `«audio/voz/${PIEZA}/esc-14.wav» está a 24000 Hz y la música a 48000 Hz, y el remuestreo ` +
        'a 48 kHz tiene que hacerse antes de mezclar. El manifiesto está bien; lo que falta es ' +
        'que ese archivo exista en el bucket con el muestreo que dice.\n'.repeat(12),
      salidas: [
        ...Array.from(
          { length: ESCENAS_DE_UN_EPISODIO },
          (_, i) => `montaje/${PIEZA}-esc-${i + 1}.mp4`
        ),
        ...Array.from({ length: 4 }, (_, i) => `montaje/${PIEZA}-acto-${i + 1}.mp4`),
        `montaje/${PIEZA}-3.mp4`
      ]
    }
  }
];

// ===========================================================================
// El camino de ida: lo que sube, que también tiene tope
// ===========================================================================

/**
 * La petición de `veo-lanzar` con las DOS imágenes dentro: el keyframe de esta
 * toma y el de la siguiente como `lastFrame`. Es la petición más pesada del
 * estudio y la razón entera de que exista `app/imagen.js`.
 *
 * @param {Buffer} jpeg la copia reducida, la misma para las dos.
 * @returns {object}
 */
function peticionDeVeoLanzar(jpeg) {
  const b64 = jpeg.toString('base64');
  return {
    modo: 'veo-lanzar',
    pieza: PIEZA,
    toma: '7-4',
    imagen_b64: b64,
    lastFrame_b64: b64
  };
}

// La petición de veo-lanzar con el master SIN reducir no está en esta tabla a
// propósito. No es un camino del estudio: es lo que pasaría si alguien quitara
// `app/imagen.js`, y se pesa abajo, en «Lo que pasaría si viajara». Metida aquí
// haría que la herramienta saliera con 1 siempre, y una herramienta que siempre
// grita deja de leerse el día que grita por algo de verdad.

/** @type {{modo:string, que:string, peticion:any, remedio:string}[]} */
const PETICIONES = [
  {
    modo: 'veo-lanzar',
    que: `dos JPEG de ${ANCHO_VEO} px en base64 en la misma petición`,
    remedio:
      'Bajar el ancho o la calidad de la copia en app/imagen.js, o mandar el lastFrame por su ruta.',
    peticion: peticionDeVeoLanzar(jpeg1280)
  },
  {
    modo: 'estado-escribir',
    que: 'el estado entero sube en cada guardado de la cola',
    remedio:
      'Mandar solo el cambio y que la función lo aplique, en vez de subir el estado completo.',
    peticion: { modo: 'estado-escribir', estado: estadoDeUnEpisodio, generacion: '17' }
  },
  {
    modo: 'montar',
    que: `el manifiesto de un episodio de ${TOMAS_DE_UN_EPISODIO} planos`,
    remedio: 'Montar por capas, que ya es lo que hace: el manifiesto de una escena es diminuto.',
    peticion: { modo: 'montar', manifiesto }
  },
  {
    modo: 'guardar-texto',
    que: 'ese mismo manifiesto, ya como texto',
    remedio: 'Escribirlo por capas.',
    peticion: {
      modo: 'guardar-texto',
      ruta: `montaje/manifiesto-${PIEZA}-3.json`,
      contenido: JSON.stringify(manifiesto)
    }
  }
];

// ===========================================================================
// La tabla
// ===========================================================================

const cuenta = { cabe: 0, noCabe: 0 };

/** Lo que ocupa el nombre del modo en la tabla. El resto de columnas van detrás. */
const ANCHO_DEL_NOMBRE = 20;

/** Cabecera de una tabla de pesos. */
function cabeceraDeTabla() {
  console.log(tenue(`  ${'modo'.padEnd(ANCHO_DEL_NOMBRE)} ${'peso'.padStart(9)} ${'tope'.padStart(7)}`));
}

/**
 * Una fila: modo, peso, porcentaje del tope y veredicto. Lo que no cabe se
 * pinta en rojo entero, y debajo va, sangrada, la frase de qué hacer.
 *
 * @param {{modo:string, que:string, remedio:string}} entrada
 * @param {number} bytes
 * @returns {boolean} si cabe.
 */
function fila(entrada, bytes) {
  const cabe = bytes <= TOPE;
  if (cabe) cuenta.cabe += 1;
  else cuenta.noCabe += 1;

  const nombre =
    entrada.modo.length > ANCHO_DEL_NOMBRE
      ? `${entrada.modo.slice(0, ANCHO_DEL_NOMBRE - 1)}…`
      : entrada.modo.padEnd(ANCHO_DEL_NOMBRE);
  const linea = `  ${nombre} ${tamano(bytes).padStart(9)} ${porcentaje(bytes).padStart(7)} ${
    cabe ? '✓' : '✗'
  }`;

  console.log(cabe ? linea : rojo(linea));
  for (const texto of envolver(entrada.que, ANCHO - 6, '      ')) console.log(tenue(texto));

  if (!cabe) {
    for (const texto of envolver(
      `No cabe: se pasa en ${tamano(bytes - TOPE)}. ${entrada.remedio}`,
      ANCHO - 6,
      '      '
    )) {
      console.log(rojo(texto));
    }
  }
  return cabe;
}

// ===========================================================================
// La salida
// ===========================================================================

console.log('PESAR · LA MIRADA QUE EL MUNDO TEMERÁ');
decir(
  `Material del tamaño real, sin red. Tope: ${conPuntos(TOPE)} bytes por petición y por respuesta.`
);

// ---------------------------------------------------------------------------

bloque('Material fabricado');

const medidaPng = medidaDePng(png2k);
const medidaJpeg = medidaDeJpeg(jpeg1280);

const bitsPorPixel = (png2k.length * 8) / (ANCHO_2K * ALTO_2K);

decir(`PNG ${ANCHO_2K}×${ALTO_2K} · ${tamano(png2k.length)} · MEDIDO`, '  ');
decir(
  `Comprimido aquí con zlib. Su cabecera se relee y dice ${medidaPng.ancho}×${medidaPng.alto}, ` +
    `así que es un PNG de verdad. Son ${conComa(bitsPorPixel, 2)} bits por píxel, que es lo que ` +
    'ocupa un fotograma con grano; el plan §10 cuenta 6,8 MB para uno real.',
  '    '
);
console.log('');

decir(`JPEG ${ANCHO_VEO}×${ALTO_VEO} · ${tamano(jpeg1280.length)} · SUPUESTO`, '  ');
decir(
  `Su cabecera se relee y dice ${medidaJpeg.ancho}×${medidaJpeg.alto}, pero el TAMAÑO está ` +
    'elegido, no medido: la reducción la hace el navegador con un canvas y en Node no hay canvas ' +
    'ni dependencias. Se ha cogido el peor de los 200-400 KB que declara app/imagen.js. Abajo se ' +
    'barre el abanico entero para que la conclusión no dependa de esta elección.',
  '    '
);
console.log('');

decir(
  `WAV de voz · ${tamano(wavDeVoz.length)} · MEDIDO`,
  '  '
);
decir(
  `PCM de ${VOZ_BITS} bits, ${VOZ_CANALES === 1 ? 'mono' : 'estéreo'}, a ` +
    `${conPuntos(VOZ_HZ)} Hz, ${conComa(duracionDeWav(wavDeVoz), 1)} s. Es lo que devuelve ` +
    'Gemini TTS.',
  '    '
);
console.log('');

decir(`WAV de música · ${tamano(wavDeMusica.length)} · MEDIDO`, '  ');
decir(
  `PCM de ${MUSICA_BITS} bits, estéreo, a ${conPuntos(MUSICA_HZ)} Hz, ` +
    `${conComa(duracionDeWav(wavDeMusica), 1)} s: el caso más pesado que puede devolver Lyria.`,
  '    '
);
console.log('');

const urlDeMuestra = urlFirmada(rutaDeKeyframe(PIEZA, '7-4', 2), 1);
decir(`URL firmada V4 · ${urlDeMuestra.length} caracteres · MEDIDO`, '  ');
decir(
  'Con la forma que compone gcs.js: host, bucket, objeto, los cinco parámetros de la firma y ' +
    'detrás la firma RSA en hexadecimal, que son 512 caracteres clavados. El encargo suponía ' +
    `unos 700; las de verdad salen por ${urlDeMuestra.length}, así que se pesa con las largas.`,
  '    '
);
console.log('');

decir(`Estado de la producción · ${tamano(pesar(estadoDeUnEpisodio))} · MEDIDO`, '  ');
decir(
  `${TOMAS_DE_UN_EPISODIO} tomas, ${placasDelBanco.length} placas de banco, ` +
    `${placasDeEscenario.length} escenarios y ${TRABAJOS_EN_COLA} trabajos en cola. El encargo ` +
    'pedía 60 placas y 27 escenarios; datos/serie.json ya trae más, así que se pesa con las de ' +
    'verdad, que son peores.',
  '    '
);
console.log('');

decir(
  `Desglose · ${ESCENAS_DE_UN_EPISODIO} escenas × ${PLANOS_POR_ESCENA} planos = ` +
    `${desgloseDelEpisodio.length} planos · MEDIDO`,
  '  '
);
decir(
  'Se pesa una escena, que es lo que devuelve el modo. El episodio entero se pesa aparte, para ' +
    'enseñar por qué el contrato §13.3 prohíbe pedirlo de una vez.',
  '    '
);

// ---------------------------------------------------------------------------

bloque('Respuestas · lo que baja');
cabeceraDeTabla();
for (const entrada of RESPUESTAS) fila(entrada, pesar(entrada.respuesta));

// ---------------------------------------------------------------------------

bloque('Peticiones · lo que sube');
cabeceraDeTabla();
for (const entrada of PETICIONES) fila(entrada, pesar(entrada.peticion));

// ---------------------------------------------------------------------------

bloque('El camino de ida de veo-lanzar');

decir(
  'La petición lleva DOS imágenes en base64: el keyframe de la toma y el de la siguiente como ' +
    'lastFrame. El base64 no se estima con la regla del tercio, se codifica y se cuenta.',
  '  '
);
console.log('');

{
  const b64 = pesarBase64(jpeg1280);
  const total = pesar(peticionDeVeoLanzar(jpeg1280));
  decir(`Un JPEG: ${tamano(jpeg1280.length)} → ${tamano(b64)} en base64`, '  ');
  decir(
    `Dos, más el resto del cuerpo: ${tamano(total)}, el ${porcentaje(total)} del tope. Sobran ` +
      `${tamano(TOPE - total)}.`,
    '  '
  );
}
console.log('');

decir('Y con la copia pesando otra cosa, que es lo único supuesto:', '  ');
console.log(tenue('    JPEG      petición    tope'));

let jpegQueRompe = null;
for (const bytes of JPEG_ABANICO) {
  const total = pesar(peticionDeVeoLanzar(fabricarJpeg(bytes, ANCHO_VEO, ALTO_VEO)));
  const cabe = total <= TOPE;
  if (!cabe && jpegQueRompe === null) jpegQueRompe = bytes;
  const linea = `    ${tamano(bytes).padStart(8)} ${tamano(total).padStart(11)} ${porcentaje(
    total
  ).padStart(7)} ${cabe ? '✓' : '✗'}`;
  console.log(cabe ? linea : rojo(linea));
}

{
  // El tamaño exacto al que la petición dejaría de caber. Se despeja del base64:
  // cada 3 bytes se convierten en 4 caracteres, y en la petición van dos copias.
  const sobrante = pesar(peticionDeVeoLanzar(Buffer.alloc(0)));
  const caracteresQueCaben = Math.floor((TOPE - sobrante) / 2);
  const bytesPorImagen = Math.floor((caracteresQueCaben / 4) * 3);
  console.log('');
  decir(
    `El corte está en ${tamano(bytesPorImagen)} por imagen: a partir de ahí las dos copias ya no ` +
      `caben. A ${ANCHO_VEO}×${ALTO_VEO} eso serían ` +
      `${conComa((bytesPorImagen * 8) / (ANCHO_VEO * ALTO_VEO), 1)} bits por píxel, que ningún ` +
      'JPEG de calidad 0,86 alcanza ni de lejos. La conclusión no depende del supuesto.',
    '  '
  );
}

// ---------------------------------------------------------------------------

bloque('Lo que pasaría si viajara');

decir(
  'Esto no ocurre —y esta es la lista de razones por las que no ocurre—, pero es lo que costaría ' +
    'devolver cada cosa dentro de la respuesta en vez de dejarla en el bucket.',
  '  '
);
console.log('');

for (const [nombre, datos] of [
  [`PNG 2K (modo imagen)`, png2k],
  ['WAV de voz de 45 s (modo voz)', wavDeVoz],
  [`WAV de música de ${SEGUNDOS_DE_MUSICA} s (modo musica)`, wavDeMusica]
]) {
  const enB64 = pesarBase64(datos);
  const cuantas = enB64 / TOPE;
  const linea = `  ${nombre}`;
  console.log(enB64 > TOPE ? rojo(linea) : linea);
  decir(
    `${tamano(datos.length)} → ${tamano(enB64)} en base64 · ${porcentaje(enB64)} del tope` +
      (enB64 > TOPE ? ` · ${conComa(cuantas, 1)} veces lo que cabe` : ''),
    '    '
  );
}
{
  // El camino de ida sin reducir: la trampa más cara del proyecto, medida. No
  // cuenta como fallo porque no es un camino que exista —`app/imagen.js` lo
  // impide—, pero es el número que explica por qué ese archivo existe.
  const total = pesar(peticionDeVeoLanzar(png2k));
  console.log(rojo('  veo-lanzar con el master 2K sin reducir'));
  decir(
    `Las dos imágenes en base64: ${tamano(total)} · ${porcentaje(total)} del tope · ` +
      `${conComa(total / TOPE, 1)} veces lo que cabe. Es el fallo que parece un tiempo agotado, y ` +
      'es exactamente lo que evita reducir a 1280 px antes de mandarlas.',
    '    '
  );
}

console.log('');
decir(
  'Por eso el master 2K y el MP4 no pasan nunca por la función: se quedan en el bucket y lo que ' +
    'viaja es la URL firmada de seis horas. Un clip de 8 s a 1080p son unos 35 MB y un episodio ' +
    'montado uno o dos gigas, así que ahí no hay ni discusión.',
  '  '
);

// ---------------------------------------------------------------------------

bloque('Hasta dónde aguanta el estado');

decir(
  'El estado no se vacía: guarda las tomas de todo lo que se ha desglosado. Un episodio son 400; ' +
    'la serie son doce. Esto es lo que va a pesar estado-leer conforme avance la producción.',
  '  '
);
console.log('');
console.log(tenue('    episodios     estado    tope'));

let episodioQueRompe = null;
for (let e = 1; e <= EPISODIOS_DE_LA_SERIE; e += 1) {
  const bytes = pesar({
    ok: true,
    estado: fabricarEstado({
      episodios: e,
      tomasPorEpisodio: TOMAS_DE_UN_EPISODIO,
      cola: TRABAJOS_EN_COLA
    }),
    generacion: '17'
  });
  const cabe = bytes <= TOPE;
  if (!cabe && episodioQueRompe === null) episodioQueRompe = e;
  // Se enseñan los primeros, los últimos y el que rompe: en un móvil no caben
  // doce filas y lo que decide es dónde está el corte.
  const interesa = e <= 2 || e >= EPISODIOS_DE_LA_SERIE - 1 || e === episodioQueRompe;
  if (!interesa) continue;
  const linea = `    ${String(e).padStart(9)} ${tamano(bytes).padStart(10)} ${porcentaje(
    bytes
  ).padStart(7)} ${cabe ? '✓' : '✗'}`;
  console.log(cabe ? linea : rojo(linea));
}

console.log('');
if (episodioQueRompe === null) {
  decir(
    `Con los doce episodios desglosados el estado sigue cabiendo. No hay nada que hacer hoy, pero ` +
      'es la respuesta que más crece de todas y la única que crece sola: conviene volver a pasar ' +
      'esta herramienta cada vez que se desglose un episodio.',
    '  '
  );
} else {
  decir(
    `A partir del episodio ${episodioQueRompe} el estado deja de caber en una respuesta, y ese ` +
      'fallo va a parecer un tiempo agotado al abrir la aplicación. Antes de llegar ahí hay que ' +
      'partirlo: la cola y los intentos por separado, y que estado-leer devuelva solo lo que la ' +
      'pantalla abierta necesita.',
    '  '
  );
}

// ---------------------------------------------------------------------------

bloque('Por qué el desglose va por escenas');

{
  const unaEscena = pesar({ ok: true, planos: desgloseDeUnaEscena });
  const elEpisodio = pesar({ ok: true, planos: desgloseDelEpisodio });
  decir(`Una escena: ${tamano(unaEscena)} · ${porcentaje(unaEscena)} del tope`, '  ');
  decir(`Las ${ESCENAS_DE_UN_EPISODIO}: ${tamano(elEpisodio)} · ${porcentaje(elEpisodio)}`, '  ');
  console.log('');
  decir(
    'El peso no es el motivo por el que el contrato §13.3 prohíbe el desglose por episodio —cabría—: ' +
      'el motivo es que no cabe en la ventana del modelo ni en los 60 s de la función, y que cuando ' +
      'falla se pierden las veinticuatro escenas en vez de una. Se pesa igualmente para que nadie ' +
      'tenga que suponerlo.',
    '  '
  );
}

// ---------------------------------------------------------------------------

bloque('Listar, que es el único sin tope');

{
  const deUnEpisodio = pesar({ ok: true, objetos: objetosDeUnEpisodio });
  const porObjeto = deUnEpisodio / objetosDeUnEpisodio.length;
  const cuantosCaben = Math.floor(TOPE / porObjeto);

  // Y lo que de verdad va a haber ahí dentro el último día de la serie: no se
  // supone, se cuenta.
  const deLaSerie = objetosDelBucket(EPISODIOS_DE_LA_SERIE);
  const bytesDeLaSerie = pesar({ ok: true, objetos: deLaSerie });

  decir(
    `Un episodio deja ${conPuntos(objetosDeUnEpisodio.length)} objetos entre keyframes y clips: ` +
      `${tamano(deUnEpisodio)}, a ${conComa(porObjeto, 0)} bytes por objeto.`,
    '  '
  );
  decir(
    `La serie entera, ${conPuntos(deLaSerie.length)} objetos: ${tamano(bytesDeLaSerie)}, el ` +
      `${porcentaje(bytesDeLaSerie)} del tope.`,
    '  '
  );
  console.log('');
  decir(
    `La respuesta se pasa a partir de ${conPuntos(cuantosCaben)} objetos, así que hoy cabe y el ` +
      'último día también. Pero `firmar` y `borrar` tienen tope escrito (200 rutas) y `listar` no ' +
      'tiene ninguno: es el único modo cuya respuesta la decide lo que haya en el bucket y no lo ' +
      `que se le pida, y el margen es de ${conComa(cuantosCaben / deLaSerie.length, 1)} veces. ` +
      'Conviene ponerle tope y cursor antes de que el margen lo gaste algo que hoy no está ahí: ' +
      'los intentos que nadie borra, las muestras de voz, los montajes por capas.',
    '  '
  );
}

// ===========================================================================
// Resumen
// ===========================================================================

console.log('');
console.log('─'.repeat(ANCHO));

const total = cuenta.cabe + cuenta.noCabe;
const partes = [`${total} pesadas`, `${cuenta.cabe} caben`];
if (cuenta.noCabe) partes.push(`${cuenta.noCabe} NO`);
console.log(partes.join(', '));

if (cuenta.noCabe) {
  decir(
    'Arriba, cada ✗ dice cuánto se pasa y qué hay que hacer. Ninguno de estos fallos se ve ' +
      'leyendo el código: aparecen en producción como un tiempo agotado, y por eso se miden aquí.'
  );
} else {
  decir(
    `Todo lo que baja y todo lo que sube cabe en los ${conPuntos(TOPE)} bytes, con el material ` +
      'del tamaño real. Lo único supuesto es cuánto pesa la copia de 1280 px, y el abanico de ' +
      'arriba enseña que la conclusión aguanta aunque pesara cinco veces más.'
  );
}
console.log('');

process.exitCode = cuenta.noCabe ? 1 : 0;
