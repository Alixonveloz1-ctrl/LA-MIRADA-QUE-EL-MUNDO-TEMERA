// El modelo de texto. Es la única llamada del estudio que no dibuja ni suena.
//
// Hace tres cosas y ninguna más:
//
//   1. `generar()` — habla con el modelo de texto de `serie.modelos.texto` por
//      `:generateContent`. Con `json:true` pide `application/json` y devuelve el
//      objeto ya parseado; si lo que vuelve no es JSON, se dice con palabras y
//      el texto devuelto viaja literal en `.detalle`.
//   2. `traducirAJapones()` — la frase de muestra de un personaje está escrita
//      en español y el audio va en `ja-JP`. Se traduce UNA vez por personaje
//      (contrato §2, modo `voz-muestra`) y se guarda en el estado: si cada voz
//      candidata dijera una frase distinta no se podrían comparar, que es justo
//      para lo que existe esa pantalla.
//   3. `desglosarEscena()` — del guion a los planos. **Una llamada por escena**,
//      pequeña e independiente (contrato §13.3). Aquí no existe, ni va a
//      existir, `desglosarEpisodio()`: una llamada por episodio no cabe en la
//      ventana ni en los 60 s de la función, y cuando falla se pierden las 24
//      escenas en vez de una.
//
// POR QUÉ EL DESGLOSE VALIDA LO QUE LE DEVUELVEN, Y NO SE FÍA
// El usuario no aprueba planos: no es su trabajo y no tiene por qué saber de
// dirección (plan §7). Si nadie mira lo que propone el modelo, un `dur_gen` de 5
// segundos —que Veo no genera— o una `ref` a una placa que no existe no se
// descubren aquí, sino cuarenta planos más tarde, pagando cada fallo. Por eso lo
// que vuelve pasa por una lista de comprobaciones CON NOMBRE, y el nombre sale
// en el mensaje: así el fallo dice qué regla se rompió, en español, y no «el
// desglose no vale».
//
// Si la validación falla, se reintenta UNA vez diciéndole al modelo exactamente
// qué reglas rompió. Si vuelve a fallar, se lanza con la lista. El usuario no
// edita planos a mano: lo único que puede hacer es pedir otro desglose de esa
// escena, y eso es lo que dice el mensaje.
//
// FALTA EN EL CONTRATO: docs/contrato.md §6 dice que las reglas del desglose las
// comprueba `_lib/desglose.js`, pero §12 —que es la lista de firmas exactas— no
// declara ese módulo por ninguna parte y sí escribe
// `desglosarEscena(episodio, escena) → { planos:[...] } ya validado contra §6`.
// Se implementa aquí, que es donde §12 lo pone, y en un solo bloque marcado
// («Las comprobaciones») para que se pueda mover a `_lib/desglose.js` sin tocar
// nada más el día que se decida. Conviene arreglar esa discrepancia en §6.

import { ErrorDeCara } from './errores.js';
import { serie, escenaDeGuion, personajesDeEscena, nivelImagen, pieza } from './datos.js';
import { comprobarCupos } from './prompt.js';
import { entorno } from './entorno.js';
import { llamar, urlModelo, conGrafias, comoGrafia } from './vertex.js';

// Las únicas duraciones que genera Veo (contrato §6.3 y plan §5). 2 y 3 segundos
// no existen: por eso todo plano trae `dur_gen` y `recorte`. No sale de
// serie.json porque no es un dato de la serie, es un límite del modelo.
const DURACIONES_DE_GENERACION = [4, 6, 8];

// Ningún plano por encima de 8 s (contrato §6.2). Coincide con el `dur_gen`
// mayor, y aun así se comprueba aparte: son dos reglas distintas.
const DURACION_MAXIMA_S = 8;

// La media ronda los 3 segundos (contrato §6.2). «Ronda» necesita un margen
// escrito, o no se puede comprobar: por debajo de 2,2 la escena va picada como
// un tráiler y por encima de 4 se apalanca. Solo se mira a partir de tres
// planos: con uno o con dos la media es la propia duración, que ya está acotada
// por la regla de los 8 segundos, y exigirle además una media sería rechazar una
// conversación estática de un solo plano, que es justo lo que pide la regla 1.
const MEDIA_MINIMA_S = 2.2;
const MEDIA_MAXIMA_S = 4;
const PLANOS_PARA_MEDIR_LA_MEDIA = 3;

// Un plano con boca visible dura entre 2 y 4 segundos, nunca más (contrato §6.8
// y `serie.dialogo.gramatica_de_una_escena_hablada`).
const BOCA_MINIMO_S = 2;
const BOCA_MAXIMO_S = 4;

// Los tres niveles de Veo, escritos como los escribe serie.json (sin tilde).
const NIVELES_DE_VEO = ['calidad', 'medio', 'economico'];

// La traducción de una frase corta es una llamada pequeña, y `voz-muestra` tiene
// que traducir, sintetizar el audio y subirlo dentro de los 60 s de la función:
// se le da un límite propio más corto para que, si el modelo se cuelga, quede
// tiempo de explicarlo en pantalla en vez de morir en silencio.
// Traducir una línea con el modelo rápido son dos o tres segundos. Treinta es
// margen de sobra, y sigue dejando sitio para la síntesis de voz dentro de la
// misma petición, que es lo que de verdad tarda.
const LIMITE_TRADUCCION_MS = 30_000;

// Kana y kanji, por punto de código para que no dependa de cómo se guarde este
// archivo. Sirve para comprobar que lo que volvió es japonés de verdad y no una
// disculpa en español.
const HAY_JAPONES = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9d]/;

/**
 * \u00bfEsta frase est\u00e1 cortada? Empieza por puntos suspensivos, o acaba sin cerrar.
 *
 * No sirve para rechazarla \u2014el guion interrumpe a la gente a prop\u00f3sito y esas
 * l\u00edneas hay que decirlas igual\u2014 sino para poder EXPLICARLO cuando la traducci\u00f3n
 * falla: un texto cortado es lo que m\u00e1s veces hace que el modelo conteste una
 * nota en vez de traducir, y sin decirlo el mensaje no lleva a ninguna parte.
 *
 * @param {string} frase
 * @returns {boolean}
 */
function fraseCortada(frase) {
  const t = String(frase || '').trim();
  if (!t) return false;
  return /^[.\u2026]/.test(t) || !/[.!?\u2026\u00bb)"']$/.test(t);
}

// Lo que delata que un prompt de imagen o de vídeo NO está en inglés: letras
// acentuadas o eñes (español), signos de apertura, o kana y kanji. `imagen` y
// `video` son prompts para los modelos de imagen y de vídeo y van en inglés; el
// resto de campos son ids.
const NO_ES_INGLES = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]|[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

// La frase que se pide en el prompt de vídeo cuando la boca está en cuadro.
// Está escrita en `serie.dialogo.como_se_consigue`; esta constante es solo la red
// por debajo si ese texto cambiara de forma.
const FRASE_DE_BOCA_POR_DEFECTO = 'the mouth keeps moving for as long as the character is speaking';

// ---------------------------------------------------------------------------
// El modelo
// ---------------------------------------------------------------------------

/**
 * El modelo de texto, ya con la sustitución por `TEXTO_MODEL` aplicada. El id no
 * se escribe aquí: sale de `serie.modelos.texto` a través de `entorno()`.
 * @returns {{id:string, region:string, variable:string}}
 */
function modeloDeTexto() {
  const ent = entorno();
  const modelo = (ent.modelos || {}).texto;
  if (!modelo || !modelo.id) {
    throw new ErrorDeCara(
      'No hay ningún modelo de texto declarado. El desglose de guion a planos y la traducción ' +
      'de las frases de muestra son llamadas de texto, y el id de ese modelo sale de ' +
      '«modelos.texto» en datos/serie.json, nunca del código. Se puede poner uno a mano en la ' +
      'variable de entorno TEXTO_MODEL.',
      { reintentable: false, http: 500 }
    );
  }
  return modelo;
}

/**
 * El modelo rápido, para lo corto: traducir una línea al japonés.
 *
 * POR QUÉ HAY DOS Y NO UNO. Con uno solo, la traducción se hacía con el modelo
 * de razonamiento del desglose, y no cabía: la llamada se cortaba a los veinte
 * segundos y ese personaje se quedaba sin poder generar NI UNA voz, porque
 * traducir es el primer paso de todas. Un flash lo hace en dos segundos.
 *
 * Si el dato no declara uno rápido, `entorno()` cae al pro: peor, pero nunca sin
 * modelo.
 */
function modeloDeTextoRapido() {
  const ent = entorno();
  const modelo = (ent.modelos || {}).textoRapido || (ent.modelos || {}).texto;
  if (!modelo || !modelo.id) {
    throw new ErrorDeCara(
      'No hay ningún modelo de texto rápido declarado, ni uno normal al que caer. Sale de ' +
      '«modelos.texto_rapido» en datos/serie.json, y se puede poner uno a mano en la variable ' +
      'de entorno TEXTO_RAPIDO_MODEL.',
      { reintentable: false, http: 500 }
    );
  }
  return modelo;
}

// ---------------------------------------------------------------------------
// La llamada
// ---------------------------------------------------------------------------

/**
 * Le pide algo al modelo de texto.
 *
 * @param {string} prompt lo que se le pide, ya compuesto. Este módulo no sella
 *   nada: `estilo.bloque` describe cómo se DIBUJA un fotograma y esto es texto.
 * @param {{json?:boolean, limiteMs?:number}} [opciones]
 *   `json:true` pide `responseMimeType: "application/json"` y devuelve el objeto
 *   ya parseado. `limiteMs` acota la espera por debajo del límite de la
 *   plataforma; si no se dice, el de `vertex.js`.
 * @returns {Promise<string|object>} el texto tal cual, o el JSON parseado.
 */
export async function generar(prompt, { json = false, limiteMs, rapido = false } = {}) {
  const texto = String(prompt === null || prompt === undefined ? '' : prompt).trim();
  if (!texto) {
    throw new ErrorDeCara(
      'Se ha pedido una generación de texto sin decir qué se pide. El prompt lo compone la ' +
      'función a partir de datos/serie.json y datos/guiones.json, así que esto es un fallo del ' +
      'propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  // El pro para razonar —el desglose— y el flash para lo corto. Traducir una
  // línea con un modelo de razonamiento se comía los veinte segundos del límite
  // y dejaba al personaje sin poder generar ninguna voz.
  const modelo = rapido ? modeloDeTextoRapido() : modeloDeTexto();
  const ent = entorno();

  const cuerpo = {
    contents: [{ role: 'user', parts: [{ text: texto }] }],
    generationConfig: {
      // Sin esto el modelo contesta con el JSON envuelto en explicaciones o en
      // vallas de markdown, y el parseo se convierte en adivinar.
      responseMimeType: json ? 'application/json' : 'text/plain'
    }
  };

  // Por todas las grafías: el mismo modelo puede estar publicado con el nombre
  // de preview y con el definitivo, y cuál contesta depende del proyecto.
  const respuesta = await conGrafias(modelo, (id) =>
    llamar(urlModelo(comoGrafia(modelo, id), 'generateContent', ent.sa.project_id), cuerpo, {
      metodo: 'POST',
      limiteMs,
      contexto: {
        que: json ? 'pedir el desglose al modelo de texto' : 'pedir una respuesta al modelo de texto',
        modelo: id,
        region: comoGrafia(modelo, id).region,
        variable: modelo.variable
      }
    })
  );

  const devuelto = sacarTexto(respuesta, modelo);
  return json ? parsearJson(devuelto, respuesta, modelo) : devuelto;
}

/**
 * Junta el texto de todas las `parts` de la primera respuesta. Si no hay texto
 * —filtro de seguridad, respuesta cortada— se lanza con el motivo LITERAL de
 * Google, porque es lo único que dice qué hay que cambiar.
 * @param {object} respuesta
 * @param {{id:string, variable:string}} modelo
 * @returns {string}
 */
function sacarTexto(respuesta, modelo) {
  const candidatos = Array.isArray(respuesta?.candidates) ? respuesta.candidates : [];
  const trozos = [];

  for (const candidato of candidatos) {
    const partes = Array.isArray(candidato?.content?.parts) ? candidato.content.parts : [];
    for (const parte of partes) {
      // Un modelo que razona puede devolver además el resumen de su
      // razonamiento, marcado con `thought`. Eso no es la respuesta: si se
      // pegara delante, el JSON del desglose vendría con un ensayo encima.
      if (parte?.thought === true) continue;
      if (typeof parte?.text === 'string' && parte.text.trim()) trozos.push(parte.text);
    }
    // Con un solo candidato basta: `sampleCount` no se pide en texto, y juntar
    // dos respuestas distintas daría un JSON pegado a otro.
    if (trozos.length) break;
  }

  const texto = trozos.join('').trim();
  if (texto) return texto;

  throw new ErrorDeCara(
    `El modelo de texto «${modelo.id}» ha contestado sin decir nada: la respuesta no trae ` +
    `ni una línea de texto. ${porQueNoContesto(respuesta, candidatos)} ` +
    'Suele ser el filtro de seguridad, que en esta serie se dispara con la violencia de una ' +
    'escena o con la edad de un personaje. Repetir tal cual da el mismo resultado. El modelo no ' +
    `se sustituye por otro en silencio: se cambia a conciencia con la variable ${modelo.variable}.`,
    { detalle: comoTexto(respuesta), reintentable: false, http: 502 }
  );
}

/**
 * Por qué no contestó, con las palabras de Google y sin traducirlas.
 * @param {object} respuesta
 * @param {object[]} candidatos
 * @returns {string}
 */
function porQueNoContesto(respuesta, candidatos) {
  const motivos = [];

  const feedback = respuesta?.promptFeedback ?? respuesta?.prompt_feedback ?? null;
  for (const clave of ['blockReason', 'block_reason', 'blockReasonMessage', 'block_reason_message']) {
    if (feedback && feedback[clave]) motivos.push(String(feedback[clave]));
  }

  for (const candidato of candidatos) {
    for (const clave of ['finishReason', 'finish_reason', 'finishMessage', 'finish_message']) {
      if (candidato && candidato[clave]) motivos.push(String(candidato[clave]));
    }
    const valoraciones = candidato?.safetyRatings ?? candidato?.safety_ratings ?? [];
    for (const v of Array.isArray(valoraciones) ? valoraciones : []) {
      if (v?.blocked) motivos.push(String(v.category ?? 'una categoría sin nombre'));
    }
  }

  const motivo = [...new Set(motivos.map((m) => m.trim()).filter(Boolean))].join(' · ');
  return motivo
    ? `Google dice, literalmente: «${recorte(motivo, 400)}».`
    : 'Google no ha dicho por qué.';
}

/**
 * Parsea lo que se pidió como JSON.
 *
 * Con `responseMimeType: "application/json"` debería llegar limpio, así que la
 * recuperación se queda en lo que no es adivinar: quitar una valla de markdown
 * si viene, y quedarse con el objeto o la lista de fuera si el modelo escribió
 * algo antes o después. Si ni así, se dice con palabras que no es JSON y el
 * texto devuelto va entero en `detalle`, que es lo que permite ver qué escribió.
 *
 * @param {string} devuelto
 * @param {object} respuesta la respuesta entera, para explicar un corte
 * @param {{id:string}} modelo
 * @returns {object}
 */
function parsearJson(devuelto, respuesta, modelo) {
  for (const candidato of candidatosDeJson(devuelto)) {
    try {
      return JSON.parse(candidato);
    } catch {
      // Se prueba el siguiente. El fallo se explica abajo, una sola vez.
    }
  }

  throw new ErrorDeCara(
    `Se le ha pedido al modelo «${modelo.id}» que contestara en JSON y lo que ha devuelto no se ` +
    `puede leer como JSON. ${seCorto(respuesta)}Sin ese JSON no hay nada que usar, así que no se ` +
    'puede seguir. Debajo está, entero y sin tocar, lo que ha contestado.',
    { detalle: devuelto, reintentable: false, http: 502 }
  );
}

/**
 * Las formas en que se intenta leer el texto como JSON, de la más fiel a la más
 * indulgente.
 * @param {string} devuelto
 * @returns {string[]}
 */
function candidatosDeJson(devuelto) {
  const formas = [devuelto];

  // ```json … ```
  const valla = devuelto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (valla && valla[1].trim()) formas.push(valla[1].trim());

  // Lo que hay entre la primera llave (o corchete) y la última.
  for (const [abre, cierra] of [['{', '}'], ['[', ']']]) {
    const inicio = devuelto.indexOf(abre);
    const fin = devuelto.lastIndexOf(cierra);
    if (inicio !== -1 && fin > inicio) formas.push(devuelto.slice(inicio, fin + 1));
  }

  return [...new Set(formas.map((f) => f.trim()).filter(Boolean))];
}

/** Un JSON que no cierra suele ser un JSON al que le cortaron el final. */
function seCorto(respuesta) {
  const candidatos = Array.isArray(respuesta?.candidates) ? respuesta.candidates : [];
  const cortado = candidatos.some((c) => {
    const fin = String(c?.finishReason ?? c?.finish_reason ?? '').toUpperCase();
    return fin.includes('MAX_TOKENS');
  });
  return cortado
    ? 'La respuesta se ha quedado a medias: Google dice que llegó al máximo de texto que podía ' +
      'escribir, así que el JSON está cortado por donde le pilló. Si era un desglose, es una ' +
      'escena que pide demasiados planos. '
    : '';
}

// ---------------------------------------------------------------------------
// Traducir al japonés
// ---------------------------------------------------------------------------

/**
 * Traduce una frase del guion al japonés hablado, el que diría un actor.
 *
 * No es una traducción de diccionario: lo que se pronuncia tiene que sonar a
 * persona, con el registro que pide la intención —la misma intención con la que
 * se eligió la voz— y sin la rigidez del japonés escrito. Devuelve SOLO la
 * frase: ni comillas, ni romaji, ni explicación, porque lo que salga de aquí se
 * le da tal cual al modelo de voz.
 *
 * El japonés no aparece nunca en pantalla (plan §9): existe solo como audio.
 *
 * @param {string} textoEs la frase, en español.
 * @param {string} intencion cómo se dice, tal y como está escrita en el guion o
 *   en `voces.reparto[].muestra.intencion`.
 * @returns {Promise<string>} la frase en japonés.
 */
export async function traducirAJapones(textoEs, intencion) {
  const frase = String(textoEs === null || textoEs === undefined ? '' : textoEs).trim();
  if (!frase) {
    throw new ErrorDeCara(
      'Se ha pedido traducir al japonés una frase vacía. Las frases de muestra están en ' +
      '«voces.reparto[].muestra.texto» de datos/serie.json y las líneas de diálogo en ' +
      'datos/guiones.json; si una está vacía, el dato es el que falta.',
      { reintentable: false, http: 500 }
    );
  }

  const comoSeDice = String(intencion === null || intencion === undefined ? '' : intencion).trim();

  const prompt = [
    'Traduce al japonés esta frase de un guion de animé para adultos. La va a decir un actor en ' +
    'voz alta, así que tiene que ser japonés HABLADO y natural, el que diría una persona en esa ' +
    'situación, no japonés escrito ni traducción literal.',
    '',
    `Frase, en español: ${frase}`,
    comoSeDice
      ? `Cómo se dice: ${comoSeDice}. Conserva ese registro: el nivel de cortesía, el tono y la ` +
        'distancia entre quien habla y quien escucha tienen que ser los de esa intención.'
      : 'No lleva intención escrita: dila en el registro contenido de la serie, en voz baja y sin ' +
        'subrayar nada.',
    '',
    // LAS LÍNEAS CORTADAS SON DEL GUION, NO UN DATO ROTO. Este animé interrumpe
    // a la gente a media frase —«...trescientos carros. Trescientos. Con la
    // nieve hasta la rodilla y sin un solo»— y eso es la escena, no un error.
    // Sin decírselo, el modelo contesta una nota avisando de que la frase está
    // incompleta en vez de traducirla, la comprobación de «esto no está en
    // japonés» salta, y el personaje entero se queda sin poder generar NADA:
    // ni su muestra de voz ni sus líneas, porque la traducción es el primer
    // paso de todas.
    'La frase puede estar cortada, empezar por puntos suspensivos o terminar a media palabra: en ' +
    'el guion interrumpen a quien habla. Si es así, tradúcela cortada igual, con la misma ' +
    'interrupción y en el mismo punto. NO la completes, no la cierres, no adivines cómo seguía y ' +
    'no avises de que está incompleta: esa interrupción es la escena.',
    '',
    'Devuelve SOLO la frase en japonés, en una línea. Sin comillas, sin romaji, sin la frase en ' +
    'español, sin explicación, sin alternativas y sin ninguna nota.'
  ].join('\n');

  const devuelto = await generar(prompt, { json: false, limiteMs: LIMITE_TRADUCCION_MS, rapido: true });
  const japones = soloLaFrase(devuelto);

  if (!japones) {
    throw new ErrorDeCara(
      `El modelo de texto ha contestado a la traducción de «${frase}», pero no ha devuelto ` +
      'ninguna frase que se pueda decir. Sin japonés no hay nada que pronunciar. Debajo está, ' +
      'sin tocar, lo que ha contestado.',
      { detalle: devuelto, reintentable: true, http: 502 }
    );
  }

  if (!HAY_JAPONES.test(japones)) {
    throw new ErrorDeCara(
      `Lo que ha devuelto el modelo al traducir «${frase}» no está en japonés: no lleva ni un ` +
      'kana ni un kanji. Se le ha pedido la frase y ha contestado otra cosa. ' +
      (fraseCortada(frase)
        ? 'Y esta frase está CORTADA —empieza por puntos suspensivos o acaba a media frase—, que ' +
          'es lo que más veces hace que el modelo conteste una nota en vez de traducir. Se le ' +
          'pide expresamente que la traduzca cortada igual, pero si insiste, lo que hay que ' +
          'cambiar es la frase de muestra de ese personaje en datos/serie.json por una entera. '
        : '') +
      'Debajo está, sin tocar, lo que ha contestado. Se puede volver a intentar.',
      { detalle: devuelto, reintentable: true, http: 502 }
    );
  }

  return japones;
}

/**
 * Deja la frase sola: la primera línea con contenido, sin la etiqueta que el
 * modelo a veces pone delante («Japonés:») y sin las comillas de ningún idioma.
 * @param {string} devuelto
 * @returns {string}
 */
function soloLaFrase(devuelto) {
  const lineas = String(devuelto)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lineas.length) return '';

  let frase = lineas[0].replace(/^[^:：]{0,20}[:：]\s*/, (etiqueta) =>
    // Solo se quita si la etiqueta no lleva japonés dentro: «見つからないで：» es
    // parte de la frase, «Japonés:» no lo es.
    (HAY_JAPONES.test(etiqueta) ? etiqueta : ''));

  frase = frase.trim();

  // Comillas de todos los sitios: latinas, angulares, japonesas y rectas.
  const pares = [['«', '»'], ['"', '"'], ["'", "'"], ['“', '”'], ['「', '」'], ['『', '』']];
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const [abre, cierra] of pares) {
      if (frase.length > 1 && frase.startsWith(abre) && frase.endsWith(cierra)) {
        frase = frase.slice(abre.length, frase.length - cierra.length).trim();
        cambio = true;
      }
    }
  }

  return frase;
}

// ---------------------------------------------------------------------------
// El desglose: del guion a los planos
// ---------------------------------------------------------------------------

/**
 * Propone los planos de UNA escena del guion.
 *
 * Una llamada de texto por escena, pequeña e independiente: son 24 por episodio
 * y 289 en toda la serie. Esto no es una preferencia de rendimiento y no se
 * optimiza (contrato §13.3): una llamada por episodio no cabe en la ventana ni
 * en los 60 s de la función, y cuando falla se pierden las 24 escenas.
 *
 * Lo que vuelve se valida contra las reglas de §6 y se RECHAZA si no cumple,
 * diciendo qué regla se rompió. Si falla, se reintenta una vez pasándole al
 * modelo la lista de reglas rotas; si vuelve a fallar, se lanza con esa lista.
 *
 * @param {number|string} episodio
 * @param {string|number} escena el id de escena tal y como lo escribe el guion.
 * @returns {Promise<{planos:object[]}>} los planos ya validados.
 */
export async function desglosarEscena(episodio, escena) {
  const contexto = contextoDeLaEscena(episodio, escena);
  const encargo = promptDeDesglose(contexto);

  let devuelto = null;
  let quejas = [];

  for (let intento = 1; intento <= 2; intento += 1) {
    const prompt = intento === 1 ? encargo : conLasReglasRotas(encargo, quejas, devuelto);
    devuelto = await generar(prompt, { json: true });

    const revision = revisar(devuelto, contexto);
    if (!revision.quejas.length) return { planos: revision.planos };
    quejas = revision.quejas;
  }

  throw new ErrorDeCara(
    `El desglose de la escena ${contexto.escena} del episodio ${contexto.episodio} ha vuelto mal ` +
    'dos veces seguidas: el modelo ha propuesto planos que rompen las reglas del desglose, y se ' +
    'le ha dicho cuáles antes de la segunda. Estas se han quedado rotas:\n' +
    listaDeQuejas(quejas) +
    '\nNo se escribe nada: una escena mal desglosada estropearía los planos de toda la pieza. ' +
    'Vuelve a pedir el desglose de esta escena; si sale mal siempre, lo que hay que mirar es la ' +
    'escena en datos/guiones.json.',
    { detalle: comoTexto(devuelto), reintentable: false, http: 502 }
  );
}

/**
 * Todo lo que hace falta saber de la escena para pedir su desglose y para
 * comprobarlo después. Se prepara una sola vez: el prompt y la validación tienen
 * que mirar exactamente los mismos datos, o se rechazaría lo que se pidió.
 *
 * @param {number|string} episodio
 * @param {string|number} escena
 * @returns {object}
 */
function contextoDeLaEscena(episodio, escena) {
  const laEscena = escenaDeGuion(episodio, escena);
  const idEscena = String(laEscena.escena);

  const escenarios = (serie.escenarios && serie.escenarios.placas) || [];
  const idEscenario = String(laEscena.escenario || '').trim();
  const elEscenario = escenarios.find((e) => e.id === idEscenario);
  if (!elEscenario) {
    throw new ErrorDeCara(
      `La escena ${idEscena} del episodio ${episodio} dice que ocurre en el escenario ` +
      `«${idEscenario || '(ninguno)'}», y ese escenario no está en el banco de escenarios de ` +
      'datos/serie.json. Todo plano tiene escenario y ese escenario tiene que existir, así que ' +
      'no se puede desglosar esta escena hasta que el dato cuadre. Los escenarios que hay son: ' +
      `${escenarios.map((e) => e.id).join(', ') || 'ninguno'}.`,
      { reintentable: false, http: 500 }
    );
  }

  const luces = serie.luces || {};
  const clave = String(laEscena.luz || '').trim();
  const descripcionDeLuz = luces[clave];
  if (typeof descripcionDeLuz !== 'string' || !descripcionDeLuz.trim()) {
    throw new ErrorDeCara(
      `La escena ${idEscena} del episodio ${episodio} pide la luz «${clave || '(ninguna)'}», que ` +
      'no está escrita en la sección «luces» de datos/serie.json. Sin su luz no se puede componer ' +
      `el prompt de ningún plano. Las luces que hay son: ${Object.keys(luces).join(', ') || 'ninguna'}.`,
      { reintentable: false, http: 500 }
    );
  }

  const personajes = personajesDeEscena(laEscena);

  return {
    episodio: Number(laEscena.episodio ?? episodio) || episodio,
    escena: idEscena,
    lugar: String(laEscena.lugar || '').trim(),
    momento: String(laEscena.momento || '').trim(),
    flashback: laEscena.flashback === true,
    accion: String(laEscena.accion || '').trim(),
    dialogo: Array.isArray(laEscena.dialogo) ? laEscena.dialogo : [],
    personajes,
    escenario: elEscenario,
    luz: clave,
    descripcionDeLuz: descripcionDeLuz.trim(),
    placas: placasDeLaEscena(personajes),
    archivo: archivoDeLaEscena(idEscenario, clave)
  };
}

/**
 * Los planos de archivo que sirven para esta escena: los de su escenario y su
 * misma luz.
 *
 * El archivo son planos de ambiente generados UNA vez para toda la temporada. La
 * cripta sale en 24 escenas de 8 episodios: si cada una encarga su propio plano
 * general de la cripta, se pagan 24 veces lo mismo. Ofrecérselos aquí al modelo
 * es lo único que hace que el ahorro exista de verdad — un archivo que el
 * desglose no conoce es una biblioteca que nadie abre.
 *
 * Se filtra por LUZ además de por escenario: el mismo sitio de día y de noche no
 * es el mismo plano, y colar uno por otro se ve en pantalla.
 *
 * @param {string} idEscenario
 * @param {string} luz
 * @returns {object[]} los planos de archivo tal cual están en serie.json
 */
function archivoDeLaEscena(idEscenario, luz) {
  const piezas = serie.piezas || {};
  const laPieza = Object.values(piezas).find((una) => una && una.archivo === true);
  const tomas = (laPieza && Array.isArray(laPieza.tomas) && laPieza.tomas) || [];
  return tomas.filter((una) => una && una.escenario === idEscenario && una.luz === luz);
}

/**
 * Las placas del banco que esta escena puede usar como referencia.
 *
 * Se ofrecen las de cada personaje de la escena y las de sus otras EDADES, que
 * en el banco son personajes distintos encadenados al mismo ancla de linaje
 * («saharis» → «saharis-5», «saharis-10», «saharis-bebe»…). En un flashback la
 * placa correcta es la de la edad, no la del adulto.
 *
 * El modelo solo puede proponer refs de esta lista, y la validación lo comprueba:
 * es la única forma de que las referencias que proponga existan de verdad y no
 * haya que descubrirlo al generar el keyframe.
 *
 * @param {string[]} personajes ids tal y como los nombra el guion.
 * @returns {object[]} las placas tal cual están en serie.json.
 */
function placasDeLaEscena(personajes) {
  const todas = (serie.banco && serie.banco.placas) || [];
  const elegidas = [];
  for (const id of personajes) {
    for (const placa of todas) {
      const suya = placa.personaje === id || String(placa.personaje).startsWith(`${id}-`);
      if (suya && !elegidas.includes(placa)) elegidas.push(placa);
    }
  }
  return elegidas;
}

// ---------------------------------------------------------------------------
// El encargo que se le manda al modelo
// ---------------------------------------------------------------------------

// Las reglas del desglose, copiadas de docs/contrato.md §6 y escritas en el
// prompt a propósito: el modelo tiene que verlas, no cumplirlas por casualidad.
// Están en el mismo orden que en el contrato para poder cotejarlas de un vistazo.
const REGLAS_DEL_DESGLOSE = [
  'Una conversación estática es UN plano. Se abren dos o tres solo cuando hay beats visuales de ' +
  'verdad distintos. Un cambio de ángulo NO es un beat.',

  'La duración media de los planos de la escena ronda los 3 segundos. Ningún plano pasa de 8.',

  '«dur_gen» solo puede ser 4, 6 u 8: son las únicas duraciones que genera el modelo de vídeo. ' +
  '«recorte» es siempre [0, dur], y «dur» nunca es mayor que «dur_gen».',

  'Si «encadena_con» no es null, el plano se usa entero: «dur» tiene que ser igual a «dur_gen», ' +
  'o la interpolación no llega al corte. Solo se encadena con el plano SIGUIENTE de la lista, y ' +
  'solo cuando la acción continúa sin corte, porque el último fotograma de este plano es la ' +
  'primera imagen del siguiente.',

  'Nivel de vídeo: «economico» para ambiente y para cámara sobre fondo; «medio» para personaje ' +
  'con movimiento contenido; «calidad» solo para los planos que sostienen la escena.',

  'Regla de la boca: ninguna línea de voz puede sonar sobre un plano en el que se vea la boca ' +
  'quieta de quien habla. Por eso, cuando pongas «boca_visible», el campo «video» tiene que ' +
  'pedir el movimiento de la boca explícitamente y con la palabra «mouth» dentro.',

  'De cada intercambio hablado, solo uno o dos planos muestran la boca; el resto van sobre la ' +
  'reacción del que escucha, sobre manos, nucas, escorzos o planos generales.',

  'Un plano con boca visible dura entre 2 y 4 segundos. Nunca más.',

  'Todo plano lleva el escenario canónico de la escena y su luz, los dos tal y como se dan más ' +
  'arriba. Toda «ref» sale de la lista de placas de más arriba y de ningún otro sitio.',

  'Los planos van en el orden en que se ven, sin huecos y sin solapes: la escena se lee seguida ' +
  'de arriba abajo.'
];

/**
 * El encargo completo de una escena: la escena, sus placas, las reglas y la
 * forma exacta de lo que tiene que devolver.
 * @param {object} ctx
 * @returns {string}
 */
function promptDeDesglose(ctx) {
  return [
    'Eres el director y el montador de un animé seinen para adultos. Te dan UNA escena del guion, ' +
    'ya escrita, y tu único trabajo es decidir con qué planos se rueda: cuántos, qué se ve en ' +
    'cada uno, qué se mueve, cuánto dura, con qué nivel de vídeo se genera y qué placas del banco ' +
    'necesita como referencia.\n' +
    'No reescribes el guion, no añades acción que no esté escrita y no propones nada de otra ' +
    'escena. Contestas con el JSON que se te pide y nada más.',

    bloque('LA ESCENA', laEscenaEnPalabras(ctx)),
    bloque('LAS PLACAS DEL BANCO QUE PUEDES USAR EN «refs»', lasPlacasEnPalabras(ctx)),
    bloque('EL ARCHIVO: PLANOS DE AMBIENTE QUE YA ESTÁN HECHOS', elArchivoEnPalabras(ctx)),
    bloque('CÓMO SE MONTA UNA ESCENA HABLADA EN ESTE ANIMÉ', laGramaticaDelDialogo()),
    bloque('LAS REGLAS DEL DESGLOSE', numerada(REGLAS_DEL_DESGLOSE) +
      '\nSe comprueban una a una sobre lo que devuelvas. Si se rompe cualquiera, el desglose ' +
      'entero se rechaza y hay que repetirlo.'),
    bloque('LO QUE TIENES QUE DEVOLVER', loQueSeEspera(ctx))
  ].join('\n\n');
}

/** La escena tal y como está escrita, sin resumir. */
function laEscenaEnPalabras(ctx) {
  const lineas = [
    `Episodio ${ctx.episodio}, escena ${ctx.escena}.`,
    `Lugar: ${ctx.lugar || 'sin escribir'}. Momento: ${ctx.momento || 'sin escribir'}. ` +
    `${ctx.flashback ? 'Es un FLASHBACK.' : 'No es un flashback: es presente.'}`,
    '',
    `Escenario canónico, obligatorio en todos los planos: «${ctx.escenario.id}».`,
    `  Es: ${ctx.escenario.descripcion || 'sin descripción escrita'}`,
    `Luz canónica, obligatoria en todos los planos: «${ctx.luz}».`,
    `  Es: ${ctx.descripcionDeLuz}`,
    '',
    `Quién sale: ${ctx.personajes.join(', ') || 'nadie nombrado'}.`,
    '',
    'Acción:',
    ctx.accion || '(la escena no trae acción escrita)'
  ];

  if (ctx.dialogo.length) {
    lineas.push('', `Diálogo (${ctx.dialogo.length} ${ctx.dialogo.length === 1 ? 'línea' : 'líneas'}), en orden:`);
    ctx.dialogo.forEach((linea, i) => {
      const quien = String(linea.quien || linea.etiqueta || 'sin nombre');
      const intencion = String(linea.intencion || '').trim();
      const riesgo = String(linea.riesgo || '').trim().toLowerCase() === 'alto';
      lineas.push(
        `${i + 1}. ${quien}: «${String(linea.texto || '').trim()}»` +
        (intencion ? `\n   Intención: ${intencion}.` : '') +
        (riesgo
          ? '\n   Riesgo alto: es un grito o un llanto sostenido, y ningún sintetizador de voz ' +
            'llega ahí. Esta línea NO se resuelve con la boca en cuadro: se resuelve fuera de ' +
            'cuadro, tapada, o cortando sobre la cara de quien escucha.'
          : '')
      );
    });
  } else {
    lineas.push('', 'Diálogo: ninguno. En esta escena no habla nadie, así que ningún plano puede ' +
      'llevar «boca_visible».');
  }

  return lineas.join('\n');
}

/**
 * El archivo, dicho al modelo. Es lo que convierte el ahorro en real: sin esta
 * lista delante, propondría un plano general nuevo para cada escena y las 24
 * escenas de la cripta pagarían 24 criptas.
 */
function elArchivoEnPalabras(ctx) {
  if (!ctx.archivo.length) {
    return 'No hay planos de archivo para este escenario con esta luz. Todos los planos de esta ' +
      'escena se describen enteros, con su «imagen» y su «video», y ninguno lleva «de_archivo».';
  }

  const filas = ctx.archivo.map(
    (plano) =>
      `- «${plano.id}» — ${plano.dur} s\n` +
      `  Se ve: ${plano.imagen}\n` +
      `  Se mueve: ${plano.video}\n` +
      `  Está pensado para: ${plano.uso || 'sin escribir'}`
  );

  return [
    'Estos planos de ambiente YA ESTÁN GENERADOS y pagados. Son de este mismo escenario y de ' +
    'esta misma luz, y se reutilizan en los doce episodios: usarlos no cuesta nada y describir ' +
    'uno nuevo que enseñe lo mismo cuesta un vídeo entero.',
    '',
    filas.join('\n'),
    '',
    'ÚSALOS siempre que el plano que ibas a proponer sea sitio y nada más: el plano de llegada ' +
    'con el que se abre la escena, un corte de respiro entre dos frases, un puente entre dos ' +
    'momentos. Para usar uno, el plano que devuelvas lleva «de_archivo» con su id, y entonces ' +
    '«imagen» y «video» van vacíos —la cadena vacía—, «refs» va vacío y «boca_visible» va null: ' +
    'no se describe lo que ya está hecho.',
    '',
    'NO los uses cuando en el plano tenga que verse alguien, cuando ocurra algo de la acción de ' +
    'la escena, o cuando el plano tenga que decir algo concreto de ESTE momento. Un plano de ' +
    'archivo sale en varios episodios: lo que pase dentro, pasa en todos.'
  ].join('\n');
}

/** La lista de placas disponibles, que es lo que hace que las refs existan. */
function lasPlacasEnPalabras(ctx) {
  if (!ctx.placas.length) {
    return 'No hay ninguna placa en el banco para los personajes de esta escena. Todos los planos ' +
      'van con «refs»: [] — la lista vacía. No te inventes ningún id.';
  }

  const filas = ctx.placas.map((placa) => {
    const marcas = [];
    if (placa.ancla === true) marcas.push('es el ancla del personaje');
    if (placa.detalle === true) {
      marcas.push('placa de detalle: solo manos, nuca o espalda, sin cara en cuadro');
    }
    if (!ctx.personajes.includes(placa.personaje)) {
      marcas.push('el mismo personaje a otra edad');
    }
    return `- «${placa.id}» — personaje «${placa.personaje}», luz ${placa.luz}` +
      (marcas.length ? ` (${marcas.join('; ')})` : '') +
      `\n  Encuadre de la placa: ${placa.encuadre || 'sin escribir'}`;
  });

  // Quién sale en la escena y todavía no tiene ninguna placa en el banco: los
  // figurantes, casi siempre. No es un error y no hay que inventarles un id: sus
  // planos van con la lista de referencias vacía y se dibujan desde el prompt.
  const conPlaca = new Set(ctx.placas.map((p) => p.personaje));
  const sinPlaca = ctx.personajes.filter(
    (p) => !conPlaca.has(p) && ![...conPlaca].some((c) => c.startsWith(`${p}-`))
  );

  return [
    'Estas y ninguna más. Una «ref» que no esté en esta lista no existe en el banco, y el ' +
    'desglose entero se rechaza.',
    '',
    filas.join('\n'),
    '',
    'Un personaje cuyo id lleva detrás un número o «bebe» es el MISMO personaje a otra edad. Todas ' +
    'esas placas encadenan al mismo ancla, así que son la misma persona.',
    ctx.flashback
      ? 'Esta escena es un FLASHBACK: elige la placa de la edad que dice el guion, no la del adulto.'
      : 'Esta escena NO es un flashback, es presente: usa las placas del personaje adulto y no las ' +
        'de sus otras edades.',
    'Elige la placa cuya luz coincida con la de la escena cuando la haya, y el ancla cuando no.',
    'Las placas de detalle son las que hacen posible la regla de la boca: son los planos de manos, ' +
    'de nuca y de espalda sobre los que va el resto de un intercambio hablado.',
    sinPlaca.length
      ? `De esta escena no tienen placa en el banco: ${sinPlaca.join(', ')}. No te inventes un id ` +
        'para ellos: los planos donde salgan van con «refs»: [] y se dibujan desde lo que escribas ' +
        'en «imagen».'
      : null,
    'Un plano donde no se reconozca a nadie —un techo, una gota de agua, una pared— va con ' +
    '«refs»: [].'
  ].filter((l) => l !== null).join('\n');
}

/**
 * La gramática de una escena hablada, leída de `serie.dialogo`. Se lee del dato
 * y no se escribe aquí para que no haya dos versiones de la misma regla.
 */
function laGramaticaDelDialogo() {
  const dialogo = serie.dialogo || {};
  const lineas = [];

  if (typeof dialogo.regla_dura === 'string' && dialogo.regla_dura.trim()) {
    lineas.push(dialogo.regla_dura.trim());
  }

  const gramatica = Array.isArray(dialogo.gramatica_de_una_escena_hablada)
    ? dialogo.gramatica_de_una_escena_hablada.filter((g) => typeof g === 'string' && g.trim())
    : [];
  if (gramatica.length) {
    lineas.push('', ...gramatica.map((g) => `- ${g.trim()}`));
  }

  if (typeof dialogo.duracion === 'string' && dialogo.duracion.trim()) {
    lineas.push('', dialogo.duracion.trim());
  }

  lineas.push(
    '',
    'Cuando un plano lleve «boca_visible», su «video» tiene que pedir el movimiento así, en ' +
    `inglés: «${fraseDeBocaEnMovimiento()}».`
  );

  return lineas.join('\n');
}

/** La frase inglesa que pide la boca en movimiento, leída de serie.json. */
function fraseDeBocaEnMovimiento() {
  const dicho = (serie.dialogo || {}).como_se_consigue;
  const entrecomillada = typeof dicho === 'string' ? dicho.match(/'([^']{10,})'/) : null;
  return entrecomillada ? entrecomillada[1] : FRASE_DE_BOCA_POR_DEFECTO;
}

/** La forma exacta de la respuesta, campo por campo. */
function loQueSeEspera(ctx) {
  // El ejemplo enseña la FORMA, no una propuesta: por eso lleva la boca a null y
  // una sola referencia. Si trajera un plano completo, saldría copiado.
  const primera = ctx.placas.length ? `["${ctx.placas[0].id}"]` : '[]';

  const ejemplo = [
    '{',
    '  "planos": [',
    '    {',
    `      "id": "${ctx.escena}-1",`,
    '      "imagen": "<EN INGLÉS: qué se ve en el fotograma, una o dos frases>",',
    '      "video": "<EN INGLÉS: qué se mueve durante el plano y qué hace la cámara>",',
    '      "dur": 3,',
    '      "dur_gen": 4,',
    '      "recorte": [0, 3],',
    '      "veo": "medio",',
    `      "luz": "${ctx.luz}",`,
    `      "escenario": "${ctx.escenario.id}",`,
    `      "refs": ${primera},`,
    '      "boca_visible": null,',
    '      "encadena_con": null,',
    '      "de_archivo": null',
    '    }',
    '  ]',
    '}'
  ].join('\n');

  return [
    'Un único objeto JSON con una clave, «planos», que es la lista de los planos de esta escena ' +
    'en el orden en que se ven. Nada más: ni texto antes, ni texto después, ni comentarios.',
    '',
    ejemplo,
    '',
    'Campo por campo:',
    `- «id»: «${ctx.escena}-1», «${ctx.escena}-2», «${ctx.escena}-3»… El número de escena, un ` +
    'guion y el orden del plano empezando por 1, sin saltarse ninguno.',
    '- «imagen»: EN INGLÉS. El fotograma quieto del que arranca el plano: encuadre, qué hay en ' +
    'cuadro y desde dónde se mira. No escribas el estilo visual ni el negativo: se pegan después, ' +
    'siempre igual, y si los escribes tú se pegarían dos veces.',
    '- «video»: EN INGLÉS. Qué se mueve durante esos segundos y qué hace la cámara. Movimiento ' +
    'contenido: en este animé la cámara casi nunca corre.',
    '- «dur»: segundos que dura el plano en el montaje.',
    '- «dur_gen»: 4, 6 u 8. Nada más.',
    '- «recorte»: [0, dur].',
    `- «veo»: «${NIVELES_DE_VEO.join('», «')}».`,
    `- «luz»: siempre «${ctx.luz}».`,
    `- «escenario»: siempre «${ctx.escenario.id}».`,
    '- «refs»: ids de placas de la lista de arriba, o [] si no se reconoce a nadie en cuadro.',
    `- «boca_visible»: null, o el id del personaje cuya boca se ve en cuadro. Solo puede ser uno ` +
    `de estos: ${ctx.personajes.map((p) => `«${p}»`).join(', ') || 'ninguno, porque no sale nadie'}.`,
    '- «encadena_con»: null, o el id del plano SIGUIENTE cuando la acción continúa sin corte.',
    '- «de_archivo»: null casi siempre. Si este plano es uno de los del archivo, aquí va su id, ' +
    'y entonces «imagen» y «video» van vacíos, «refs» vacío y «boca_visible» null.',
    '',
    'Todo lo que no sea «imagen» y «video» son identificadores: van tal cual, sin traducir.'
  ].join('\n');
}

/** Un bloque con su título, para que el prompt se lea de un vistazo. */
function bloque(titulo, cuerpo) {
  return `== ${titulo} ==\n${cuerpo}`;
}

/** Una lista numerada, del 1 en adelante. */
function numerada(lista) {
  return lista.map((linea, i) => `${i + 1}. ${linea}`).join('\n');
}

/**
 * El segundo intento: el mismo encargo, y detrás lo que rompió el primero.
 * Se le devuelve también su propia respuesta, porque corregir es más fácil que
 * empezar de cero y porque así se ve que se le está hablando de LO SUYO.
 * @param {string} encargo
 * @param {{regla:string, queja:string}[]} quejas
 * @param {*} devuelto
 * @returns {string}
 */
function conLasReglasRotas(encargo, quejas, devuelto) {
  return [
    encargo,
    '',
    bloque('EL INTENTO ANTERIOR SE HA RECHAZADO', [
      'Esto es lo que devolviste:',
      '',
      recorte(comoTexto(devuelto), 6000),
      '',
      'Y estas son las reglas que rompía. Cada línea dice qué comprobación falló y por qué:',
      '',
      listaDeQuejas(quejas),
      '',
      'Devuelve el desglose ENTERO otra vez, corregido y con la misma forma de siempre. No ' +
      'expliques los cambios: solo el JSON.'
    ].join('\n'))
  ].join('\n\n');
}

/** Las quejas, una por línea, con el nombre de la comprobación delante. */
function listaDeQuejas(quejas) {
  return quejas.map((q) => `  · ${q.regla}: ${q.queja}`).join('\n');
}

// ---------------------------------------------------------------------------
// Las comprobaciones
//
// Cada una tiene NOMBRE, y ese nombre es el que sale en el mensaje: así el fallo
// dice qué regla se rompió y no «el desglose no vale». Se ejecutan todas —no se
// para en la primera— porque el reintento tiene que llevar la lista completa; si
// solo se dijera la primera, el segundo intento arreglaría una y rompería otra.
//
// DOS REGLAS DE §6 NO SE PUEDEN COMPROBAR AQUÍ, y no es un olvido:
//   · §6.6 en su forma exacta («ninguna línea de voz se solapa con un plano cuya
//     boca_visible sea quien habla») necesita la línea de tiempo de la pieza, y
//     al desglosar una escena todavía no existe: los planos no tienen segundo de
//     entrada hasta que se escriben en la pieza. Lo que sí se puede exigir es el
//     lado seguro de esa regla, y se exige: si un plano declara boca visible, su
//     «video» pide el movimiento de la boca. Así la regla no se puede romper
//     después, sea cual sea el reparto de tiempos.
//   · §6.10 («la línea de tiempo no tiene huecos ni solapes») es de la pieza
//     entera, no de una escena suelta.
// Las dos las comprueba `herramientas/invariantes.mjs` sobre lo ya escrito.
// ---------------------------------------------------------------------------

const COMPROBACIONES = [
  {
    // UN PLANO DE ARCHIVO ES UN PUNTERO, NO UNA DESCRIPCIÓN.
    //
    // Aquí se vigilan dos maneras de equivocarse que cuestan dinero de verdad.
    // La primera: inventarse un id de archivo que no existe, y entonces el
    // episodio se monta con un hueco donde tenía que ir un plano. La segunda,
    // más callada: apuntar al archivo Y describir el plano igualmente, con lo
    // que alguien acabaría generando la descripción sin darse cuenta de que ese
    // material ya estaba hecho. Y la tercera, la peor: meter un personaje o una
    // boca en un plano que va a salir en cuatro episodios.
    nombre: 'el-archivo-se-usa-como-puntero',
    revisar(planos, ctx) {
      const quejas = [];
      const permitidos = new Set(ctx.archivo.map((una) => una.id));

      for (const plano of planos) {
        if (!plano.de_archivo) continue;

        if (!permitidos.has(plano.de_archivo)) {
          quejas.push(
            `el plano ${plano.id} dice usar «${plano.de_archivo}» del archivo, y ese plano no ` +
            `está entre los que sirven para este escenario y esta luz. Los que hay son: ` +
            `${[...permitidos].join(', ') || 'ninguno, así que ningún plano puede llevar «de_archivo»'}.`
          );
          continue;
        }

        if (plano.imagen || plano.video) {
          quejas.push(
            `el plano ${plano.id} usa «${plano.de_archivo}» del archivo y además lo describe. Un ` +
            'plano de archivo ya está generado: «imagen» y «video» van vacíos, o alguien acabaría ' +
            'pagando otra vez lo que ya está hecho.'
          );
        }

        if (Array.isArray(plano.refs) && plano.refs.length) {
          quejas.push(
            `el plano ${plano.id} usa «${plano.de_archivo}» del archivo y lleva referencias de ` +
            'personaje. Un plano de archivo sale en varios episodios: quien esté dentro, sale en ' +
            'todos. Si en este plano tiene que verse alguien, descríbelo entero y no uses el archivo.'
          );
        }

        if (plano.boca_visible) {
          quejas.push(
            `el plano ${plano.id} usa «${plano.de_archivo}» del archivo y declara boca visible. En ` +
            'un plano de archivo no hay nadie hablando.'
          );
        }

        if (plano.encadena_con) {
          quejas.push(
            `el plano ${plano.id} usa «${plano.de_archivo}» del archivo y encadena con ` +
            `${plano.encadena_con}. Encadenar interpola hacia el keyframe del siguiente, y un ` +
            'plano de archivo es el mismo en todos los episodios: no puede llevar a ningún sitio ' +
            'concreto.'
          );
        }

        // NO SE PUEDE CORTAR MÁS PELÍCULA DE LA QUE HAY.
        //
        // El clip del archivo dura lo que dura. Si aquí se pidieran ocho
        // segundos de un clip de cuatro, el montaje encargaría un tramo que no
        // existe y el episodio saldría con un salto justo donde debería haber
        // aire. Usar MENOS sí vale: coger dos segundos de un plano de cuatro es
        // montar, y no cuesta nada.
        const original = ctx.archivo.find((una) => una.id === plano.de_archivo);
        const cabe = Number(original && original.dur);
        if (Number.isFinite(cabe) && Number(plano.dur) > cabe) {
          quejas.push(
            `el plano ${plano.id} pide ${plano.dur} s de «${plano.de_archivo}», y ese plano de ` +
            `archivo dura ${cabe} s. Se puede usar menos, nunca más: pon «dur» en ${cabe} o menos, ` +
            `con «dur_gen» ${original.dur_gen} y «recorte» [0, dur].`
          );
        }
        if (Number.isFinite(cabe) && Number(plano.dur_gen) !== Number(original.dur_gen)) {
          quejas.push(
            `el plano ${plano.id} dice «dur_gen» ${plano.dur_gen} y «${plano.de_archivo}» se ` +
            `generó con ${original.dur_gen}. Un plano de archivo no se vuelve a generar, así que ` +
            'ese número tiene que ser el suyo.'
          );
        }
      }

      return quejas;
    }
  },
  {
    nombre: 'los-ids-son-unicos-y-correlativos',
    revisar(planos, ctx) {
      const quejas = [];
      const vistos = new Set();
      planos.forEach((plano, i) => {
        const esperado = `${ctx.escena}-${i + 1}`;
        if (plano.id !== esperado) {
          quejas.push(
            `el plano número ${i + 1} se llama «${plano.id || '(sin id)'}» y tiene que llamarse ` +
            `«${esperado}»: el id es el número de escena, un guion y el orden del plano.`
          );
        }
        if (vistos.has(plano.id)) quejas.push(`el id «${plano.id}» está repetido.`);
        vistos.add(plano.id);
      });
      return quejas;
    }
  },

  {
    // `imagen` y `video` son prompts para los modelos de imagen y de vídeo: van
    // en inglés. Si se cuelan en español, el modelo de imagen dibuja otra cosa y
    // se paga igual.
    nombre: 'imagen-y-video-escritos-en-ingles',
    revisar(planos) {
      const quejas = [];
      for (const plano of planos) {
        // Un plano de archivo no se describe: apunta a uno ya hecho, y su
        // descripción está escrita en el archivo desde hace meses. Exigirle
        // «imagen» aquí sería exigir que se vuelva a escribir lo mismo.
        if (plano.de_archivo) continue;
        for (const campo of ['imagen', 'video']) {
          const valor = plano[campo];
          if (!valor) {
            quejas.push(`el plano «${plano.id}» no trae «${campo}», y sin él no hay nada que generar.`);
            continue;
          }
          if (NO_ES_INGLES.test(valor)) {
            quejas.push(
              `«${campo}» del plano «${plano.id}» no está en inglés: lleva acentos, eñes o ` +
              'caracteres japoneses. Los prompts de imagen y de vídeo van en inglés; los demás ' +
              'campos son identificadores.'
            );
          }
        }
      }
      return quejas;
    }
  },

  {
    nombre: 'dur-gen-es-cuatro-seis-u-ocho',
    revisar(planos) {
      return planos
        .filter((plano) => !DURACIONES_DE_GENERACION.includes(plano.dur_gen))
        .map((plano) =>
          `el plano «${plano.id}» pide generar ${describirNumero(plano.dur_gen)} segundos, y el ` +
          `modelo de vídeo solo genera ${DURACIONES_DE_GENERACION.join(', ')}.`
        );
    }
  },

  {
    nombre: 'el-recorte-va-de-cero-a-dur',
    revisar(planos) {
      const quejas = [];
      for (const plano of planos) {
        if (!Number.isFinite(plano.dur) || plano.dur <= 0) {
          quejas.push(`el plano «${plano.id}» no dice cuánto dura, o dura ${describirNumero(plano.dur)}.`);
          continue;
        }
        if (Number.isFinite(plano.dur_gen) && plano.dur > plano.dur_gen) {
          quejas.push(
            `el plano «${plano.id}» dura ${plano.dur} s y solo se generan ${plano.dur_gen} s: ` +
            'no se puede recortar más de lo que hay.'
          );
        }
        const recorte = plano.recorte;
        if (!Array.isArray(recorte) || recorte.length !== 2 || !recorte.every(Number.isFinite)) {
          quejas.push(`el «recorte» del plano «${plano.id}» no es una pareja de números [0, dur].`);
          continue;
        }
        if (recorte[0] !== 0 || recorte[1] !== plano.dur) {
          quejas.push(
            `el «recorte» del plano «${plano.id}» es [${recorte.join(', ')}] y tiene que ser ` +
            `[0, ${plano.dur}]: se recorta desde el principio del clip generado.`
          );
        }
      }
      return quejas;
    }
  },

  {
    nombre: 'ningun-plano-pasa-de-ocho-segundos',
    revisar(planos) {
      return planos
        .filter((plano) => Number.isFinite(plano.dur) && plano.dur > DURACION_MAXIMA_S)
        .map((plano) =>
          `el plano «${plano.id}» dura ${plano.dur} s, y ningún plano pasa de ${DURACION_MAXIMA_S}.`
        );
    }
  },

  {
    nombre: 'la-duracion-media-ronda-los-tres-segundos',
    revisar(planos) {
      if (planos.length < PLANOS_PARA_MEDIR_LA_MEDIA) return [];
      const duraciones = planos.map((p) => p.dur).filter(Number.isFinite);
      if (duraciones.length !== planos.length) return []; // ya se queja el recorte
      const media = duraciones.reduce((a, b) => a + b, 0) / duraciones.length;
      if (media >= MEDIA_MINIMA_S && media <= MEDIA_MAXIMA_S) return [];
      return [
        `los ${planos.length} planos duran de media ${conComa(media)} s, y la media de la escena ` +
        `tiene que rondar los 3 s (entre ${conComa(MEDIA_MINIMA_S)} y ${conComa(MEDIA_MAXIMA_S)}). ` +
        (media > MEDIA_MAXIMA_S
          ? 'Los planos están demasiado largos: se apalanca.'
          : 'Los planos están demasiado cortos: la escena va picada.')
      ];
    }
  },

  {
    nombre: 'un-plano-encadenado-se-usa-entero',
    revisar(planos) {
      return planos
        .filter((plano) => plano.encadena_con !== null && plano.dur !== plano.dur_gen)
        .map((plano) =>
          `el plano «${plano.id}» encadena con «${plano.encadena_con}» y dura ${plano.dur} s de ` +
          `los ${describirNumero(plano.dur_gen)} que se generan: un plano encadenado se usa entero ` +
          'o la interpolación no llega al corte.'
        );
    }
  },

  {
    nombre: 'solo-se-encadena-con-el-plano-siguiente',
    revisar(planos) {
      const quejas = [];
      planos.forEach((plano, i) => {
        if (plano.encadena_con === null) return;
        const siguiente = planos[i + 1];
        if (!siguiente) {
          quejas.push(
            `el plano «${plano.id}» es el último de la escena y no puede encadenar con nada: ` +
            'no hay plano siguiente al que llevar la interpolación.'
          );
          return;
        }
        if (plano.encadena_con !== siguiente.id) {
          quejas.push(
            `el plano «${plano.id}» encadena con «${plano.encadena_con}», y solo se puede ` +
            `encadenar con el plano siguiente, que es «${siguiente.id}».`
          );
        }
      });
      return quejas;
    }
  },

  {
    nombre: 'el-escenario-es-el-canonico-de-la-escena',
    revisar(planos, ctx) {
      return planos
        .filter((plano) => plano.escenario !== ctx.escenario.id)
        .map((plano) =>
          `el plano «${plano.id}» dice que ocurre en «${plano.escenario || '(ninguno)'}», y esta ` +
          `escena ocurre en «${ctx.escenario.id}». La placa del escenario viaja como referencia ` +
          'en todos los planos que pasan ahí: si cambia, salen dos sitios distintos.'
        );
    }
  },

  {
    nombre: 'la-luz-es-la-de-la-escena',
    revisar(planos, ctx) {
      return planos
        .filter((plano) => plano.luz !== ctx.luz)
        .map((plano) =>
          `el plano «${plano.id}» pide la luz «${plano.luz || '(ninguna)'}», y esta escena está ` +
          `iluminada con «${ctx.luz}». La luz se escribe una vez en el guion y no cambia dentro ` +
          'de la escena.'
        );
    }
  },

  {
    nombre: 'el-nivel-de-video-es-uno-de-los-tres',
    revisar(planos) {
      return planos
        .filter((plano) => !NIVELES_DE_VEO.includes(plano.veo))
        .map((plano) =>
          `el plano «${plano.id}» pide el nivel «${plano.veo || '(ninguno)'}», y los niveles son ` +
          `${NIVELES_DE_VEO.join(', ')}.`
        );
    }
  },

  {
    nombre: 'toda-ref-existe-en-el-banco',
    revisar(planos) {
      const banco = new Set(((serie.banco && serie.banco.placas) || []).map((p) => p.id));
      const quejas = [];
      for (const plano of planos) {
        if (!Array.isArray(plano.refs)) {
          quejas.push(`las «refs» del plano «${plano.id}» no son una lista.`);
          continue;
        }
        for (const ref of plano.refs) {
          if (!banco.has(ref)) {
            quejas.push(
              `el plano «${plano.id}» pide la placa «${ref}», que no existe en el banco. Una ` +
              'placa que no está en el banco no se puede generar ni adjuntar.'
            );
          }
        }
      }
      return quejas;
    }
  },

  {
    nombre: 'las-refs-son-de-personajes-de-esta-escena',
    revisar(planos, ctx) {
      const ofrecidas = new Set(ctx.placas.map((p) => p.id));
      const quejas = [];
      for (const plano of planos) {
        if (!Array.isArray(plano.refs)) continue; // ya se queja la comprobación anterior
        for (const ref of plano.refs) {
          if (ofrecidas.has(ref)) continue;
          quejas.push(
            `el plano «${plano.id}» pide la placa «${ref}», que no es de ningún personaje de ` +
            'esta escena. Las únicas que se pueden usar son las de la lista que se te dio.'
          );
        }
      }
      return quejas;
    }
  },

  {
    // Los cupos de referencias por modelo están escritos en
    // `instrucciones_referencia.maximo_referencias`, y quien sabe leerlos es
    // `comprobarCupos()`. Aquí no se repite ningún número: se le pregunta a él.
    // Se mira contra el modelo de imagen por defecto, que es con el que se
    // genera el keyframe, y el escenario cuenta como la referencia de objeto que
    // será. Pasarse no da un error claro del otro lado: da una llamada fallida
    // ya cobrada, cuarenta planos más tarde.
    nombre: 'las-refs-caben-en-el-modelo-de-imagen',
    revisar(planos) {
      let modelo;
      try {
        modelo = nivelImagen();
      } catch {
        // Sin modelo de imagen resuelto no se puede comprobar el cupo, y ese
        // fallo ya lo dará —con su mensaje— quien genere el keyframe.
        return [];
      }
      const quejas = [];
      for (const plano of planos) {
        if (!Array.isArray(plano.refs)) continue;
        const referencias = [
          { cupo: 'objeto' },
          ...plano.refs.map(() => ({ cupo: 'personaje' }))
        ];
        try {
          comprobarCupos(referencias, modelo.id);
        } catch (fallo) {
          quejas.push(
            `el plano «${plano.id}» lleva ${plano.refs.length} referencias de personaje y no ` +
            `caben: ${fallo && fallo.mensaje ? fallo.mensaje : String(fallo)}`
          );
        }
      }
      return quejas;
    }
  },

  {
    nombre: 'boca-visible-es-null-o-un-personaje-de-la-escena',
    revisar(planos, ctx) {
      const quienes = new Set(ctx.personajes);
      return planos
        .filter((plano) => plano.boca_visible !== null && !quienes.has(plano.boca_visible))
        .map((plano) =>
          `el plano «${plano.id}» dice que se ve la boca de «${plano.boca_visible}», y en esta ` +
          `escena solo salen: ${ctx.personajes.join(', ') || 'nadie'}.`
        );
    }
  },

  {
    nombre: 'un-plano-con-boca-visible-dura-entre-dos-y-cuatro-segundos',
    revisar(planos) {
      return planos
        .filter((plano) => plano.boca_visible !== null && Number.isFinite(plano.dur))
        .filter((plano) => plano.dur < BOCA_MINIMO_S || plano.dur > BOCA_MAXIMO_S)
        .map((plano) =>
          `el plano «${plano.id}» muestra la boca de «${plano.boca_visible}» y dura ${plano.dur} s: ` +
          `un plano con boca visible dura entre ${BOCA_MINIMO_S} y ${BOCA_MAXIMO_S} segundos, ` +
          'nunca más.'
        );
    }
  },

  {
    // El lado seguro de §6.6: si la boca está en cuadro, que se mueva. Así
    // ninguna línea de voz puede caer luego sobre una boca quieta, se coloque
    // donde se coloque en la línea de tiempo.
    nombre: 'un-plano-con-boca-visible-pide-que-la-boca-se-mueva',
    revisar(planos) {
      return planos
        .filter((plano) => plano.boca_visible !== null)
        .filter((plano) => !/\bmouth\b/i.test(String(plano.video || '')))
        .map((plano) =>
          `el plano «${plano.id}» muestra la boca de «${plano.boca_visible}» pero su «video» no ` +
          'pide que la boca se mueva. Una boca quieta mientras suena esa voz es lo único que esta ' +
          `serie no se permite: escríbelo, en inglés, con «${fraseDeBocaEnMovimiento()}».`
        );
    }
  },

  {
    nombre: 'no-hay-mas-planos-con-boca-que-lineas-de-dialogo',
    revisar(planos, ctx) {
      const conBoca = planos.filter((plano) => plano.boca_visible !== null).length;
      if (!ctx.dialogo.length && conBoca > 0) {
        return [
          `en esta escena no habla nadie y hay ${conBoca} ${conBoca === 1 ? 'plano' : 'planos'} ` +
          'con la boca en cuadro. Si nadie habla, «boca_visible» es null en todos.'
        ];
      }
      if (conBoca > ctx.dialogo.length) {
        return [
          `hay ${conBoca} planos con la boca en cuadro para ${ctx.dialogo.length} líneas de ` +
          'diálogo. De cada intercambio solo uno o dos planos muestran la boca; el resto van ' +
          'sobre reacción, manos, nucas o escorzos.'
        ];
      }
      return [];
    }
  }
];

/**
 * Pasa por todas las comprobaciones y devuelve los planos ya normalizados junto
 * con la lista completa de lo que falla.
 * @param {*} devuelto lo que contestó el modelo, ya parseado
 * @param {object} ctx
 * @returns {{planos:object[], quejas:{regla:string, queja:string}[]}}
 */
function revisar(devuelto, ctx) {
  const lista = Array.isArray(devuelto)
    ? devuelto
    : (devuelto && Array.isArray(devuelto.planos) ? devuelto.planos : null);

  if (!lista) {
    return {
      planos: [],
      quejas: [{
        regla: 'la-respuesta-trae-una-lista-de-planos',
        queja: 'lo devuelto no trae ninguna lista «planos». Se espera un objeto con una sola ' +
          'clave, «planos», y dentro la lista de los planos de la escena.'
      }]
    };
  }

  if (!lista.length) {
    return {
      planos: [],
      quejas: [{
        regla: 'la-respuesta-trae-una-lista-de-planos',
        queja: 'la lista «planos» ha venido vacía. Toda escena tiene al menos un plano: aunque ' +
          'sea una conversación estática, esa conversación es un plano.'
      }]
    };
  }

  const roto = lista.findIndex((p) => !p || typeof p !== 'object' || Array.isArray(p));
  if (roto !== -1) {
    return {
      planos: [],
      quejas: [{
        regla: 'la-respuesta-trae-una-lista-de-planos',
        queja: `el elemento número ${roto + 1} de «planos» no es un plano: es ` +
          `${describirValor(lista[roto])}. Cada plano es un objeto con sus campos.`
      }]
    };
  }

  const planos = lista.map(normalizarPlano);
  const quejas = [];
  for (const comprobacion of COMPROBACIONES) {
    for (const queja of comprobacion.revisar(planos, ctx)) {
      quejas.push({ regla: comprobacion.nombre, queja });
    }
  }

  return { planos, quejas };
}

/**
 * Deja el plano con los campos del contrato y en su orden, sin arreglar nada que
 * esté mal: un número escrito como texto se convierte —eso es forma, no fondo—,
 * pero lo que no se entiende se deja tal cual para que la comprobación se queje
 * de ello con su nombre. Lo que falta se pone en su valor de «nada» (null o
 * lista vacía), que es lo que significa que no está.
 * @param {object} crudo
 * @returns {object}
 */
function normalizarPlano(crudo) {
  return {
    id: comoCadena(crudo.id),
    imagen: comoCadena(crudo.imagen),
    video: comoCadena(crudo.video),
    dur: comoNumero(crudo.dur),
    dur_gen: comoNumero(crudo.dur_gen),
    recorte: Array.isArray(crudo.recorte) ? crudo.recorte.map(comoNumero) : crudo.recorte ?? null,
    // Los datos escriben «economico» sin tilde y `datos.js` acepta las dos
    // formas al resolver el modelo. Aquí se normaliza igual, para no rechazar un
    // desglose por una tilde que luego daría lo mismo.
    veo: sinTildes(comoCadena(crudo.veo)),
    luz: comoCadena(crudo.luz),
    escenario: comoCadena(crudo.escenario),
    refs: Array.isArray(crudo.refs)
      ? crudo.refs.map(comoCadena)
      : (crudo.refs === null || crudo.refs === undefined ? [] : crudo.refs),
    boca_visible: vacio(crudo.boca_visible) ? null : comoCadena(crudo.boca_visible),
    encadena_con: vacio(crudo.encadena_con) ? null : comoCadena(crudo.encadena_con),
    de_archivo: vacio(crudo.de_archivo) ? null : comoCadena(crudo.de_archivo)
  };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** ¿Es «nada»? null, undefined, cadena vacía o la palabra «null» escrita. */
function vacio(valor) {
  if (valor === null || valor === undefined) return true;
  const texto = String(valor).trim().toLowerCase();
  return texto === '' || texto === 'null' || texto === 'none' || texto === 'ninguno';
}

/** Cadena limpia. Lo que no es texto ni número sale como cadena vacía. */
function comoCadena(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

/** Minúsculas y sin tildes, para comparar un nivel escrito de cualquier manera. */
function sinTildes(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Número. Un «4» escrito como texto vale; cualquier otra cosa sale como NaN. */
function comoNumero(valor) {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string' && valor.trim() !== '' && Number.isFinite(Number(valor))) {
    return Number(valor);
  }
  return NaN;
}

/** Un número para un mensaje, incluso cuando no es un número. */
function describirNumero(valor) {
  return Number.isFinite(valor) ? String(valor) : '«un valor que no es un número»';
}

/** Qué clase de cosa es algo, para poder decirlo en español. */
function describirValor(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'una lista';
  return `un ${typeof valor}`;
}

/** Decimales con coma, como se escriben en español. */
function conComa(x) {
  return String(Math.round(Number(x) * 10) / 10).replace('.', ',');
}

/** Un texto largo, recortado y diciendo que se recortó. */
function recorte(texto, maximo) {
  const t = String(texto);
  return t.length <= maximo ? t : `${t.slice(0, maximo)}… (recortado: eran ${t.length} caracteres)`;
}

/** Cualquier cosa como texto, sin que un ciclo tumbe el manejador de errores. */
function comoTexto(valor) {
  if (typeof valor === 'string') return valor;
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

// ---------------------------------------------------------------------------
// La ficha de difusión
// ---------------------------------------------------------------------------

/**
 * El título, la descripción y las etiquetas con las que se sube una pieza.
 *
 * POR QUÉ ESTO NO ES UN CAMPO DE TEXTO. Escribir un título y cinco frases de
 * descripción en el teclado de un móvil, doce veces, es exactamente el trabajo
 * que esta herramienta existe para no hacer. Y hay una razón más dura: la
 * descripción no puede contar el final ni nombrar a quien todavía no ha
 * aparecido, y eso, escrito a mano y con prisa, se falla.
 *
 * LAS ETIQUETAS NO SE INVENTAN. Salen de la lista de `difusion.etiquetas.lista`
 * de datos/serie.json y el modelo solo ELIGE de ahí. Una etiqueta inventada no la
 * busca nadie —y puede estar cogida por otra cosa—, así que dejar que el modelo
 * se las invente sería pagar por que no la vea nadie. Aquí se comprueba una a
 * una y las que no estén en la lista se tiran.
 *
 * @param {string} idPieza
 * @returns {Promise<{titulo:string, descripcion:string, etiquetas:string[]}>}
 */
export async function fichaDePieza(idPieza) {
  const laPieza = pieza(idPieza);
  const difusion = (serie.difusion && typeof serie.difusion === 'object') ? serie.difusion : {};
  const reglaFicha = difusion.ficha || {};
  const reglaEtiquetas = difusion.etiquetas || {};

  const permitidas = Array.isArray(reglaEtiquetas.lista) ? reglaEtiquetas.lista.map(String) : [];
  if (!permitidas.length) {
    throw new ErrorDeCara(
      'No hay ninguna etiqueta escrita en «difusion.etiquetas.lista» de datos/serie.json, y las ' +
      'etiquetas no se inventan: se eligen de esa lista. Es un fallo de los datos del repositorio, ' +
      'no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  const [minEtiquetas, maxEtiquetas] = Array.isArray(reglaEtiquetas.cuantas)
    ? reglaEtiquetas.cuantas.map((n) => Number(n) || 0)
    : [8, 15];
  const largoTitulo = Number(reglaFicha.largo_titulo) || 60;

  const encargo = promptDeFicha(laPieza, idPieza, {
    difusion, reglaFicha, reglaEtiquetas, permitidas, largoTitulo, minEtiquetas, maxEtiquetas
  });

  const devuelto = await generar(encargo, { json: true });

  const titulo = comoCadena(devuelto && devuelto.titulo);
  const descripcion = comoCadena(devuelto && devuelto.descripcion);
  const crudas = Array.isArray(devuelto && devuelto.etiquetas) ? devuelto.etiquetas : [];

  // Las etiquetas, una a una, contra la lista. Se comparan sin almohadilla y en
  // minúsculas: el modelo las devuelve de las dos maneras.
  const validas = new Set(permitidas.map((una) => una.toLowerCase()));
  const elegidas = [];
  for (const cruda of crudas) {
    const limpia = comoCadena(cruda).replace(/^#/, '').trim().toLowerCase();
    if (!limpia || !validas.has(limpia) || elegidas.includes(limpia)) continue;
    elegidas.push(limpia);
  }

  if (!titulo || !descripcion) {
    throw new ErrorDeCara(
      `La ficha de «${idPieza}» ha vuelto sin título o sin descripción, que son lo único que hace ` +
      'falta para subir el vídeo. Vuelve a pedirla.',
      { detalle: comoTexto(devuelto), reintentable: true, http: 502 }
    );
  }

  if (elegidas.length < Math.max(1, minEtiquetas)) {
    throw new ErrorDeCara(
      `La ficha de «${idPieza}» ha vuelto con ${elegidas.length} etiquetas de la lista y hacen ` +
      `falta al menos ${minEtiquetas}. Las etiquetas salen de «difusion.etiquetas.lista» de ` +
      'datos/serie.json y las que no estén ahí se tiran, porque una etiqueta inventada no la busca ' +
      'nadie. Vuelve a pedir la ficha.',
      { detalle: comoTexto(devuelto), reintentable: true, http: 502 }
    );
  }

  return {
    titulo: titulo.slice(0, largoTitulo * 2).trim(),
    descripcion,
    etiquetas: elegidas.slice(0, Math.max(minEtiquetas, maxEtiquetas))
  };
}

/**
 * El encargo de la ficha. Lleva lo que la pieza ES y lo que la pieza ENSEÑA, que
 * es lo único con lo que se puede escribir una descripción que no mienta.
 * @returns {string}
 */
function promptDeFicha(laPieza, idPieza, ctx) {
  const { difusion, reglaFicha, reglaEtiquetas, permitidas, largoTitulo, minEtiquetas, maxEtiquetas } = ctx;

  const meta = serie.meta || {};
  const cuantosPlanos = Array.isArray(laPieza.tomas) ? laPieza.tomas.length : 0;
  const lineas = Array.isArray(laPieza.audio && laPieza.audio.voz) ? laPieza.audio.voz : [];

  return [
    'Escribes la ficha con la que se sube un vídeo de un animé a YouTube, TikTok e Instagram. ' +
    'No escribes el guion ni inventas historia: solo el título, la descripción y las etiquetas. ' +
    'Contestas con el JSON que se te pide y nada más.',

    bloque('LA SERIE', [
      `Título: ${comoCadena(meta.titulo_es) || 'La mirada que el mundo temerá'}.`,
      'Drama de animé para adultos, sombrío. Doce episodios de veintidós minutos.',
    ].filter(Boolean).join('\n')),

    bloque('LA PIEZA QUE SE SUBE', [
      `Se llama «${idPieza}» y su título de producción es «${comoCadena(laPieza.titulo) || idPieza}».`,
      Number(laPieza.duracion_s) ? `Dura ${Math.round(Number(laPieza.duracion_s))} segundos.` : '',
      cuantosPlanos ? `Tiene ${cuantosPlanos} planos.` : '',
      lineas.length
        ? `Se oye hablar ${lineas.length} ${lineas.length === 1 ? 'vez' : 'veces'}. Lo que se dice, ` +
          `en español: ${lineas.map((una) => `«${comoCadena(una.es)}»`).filter((t) => t !== '«»').join(' ')}`
        : 'No habla nadie: es solo imagen y música.',
    ].filter(Boolean).join('\n')),

    bloque('LO QUE SE VE EN ELLA', (Array.isArray(laPieza.tomas) ? laPieza.tomas : [])
      .map((una, i) => `${i + 1}. ${comoCadena(una.imagen) || '(sin descripción)'}`)
      .join('\n') || '(esta pieza no trae planos escritos)'),

    bloque('EL TÍTULO', [
      comoCadena(reglaFicha.titulo) || '',
      `Máximo ${largoTitulo} caracteres. En español.`,
      'Sin emojis, sin MAYÚSCULAS gritadas, sin corchetes de «[SUB ESPAÑOL]».',
    ].filter(Boolean).join('\n')),

    bloque('LA DESCRIPCIÓN', [
      comoCadena(reglaFicha.descripcion) || '',
      'En español. Sin emojis. Las etiquetas NO van dentro de la descripción: van en su campo.',
      'No escribas «¡Suscríbete!» ni «dale like»: eso lo pone quien sube, si quiere.',
    ].filter(Boolean).join('\n')),

    bloque('LAS ETIQUETAS', [
      comoCadena(reglaEtiquetas.regla) || '',
      `Elige entre ${minEtiquetas} y ${maxEtiquetas}, TODAS de esta lista y ninguna más:`,
      permitidas.join(', '),
      comoCadena(reglaEtiquetas.nota_ia) || '',
      'Se comprueban una a una contra esa lista y las que no estén se tiran, así que inventar una ' +
      'es perder un hueco.',
    ].filter(Boolean).join('\n')),

    bloque('LO QUE TIENES QUE DEVOLVER', [
      'Un único objeto JSON con tres claves y nada más:',
      '',
      '{',
      '  "titulo": "<el título, en español>",',
      '  "descripcion": "<la descripción, en español, con saltos de línea si hacen falta>",',
      '  "etiquetas": ["anime", "seinen", "..."]',
      '}',
      '',
      'Las etiquetas van SIN almohadilla y en minúsculas.',
    ].join('\n')),
  ].join('\n\n');
}
