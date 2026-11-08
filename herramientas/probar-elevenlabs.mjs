// Prueba de la integración de ElevenLabs SIN red y SIN clave de verdad.
//
// POR QUÉ EXISTE. La clave la pone el dueño en Vercel, así que en el
// repositorio nunca hay una con la que llamar de verdad. Lo que sí se puede
// comprobar aquí es todo lo que no depende de ElevenLabs: que sin clave nada
// se rompe y el error dice lo que hay que hacer; que las validaciones
// rechazan ANTES de gastar (un id sin forma, una duración fuera de rango,
// una descripción vacía); y que, con un `fetch` de mentira que devuelve los
// bytes que devolvería ElevenLabs, la voz sale en el WAV de la casa con la
// duración exacta y el efecto sale con la duración medida de su MP3.
//
// Lo que esta prueba NO comprueba, y no finge comprobar: que la clave del
// dueño valga, que su plan dé el formato PCM, ni cómo suena nada. Eso solo
// se sabe generando la primera muestra en la aplicación ya desplegada.

import { Buffer } from 'node:buffer';

let fallos = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) {
    console.log(`  bien  ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  MAL   ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

async function rechazoDe(promesa) {
  try {
    await promesa;
    return null;
  } catch (fallo) {
    return fallo;
  }
}

// ---------------------------------------------------------------------------
// Sin clave: nada se rompe y el error dice qué hacer
// ---------------------------------------------------------------------------

delete process.env.ELEVENLABS_API_KEY;
delete process.env.ELEVENLABS_TTS_MODEL;

const {
  hayClaveElevenLabs,
  modeloDeVozElevenLabs,
  listarVocesElevenLabs,
  vozElevenLabs,
  efectoElevenLabs
} = await import(new URL('api/_lib/elevenlabs.js', new URL('..', import.meta.url)).href);

console.log('Sin clave:');
comprobar('hayClaveElevenLabs() dice que no hay', hayClaveElevenLabs() === false);
comprobar(
  'el modelo por defecto es eleven_v3',
  modeloDeVozElevenLabs().id === 'eleven_v3',
  modeloDeVozElevenLabs().id
);

const falloLista = await rechazoDe(listarVocesElevenLabs());
comprobar(
  'listar voces sin clave falla diciendo que falta ELEVENLABS_API_KEY',
  Boolean(falloLista) && /ELEVENLABS_API_KEY/.test(falloLista.mensaje || ''),
  falloLista && falloLista.mensaje
);

const falloEfectoSinClave = await rechazoDe(efectoElevenLabs({ texto: 'una gota que cae' }));
comprobar(
  'un efecto sin clave falla diciendo que falta la clave, sin generar nada',
  Boolean(falloEfectoSinClave) && /falta la clave/i.test(falloEfectoSinClave.mensaje || '')
);

// ---------------------------------------------------------------------------
// Las validaciones rechazan antes de gastar (con una clave de mentira puesta,
// para que lo que frene sea la validación y no la falta de clave)
// ---------------------------------------------------------------------------

process.env.ELEVENLABS_API_KEY = 'clave-de-mentira-para-probar';

console.log('Validaciones:');
comprobar('con la variable puesta, hayClaveElevenLabs() dice que sí', hayClaveElevenLabs() === true);

const falloTextoVacio = await rechazoDe(efectoElevenLabs({ texto: '   ' }));
comprobar(
  'un efecto sin descripción se rechaza',
  Boolean(falloTextoVacio) && /sin decir qué sonido es/i.test(falloTextoVacio.mensaje || '')
);

const falloDuracion = await rechazoDe(efectoElevenLabs({ texto: 'un trueno', durS: 45 }));
comprobar(
  'un efecto de 45 s se rechaza (el tope son 30)',
  Boolean(falloDuracion) && /entre 0.5 y 30/.test(falloDuracion.mensaje || ''),
  falloDuracion && falloDuracion.mensaje
);

const falloVozSinId = await rechazoDe(
  vozElevenLabs({ partes: [{ quien: 'saharis', texto_ja: 'テスト' }], voces: { saharis: '' } })
);
comprobar(
  'una intervención sin voz fijada se rechaza con el nombre del personaje',
  Boolean(falloVozSinId) && /saharis/.test(falloVozSinId.mensaje || ''),
  falloVozSinId && falloVozSinId.mensaje
);

// ---------------------------------------------------------------------------
// Con un fetch de mentira: la voz sale en el WAV de la casa, y el efecto con
// la duración medida de su MP3
// ---------------------------------------------------------------------------

console.log('Con respuestas de mentira:');

const llamadas = [];
const PCM_POR_PARTE = Buffer.alloc(24_000, 1); // medio segundo de PCM a 24 kHz (48.000 bytes/s)
const fetchDeMentiraVoz = async (url, opciones) => {
  llamadas.push({ url, cuerpo: JSON.parse(opciones.body) });
  return { ok: true, arrayBuffer: async () => PCM_POR_PARTE };
};

globalThis.fetch = fetchDeMentiraVoz;
const bloque = await vozElevenLabs({
  partes: [
    { quien: 'saharis', texto_ja: '二度と。' },
    { quien: 'madre', texto_ja: '見つからないで。' }
  ],
  voces: { saharis: 'vozSaharis1234567890', madre: 'vozMadre12345678901' }
});

comprobar('la voz sale envuelta en WAV (RIFF/WAVE)',
  bloque.datos.toString('ascii', 0, 4) === 'RIFF' && bloque.datos.toString('ascii', 8, 12) === 'WAVE');
comprobar('la extensión y el tipo son los de la casa (.wav, audio/wav)',
  bloque.extension === '.wav' && bloque.tipo === 'audio/wav');
comprobar('la duración es la suma exacta de las partes (1 s)',
  Math.abs(bloque.durS - 1) < 1e-9, String(bloque.durS));
comprobar('una llamada por intervención, a su voz fijada',
  llamadas.length === 2 &&
    llamadas[0].url.includes('text-to-speech/vozSaharis1234567890') &&
    llamadas[1].url.includes('text-to-speech/vozMadre12345678901'),
  llamadas.map((l) => l.url).join(' | '));
comprobar('se pide el PCM de la casa (output_format=pcm_24000)',
  llamadas.every((l) => l.url.includes('output_format=pcm_24000')));
comprobar('el modelo que viaja es eleven_v3',
  llamadas.every((l) => l.cuerpo.model_id === 'eleven_v3'));
comprobar('NO viaja language_code (el v3 lo rechaza; el texto ya es japonés)',
  llamadas.every((l) => !('language_code' in l.cuerpo)));
comprobar('el texto que viaja es el japonés, sin dirección en español dentro',
  llamadas[0].cuerpo.text === '二度と。' && llamadas[1].cuerpo.text === '見つからないで。');

// Un MP3 de mentira: diez tramas MPEG1 capa III a 128 kbps y 44,1 kHz.
// Cada trama son 1152 muestras: 10 × 1152 / 44100 ≈ 0,261 s.
function tramaMp3() {
  const cabecera = Buffer.from([0xff, 0xfb, 0x90, 0x00]); // sync, MPEG1 L3, 128 kbps, 44,1 kHz
  const longitud = Math.floor((1152 / 8) * 128_000 / 44_100); // 417
  const trama = Buffer.alloc(longitud, 0);
  cabecera.copy(trama, 0);
  return trama;
}
const mp3DeMentira = Buffer.concat(Array.from({ length: 10 }, tramaMp3));

globalThis.fetch = async (url, opciones) => {
  llamadas.push({ url, cuerpo: JSON.parse(opciones.body) });
  return { ok: true, arrayBuffer: async () => mp3DeMentira };
};
llamadas.length = 0;

const efecto = await efectoElevenLabs({ texto: 'a single drop of water falls into a puddle', durS: 2 });
comprobar('el efecto va al endpoint de generación de sonido',
  llamadas.length === 1 && llamadas[0].url.includes('sound-generation'),
  llamadas.map((l) => l.url).join(' | '));
comprobar('el modelo del efecto es eleven_text_to_sound_v2',
  llamadas[0].cuerpo.model_id === 'eleven_text_to_sound_v2');
comprobar('la duración pedida viaja como duration_seconds',
  llamadas[0].cuerpo.duration_seconds === 2);
comprobar('el efecto sale en MP3', efecto.extension === '.mp3' && efecto.tipo === 'audio/mpeg');
comprobar('la duración del efecto es la MEDIDA del MP3 (≈0,261 s), no la pedida',
  Math.abs(efecto.durS - (10 * 1152) / 44_100) < 0.01, String(efecto.durS));

// ---------------------------------------------------------------------------

console.log(fallos ? `\n${fallos} COMPROBACIONES MAL.` : '\nTodo bien.');
process.exit(fallos ? 1 : 0);
