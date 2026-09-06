// Prueba de que el estudio entiende el audio que Google le manda, sea cual sea.
//
// POR QUÉ EXISTE ESTA PRUEBA. Dos veces ha roto la producción una suposición
// sobre el formato del audio, y las dos veces la suposición estaba escrita en el
// código como si fuera un hecho. La última: `aWav()` daba por sentado que todo
// lo que no fuera WAV era PCM crudo, así que cuando Lyria contestó con un MP3
// («audio/mpeg») el estudio rechazó una música que estaba perfectamente bien,
// pidiéndole un muestreo que un MP3 no tiene por qué declarar aparte.
//
// Eso no lo caza `node --check` —es sintaxis válida— ni los invariantes —no es
// un dato ni un estilo—. Solo se ve dándole bytes de verdad y mirando qué sale.
//
// Los MP3 se construyen aquí a mano, trama a trama, en vez de traer archivos:
// así la prueba no depende de que haya ffmpeg ni de guardar binarios en el
// repositorio, y además se sabe EXACTAMENTE cuánto dura cada uno, que es lo que
// se está comprobando. (El arreglo se comprobó además contra MP3 reales hechos
// con ffmpeg, CBR y VBR, con desvío cero frente a ffprobe.)

import { Buffer } from 'node:buffer';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('..', import.meta.url);

// ---------------------------------------------------------------------------
// Traer aPista sin arrastrar medio estudio
// ---------------------------------------------------------------------------

/**
 * `api/_lib/audio.js` habla con Vertex, y para esta prueba eso sobra: lo único
 * que se quiere es la parte que mira bytes. Se hace una copia del módulo sin sus
 * importaciones y con lo justo puesto delante.
 */
async function traerDeAudio() {
  const codigo = readFileSync(new URL('api/_lib/audio.js', RAIZ), 'utf8');
  const sinImportaciones = codigo
    .split('\n')
    .filter((linea) => !linea.startsWith('import '))
    .join('\n');

  const errores = new URL('api/_lib/errores.js', RAIZ).href;
  const delante = [
    `import { Buffer } from 'node:buffer';`,
    `import { ErrorDeCara } from ${JSON.stringify(errores)};`,
    'const entorno = () => ({});',
    'const serie = () => ({});',
    'const llamar = () => {};',
    'const urlModelo = () => 0;',
    'const urlServicio = () => 0;',
    'const conGrafias = () => {};',
    'const comoGrafia = (m) => m;',
  ].join('\n');

  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-audio-'));
  const archivo = join(carpeta, 'audio-suelto.mjs');
  writeFileSync(
    archivo,
    `${delante}\n${sinImportaciones}\nexport { aPista, sinAudio, esBloqueoDeContenido };\n`
  );

  return import(pathToFileURL(archivo).href);
}

// ---------------------------------------------------------------------------
// Fabricar MP3 con una duración conocida
// ---------------------------------------------------------------------------

/**
 * Una trama MP3 de capa III, MPEG 1, 44,1 kHz, estéreo, a los kbps que se pidan.
 * El contenido de la trama da igual —aquí no se descodifica nada—: lo que se
 * está probando es que la cabecera se lea bien.
 */
function tramaMpeg1(kbps, { relleno = 0 } = {}) {
  const INDICES = { 32: 1, 64: 5, 128: 9, 192: 11, 320: 14 };
  const indice = INDICES[kbps];
  if (!indice) throw new Error(`Esta prueba no sabe hacer una trama de ${kbps} kbps`);

  const cabecera = Buffer.from([
    0xff,
    0xfb,                                   // MPEG 1, capa III, sin CRC
    (indice << 4) | (0 << 2) | (relleno << 1),  // bitrate, 44100 Hz, relleno
    0x00,                                   // estéreo
  ]);

  // Los bytes de una trama de capa III: 144 · bits/s / muestreo, más el relleno.
  const largo = Math.floor((144 * kbps * 1000) / 44100) + relleno;
  return Buffer.concat([cabecera, Buffer.alloc(largo - 4)]);
}

/** Un MP3 de tasa constante con `tramas` tramas: dura tramas · 1152 / 44100. */
function mp3Constante(tramas, kbps = 128) {
  return Buffer.concat(Array.from({ length: tramas }, () => tramaMpeg1(kbps)));
}

/**
 * Un MP3 de tasa VARIABLE: la primera trama lleva la cabecera «Xing» con el
 * número total de tramas, y detrás van tramas de bitrates distintos. Sin leer el
 * Xing la cuenta por bytes daría otra cosa, que es justo lo que se comprueba.
 */
function mp3Variable(tramas) {
  const primera = tramaMpeg1(128);
  // En MPEG 1 estéreo, el Xing va 32 bytes después de la cabecera de 4.
  const xing = 4 + 32;
  primera.write('Xing', xing, 'ascii');
  primera.writeUInt32BE(0x01, xing + 4);        // solo viene el número de tramas
  primera.writeUInt32BE(tramas, xing + 8);

  const resto = [];
  const bitrates = [64, 192, 320, 32];
  for (let i = 1; i < tramas; i++) resto.push(tramaMpeg1(bitrates[i % bitrates.length]));

  return Buffer.concat([primera, ...resto]);
}

/** Le pega delante una etiqueta ID3v2 de `bytes` de relleno. */
function conEtiquetaId3(mp3, bytes = 300) {
  const etiqueta = Buffer.alloc(10 + bytes);
  etiqueta.write('ID3', 0, 'ascii');
  etiqueta[3] = 3;
  // El tamaño va en cuatro bytes «sincroseguros»: siete bits útiles de cada uno.
  etiqueta[6] = (bytes >> 21) & 0x7f;
  etiqueta[7] = (bytes >> 14) & 0x7f;
  etiqueta[8] = (bytes >> 7) & 0x7f;
  etiqueta[9] = bytes & 0x7f;
  return Buffer.concat([etiqueta, mp3]);
}

/** Un WAV de PCM 16 bits mono con la duración que se pida. */
function wav(segundos, hz = 24000) {
  const muestras = Math.round(segundos * hz);
  const datos = Buffer.alloc(muestras * 2);
  const cabecera = Buffer.alloc(44);
  cabecera.write('RIFF', 0, 'ascii');
  cabecera.writeUInt32LE(36 + datos.length, 4);
  cabecera.write('WAVE', 8, 'ascii');
  cabecera.write('fmt ', 12, 'ascii');
  cabecera.writeUInt32LE(16, 16);
  cabecera.writeUInt16LE(1, 20);
  cabecera.writeUInt16LE(1, 22);
  cabecera.writeUInt32LE(hz, 24);
  cabecera.writeUInt32LE(hz * 2, 28);
  cabecera.writeUInt16LE(2, 32);
  cabecera.writeUInt16LE(16, 34);
  cabecera.write('data', 36, 'ascii');
  cabecera.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cabecera, datos]);
}

// ---------------------------------------------------------------------------
// Las comprobaciones
// ---------------------------------------------------------------------------

const MUESTRAS_POR_TRAMA = 1152;
const HZ = 44100;

const deAudio = await traerDeAudio();
const { aPista, sinAudio, esBloqueoDeContenido } = deAudio;

let bien = 0;
let mal = 0;

/** @param {string} que  @param {() => void} comprobar */
function comprobar(que, hacer) {
  try {
    hacer();
    bien++;
    console.log(`  ✓ ${que}`);
  } catch (fallo) {
    mal++;
    console.log(`  ✗ ${que}`);
    console.log(`      ${fallo && fallo.message ? fallo.message : fallo}`);
  }
}

/** Falla si los dos números no son casi el mismo. */
function casi(sale, esperado, margen, que) {
  if (Math.abs(sale - esperado) > margen) {
    throw new Error(`${que}: sale ${sale.toFixed(4)} y tenía que salir ${esperado.toFixed(4)}`);
  }
}

/** Falla si no son iguales. */
function igual(sale, esperado, que) {
  if (sale !== esperado) throw new Error(`${que}: sale «${sale}» y tenía que salir «${esperado}»`);
}

console.log('\nEL AUDIO QUE MANDA GOOGLE, VENGA COMO VENGA\n');

comprobar('Un MP3 de tasa constante se guarda como MP3 y dura lo que dura', () => {
  const tramas = 280;
  const r = aPista(mp3Constante(tramas), 'audio/mpeg', { hzPorDefecto: null, deQuien: 'la música' });
  igual(r.extension, '.mp3', 'la extensión');
  igual(r.tipo, 'audio/mpeg', 'el tipo');
  casi(r.durS, (tramas * MUESTRAS_POR_TRAMA) / HZ, 0.05, 'la duración');
});

comprobar('Un MP3 de tasa VARIABLE se mide por su cabecera Xing, no por los bytes', () => {
  const tramas = 400;
  const datos = mp3Variable(tramas);
  const r = aPista(datos, 'audio/mpeg', { hzPorDefecto: null, deQuien: 'la música' });
  const esperado = (tramas * MUESTRAS_POR_TRAMA) / HZ;
  casi(r.durS, esperado, 0.05, 'la duración');

  // Y la prueba de que el Xing hacía falta: la cuenta por bytes da otra cosa.
  const porBytes = (datos.length * 8) / (128 * 1000);
  if (Math.abs(porBytes - esperado) < 0.5) {
    throw new Error('esta prueba no vale: por bytes salía casi lo mismo, así que no probaba el Xing');
  }
});

comprobar('Un MP3 con etiqueta ID3 delante se lee igual de bien', () => {
  const tramas = 150;
  const r = aPista(conEtiquetaId3(mp3Constante(tramas)), 'audio/mpeg',
    { hzPorDefecto: null, deQuien: 'la música' });
  igual(r.extension, '.mp3', 'la extensión');
  casi(r.durS, (tramas * MUESTRAS_POR_TRAMA) / HZ, 0.05, 'la duración');
});

comprobar('El mimeType no manda: unos bytes que no son MP3 no pasan por MP3', () => {
  let salto = false;
  try {
    aPista(Buffer.alloc(4000, 0x41), 'audio/mpeg', { hzPorDefecto: null, deQuien: 'la música' });
  } catch {
    salto = true;
  }
  if (!salto) throw new Error('se ha tragado como MP3 algo que no lo es');
});

comprobar('Un WAV sigue pasando tal cual, sin envolverlo dos veces', () => {
  const r = aPista(wav(5.25), 'audio/wav', { hzPorDefecto: null, deQuien: 'la voz' });
  igual(r.extension, '.wav', 'la extensión');
  igual(r.tipo, 'audio/wav', 'el tipo');
  casi(r.durS, 5.25, 0.001, 'la duración');
  if (r.datos.toString('ascii', 0, 4) !== 'RIFF') throw new Error('ya no empieza por RIFF');
  if (r.datos.indexOf('RIFF', 4, 'ascii') !== -1) throw new Error('le han puesto una segunda cabecera');
});

comprobar('El PCM crudo con su muestreo se envuelve en WAV y mide bien', () => {
  const pcm = Buffer.alloc(24000 * 2 * 3);   // 3 s, 24 kHz, 16 bits, mono
  const r = aPista(pcm, 'audio/L16;codec=pcm;rate=24000', { hzPorDefecto: null, deQuien: 'la voz' });
  igual(r.extension, '.wav', 'la extensión');
  casi(r.durS, 3, 0.001, 'la duración');
});

comprobar('El PCM crudo SIN muestreo sigue fallando, y no se inventa un número', () => {
  let salto = null;
  try {
    aPista(Buffer.alloc(4000, 7), 'audio/x-desconocido', { hzPorDefecto: null, deQuien: 'la música' });
  } catch (fallo) {
    salto = fallo;
  }
  if (!salto) throw new Error('no ha fallado, y tenía que fallar');
  if (!/no sabe leer/i.test(salto.mensaje || '')) {
    throw new Error(`ha fallado, pero diciendo otra cosa: «${salto.mensaje}»`);
  }
});

comprobar('Cero bytes se cuenta como cero bytes, no como formato raro', () => {
  let salto = null;
  try {
    aPista(Buffer.alloc(0), 'audio/mpeg', { hzPorDefecto: null, deQuien: 'la música' });
  } catch (fallo) {
    salto = fallo;
  }
  if (!salto || !/vacía/i.test(salto.mensaje || '')) {
    throw new Error('no ha dicho que venía vacía');
  }
});

// ── UN «SIN AUDIO» NO ES SIEMPRE UN BLOQUEO ────────────────────────────────
//
// Es la misma regla que la imagen y hace falta por lo mismo. Aquí se decía
// siempre «repetir da el mismo resultado» y la cola daba la pieza por muerta,
// así que un «OTHER» de Lyria —que es «no digo por qué», y con una pieza de
// tres minutos pasa— mandaba a reescribir un encargo que estaba bien.
//
// Lo que decide no es la palabra: es el campo en el que viene.
const modeloFalso = { id: 'lyria-3-pro-preview', variable: 'MUSIC_MODEL' };

comprobar('Un «OTHER» en finishReason SÍ se reintenta: ahí es ambiguo', () => {
  const salta = sinAudio(
    { candidates: [{ content: { role: 'model' }, finishReason: 'OTHER' }] },
    modeloFalso,
    [{ content: { role: 'model' }, finishReason: 'OTHER' }],
    'la música'
  );
  if (salta.reintentable !== true) throw new Error(`reintentable = ${salta.reintentable}`);
  if (!/SIN DECIR POR QUÉ/.test(salta.mensaje)) throw new Error('no lo dice con palabras');
});

comprobar('Un «OTHER» en promptFeedback NO se reintenta: es el encargo, rechazado entero', () => {
  const salta = sinAudio({ promptFeedback: { blockReason: 'OTHER' } }, modeloFalso, [], 'la música');
  if (salta.reintentable !== false) throw new Error(`reintentable = ${salta.reintentable}`);
  if (!/ENCARGO/.test(salta.mensaje)) throw new Error('no dice que lo bloqueado fue el encargo');
});

comprobar('El filtro dicho por su nombre tampoco se reintenta', () => {
  const salta = sinAudio(
    { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] },
    modeloFalso,
    [{ finishReason: 'PROHIBITED_CONTENT' }],
    'la música'
  );
  if (salta.reintentable !== false) throw new Error(`reintentable = ${salta.reintentable}`);
});

comprobar('Y una respuesta sin audio y sin motivo ninguno se reintenta', () => {
  const salta = sinAudio({}, modeloFalso, [], 'la música');
  if (salta.reintentable !== true) throw new Error(`reintentable = ${salta.reintentable}`);
});

comprobar('«OTHER» no cuenta como bloqueo de contenido, y «SAFETY» sí', () => {
  if (esBloqueoDeContenido('OTHER')) throw new Error('«OTHER» no es un bloqueo');
  if (!esBloqueoDeContenido('SAFETY')) throw new Error('«SAFETY» sí lo es');
});

console.log(`\n${bien + mal} comprobaciones, ${bien} bien${mal ? `, ${mal} MAL` : ''}\n`);
process.exit(mal === 0 ? 0 : 1);
