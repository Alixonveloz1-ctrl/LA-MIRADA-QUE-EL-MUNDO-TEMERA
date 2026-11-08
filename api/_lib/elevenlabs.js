// ElevenLabs: la segunda casa de sonido del estudio.
//
// QUÉ HACE AQUÍ. Dos cosas que Google no da:
//
//   1. VOCES MÁS EXPRESIVAS. Gemini TTS lee muy bien, pero la entrega de un
//      personaje de ficción —la amabilidad horrible del Celebrante, el grito
//      contenido de la Madre— pide actuación, y eso es lo que vende ElevenLabs.
//      Cada personaje puede tener fijada una voz de ElevenLabs
//      (`estado.voces[personaje].elevenlabs_voz_id`) AL LADO de su voz de
//      Gemini, no en su lugar: si hay clave y el bloque entero tiene voz de
//      ElevenLabs, el bloque se graba aquí; si falta la clave o a alguien del
//      bloque le falta su voz de ElevenLabs, se graba con Gemini como siempre.
//      ElevenLabs SUMA: sin clave, el estudio funciona entero igual que antes.
//
//   2. EFECTOS DE SONIDO. Hasta hoy no había cadena de efectos: ni un modo, ni
//      un modelo, ni un banco. El endpoint de generación de sonido de
//      ElevenLabs (`POST /v1/sound-generation`) convierte una descripción en
//      el efecto —la gota, la puerta, la respiración— y el modo `efecto` lo
//      guarda junto a su plano.
//
// LA CLAVE. Se lee de la variable de entorno ELEVENLABS_API_KEY y de ningún
// otro sitio. No se guarda en el bucket, no se escribe en el estado, no sale
// en ningún mensaje: aquí solo se pregunta si está puesta o no está. La pone
// el dueño en Vercel, a mano, como las demás claves de este estudio.
//
// EL MODELO DE VOZ. `eleven_v3`: la documentación de ElevenLabs lo presenta
// como su modelo más expresivo («most emotionally rich, expressive speech
// synthesis model»), con más de 70 idiomas —el japonés entre ellos— y con
// etiquetas de actuación dentro del texto. Es el que se pide para un japonés
// EXPRESIVO, que es lo que se busca. La alternativa estable,
// `eleven_multilingual_v2` (29 idiomas, japonés incluido), se puede poner sin
// tocar código con la variable ELEVENLABS_TTS_MODEL. Dos consecuencias del v3
// que están escritas en su documentación y que aquí se respetan:
//
//   · El v3 RECHAZA `language_code`: detecta el idioma del texto. Como el
//     texto que se le manda ya es el japonés traducido por el estudio, no se
//     manda código de idioma con ningún modelo y los dos funcionan.
//   · El límite del v3 son 5.000 caracteres por llamada. Una intervención de
//     un bloque está lejísimos de eso, pero se comprueba antes de gastar.
//
// EL FORMATO DE LA VOZ. Se pide PCM crudo a 24 kHz (`output_format=
// pcm_24000`) y se envuelve en WAV con `envolverWav()` de audio.js, que es
// EXACTAMENTE el formato de la casa (PCM mono 16 bits a 24 kHz): el bloque de
// ElevenLabs entra en la alineación de subtítulos y en el montaje sin que
// nada note la diferencia de proveedor. Ojo: los formatos PCM de ElevenLabs
// los da a los planes de pago; si la cuenta no los tiene, ElevenLabs lo dice
// con su error y ese error sale a pantalla tal cual, sin disimulo.
//
// Y UNA DIFERENCIA HONESTA CON GEMINI. Gemini graba el bloque entero en UNA
// llamada con hasta dos hablantes. ElevenLabs no: su text-to-speech es una
// voz por llamada, así que aquí cada intervención se graba con la voz fijada
// de su personaje y las intervenciones se pegan en PCM, en orden, dentro del
// mismo WAV. El timbre no deriva —es el voice_id fijado, idéntico en toda la
// serie— y la duración total es exacta, porque en PCM los segundos son bytes
// contados, no estimados. La dirección de actuación en español que compone
// `guionDeVoz()` NO viaja: ElevenLabs no tiene un canal de instrucciones
// aparte del texto, y mandar la dirección dentro del texto sería leerla en
// voz alta. Lo que actúa es el propio texto japonés y su puntuación, que es
// como trabaja el v3.

import { Buffer } from 'node:buffer';
import { ErrorDeCara } from './errores.js';
import { envolverWav } from './audio.js';

// La puerta pública de ElevenLabs. No identifica ninguna cuenta: la cuenta va
// en la cabecera `xi-api-key` y esa cabecera no sale de este archivo.
const HOST_ELEVENLABS = 'api.elevenlabs.io';

// El modelo de voz por defecto, y por qué: ver la cabecera. Lo sustituye
// ELEVENLABS_TTS_MODEL sin tocar código, igual que TTS_MODEL sustituye el de
// Gemini.
const MODELO_DE_VOZ_POR_DEFECTO = 'eleven_v3';

// El modelo de efectos. Es el ÚNICO que acepta el endpoint de generación de
// sonido según la documentación, así que no hay nada que elegir.
const MODELO_DE_EFECTOS = 'eleven_text_to_sound_v2';

// El formato en que se pide la voz: PCM crudo a 24 kHz, el de la casa.
const FORMATO_DE_VOZ = 'pcm_24000';
const HZ_DE_LA_VOZ = 24_000;
const BYTES_POR_SEGUNDO_DE_VOZ = HZ_DE_LA_VOZ * 2; // mono, 16 bits

// El formato de los efectos: el MP3 que el endpoint da por defecto, a
// 44,1 kHz y 128 kbps. El montador lo lee sin problema y el archivo pesa poco.
const FORMATO_DE_EFECTO = 'mp3_44100_128';

// El límite de caracteres del modelo v3 por llamada (5.000 según su
// documentación). Se deja un margen y se comprueba ANTES de gastar.
const MAXIMO_CARACTERES_POR_LLAMADA = 4_500;

// La duración que acepta el endpoint de efectos: de 0,5 a 30 segundos.
const MINIMO_EFECTO_S = 0.5;
const MAXIMO_EFECTO_S = 30;

// Cuánto se espera a ElevenLabs. La función de Vercel tiene su propio techo y
// este plazo va por debajo: mejor un error con palabras que un corte mudo.
const PLAZO_MS = 120_000;

// Un id de voz de ElevenLabs es una cadena sin espacios (los de su catálogo
// son alfanuméricos de 20 caracteres). Acaba dentro de la URL de la petición:
// se comprueba antes de mandarlo, igual que audio.js comprueba los de Google.
const ID_DE_VOZ = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// La clave y el modelo
// ---------------------------------------------------------------------------

/**
 * La clave de ElevenLabs, o cadena vacía si no está puesta. NUNCA se devuelve
 * a pantalla ni se escribe en ningún sitio: quien la necesita es `llamar()`,
 * dentro de este archivo.
 * @returns {string}
 */
function claveElevenLabs() {
  return (process.env.ELEVENLABS_API_KEY || '').trim();
}

/**
 * ¿Está puesta la clave? Es lo único que Salud pregunta, y preguntarlo no
 * gasta nada: no se llama a ElevenLabs para saberlo.
 * @returns {boolean}
 */
export function hayClaveElevenLabs() {
  return Boolean(claveElevenLabs());
}

/**
 * El modelo de voz que se va a usar, con la variable que lo sustituye. Se
 * enseña en Salud y en la pantalla de Voces para que se sepa qué va a sonar
 * antes de pagar una muestra.
 * @returns {{id:string, variable:string}}
 */
export function modeloDeVozElevenLabs() {
  return {
    id: (process.env.ELEVENLABS_TTS_MODEL || '').trim() || MODELO_DE_VOZ_POR_DEFECTO,
    variable: 'ELEVENLABS_TTS_MODEL'
  };
}

/** La queja de que falta la clave, dicha una sola vez y siempre igual. */
function faltaLaClave(paraQue) {
  return new ErrorDeCara(
    `No se ha podido ${paraQue}: falta la clave de ElevenLabs. Se pone una sola vez en Vercel, ` +
      'en la variable ELEVENLABS_API_KEY (Settings → Environment Variables), y después hay que ' +
      'redesplegar para que la función la vea. Sin la clave, las voces se siguen grabando con ' +
      'Gemini como hasta hoy: no se ha generado nada ni se ha gastado nada.',
    { reintentable: false, http: 400 }
  );
}

// ---------------------------------------------------------------------------
// La llamada
// ---------------------------------------------------------------------------

/**
 * Una llamada a ElevenLabs con su clave, devolviendo el audio en bruto.
 *
 * Los errores de ElevenLabs se traducen a ErrorDeCara con su propio texto
 * delante: si la clave no vale, si la cuenta no tiene ese formato o si se ha
 * acabado la cuota, lo dice él y se enseña él —maquillarlo sería esconder la
 * única pista que hay—. La clave no viaja en ningún mensaje: solo va en la
 * cabecera.
 *
 * @param {string} camino p. ej. `text-to-speech/<voz_id>`
 * @param {{cuerpo?:object, formato:string, paraQue:string}} opciones
 * @returns {Promise<Buffer>} los bytes del audio
 */
async function llamarElevenLabs(camino, { cuerpo = null, formato, paraQue }) {
  const clave = claveElevenLabs();
  if (!clave) throw faltaLaClave(paraQue);

  const url = `https://${HOST_ELEVENLABS}/v1/${camino}?output_format=${formato}`;

  let respuesta;
  try {
    respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': clave,
        'Content-Type': 'application/json',
        Accept: 'audio/*'
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(PLAZO_MS)
    });
  } catch (fallo) {
    throw new ErrorDeCara(
      `ElevenLabs no ha contestado al pedir ${paraQue}. Puede ser su servicio o la conexión; ` +
        'no se ha generado nada.',
      { detalle: String(fallo && fallo.message ? fallo.message : fallo), reintentable: true, http: 502 }
    );
  }

  if (!respuesta.ok) {
    let dicho = '';
    try {
      const crudo = await respuesta.text();
      try {
        const json = JSON.parse(crudo);
        dicho = (json && json.detail && (json.detail.message || json.detail)) || '';
        if (typeof dicho !== 'string') dicho = JSON.stringify(dicho);
      } catch {
        dicho = crudo;
      }
    } catch {
      dicho = '';
    }
    dicho = String(dicho || '').trim().slice(0, 400);

    if (respuesta.status === 401) {
      throw new ErrorDeCara(
        'La clave de ElevenLabs que hay en Vercel no vale: ElevenLabs la ha rechazado (401). ' +
          'Hay que poner la buena en la variable ELEVENLABS_API_KEY y redesplegar. No se ha ' +
          'generado nada.',
        { detalle: dicho || null, reintentable: false, http: 401 }
      );
    }
    if (respuesta.status === 429) {
      throw new ErrorDeCara(
        `ElevenLabs dice que ahora mismo no hay cuota para ${paraQue} (429). Hay acceso: es ` +
          'esperar o subir el plan, no arreglar la clave.',
        { detalle: dicho || null, reintentable: true, http: 429 }
      );
    }
    throw new ErrorDeCara(
      `ElevenLabs ha rechazado el pedido de ${paraQue} (${respuesta.status}). Debajo va lo que ` +
        'ha dicho él, tal cual: es la pista que hay.',
      { detalle: dicho || null, reintentable: false, http: respuesta.status }
    );
  }

  const datos = Buffer.from(await respuesta.arrayBuffer());
  if (!datos.length) {
    throw new ErrorDeCara(
      `ElevenLabs ha contestado con ${paraQue} vacío: cero bytes de audio. Hay que volver a pedirlo.`,
      { reintentable: true, http: 502 }
    );
  }
  return datos;
}

// ---------------------------------------------------------------------------
// La lista de voces
// ---------------------------------------------------------------------------

/**
 * Las voces que la cuenta de ElevenLabs tiene de verdad: las suyas y las del
 * catálogo que lleve añadidas. Los ids NO se inventan y NO se escriben en el
 * código: salen de `GET /v1/voices`, se escuchan en la pantalla de Voces y se
 * fija una por personaje.
 *
 * @returns {Promise<Array<{id:string, nombre:string, genero:string, descripcion:string}>>}
 */
export async function listarVocesElevenLabs() {
  const clave = claveElevenLabs();
  if (!clave) throw faltaLaClave('listar las voces');

  let respuesta;
  try {
    respuesta = await fetch(`https://${HOST_ELEVENLABS}/v1/voices`, {
      method: 'GET',
      headers: { 'xi-api-key': clave, Accept: 'application/json' },
      signal: AbortSignal.timeout(PLAZO_MS)
    });
  } catch (fallo) {
    throw new ErrorDeCara(
      'ElevenLabs no ha contestado al pedir su lista de voces.',
      { detalle: String(fallo && fallo.message ? fallo.message : fallo), reintentable: true, http: 502 }
    );
  }
  if (!respuesta.ok) {
    throw new ErrorDeCara(
      `ElevenLabs no ha dado su lista de voces (${respuesta.status}). Si es un 401, la clave de ` +
        'la variable ELEVENLABS_API_KEY no vale; hay que poner la buena y redesplegar.',
      { reintentable: respuesta.status !== 401, http: respuesta.status }
    );
  }

  const json = await respuesta.json().catch(() => null);
  const crudas = json && Array.isArray(json.voices) ? json.voices : [];

  return crudas
    .map((voz) => {
      const etiquetas = voz && typeof voz.labels === 'object' && voz.labels ? voz.labels : {};
      const generoCrudo = String(etiquetas.gender || '').trim().toLowerCase();
      return {
        id: String((voz && voz.voice_id) || '').trim(),
        nombre: String((voz && voz.name) || '').trim(),
        genero: generoCrudo === 'male' ? 'masculina' : generoCrudo === 'female' ? 'femenina' : generoCrudo,
        descripcion: String((voz && voz.description) || etiquetas.description || '').trim()
      };
    })
    .filter((voz) => voz.id);
}

// ---------------------------------------------------------------------------
// Voz — text-to-speech
// ---------------------------------------------------------------------------

/**
 * Graba las intervenciones de un bloque, cada una con la voz de ElevenLabs
 * fijada de su personaje, y las devuelve pegadas en UN solo WAV en el formato
 * de la casa —la misma forma que devuelve `voz()` de audio.js, para que
 * `modoVoz` pueda cambiar de proveedor sin tocar nada más—.
 *
 * Cada intervención es una llamada: ElevenLabs no graba dos voces en una.
 * Entre llamada y llamada el timbre es el voice_id fijado, idéntico siempre;
 * lo que se pega es PCM, así que la duración total es la suma exacta de las
 * partes, sin estimaciones.
 *
 * @param {{partes:Array<{quien:string, texto_ja:string}>,
 *          voces:Object<string,string>}} bloque `voces` dice qué voice_id de
 *        ElevenLabs le toca a cada hablante.
 * @returns {Promise<{datos:Buffer, extension:string, tipo:string, durS:number}>}
 */
export async function vozElevenLabs({ partes, voces } = {}) {
  if (!Array.isArray(partes) || !partes.length) {
    throw new ErrorDeCara(
      'Se ha pedido grabar con ElevenLabs sin ninguna línea que decir. Los bloques los arma ' +
        '«bloquesDeVoz()» en api/_lib/datos.js: esto es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  const modelo = modeloDeVozElevenLabs().id;
  const pedazos = [];

  for (const parte of partes) {
    const quien = String((parte && parte.quien) ?? '').trim();
    const texto = String((parte && (parte.texto_ja ?? parte.ja)) ?? '').trim();
    const vozId = String((voces && voces[quien]) ?? '').trim();

    if (!quien || !texto) {
      throw new ErrorDeCara(
        'Una intervención del bloque llega sin hablante o sin texto en japonés, y a ElevenLabs ' +
          'no se le puede pedir que la invente. Es un fallo del propio estudio, no de tu cuenta.',
        { reintentable: false, http: 500 }
      );
    }
    if (!ID_DE_VOZ.test(vozId)) {
      throw new ErrorDeCara(
        `La voz de ElevenLabs fijada para ${quien} («${vozId || '(vacía)'}») no tiene forma de ` +
          'id de voz. Los ids salen de la lista real de la cuenta, en la pantalla de Voces: no ' +
          'se escriben a mano.',
        { reintentable: false, http: 400 }
      );
    }
    if (texto.length > MAXIMO_CARACTERES_POR_LLAMADA) {
      throw new ErrorDeCara(
        `Una intervención de ${quien} tiene ${texto.length} caracteres y el modelo ${modelo} ` +
          `acepta ${MAXIMO_CARACTERES_POR_LLAMADA} por llamada. Habría que partir el bloque, ` +
          'que es trabajo del desglose de bloques, no de esta llamada.',
        { reintentable: false, http: 400 }
      );
    }

    // Sin `language_code`: el v3 lo rechaza y el texto ya es el japonés. La
    // actuación la pone el texto y su puntuación; no hay canal de dirección.
    const pcm = await llamarElevenLabs(`text-to-speech/${vozId}`, {
      formato: FORMATO_DE_VOZ,
      paraQue: `la voz de ${quien}`,
      cuerpo: {
        text: texto,
        model_id: modelo,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          use_speaker_boost: true
        }
      }
    });
    pedazos.push(pcm);
  }

  const pcmTotal = Buffer.concat(pedazos);
  const wav = envolverWav(pcmTotal, { hz: HZ_DE_LA_VOZ });
  return {
    datos: wav,
    extension: '.wav',
    tipo: 'audio/wav',
    durS: pcmTotal.length / BYTES_POR_SEGUNDO_DE_VOZ
  };
}

// ---------------------------------------------------------------------------
// Efectos de sonido — sound-generation
// ---------------------------------------------------------------------------

/**
 * Pide UN efecto de sonido: la descripción se convierte en audio con el
 * modelo de generación de sonido de ElevenLabs.
 *
 * @param {{texto:string, durS?:number|null}} pedido `durS` entre 0,5 y 30;
 *        si no viene, el modelo decide la duración según la descripción.
 * @returns {Promise<{datos:Buffer, extension:string, tipo:string, durS:number}>}
 *          `durS` es la MEDIDA del MP3 devuelto; si no se pudiera medir, la
 *          pedida —nunca un número inventado sin decir de dónde sale—.
 */
export async function efectoElevenLabs({ texto, durS = null } = {}) {
  const descripcion = String(texto ?? '').trim();
  if (!descripcion) {
    throw new ErrorDeCara(
      'Se ha pedido un efecto de sonido sin decir qué sonido es. El efecto nace de su ' +
        'descripción —«una gota que cae en una cueva», «una puerta de madera que se cierra ' +
        'despacio»—: sin ella no hay nada que generar.',
      { reintentable: false, http: 400 }
    );
  }

  let segundos = null;
  if (durS !== null && durS !== undefined) {
    segundos = Number(durS);
    if (!Number.isFinite(segundos) || segundos < MINIMO_EFECTO_S || segundos > MAXIMO_EFECTO_S) {
      throw new ErrorDeCara(
        `Se han pedido ${durS} segundos de efecto y el generador de sonido de ElevenLabs ` +
          `acepta entre ${MINIMO_EFECTO_S} y ${MAXIMO_EFECTO_S}. Ajusta la duración del plano o ` +
          'no la digas y deja que el modelo la decida.',
        { reintentable: false, http: 400 }
      );
    }
  }

  const datos = await llamarElevenLabs('sound-generation', {
    formato: FORMATO_DE_EFECTO,
    paraQue: 'el efecto de sonido',
    cuerpo: {
      text: descripcion,
      model_id: MODELO_DE_EFECTOS,
      ...(segundos ? { duration_seconds: segundos } : {}),
      prompt_influence: 0.5
    }
  });

  return {
    datos,
    extension: '.mp3',
    tipo: 'audio/mpeg',
    durS: duracionMp3(datos) ?? segundos ?? 0
  };
}

// ---------------------------------------------------------------------------
// Medir un MP3: la duración está en sus tramas, no en una cabecera
// ---------------------------------------------------------------------------

// Tasas de bits de la capa III, por versión de MPEG (índice 0 y 15 no valen).
const BITS_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITS_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MUESTREOS = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000] // MPEG 2.5
};

/**
 * La duración real de un MP3, sumando trama a trama. Si los bytes no son un
 * MP3 legible devuelve null: quien llama decide qué hacer con no saberlo, y
 * lo que no se hace es inventarse el número.
 * @param {Buffer} datos
 * @returns {number|null} segundos
 */
function duracionMp3(datos) {
  if (!Buffer.isBuffer(datos) || datos.length < 4) return null;

  let pos = 0;
  // La etiqueta ID3v2, si está, va delante y su tamaño viene en su cabecera.
  if (datos.toString('ascii', 0, 3) === 'ID3' && datos.length >= 10) {
    const tam =
      ((datos[6] & 0x7f) << 21) | ((datos[7] & 0x7f) << 14) | ((datos[8] & 0x7f) << 7) | (datos[9] & 0x7f);
    pos = 10 + tam;
  }

  let segundos = 0;
  let tramas = 0;
  while (pos + 4 <= datos.length) {
    const b0 = datos[pos];
    const b1 = datos[pos + 1];
    const b2 = datos[pos + 2];
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) break; // sin sincronía no hay trama

    const version = (b1 >> 3) & 0x3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reservada
    const capa = (b1 >> 1) & 0x3;
    if (version === 1 || capa !== 1) break; // solo capa III

    const indiceBits = (b2 >> 4) & 0xf;
    const indiceHz = (b2 >> 2) & 0x3;
    const kbps = (version === 3 ? BITS_MPEG1_L3 : BITS_MPEG2_L3)[indiceBits];
    const hz = MUESTREOS[version] && MUESTREOS[version][indiceHz];
    if (!kbps || !hz) break;

    const relleno = (b2 >> 1) & 0x1;
    const muestras = version === 3 ? 1152 : 576;
    const longitud = Math.floor((muestras / 8) * kbps * 1000 / hz) + relleno;
    if (longitud < 4) break;

    segundos += muestras / hz;
    tramas += 1;
    pos += longitud;
  }

  return tramas ? segundos : null;
}
