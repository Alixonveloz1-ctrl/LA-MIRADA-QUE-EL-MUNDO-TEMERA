// Todo el sonido de la serie: la música de Lyria, la voz de Gemini TTS, la
// lista de voces reales de Google, la alineación con Speech-to-Text y las dos
// funciones que leen y escriben una cabecera WAV de verdad.
//
// Cinco cosas que están escritas en la FORMA del código, no en un aviso, porque
// cada una costó un fallo real:
//
//   1. LYRIA SOLO ENTIENDE INGLÉS. Rechaza la petición entera —no la traduce, no
//      la aproxima— con «Unsupported language detected». Por eso el encargo se
//      compone en inglés desde los mismos datos, y si aun así Google se queja
//      del idioma, el mensaje que sale a pantalla lo dice en español y con
//      palabras.
//
//   2. LYRIA NO PASA DE TRES MINUTOS. Un episodio de 22 minutos no es una pieza
//      larga: son varias piezas unidas en el montaje con fundidos de dos
//      segundos y medio. Se comprueba ANTES de gastar.
//
//   3. UN BLOQUE DE VOZ ES UNA SOLA LLAMADA, con todas sus líneas dentro y hasta
//      dos hablantes. Es la única defensa real contra la deriva de tono: el
//      timbre no cambia entre llamadas —es la voz elegida— pero la entrega sí, y
//      eso no se arregla con indicaciones. Nunca se regenera una línea suelta.
//
//   4. LOS IDS DE VOZ NO SE INVENTAN. Salen de la lista que devuelve Google.
//
//   5. LA ALINEACIÓN VA POR LÍNEA, NUNCA POR PALABRA. El audio va en japonés y
//      el subtítulo en español: el número de palabras no coincide y la
//      correspondencia palabra a palabra no transfiere. Lo que se toma es la
//      entrada y la salida de cada intervención.
//
// Aquí no hay ni un id de modelo escrito a mano: salen de datos/serie.json a
// través de `entorno()`, y las variables MUSIC_MODEL, TTS_MODEL y STT_MODEL los
// sustituyen sin tocar una línea. Tampoco hay ni un dato de la cuenta.

import { Buffer } from 'node:buffer';
import { entorno } from './entorno.js';
import { serie } from './datos.js';
import { ErrorDeCara } from './errores.js';
import { llamar, urlModelo, urlServicio } from './vertex.js';

// Los dos servicios de Google que no son Vertex y que este módulo usa. Son
// puertas públicas: no identifican ninguna cuenta.
const HOST_VOZ = 'texttospeech.googleapis.com';
const HOST_RECONOCIMIENTO = 'speech.googleapis.com';

// El idioma en que se dice todo lo hablado de la serie. Sale de
// `voces.idioma` en datos/serie.json; esto es solo la red por debajo, y es el
// mismo valor que fija docs/contrato.md §2.
const IDIOMA_POR_DEFECTO = 'ja-JP';

// Lo que devuelve Gemini TTS cuando no dice el muestreo: PCM mono de 16 bits a
// 24 kHz, tal y como está declarado en `voces.formato_salida` de serie.json y
// en la firma de `envolverWav()` del contrato.
const HZ_DE_LA_VOZ = 24_000;
const CANALES_DE_LA_VOZ = 1;
const BITS_DE_LA_VOZ = 16;

// Lyria 3 Pro llega a tres minutos. El dato manda desde `musica.modelo.maximo_s`
// de serie.json; esto es el valor por si ese campo faltara.
const MAXIMO_DE_LYRIA_S = 180;

// El límite de la v1 síncrona de Speech-to-Text es de un minuto de audio. Por
// eso se alinea POR BLOQUE y nunca por episodio. Además, un minuto de PCM a
// 24 kHz son ~2,9 MB en base64, que es lo que cabe holgadamente en la petición.
const LIMITE_SINCRONO_S = 60;

// Un margen de una décima para no rechazar un bloque que mide 60,04 s por culpa
// del redondeo del propio archivo.
const MARGEN_DEL_LIMITE_S = 0.1;

// Gemini TTS admite dos hablantes en una misma llamada, no más. Los bloques de
// más de dos se parten por parejas consecutivas en `bloquesDeVoz()`.
const MAXIMO_DE_HABLANTES = 2;

// Por debajo de los 60 s de la plataforma. Generar una pieza de música o un
// bloque de voz largo lleva su tiempo, pero el límite propio es lo único que
// impide que la función se apague sin excepción y el audio se quede
// «generando» para siempre.
const LIMITE_MS = 45_000;

// Los bits por muestra que sabe escribir `envolverWav()`. Cualquier otro valor
// daría una cabecera que suena a ruido en vez de a voz.
const BITS_ADMITIDOS = new Set([8, 16, 24, 32]);

// Cómo se dice en español lo que Google llama SSML_VOICE_GENDER_*. El valor se
// pinta tal cual en la pantalla de Voces, y en esa pantalla todo va en español.
const GENEROS = {
  MALE: 'masculina',
  FEMALE: 'femenina',
  NEUTRAL: 'neutra',
  SSML_VOICE_GENDER_UNSPECIFIED: 'sin especificar'
};

// Un id de voz viene de la lista de Google o de datos/serie.json, pero acaba
// dentro del cuerpo de una petición: se comprueba antes de mandarlo.
const ID_DE_VOZ = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// Música — Lyria
// ---------------------------------------------------------------------------

/**
 * Genera una pieza de música con Lyria.
 *
 * El encargo va **en inglés**, literal, tal y como está escrito en
 * `musica.piezas[].encargo` de datos/serie.json. Es el único texto de todo el
 * estudio que no va en español, y no es una preferencia: Lyria rechaza la
 * petición entera en cualquier otro idioma.
 *
 * @param {{texto:string, negativo?:string|null, durS:number}} encargo
 *        `texto` es el encargo en inglés; `negativo` lo que no se quiere oír,
 *        también en inglés; `durS` los segundos que se piden.
 * @returns {Promise<{wav:Buffer, durS:number}>} el WAV listo para subir al
 *          bucket y su duración REAL medida de la cabecera, no la pedida.
 */
export async function musica({ texto, negativo = null, durS } = {}) {
  const encargo = comprobarEncargo(texto);
  const segundos = comprobarDuracionPedida(durS);
  const maximo = maximoDeLyria();

  // Se comprueba antes de llamar: pedir de más no devuelve una pieza recortada,
  // devuelve un error habiendo esperado, y el arreglo no es reintentar.
  if (segundos > maximo) {
    throw new ErrorDeCara(
      `Se han pedido ${formatearSegundos(segundos)} de música y Lyria no pasa de ` +
      `${formatearSegundos(maximo)} —tres minutos— por pieza. Un episodio de veintidós minutos no ` +
      'es una pieza larga: son varias piezas, una por acto o por bloque, que se unen en el ' +
      'montaje con fundidos de dos segundos y medio (los fundidos cortos suenan a tajo). Parte ' +
      'esta pieza en varias dentro de «musica.piezas» de datos/serie.json y pídelas por separado.',
      { reintentable: false, http: 400 }
    );
  }

  // El id no se escribe aquí: sale de datos/serie.json y lo sustituye la
  // variable MUSIC_MODEL sin tocar una línea de código.
  const modelo = modeloDeMusica();
  const ent = entorno();

  const cuerpo = {
    contents: [
      {
        role: 'user',
        // Todo en inglés. `:generateContent` no tiene campo de negativo ni de
        // duración, así que las dos cosas viajan dentro del encargo, redactadas
        // en inglés desde los mismos datos.
        parts: [{ text: componerEncargo(encargo, negativo, segundos) }]
      }
    ],
    generationConfig: {
      // Se pide audio y solo audio: sin esto el modelo puede contestar con un
      // texto describiendo la música que compondría.
      responseModalities: ['AUDIO']
    }
  };

  let respuesta;
  try {
    respuesta = await llamar(urlModelo(modelo, 'generateContent', ent.sa.project_id), cuerpo, {
      metodo: 'POST',
      limiteMs: LIMITE_MS,
      contexto: {
        que: 'generar la música',
        modelo: modelo.id,
        region: modelo.region,
        variable: modelo.variable
      }
    });
  } catch (fallo) {
    // Si la queja de Google es el idioma, se explica en español lo que hay que
    // hacer, que no es reintentar.
    throw quizaEsElIdioma(fallo);
  }

  const { datos, mime } = sacarAudio(respuesta, modelo, 'la música');

  // Lyria no siempre entrega WAV: cuando manda PCM crudo, el muestreo viene en
  // el propio mimeType («audio/L16;codec=pcm;rate=48000») y de ahí se lee. No se
  // supone ninguno: un muestreo inventado da una duración inventada, y esa
  // duración es la que coloca la pieza en el montaje.
  const wav = aWav(datos, mime, { hzPorDefecto: null, deQuien: 'la música' });

  return { wav, durS: duracionWav(wav) };
}

/**
 * El encargo entero que se le manda a Lyria, en inglés.
 *
 * El texto del encargo va literal, tal cual está en serie.json. Detrás se le
 * pegan, también en inglés, la duración pedida y lo que no se quiere oír:
 * `:generateContent` no tiene campo para ninguna de las dos cosas.
 */
function componerEncargo(encargo, negativo, segundos) {
  const trozos = [encargo];

  // En inglés a propósito: cualquier palabra en otro idioma tira la petición
  // entera. La duración no es un adorno; sin ella el modelo compone lo que
  // quiere y luego no cuadra con el hueco del montaje.
  trozos.push(`Target duration: about ${Math.round(segundos)} seconds.`);

  const fuera = String(negativo ?? '').trim().replace(/[.\s]+$/, '');
  if (fuera) trozos.push(`Do not include: ${fuera}.`);

  return trozos.join('\n\n');
}

/**
 * Traduce a español la única queja de Lyria que tiene arreglo conocido: que el
 * encargo no está en inglés. Cualquier otro fallo sale tal y como vino.
 */
function quizaEsElIdioma(fallo) {
  if (!(fallo instanceof ErrorDeCara)) return fallo;

  const dijo = `${fallo.detalle ?? ''} ${fallo.mensaje ?? ''}`;
  if (!/unsupported\s+language/i.test(dijo)) return fallo;

  return new ErrorDeCara(
    'Lyria ha rechazado el encargo entero porque no está escrito en inglés. No es un capricho ni ' +
    'una preferencia: el modelo no traduce ni aproxima, tira la petición completa en cuanto ve ' +
    'otro idioma. El encargo de música es el único texto de todo el estudio que va en inglés, y ' +
    'está escrito así a propósito en «musica.piezas[].encargo» y «musica.piezas[].negativo» de ' +
    'datos/serie.json. Revisa que ninguno de los dos lleve una palabra en español. No se ' +
    'reintenta: con el mismo texto la respuesta será la misma.',
    { detalle: fallo.detalle, reintentable: false, http: fallo.http }
  );
}

/** El tope del modelo, tal como lo declara serie.json. */
function maximoDeLyria() {
  const escrito = Number(((serie.musica || {}).modelo || {}).maximo_s);
  return Number.isFinite(escrito) && escrito > 0 ? escrito : MAXIMO_DE_LYRIA_S;
}

/** El modelo de música, con su id salido de los datos y nunca del código. */
function modeloDeMusica() {
  const modelo = entorno().modelos.musica;
  if (!modelo || !modelo.id) {
    throw new ErrorDeCara(
      'No hay ningún modelo de música declarado. El id sale de «musica.modelo.id» en ' +
      'datos/serie.json y nunca del código; mientras tanto se puede poner uno en la variable de ' +
      'entorno MUSIC_MODEL.',
      { reintentable: false, http: 500 }
    );
  }
  return modelo;
}

function comprobarEncargo(texto) {
  const encargo = String(texto ?? '').trim();
  if (!encargo) {
    throw new ErrorDeCara(
      'Se ha pedido generar música sin encargo. El encargo lo compone la función a partir de ' +
      'datos/serie.json, así que esto es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  return encargo;
}

function comprobarDuracionPedida(durS) {
  const segundos = Number(durS);
  if (!Number.isFinite(segundos) || segundos <= 0) {
    throw new ErrorDeCara(
      'Se ha pedido música sin decir cuántos segundos tiene que durar, y sin eso no se puede ni ' +
      'pedirla ni colocarla en el montaje. La duración está en «duracion_s» de cada pieza de ' +
      '«musica.piezas» en datos/serie.json.',
      { reintentable: false, http: 500 }
    );
  }
  return segundos;
}

// ---------------------------------------------------------------------------
// Voz — Gemini TTS
// ---------------------------------------------------------------------------

/**
 * Genera un bloque de voz entero: UNA sola llamada con todas sus líneas dentro.
 *
 * Esto no es una optimización, es la única defensa real contra la deriva de
 * tono. Entre llamadas distintas el timbre no cambia —es la voz elegida— pero
 * la entrega sí: tono, energía y ritmo. No se corrige con indicaciones, y ya se
 * probó. Lo que se hace es reducir la exposición: todas las líneas del bloque en
 * una llamada, los dos hablantes de un intercambio en esa misma llamada, y nunca
 * jamás regenerar una línea suelta —una línea regenerada sola es justo la que
 * canta—: se rehace el bloque entero.
 *
 * @param {{partes:Array<{quien:string, texto_ja:string, direccion:string}>,
 *          instruccion:string,
 *          voces:Object<string,string>|Map|Array}} bloque
 *        `partes` e `instruccion` salen de `guionDeVoz()` en prompt.js, que las
 *        compone siempre igual carácter por carácter. `voces` dice qué voz le
 *        toca a cada hablante: un objeto `{ "<personaje>": "<voz_id>" }`, un Map
 *        o una lista de `{ personaje, voz_id }`.
 * @returns {Promise<{wav:Buffer, durS:number}>}
 */
export async function voz({ partes, instruccion, voces } = {}) {
  const guion = comprobarPartes(partes);
  const global = comprobarInstruccion(instruccion);
  const hablantes = hablantesDelBloque(guion);
  const reparto = comprobarVoces(voces, hablantes);

  const idioma = idiomaDeLaSerie();
  const modelo = modeloDeVoz();
  const ent = entorno();

  const cuerpo = {
    contents: [
      {
        role: 'user',
        parts: [{ text: componerGuion(global, guion, hablantes.length > 1) }]
      }
    ],
    generationConfig: {
      // Audio y solo audio: sin esto el modelo puede contestar por escrito.
      responseModalities: ['AUDIO'],
      speechConfig: configuracionDeVoz(hablantes, reparto, idioma)
    }
  };

  const respuesta = await llamar(urlModelo(modelo, 'generateContent', ent.sa.project_id), cuerpo, {
    metodo: 'POST',
    limiteMs: LIMITE_MS,
    contexto: {
      que: 'generar la voz del bloque',
      modelo: modelo.id,
      region: modelo.region,
      variable: modelo.variable
    }
  });

  const { datos, mime } = sacarAudio(respuesta, modelo, 'la voz');

  // Gemini TTS entrega PCM mono de 16 bits a 24 kHz. Si viene crudo se envuelve
  // en WAV, que es lo que sabe leer el resto del estudio —y lo que espera
  // Speech-to-Text para alinear—.
  const wav = aWav(datos, mime, { hzPorDefecto: HZ_DE_LA_VOZ, deQuien: 'la voz' });

  return { wav, durS: duracionWav(wav) };
}

/**
 * El texto de la llamada: la instrucción global del bloque delante y, por cada
 * intervención, su dirección de actuación y detrás el japonés que se pronuncia.
 *
 * La dirección va DELANTE de su línea y en español —el modelo la entiende y la
 * instrucción global le dice que no se pronuncia nunca—. Lo único que se lee en
 * voz alta es el japonés.
 *
 * Con dos hablantes, cada intervención va etiquetada con el id del personaje, y
 * ese id es exactamente el mismo que viaja en `speakerVoiceConfig.speaker`: si
 * no coincidieran, el modelo no sabría a quién le toca cada voz.
 */
function componerGuion(instruccion, partes, conEtiqueta) {
  const lineas = [instruccion, ''];

  for (const parte of partes) {
    lineas.push(`(Dirección para ${parte.quien}, no se pronuncia: ${parte.direccion})`);
    lineas.push(conEtiqueta ? `${parte.quien}: ${parte.texto_ja}` : parte.texto_ja);
    lineas.push('');
  }

  return lineas.join('\n').trimEnd();
}

/**
 * La configuración de voz de la llamada.
 *
 * Con un hablante, la configuración simple. Con dos, la multi-hablante: un
 * `speakerVoiceConfig` por personaje, cada uno con su `prebuiltVoiceConfig`. Que
 * los dos vayan en la misma llamada no es solo por el tono: además suena a
 * conversación y no a dos monólogos pegados.
 */
function configuracionDeVoz(hablantes, reparto, idioma) {
  const config = { languageCode: idioma };

  if (hablantes.length === 1) {
    config.voiceConfig = {
      prebuiltVoiceConfig: { voiceName: nombreDeVoz(reparto.get(hablantes[0]), hablantes[0]) }
    };
    return config;
  }

  config.multiSpeakerVoiceConfig = {
    speakerVoiceConfigs: hablantes.map((quien) => ({
      // El mismo id que etiqueta sus intervenciones en el texto.
      speaker: quien,
      voiceConfig: { prebuiltVoiceConfig: { voiceName: nombreDeVoz(reparto.get(quien), quien) } }
    }))
  };
  return config;
}

/**
 * El nombre con el que Gemini conoce una voz.
 *
 * Gemini nombra sus voces con una sola palabra («Kore», «Puck», «Aoede»). La
 * lista de Google devuelve esas mismas voces con el idioma delante
 * («ja-JP-Chirp3-HD-Kore»): es la misma voz con el nombre largo. Cuando el id
 * viene con esa forma se usa el último tramo; en cualquier otro caso viaja tal
 * cual, sin tocarlo, para que si Google no lo reconoce lo diga él con su propio
 * texto y no lo adivinemos nosotros. Aquí no se inventa ningún id: todos salen
 * de `listarVoces()`.
 */
function nombreDeVoz(vozId, quien) {
  const id = String(vozId ?? '').trim();

  if (!ID_DE_VOZ.test(id)) {
    throw new ErrorDeCara(
      `La voz elegida para ${quien} («${id || '(vacía)'}») no tiene forma de id de voz. Los ids ` +
      'salen de la lista real de Google en la pantalla de Voces y se guardan en ' +
      '«voces.reparto[].voz_id» de datos/serie.json: no se escriben a mano.',
      { reintentable: false, http: 500 }
    );
  }

  // Solo se recorta cuando el último tramo es un nombre de al menos tres
  // letras, que es como se llaman las voces de Gemini. Así «ja-JP-Standard-A»
  // no se convierte en «A» a nuestras espaldas: viaja entero y Google contesta
  // literalmente que esa voz no le sirve, que es la verdad.
  const conIdioma = /^[a-z]{2,3}-[A-Za-z]{2,4}-.+-([A-Za-z][A-Za-z0-9]{2,})$/.exec(id);
  return conIdioma ? conIdioma[1] : id;
}

/** El modelo de voz, con su id salido de los datos y nunca del código. */
function modeloDeVoz() {
  const modelo = entorno().modelos.tts;
  if (!modelo || !modelo.id) {
    throw new ErrorDeCara(
      'No hay ningún modelo de voz declarado. El id sale de «voces.modelo.id» en datos/serie.json ' +
      'y nunca del código; mientras tanto se puede poner uno en la variable de entorno TTS_MODEL.',
      { reintentable: false, http: 500 }
    );
  }
  return modelo;
}

/** El idioma en que se habla la serie, tal como lo declara serie.json. */
function idiomaDeLaSerie() {
  const escrito = String((serie.voces || {}).idioma ?? '').trim();
  return escrito || IDIOMA_POR_DEFECTO;
}

function comprobarInstruccion(instruccion) {
  const global = String(instruccion ?? '').trim();
  if (!global) {
    throw new ErrorDeCara(
      'Se ha pedido generar voz sin la instrucción del bloque. Esa instrucción es la que fija el ' +
      'registro de toda la llamada y la que dice que las direcciones de actuación no se ' +
      'pronuncian; sin ella el modelo leería las direcciones en voz alta. La compone ' +
      '«guionDeVoz()» en api/_lib/prompt.js, así que esto es un fallo del propio estudio, no de ' +
      'tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  return global;
}

/**
 * Las partes del bloque, comprobadas una a una. Una parte sin dirección de
 * actuación se rechaza aquí, antes de gastar: sin ella el modelo se agarra a lo
 * único que le queda y la línea sale con otro carácter.
 */
function comprobarPartes(partes) {
  if (!Array.isArray(partes) || partes.length === 0) {
    throw new ErrorDeCara(
      'Se ha pedido generar voz sin ninguna línea que decir. Un bloque de voz es una sola llamada ' +
      'con todas sus líneas dentro; los bloques los arma «bloquesDeVoz()» en api/_lib/datos.js, ' +
      'así que esto es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  return partes.map((parte, i) => {
    const cual = `la intervención ${i + 1} de ${partes.length} del bloque`;

    if (!parte || typeof parte !== 'object') {
      throw new ErrorDeCara(
        `No se entiende ${cual}. Es un fallo del propio estudio, no de tu cuenta.`,
        { reintentable: false, http: 500 }
      );
    }

    const quien = String(parte.quien ?? '').trim();
    if (!quien) {
      throw new ErrorDeCara(
        `${primeraMayuscula(cual)} no dice quién habla, y sin eso no se le puede asignar una voz.`,
        { reintentable: false, http: 500 }
      );
    }

    const textoJa = String(parte.texto_ja ?? parte.ja ?? '').trim();
    if (!textoJa) {
      throw new ErrorDeCara(
        `${primeraMayuscula(cual)} no trae texto en japonés. El audio va en japonés y el ` +
        'subtítulo en español; sin el japonés no hay nada que decir.',
        { reintentable: false, http: 500 }
      );
    }

    const direccion = String(parte.direccion ?? '').trim();
    if (!direccion) {
      // La misma trampa que la de una referencia de imagen sin su línea: no
      // falla, sale mal habiéndolo pagado.
      throw new ErrorDeCara(
        `${primeraMayuscula(cual)} viaja sin su dirección de actuación. La dirección se compone ` +
        'siempre igual, carácter por carácter, en «guionDeVoz()» de api/_lib/prompt.js: es lo ' +
        'que hace que el personaje suene al mismo personaje en todas sus llamadas. Sin ella la ' +
        'línea sale con otro carácter y hay que rehacer el bloque entero.',
        { reintentable: false, http: 500 }
      );
    }

    return { quien, texto_ja: textoJa, direccion };
  });
}

/** Quién habla en el bloque, en el orden en que aparece. Dos como mucho. */
function hablantesDelBloque(partes) {
  const hablantes = [];
  for (const parte of partes) if (!hablantes.includes(parte.quien)) hablantes.push(parte.quien);

  if (hablantes.length > MAXIMO_DE_HABLANTES) {
    throw new ErrorDeCara(
      `Este bloque tiene ${hablantes.length} hablantes (${hablantes.join(', ')}) y el modelo admite ` +
      `${MAXIMO_DE_HABLANTES} en una misma llamada. Una escena con más se parte por parejas ` +
      'consecutivas, que es lo que hace «bloquesDeVoz()» en api/_lib/datos.js; si ha llegado ' +
      'hasta aquí sin partirse es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  return hablantes;
}

/**
 * El reparto de voces del bloque, admitiendo las tres formas en que puede
 * llegar: objeto, Map o lista de fichas. Todo hablante tiene que traer voz: sin
 * ella no se genera nada, porque elegir una por nuestra cuenta sería inventarse
 * un id.
 */
function comprobarVoces(voces, hablantes) {
  const reparto = new Map();

  if (voces instanceof Map) {
    for (const [quien, valor] of voces) reparto.set(String(quien), vozDeFicha(valor));
  } else if (Array.isArray(voces)) {
    for (const ficha of voces) {
      if (!ficha || typeof ficha !== 'object') continue;
      const quien = String(ficha.quien ?? ficha.personaje ?? '').trim();
      if (quien) reparto.set(quien, vozDeFicha(ficha));
    }
  } else if (voces && typeof voces === 'object') {
    for (const [quien, valor] of Object.entries(voces)) reparto.set(String(quien), vozDeFicha(valor));
  }

  const sinVoz = hablantes.filter((quien) => !reparto.get(quien));
  if (sinVoz.length) {
    throw new ErrorDeCara(
      `No se ha elegido voz para ${listar(sinVoz)}. Las voces se escuchan y se eligen en la ` +
      'pantalla de Voces —cada candidata dice la frase más difícil de ese personaje— y quedan ' +
      'guardadas en «voces.reparto[].voz_id» de datos/serie.json. No se puede poner una por su ' +
      'cuenta: los ids salen de la lista real de Google y elegir a ciegas daría otro personaje.',
      { reintentable: false, http: 400 }
    );
  }

  return reparto;
}

/** Una voz puede venir suelta («Kore») o dentro de una ficha ({ voz_id }). */
function vozDeFicha(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (valor && typeof valor === 'object') {
    return String(valor.voz_id ?? valor.voz ?? valor.id ?? '').trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// La lista de voces
// ---------------------------------------------------------------------------

/**
 * Las voces que Google tiene de verdad para el idioma de la serie.
 *
 * Los ids NO se inventan y NO se escriben en el código: se piden a la API, se
 * escuchan en la pantalla de Voces y se elige una por personaje. Aquí solo se
 * filtra: se quedan las que sirven para el idioma en que se habla la serie.
 *
 * @returns {Promise<Array<{id:string, genero:string, idiomas:string[]}>>}
 */
export async function listarVoces() {
  const idioma = idiomaDeLaSerie();

  const respuesta = await llamar(
    urlServicio(HOST_VOZ, `v1/voices?languageCode=${encodeURIComponent(idioma)}`),
    null,
    {
      metodo: 'GET',
      limiteMs: LIMITE_MS,
      contexto: { que: `pedir a Google la lista de voces de ${idioma}` }
    }
  );

  const crudas = Array.isArray(respuesta && respuesta.voices) ? respuesta.voices : [];
  const voces = [];

  for (const cruda of crudas) {
    if (!cruda || typeof cruda !== 'object') continue;

    const id = String(cruda.name ?? '').trim();
    if (!id) continue;

    const idiomas = (Array.isArray(cruda.languageCodes) ? cruda.languageCodes : [])
      .map((c) => String(c).trim())
      .filter(Boolean);

    // La consulta ya pide solo las del idioma, pero se vuelve a comprobar: lo
    // que se enseña en pantalla tiene que servir de verdad para lo que se va a
    // grabar, y una voz de otro idioma diría el japonés con acento de otro sitio.
    if (!sirveParaIdioma(idiomas, idioma)) continue;

    voces.push({ id, genero: generoEnEspanol(cruda.ssmlGender), idiomas });
  }

  if (!voces.length) {
    throw new ErrorDeCara(
      `Google no ha devuelto ninguna voz para ${idioma}. Sin lista no se puede elegir voz, y los ` +
      'ids no se inventan. Suele ser que falte habilitar la API de síntesis de voz ' +
      '(texttospeech.googleapis.com) en el proyecto, o que la service account no tenga permiso ' +
      'sobre ella. La pantalla de Salud lo comprueba y lo dice.',
      { detalle: comoTexto(respuesta), reintentable: false, http: 502 }
    );
  }

  // Ordenadas por id: la pantalla las enseña en una lista y una lista que cambia
  // de orden en cada carga no se puede recorrer con el pulgar.
  voces.sort((a, b) => a.id.localeCompare(b.id, 'es'));
  return voces;
}

/** ¿Sirve esta voz para el idioma de la serie? Vale «ja-JP» y vale «ja». */
function sirveParaIdioma(idiomas, idioma) {
  const pedido = idioma.toLowerCase();
  const raiz = pedido.split('-')[0];
  return idiomas.some((codigo) => {
    const c = codigo.toLowerCase();
    return c === pedido || c === raiz || c.startsWith(`${raiz}-`);
  });
}

/** SSML_VOICE_GENDER_* → una palabra en español, que es lo que se pinta. */
function generoEnEspanol(crudo) {
  const clave = String(crudo ?? '').trim().toUpperCase();
  return GENEROS[clave] || 'sin especificar';
}

// ---------------------------------------------------------------------------
// Alineación — Speech-to-Text
// ---------------------------------------------------------------------------

/**
 * Dónde empieza y dónde acaba cada línea dentro del WAV del bloque.
 *
 * DEVUELVE TIEMPOS POR LÍNEA, NO POR PALABRA, y eso no es una simplificación:
 * el audio va en japonés y el subtítulo en español, así que el número de
 * palabras no coincide y la correspondencia palabra a palabra no transfiere a
 * ninguna parte. Lo que se toma es la entrada y la salida de cada intervención,
 * y eso se aplica al texto español a nivel de línea.
 *
 * Las palabras reconocidas se reparten entre las líneas EN ORDEN y de forma
 * proporcional a cuántos caracteres tiene cada línea japonesa; de cada tramo se
 * toma el inicio de su primera palabra y el fin de su última.
 *
 * Si el reconocimiento vuelve vacío o corto no falla: reparte la duración total
 * en proporción y marca cada línea con `estimado:true`, para que la pantalla
 * pueda decirlo con palabras en vez de dar por buenos unos tiempos que no se
 * han medido.
 *
 * FALTA EN EL CONTRATO: docs/contrato.md §12 escribe el resultado como
 * `[{ inicio, fin }]` y no menciona el caso de un reconocimiento vacío. Se añade
 * `estimado:true` en cada línea repartida a ojo —solo en ese caso— porque un
 * tiempo estimado y uno medido no valen lo mismo y el montaje quema los
 * subtítulos con ellos. Conviene apuntarlo en el contrato.
 *
 * @param {Buffer|Uint8Array} wav el WAV del bloque entero.
 * @param {Array<{ja:string}|string>} lineas las líneas del bloque, en orden.
 * @returns {Promise<Array<{inicio:number, fin:number, estimado?:boolean}>>}
 */
export async function alinear(wav, lineas) {
  const datos = aBuffer(wav, 'el audio que se va a alinear');
  const pesos = comprobarLineasAAlinear(lineas);
  const cabecera = leerCabeceraWav(datos);
  const duracion = cabecera.bytesDeDatos / cabecera.byteRate;

  // El límite de la v1 síncrona es de un minuto de audio. Por eso se alinea por
  // bloque y nunca por episodio: no es una recomendación, es que no entra.
  if (duracion > LIMITE_SINCRONO_S + MARGEN_DEL_LIMITE_S) {
    throw new ErrorDeCara(
      `Este audio dura ${formatearSegundos(duracion)} y el reconocimiento de voz de Google solo ` +
      `admite ${formatearSegundos(LIMITE_SINCRONO_S)} de una vez. La alineación se hace POR ` +
      'BLOQUE, nunca por episodio ni por pieza entera: cada bloque de voz es una llamada, se mide ' +
      'por separado, y el montador coloca cada línea en su segundo. Si un bloque ha salido de más ' +
      'de un minuto, hay que partirlo en «bloquesDeVoz()» de api/_lib/datos.js.',
      { reintentable: false, http: 400 }
    );
  }

  const modelo = entorno().modelos.stt;

  const config = {
    // LINEAR16 y el muestreo dicho a las claras, como manda el contrato. El
    // muestreo se lee de la cabecera del propio archivo en vez de darlo por
    // supuesto: con el WAV de Gemini TTS son exactamente 24000, y si algún día
    // llega otro, unos tiempos medidos contra el muestreo equivocado
    // desplazarían todos los subtítulos sin avisar.
    encoding: 'LINEAR16',
    sampleRateHertz: cabecera.hz,
    languageCode: idiomaDeLaSerie(),
    // Sin esto no vienen los tiempos, que es lo único que se busca aquí.
    enableWordTimeOffsets: true
  };
  if (cabecera.canales > 1) config.audioChannelCount = cabecera.canales;
  // El id solo se manda si está declarado: la v1 elige el suyo cuando falta, y
  // escribir uno a mano aquí sería inventarlo.
  if (modelo && modelo.id) config.model = modelo.id;

  const respuesta = await llamar(
    urlServicio(HOST_RECONOCIMIENTO, 'v1/speech:recognize'),
    {
      config,
      // Va el PCM pelado, sin la cabecera RIFF, porque el formato ya se declara
      // arriba. Un minuto a 24 kHz son ~2,9 MB en base64: cabe.
      audio: { content: cabecera.pcm.toString('base64') }
    },
    {
      metodo: 'POST',
      limiteMs: LIMITE_MS,
      contexto: { que: 'medir dónde empieza y acaba cada línea dentro del audio' }
    }
  );

  const palabras = sacarPalabras(respuesta);

  // Con menos palabras reconocidas que líneas no hay forma honrada de repartir:
  // se estima y se dice que está estimado. Fallar aquí sería peor —el bloque ya
  // está generado y pagado— y mentir con unos tiempos sin marcar, mucho peor.
  if (palabras.length < pesos.length) return repartoEstimado(pesos, duracion);

  return repartoMedido(pesos, palabras, duracion);
}

/**
 * Los pesos de las líneas: cuántos caracteres tiene el japonés de cada una. El
 * japonés no separa con espacios, así que el número de caracteres es la mejor
 * medida de cuánto se tarda en decirla.
 */
function comprobarLineasAAlinear(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new ErrorDeCara(
      'Se ha pedido alinear un audio sin decir qué líneas hay dentro. Sin las líneas no hay nada ' +
      'que colocar: los tiempos que se miden son la entrada y la salida de cada una.',
      { reintentable: false, http: 400 }
    );
  }

  return lineas.map((linea, i) => {
    const ja = typeof linea === 'string' ? linea : String((linea && linea.ja) ?? '');
    // Sin espacios ni saltos: lo que se pronuncia son los caracteres.
    const limpio = ja.replace(/\s+/g, '');
    if (!limpio) {
      throw new ErrorDeCara(
        `La línea ${i + 1} de ${lineas.length} no trae texto en japonés, y el reparto de tiempos ` +
        'se hace en proporción a lo que dura decirla. El japonés de cada línea está en la pieza, ' +
        'en datos/serie.json.',
        { reintentable: false, http: 400 }
      );
    }
    return [...limpio].length;
  });
}

/** Todas las palabras reconocidas, en orden, con sus tiempos en segundos. */
function sacarPalabras(respuesta) {
  const resultados = Array.isArray(respuesta && respuesta.results) ? respuesta.results : [];
  const palabras = [];

  for (const resultado of resultados) {
    const alternativas = Array.isArray(resultado && resultado.alternatives) ? resultado.alternatives : [];
    const mejor = alternativas[0];
    const trozos = Array.isArray(mejor && mejor.words) ? mejor.words : [];

    for (const trozo of trozos) {
      const inicio = enSegundos(trozo && (trozo.startTime ?? trozo.start_time));
      const fin = enSegundos(trozo && (trozo.endTime ?? trozo.end_time));
      if (inicio === null && fin === null) continue;
      palabras.push({
        inicio: inicio === null ? (fin ?? 0) : inicio,
        fin: fin === null ? (inicio ?? 0) : fin
      });
    }
  }

  return palabras;
}

/**
 * Reparte las palabras entre las líneas en orden y en proporción a sus
 * caracteres, y de cada tramo toma el inicio de la primera y el fin de la
 * última. Cada línea se lleva al menos una palabra: un tramo vacío no tendría
 * ni entrada ni salida que tomar.
 */
function repartoMedido(pesos, palabras, duracion) {
  const total = palabras.length;
  const n = pesos.length;
  const sumaDePesos = pesos.reduce((a, b) => a + b, 0);

  const cortes = [0];
  let acumulado = 0;
  for (let i = 0; i < n; i += 1) {
    acumulado += pesos[i];
    const propuesta = Math.round((total * acumulado) / sumaDePesos);
    const minimo = cortes[i] + 1;                 // esta línea se lleva al menos una
    const maximo = total - (n - 1 - i);           // y deja al menos una a cada siguiente
    cortes.push(Math.min(Math.max(propuesta, minimo), maximo));
  }

  const salida = [];
  let anterior = 0;

  for (let i = 0; i < n; i += 1) {
    const tramo = palabras.slice(cortes[i], cortes[i + 1]);
    // Los tiempos no pueden ir hacia atrás: el montador corta el bloque por
    // estos puntos y un corte que retrocede se lleva por delante la línea de al
    // lado.
    const inicio = Math.max(anterior, Math.min(tramo[0].inicio, duracion));
    const fin = Math.max(inicio, Math.min(tramo[tramo.length - 1].fin, duracion));
    salida.push({ inicio: redondear(inicio), fin: redondear(fin) });
    anterior = fin;
  }

  return salida;
}

/**
 * Sin reconocimiento útil, la duración total se reparte en proporción a los
 * caracteres de cada línea. Va marcado como estimado: un tiempo a ojo y un
 * tiempo medido no valen lo mismo, y quien mira la pantalla tiene derecho a
 * saber cuál de los dos está viendo.
 */
function repartoEstimado(pesos, duracion) {
  const sumaDePesos = pesos.reduce((a, b) => a + b, 0);
  const salida = [];
  let acumulado = 0;
  let inicio = 0;

  for (let i = 0; i < pesos.length; i += 1) {
    acumulado += pesos[i];
    const fin = i === pesos.length - 1 ? duracion : (duracion * acumulado) / sumaDePesos;
    salida.push({ inicio: redondear(inicio), fin: redondear(Math.max(inicio, fin)), estimado: true });
    inicio = fin;
  }

  return salida;
}

/** «1.200s» o { seconds, nanos } → segundos. null si no hay tiempo. */
function enSegundos(valor) {
  if (valor === null || valor === undefined) return null;

  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  if (typeof valor === 'string') {
    const numero = Number(valor.replace(/s$/i, '').trim());
    return Number.isFinite(numero) ? numero : null;
  }

  if (typeof valor === 'object') {
    const segundos = Number(valor.seconds ?? 0);
    const nanos = Number(valor.nanos ?? 0);
    if (!Number.isFinite(segundos) || !Number.isFinite(nanos)) return null;
    return segundos + nanos / 1e9;
  }

  return null;
}

/** Milésimas de segundo: más precisión de la que tiene el propio audio sobra. */
function redondear(s) {
  return Math.round(s * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// WAV: leer la cabecera y escribirla
// ---------------------------------------------------------------------------

/**
 * Cuántos segundos dura un WAV, leídos de su cabecera de verdad.
 *
 * NO se dan por supuestos 44 bytes de cabecera. Un WAV puede traer delante
 * trozos `LIST`, `fact` o metadatos que Google mete sin avisar, y contar desde
 * el byte 44 daría una duración equivocada —y, con ella, una música colocada
 * fuera de sitio en el montaje—. Se recorren los trozos hasta encontrar `fmt `
 * y `data`, y los segundos salen de dividir los bytes de audio entre el
 * `byteRate` que declara el propio archivo.
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {number} segundos
 */
export function duracionWav(buf) {
  const cabecera = leerCabeceraWav(aBuffer(buf, 'el audio'));
  return cabecera.bytesDeDatos / cabecera.byteRate;
}

/**
 * Envuelve PCM crudo en un WAV con la cabecera correcta.
 *
 * @param {Buffer|Uint8Array} pcm las muestras, sin cabecera.
 * @param {{hz?:number, canales?:number, bits?:number}} [formato] por defecto, el
 *        de Gemini TTS: mono, 16 bits, 24 kHz.
 * @returns {Buffer} el WAV entero.
 */
export function envolverWav(pcm, { hz = HZ_DE_LA_VOZ, canales = CANALES_DE_LA_VOZ, bits = BITS_DE_LA_VOZ } = {}) {
  const datos = aBuffer(pcm, 'el audio que se va a envolver en WAV');

  const muestreo = Math.round(Number(hz));
  const pistas = Math.round(Number(canales));
  const profundidad = Math.round(Number(bits));

  if (!Number.isFinite(muestreo) || muestreo <= 0) {
    throw new ErrorDeCara(
      `No se puede envolver el audio en WAV: «${hz}» no es un muestreo. Es un fallo del propio ` +
      'estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  if (!Number.isFinite(pistas) || pistas < 1 || pistas > 8) {
    throw new ErrorDeCara(
      `No se puede envolver el audio en WAV: «${canales}» no es un número de canales. Es un fallo ` +
      'del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  if (!BITS_ADMITIDOS.has(profundidad)) {
    throw new ErrorDeCara(
      `No se puede envolver el audio en WAV a ${bits} bits por muestra: se escriben cabeceras de ` +
      `${[...BITS_ADMITIDOS].join(', ')} bits. Es un fallo del propio estudio, no de tu cuenta.`,
      { reintentable: false, http: 500 }
    );
  }

  const bytesPorMuestra = profundidad / 8;
  const alineacion = pistas * bytesPorMuestra;
  const byteRate = muestreo * alineacion;

  // Los trozos de un RIFF van a tamaño par: si el audio tiene un número impar de
  // bytes se añade un byte de relleno que NO cuenta como audio.
  const relleno = datos.length % 2;

  const cabecera = Buffer.alloc(44);
  cabecera.write('RIFF', 0, 'ascii');
  cabecera.writeUInt32LE(36 + datos.length + relleno, 4);   // lo que queda detrás de este campo
  cabecera.write('WAVE', 8, 'ascii');
  cabecera.write('fmt ', 12, 'ascii');
  cabecera.writeUInt32LE(16, 16);                            // tamaño del trozo fmt de PCM
  cabecera.writeUInt16LE(1, 20);                             // 1 = PCM sin comprimir
  cabecera.writeUInt16LE(pistas, 22);
  cabecera.writeUInt32LE(muestreo, 24);
  cabecera.writeUInt32LE(byteRate, 28);
  cabecera.writeUInt16LE(alineacion, 32);
  cabecera.writeUInt16LE(profundidad, 34);
  cabecera.write('data', 36, 'ascii');
  cabecera.writeUInt32LE(datos.length, 40);                  // los bytes de audio de verdad

  return relleno
    ? Buffer.concat([cabecera, datos, Buffer.alloc(1)])
    : Buffer.concat([cabecera, datos]);
}

/**
 * Recorre un RIFF de verdad y devuelve lo que hace falta saber de él:
 * `{ hz, canales, bits, byteRate, pcm, bytesDeDatos }`.
 *
 * No supone ninguna posición fija. Busca el trozo `fmt ` y el trozo `data`
 * saltando de cabecera en cabecera, que es la única forma de leer un WAV que
 * traiga metadatos delante.
 */
function leerCabeceraWav(datos) {
  if (datos.length < 12 ||
      datos.toString('ascii', 0, 4) !== 'RIFF' ||
      datos.toString('ascii', 8, 12) !== 'WAVE') {
    throw new ErrorDeCara(
      'Lo que se ha recibido no es un archivo WAV: no empieza por la marca «RIFF … WAVE» que ' +
      'lleva cualquier WAV. Sin cabecera no se puede saber cuánto dura, y sin duración no se ' +
      'puede colocar en el montaje.',
      { detalle: `${datos.length} bytes; empieza por «${asciiLegible(datos, 12)}»`,
        reintentable: false, http: 502 }
    );
  }

  let posicion = 12;
  let formato = null;
  let audio = null;

  while (posicion + 8 <= datos.length) {
    const nombre = datos.toString('ascii', posicion, posicion + 4);
    const tamano = datos.readUInt32LE(posicion + 4);
    const cuerpo = posicion + 8;
    const disponible = datos.length - cuerpo;

    if (nombre === 'fmt ' && tamano >= 16 && disponible >= 16) {
      formato = {
        codificacion: datos.readUInt16LE(cuerpo),
        canales: datos.readUInt16LE(cuerpo + 2),
        hz: datos.readUInt32LE(cuerpo + 4),
        byteRate: datos.readUInt32LE(cuerpo + 8),
        bits: datos.readUInt16LE(cuerpo + 14)
      };
    }

    if (nombre === 'data') {
      // Un tamaño de 0 —o mayor que lo que queda— pasa con el audio que se
      // escribe mientras suena: entonces el audio es todo lo que hay detrás.
      const dudoso = tamano === 0 || tamano > disponible;
      audio = { inicio: cuerpo, bytes: dudoso ? disponible : tamano };
      if (dudoso) break;
    }

    // Cada trozo se rellena hasta tamaño par.
    posicion = cuerpo + tamano + (tamano % 2);
  }

  if (!formato) {
    throw new ErrorDeCara(
      'Este WAV no trae el trozo «fmt» que dice a qué muestreo y con cuántos canales está grabado, ' +
      'así que no se puede saber cuánto dura. El archivo llegó incompleto o no es un WAV.',
      { reintentable: false, http: 502 }
    );
  }
  if (!audio || audio.bytes <= 0) {
    throw new ErrorDeCara(
      'Este WAV no trae audio dentro: tiene cabecera pero el trozo «data» está vacío. Hay que ' +
      'volver a generarlo.',
      { reintentable: false, http: 502 }
    );
  }

  // El byteRate declarado es el que manda; si el archivo lo trae a cero se
  // calcula con el resto de la cabecera, que es la misma cuenta.
  const byteRate = formato.byteRate > 0
    ? formato.byteRate
    : formato.hz * formato.canales * Math.ceil(formato.bits / 8);

  if (!(byteRate > 0)) {
    throw new ErrorDeCara(
      'La cabecera de este WAV dice que suena a cero bytes por segundo, y con eso no se puede ' +
      'calcular cuánto dura. El archivo está mal escrito: hay que volver a generarlo.',
      { reintentable: false, http: 502 }
    );
  }

  return {
    hz: formato.hz,
    canales: formato.canales || 1,
    bits: formato.bits || BITS_DE_LA_VOZ,
    byteRate,
    bytesDeDatos: audio.bytes,
    pcm: datos.subarray(audio.inicio, audio.inicio + audio.bytes)
  };
}

// ---------------------------------------------------------------------------
// La respuesta de los modelos
// ---------------------------------------------------------------------------

/**
 * Saca el audio de la primera `part` que lo traiga. Si el modelo ha contestado
 * sin audio —el filtro, una queja escrita— se lanza con el motivo LITERAL de
 * Google: es lo único que dice qué hay que cambiar.
 */
function sacarAudio(respuesta, modelo, deQuien) {
  const candidatos = Array.isArray(respuesta && respuesta.candidates) ? respuesta.candidates : [];

  for (const candidato of candidatos) {
    const partes = Array.isArray(candidato && candidato.content && candidato.content.parts)
      ? candidato.content.parts
      : [];
    for (const parte of partes) {
      // Vertex contesta en camelCase; se mira también el snake_case por si
      // alguna versión de la API lo devuelve así.
      const dato = (parte && (parte.inlineData ?? parte.inline_data)) || null;
      const b64 = dato && typeof dato.data === 'string' ? dato.data.trim() : '';
      if (!b64) continue;

      const mime = String((dato.mimeType ?? dato.mime_type) || '').trim();
      if (mime && !/^audio\//i.test(mime)) continue;

      return { datos: Buffer.from(b64, 'base64'), mime };
    }
  }

  throw sinAudio(respuesta, modelo, candidatos, deQuien);
}

/** El modelo contestó, pero sin sonido. El motivo va tal cual lo dio Google. */
function sinAudio(respuesta, modelo, candidatos, deQuien) {
  const motivos = [];

  const opinion = (respuesta && (respuesta.promptFeedback ?? respuesta.prompt_feedback)) || null;
  const bloqueo = opinion && (opinion.blockReason ?? opinion.block_reason);
  if (bloqueo) motivos.push(String(bloqueo));
  const bloqueoTexto = opinion && (opinion.blockReasonMessage ?? opinion.block_reason_message);
  if (bloqueoTexto) motivos.push(String(bloqueoTexto));

  for (const candidato of candidatos) {
    const fin = candidato && (candidato.finishReason ?? candidato.finish_reason);
    if (fin) motivos.push(String(fin));
    const finTexto = candidato && (candidato.finishMessage ?? candidato.finish_message);
    if (finTexto) motivos.push(String(finTexto));

    const valoraciones = (candidato && (candidato.safetyRatings ?? candidato.safety_ratings)) || [];
    for (const v of Array.isArray(valoraciones) ? valoraciones : []) {
      if (v && v.blocked) motivos.push(String(v.category ?? 'categoría sin nombre'));
    }

    // Si en vez de sonar ha escrito, lo que escribió explica por qué.
    const partes = Array.isArray(candidato && candidato.content && candidato.content.parts)
      ? candidato.content.parts
      : [];
    for (const parte of partes) {
      if (parte && typeof parte.text === 'string' && parte.text.trim()) motivos.push(parte.text.trim());
    }
  }

  const motivo = [...new Set(motivos.map((m) => m.trim()).filter(Boolean))].join(' · ');
  const porQue = motivo
    ? `Google dice, literalmente: «${recorte(motivo)}».`
    : 'Google no ha dicho por qué: ha contestado sin sonido y sin motivo.';

  return new ErrorDeCara(
    `El modelo «${modelo.id}» no ha devuelto ningún audio para ${deQuien}. ${porQue} Repetir tal ` +
    'cual da el mismo resultado: hay que cambiar lo que se le pide en datos/serie.json. El modelo ' +
    `no se sustituye por otro (se cambia a conciencia con la variable ${modelo.variable}).`,
    { detalle: comoTexto(respuesta), reintentable: false, http: 502 }
  );
}

/**
 * Deja el audio en WAV pase lo que pase: si ya viene envuelto se devuelve tal
 * cual, y si viene crudo se envuelve con el formato que declare el propio
 * mimeType («audio/L16;codec=pcm;rate=24000»).
 *
 * `hzPorDefecto` es el muestreo que se da por bueno cuando Google no lo dice.
 * Con la voz hay uno declarado en serie.json —PCM mono de 16 bits a 24 kHz— y
 * con la música no lo hay: ahí, antes que inventarse un número, se falla. Un
 * muestreo equivocado no suena mal, suena bien y dura otra cosa, y esa duración
 * es la que coloca la pieza en el montaje.
 */
function aWav(datos, mime, { hzPorDefecto, deQuien }) {
  if (datos.length === 0) {
    throw new ErrorDeCara(
      `Google ha contestado con ${deQuien} vacía: cero bytes de audio. Hay que volver a generarla.`,
      { reintentable: true, http: 502 }
    );
  }

  // Ya viene envuelto: no se toca. Volver a envolverlo dejaría dos cabeceras y
  // un chasquido al principio.
  if (datos.length >= 12 &&
      datos.toString('ascii', 0, 4) === 'RIFF' &&
      datos.toString('ascii', 8, 12) === 'WAVE') {
    return datos;
  }

  const formato = formatoDeMime(mime);

  const hz = formato.hz ?? hzPorDefecto;
  if (!hz) {
    throw new ErrorDeCara(
      `Google ha mandado ${deQuien} como audio crudo y sin decir a qué muestreo está grabada ` +
      `(su tipo es «${mime || 'ninguno'}»). Sin el muestreo no se puede saber cuánto dura, y esa ` +
      'duración es la que coloca la pieza en el montaje: darla por supuesta desplazaría todo lo ' +
      'que va detrás. No se inventa un número.',
      { detalle: `${datos.length} bytes de audio sin muestreo declarado`,
        reintentable: false, http: 502 }
    );
  }

  return envolverWav(datos, {
    hz,
    canales: formato.canales ?? CANALES_DE_LA_VOZ,
    bits: formato.bits ?? BITS_DE_LA_VOZ
  });
}

/** «audio/L16;codec=pcm;rate=24000;channels=2» → { hz, canales, bits }. */
function formatoDeMime(mime) {
  const texto = String(mime ?? '');

  const rate = /(?:^|[;\s])rate\s*=\s*(\d+)/i.exec(texto);
  const canales = /(?:^|[;\s])channels\s*=\s*(\d+)/i.exec(texto);
  const profundidad = /audio\/l(\d+)/i.exec(texto);

  return {
    hz: rate ? Number(rate[1]) : null,
    canales: canales ? Number(canales[1]) : null,
    bits: profundidad && BITS_ADMITIDOS.has(Number(profundidad[1])) ? Number(profundidad[1]) : null
  };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** Acepta Buffer, Uint8Array o ArrayBuffer. Cualquier otra cosa se explica. */
function aBuffer(datos, que) {
  if (Buffer.isBuffer(datos)) return datos;
  if (datos instanceof Uint8Array) return Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength);
  if (datos instanceof ArrayBuffer) return Buffer.from(datos);
  throw new ErrorDeCara(
    `No se ha recibido ${que} como archivo, sino otra cosa. Es un fallo del propio estudio, no de ` +
    'tu cuenta.',
    { reintentable: false, http: 500 }
  );
}

/** «78 segundos», «1 segundo», «78,5 segundos». Se escribe en español. */
function formatearSegundos(s) {
  const redondeado = Math.round(s * 10) / 10;
  const texto = Number.isInteger(redondeado)
    ? String(redondeado)
    : String(redondeado).replace('.', ',');
  return redondeado === 1 ? '1 segundo' : `${texto} segundos`;
}

/** «la madre», «la madre y Saharis», «la madre, Saharis y el celebrante». */
function listar(nombres) {
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** Los primeros bytes, legibles, para poder decir qué llegó cuando no era WAV. */
function asciiLegible(datos, cuantos) {
  const trozo = datos.subarray(0, Math.min(cuantos, datos.length));
  return [...trozo].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
}

/** La respuesta entera, para `detalle`, sin que un ciclo tumbe el error. */
function comoTexto(valor) {
  const vistos = new WeakSet();
  try {
    return JSON.stringify(valor, (_clave, v) => {
      if (v && typeof v === 'object') {
        if (vistos.has(v)) return '«ciclo»';
        vistos.add(v);
      }
      return v;
    }) ?? String(valor);
  } catch {
    return String(valor);
  }
}

function recorte(texto, maximo = 600) {
  const t = String(texto);
  return t.length <= maximo ? t : `${t.slice(0, maximo)}…`;
}

function primeraMayuscula(t) {
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}
