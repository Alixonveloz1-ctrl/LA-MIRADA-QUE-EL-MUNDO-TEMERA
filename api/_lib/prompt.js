// Donde se componen los prompts. Es el ÚNICO sitio del sistema donde se pega
// `serie.estilo.bloque`, y por eso es el archivo que hace estructuralmente
// imposible que salga una generación sin él: el navegador no compone texto
// —manda un id—, los modos no concatenan nada, y todo prompt de imagen y de
// vídeo sale de aquí ya sellado. Si alguien quisiera generar sin el bloque
// tendría que escribir una función nueva en este archivo y saltarse `sellar()`
// a propósito.
//
// EL ORDEN DE COMPOSICIÓN, que es el del plan §4 y no admite excepciones:
//
//     <prompt de la toma o de la placa>
//     + luces[luz]
//     + estilo.bloque          ← literal, sin modificar ni una coma
//     negativo: estilo.negativo
//
// Las tres primeras partes viajan juntas en `texto`. El negativo se devuelve
// además aparte, porque Veo tiene su propio campo `negativePrompt` y porque
// `imagen.js` lo necesita suelto; aun así el bloque de estilo va siempre pegado
// al texto, también en vídeo.
//
// QUÉ IDIOMA LLEVA CADA COSA. El código y los comentarios van en español. Los
// prompts de imagen y de vídeo, las instrucciones que acompañan a cada
// referencia y los encargos a Lyria van en inglés, porque es lo que entienden
// esos modelos y porque Lyria rechaza la petición entera si detecta otro idioma.
// Las direcciones de actuación de la voz van en español a propósito: las lee
// Gemini TTS, que entiende español, y lo que se pronuncia es el japonés.
//
// QUÉ NO SE SELLA, y por qué no es un olvido. El bloque de estilo describe cómo
// se DIBUJA un fotograma: grosor de línea, cel shading, paleta, halación. Pegarlo
// a un encargo de música o a una dirección de voz no solo no significa nada: en
// Lyria tira la petición completa. Por eso `encargoMusica()` y `guionDeVoz()` no
// pasan por `sellar()`, y cada una lo dice en su sitio. Toda función que
// componga un prompt de IMAGEN o de VÍDEO termina llamando a `sellar()`.

import { ErrorDeCara } from './errores.js';
import {
  serie,
  pieza,
  toma,
  placa,
  escenario,
  personaje,
  anclaDePersonaje,
  bloquesDeVoz
} from './datos.js';

// ---------------------------------------------------------------------------
// Piezas sueltas de serie.json, cada una con su queja si falta
// ---------------------------------------------------------------------------

/**
 * El bloque de estilo, literal. Es el corazón del archivo: si no está, no se
 * genera nada, porque una imagen sin él se descarta y habría que pagarla igual.
 * @returns {string}
 */
function bloqueDeEstilo() {
  const bloque = serie.estilo && serie.estilo.bloque;
  if (typeof bloque !== 'string' || !bloque.trim()) {
    throw new ErrorDeCara(
      'Falta el bloque de estilo en datos/serie.json (estilo.bloque). Es el texto que ' +
        'se pega literal al final de todos los prompts de imagen y de vídeo, y sin él ' +
        'todo lo que se generase saldría con otro aspecto y habría que tirarlo. No se ' +
        'genera nada hasta que ese texto esté escrito.',
      { reintentable: false, http: 500 }
    );
  }
  return bloque;
}

/**
 * El negativo de estilo, literal.
 * @returns {string}
 */
function negativoDeEstilo() {
  const negativo = serie.estilo && serie.estilo.negativo;
  if (typeof negativo !== 'string' || !negativo.trim()) {
    throw new ErrorDeCara(
      'Falta el negativo de estilo en datos/serie.json (estilo.negativo). Es la lista ' +
        'de lo que no queremos ver —paleta shonen, ojos brillantes, render 3D, marcas de ' +
        'agua— y viaja en todos los prompts y en el campo negativo de Veo.',
      { reintentable: false, http: 500 }
    );
  }
  return negativo;
}

/**
 * El esquema de luz de una toma, de una placa o de un escenario.
 * @param {string} clave `CRIPTA`, `BARRIO`, `NOBLE` o `NEUTRA`.
 * @param {string} deQuien qué la pedía, para poder explicarlo si no existe.
 * @returns {string} la descripción de luz en inglés, tal cual está en serie.json.
 */
function luzDe(clave, deQuien) {
  const luces = serie.luces || {};
  const disponibles = Object.keys(luces);
  if (clave === null || clave === undefined || clave === '') {
    throw new ErrorDeCara(
      `${deQuien} no dice con qué luz se ilumina, y la luz es parte obligatoria del ` +
        `prompt. Tiene que llevar un campo «luz» con uno de estos valores: ` +
        `${disponibles.join(', ')}.`,
      { reintentable: false, http: 500 }
    );
  }
  const descripcion = luces[clave];
  if (typeof descripcion !== 'string' || !descripcion.trim()) {
    throw new ErrorDeCara(
      `${deQuien} pide la luz «${clave}», que no está escrita en la sección «luces» de ` +
        `datos/serie.json. Las luces que hay son: ${disponibles.join(', ') || 'ninguna'}.`,
      { reintentable: false, http: 500 }
    );
  }
  return descripcion;
}

/**
 * Cómo se llama un personaje cuando hay que nombrarlo dentro de una instrucción
 * de referencia. Se usa `personajes[x].nombre` si está escrito y el id si no:
 * casi ningún personaje tiene nombre aparte porque su id ya es su nombre
 * («saharis», «madre»), pero los que no lo son —«bebe», «nino5»— sí lo traen.
 * @param {string} idPersonaje
 * @returns {string}
 */
function nombreLegible(idPersonaje) {
  const ficha = (serie.personajes || {})[idPersonaje];
  const nombre = ficha && ficha.nombre;
  return typeof nombre === 'string' && nombre.trim() ? nombre : String(idPersonaje);
}

/**
 * Pone el nombre del personaje donde la instrucción escribe `{nombre}`.
 * Sustituye todas las apariciones: la instrucción de toma lo nombra tres veces.
 * @param {string} plantilla
 * @param {string} idPersonaje
 * @returns {string}
 */
function conNombre(plantilla, idPersonaje) {
  return String(plantilla).split('{nombre}').join(nombreLegible(idPersonaje));
}

/**
 * Une las partes de un prompt saltándose las vacías. Cada parte va en su línea:
 * identidad, encuadre y luz son tres frases distintas y el modelo las lee mejor
 * separadas que pegadas con comas.
 * @param {...(string|null|undefined)} partes
 * @returns {string}
 */
function unir(...partes) {
  return partes
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter((p) => p !== '')
    .join('\n');
}

/**
 * Deja una frase terminada en punto sin tocarla si ya lo estaba. Solo se usa
 * para las direcciones de voz, que se componen en español a partir de trozos
 * escritos a mano en serie.json y que no siempre acaban en punto.
 * @param {string} texto
 * @returns {string}
 */
function frase(texto) {
  const limpio = String(texto).trim().replace(/[.;,]+$/, '');
  return `${limpio}.`;
}

// ---------------------------------------------------------------------------
// El sello
// ---------------------------------------------------------------------------

/**
 * Compara ignorando cuántos espacios o saltos de línea hay entre palabras: el
 * bloque puede haber llegado reindentado y seguiría siendo el mismo bloque.
 * @param {string} s
 * @returns {string}
 */
function sinEspaciosDeMas(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * ¿Este texto ya lleva pegado el bloque de estilo?
 * Se mira de dos maneras: el bloque entero (el caso normal de doble sellado) y
 * su primera frase (el caso de un bloque pegado a mano y luego retocado, que es
 * justo lo que la regla «sin modificar ni una coma» quiere impedir).
 * @param {string} texto
 * @param {string} bloque
 * @returns {boolean}
 */
function yaLlevaElBloque(texto, bloque) {
  const cuerpo = sinEspaciosDeMas(texto);
  const sello = sinEspaciosDeMas(bloque);
  if (cuerpo.includes(sello)) return true;
  const huella = sello.slice(0, 48);
  return huella.length >= 16 && cuerpo.includes(huella);
}

/**
 * Sella un prompt: le pega el bloque de estilo literal y el negativo.
 * Es el único sitio del sistema donde se pega `estilo.bloque`.
 *
 * Devuelve exactamente:
 *
 *     <texto>
 *
 *     <serie.estilo.bloque>
 *
 *     negativo: <serie.estilo.negativo>
 *
 * @param {string} texto el prompt de la toma o de la placa, ya con su luz.
 * @param {{negativo?:string}} [opciones] `negativo` sustituye al de la serie; se
 *   deja pasar porque el encargo de este módulo lo pide así, pero hoy nadie lo
 *   usa: todo lleva el negativo de la serie.
 *   NOTA SOBRE EL CONTRATO: docs/contrato.md §12 escribe `sellar(texto)` y el
 *   encargo escribe `sellar(texto, { negativo })`. El segundo argumento es
 *   opcional justamente para que las dos formas sean ciertas a la vez.
 * @returns {string} el prompt final.
 */
export function sellar(texto, { negativo } = {}) {
  const bloque = bloqueDeEstilo();
  const cuerpo = String(texto === null || texto === undefined ? '' : texto).trim();

  if (!cuerpo) {
    throw new ErrorDeCara(
      'Se ha intentado sellar un prompt vacío. El bloque de estilo se pega detrás de ' +
        'algo que describa el plano; solo, no describe nada y la generación saldría ' +
        'sin contenido.',
      { reintentable: false, http: 500 }
    );
  }

  if (yaLlevaElBloque(cuerpo, bloque)) {
    throw new ErrorDeCara(
      'Este prompt ya lleva pegado el bloque de estilo, así que se estaba a punto de ' +
        'pegarlo dos veces. Eso es un fallo de programación, no del usuario: el bloque ' +
        'se pega en un solo sitio, dentro de sellar(), y ninguna función debe traerlo ' +
        'ya puesto. Revisa quién compuso este texto.',
      { detalle: cuerpo.slice(0, 400), reintentable: false, http: 500 }
    );
  }

  const negativoFinal =
    negativo === null || negativo === undefined || String(negativo).trim() === ''
      ? negativoDeEstilo()
      : String(negativo).trim();

  return `${cuerpo}\n\n${bloque}\n\nnegativo: ${negativoFinal}`;
}

// ---------------------------------------------------------------------------
// Referencias
// ---------------------------------------------------------------------------

// La instrucción que acompaña a la placa del escenario cuando viaja dentro de un
// keyframe. Va en inglés porque la lee el modelo de imagen.
//
// FALTA EN EL CONTRATO: `serie.instrucciones_referencia` tiene `banco` (para las
// placas de personaje del banco) y `toma` (para los personajes de un keyframe),
// pero no tiene ninguna para el escenario, y el contrato §2 sí dice que la placa
// del escenario viaja como referencia de objeto en todos los keyframes. Una
// referencia sin línea que diga qué copiar hace que el modelo copie el encuadre
// en vez del sitio —trampa ya pagada—, así que se escribe aquí. Si algún día se
// añade `instrucciones_referencia.escenario` a datos/serie.json, esa manda y
// esta constante deja de usarse sola.
const INSTRUCCION_ESCENARIO_POR_DEFECTO =
  'LOCATION REFERENCE above: this is the place where this shot happens. Copy the ' +
  'PLACE exactly - the same architecture, the same materials and textures, the same ' +
  'colours, the same objects and where they are placed, the same wear, damp and dirt. ' +
  'Do NOT copy the framing, the camera angle, the scale or the composition of the ' +
  'reference: this shot looks at the same place from where it needs to, and everything ' +
  'in it is drawn at the size, position and perspective this shot describes. ' +
  // Y esto, que es lo que evita que un figurante inventado se herede en cadena:
  'If any people or figures appear in this reference, IGNORE THEM COMPLETELY - they ' +
  'are not part of the place. The only people in this shot are the ones this shot ' +
  'names, and nobody else.';

/**
 * La instrucción que acompaña a la placa de escenario, de serie.json si está
 * escrita ahí y del texto de arriba si no.
 * @returns {string}
 */
function instruccionDeEscenario() {
  const escrita = (serie.instrucciones_referencia || {}).escenario;
  return typeof escrita === 'string' && escrita.trim() ? escrita : INSTRUCCION_ESCENARIO_POR_DEFECTO;
}

/**
 * La instrucción genérica del banco (la que acompaña al ancla de un personaje),
 * con `{nombre}` ya sustituido.
 * @param {string} idPersonaje
 * @returns {string}
 */
function instruccionDeBanco(idPersonaje) {
  const plantilla = (serie.instrucciones_referencia || {}).banco;
  if (typeof plantilla !== 'string' || !plantilla.trim()) {
    throw new ErrorDeCara(
      'Falta instrucciones_referencia.banco en datos/serie.json. Es la línea que ' +
        'acompaña al ancla cuando se genera otra placa del mismo personaje, y sin ella ' +
        'el modelo copia el encuadre del ancla en vez de la identidad.',
      { reintentable: false, http: 500 }
    );
  }
  return conNombre(plantilla, idPersonaje);
}

/**
 * La instrucción de la cadena de edades: la que convierte siete placas sueltas
 * en la misma persona a siete edades.
 * @returns {string}
 */
function instruccionDeLinaje() {
  const plantilla = (serie.banco || {}).edades && serie.banco.edades.instruccion;
  if (typeof plantilla !== 'string' || !plantilla.trim()) {
    throw new ErrorDeCara(
      'Falta banco.edades.instruccion en datos/serie.json. Es la línea que hace que ' +
        'las siete edades de Saharis sean la misma persona en vez de siete personas ' +
        'parecidas, y sin ella los flashbacks no funcionan.',
      { reintentable: false, http: 500 }
    );
  }
  return plantilla;
}

/**
 * La instrucción que acompaña a un personaje dentro de un keyframe, con
 * `{nombre}` ya sustituido.
 * @param {string} idPersonaje
 * @returns {string}
 */
function instruccionDeToma(idPersonaje) {
  const plantilla = (serie.instrucciones_referencia || {}).toma;
  if (typeof plantilla !== 'string' || !plantilla.trim()) {
    throw new ErrorDeCara(
      'Falta instrucciones_referencia.toma en datos/serie.json. Es la línea que ' +
        'acompaña a cada personaje dentro de un keyframe, y sin ella el modelo copia el ' +
        'encuadre de la placa en vez de dibujar al personaje donde toca.',
      { reintentable: false, http: 500 }
    );
  }
  return conNombre(plantilla, idPersonaje);
}

/**
 * Añade una referencia a la lista sin repetir placa.
 * Una misma placa puede pedirse dos veces por dos motivos distintos: `eira-joven`
 * no es ancla (así que le tocaría su ancla) y además encadena a `eira-ancla`, que
 * es esa misma ancla. Adjuntarla dos veces gastaría dos huecos de cupo por la
 * misma imagen. Cuando pasa, manda la última instrucción escrita, que es siempre
 * la de linaje: es la más específica de las dos, porque dice que es la misma
 * persona a otra edad.
 * @param {object[]} lista
 * @param {object} referencia
 */
function ponerReferencia(lista, referencia) {
  const clave = referencia.placa || referencia.escenario;
  const ya = lista.find((r) => (r.placa || r.escenario) === clave);
  if (ya) {
    ya.instruccion = referencia.instruccion;
    ya.cupo = referencia.cupo;
    return;
  }
  lista.push(referencia);
}

// ---------------------------------------------------------------------------
// Prompts de imagen
// ---------------------------------------------------------------------------

/**
 * El prompt de una placa del banco de personajes.
 *
 * Composición: identidad del personaje + encuadre de la placa + luz + sello.
 *
 * Referencias:
 *  - Si la placa NO es ancla, se adjunta el ancla de su personaje. La línea que
 *    la acompaña es la propia de la placa (`instruccion_referencia`) si la trae
 *    —las placas de detalle: manos, nucas, espaldas, donde no hay cara que
 *    copiar— y la genérica del banco si no (enmienda 13.1 del contrato).
 *  - Si la placa trae `encadena_a`, se adjunta ESA placa con la instrucción de
 *    edades. Es la cadena de linaje: sin ella, las siete edades de Saharis son
 *    siete personas distintas y el corte entre flashback y presente no significa
 *    nada.
 *
 * Las dos cosas pueden pasar a la vez: `saharis-5-ancla` es ancla de su
 * personaje y encadena al ancla de linaje del adulto, y `saharis-5-manos` no es
 * ancla y cuelga de `saharis-5-ancla`. Ahí está la cadena doble
 * `saharis-5-manos → saharis-5-ancla → saharis-ancla`.
 *
 * @param {string} idPlaca
 * @returns {{texto:string, negativo:string, referencias:{placa:string, instruccion:string, cupo:string}[]}}
 */
export function promptPlaca(idPlaca) {
  const laPlaca = placa(idPlaca);
  const suPersonaje = personaje(laPlaca.personaje);

  if (typeof suPersonaje.identidad !== 'string' || !suPersonaje.identidad.trim()) {
    throw new ErrorDeCara(
      `El personaje «${laPlaca.personaje}» no tiene identidad escrita en datos/serie.json, ` +
        `así que la placa «${idPlaca}» no se puede generar: la identidad es lo primero ` +
        'que va en el prompt y sin ella el modelo dibujaría a cualquiera.',
      { reintentable: false, http: 500 }
    );
  }

  const cuerpo = unir(
    suPersonaje.identidad,
    laPlaca.encuadre,
    luzDe(laPlaca.luz, `La placa «${idPlaca}»`)
  );

  const referencias = [];

  // 1. Las placas que no son ancla se generan contra el ancla de su personaje.
  if (laPlaca.ancla !== true) {
    const idAncla = anclaDePersonaje(laPlaca.personaje);
    if (!idAncla) {
      throw new ErrorDeCara(
        `La placa «${idPlaca}» no es un ancla, así que necesita el ancla de ` +
          `«${laPlaca.personaje}» como referencia, y ese personaje no tiene ninguna placa ` +
          'marcada como ancla en el banco de datos/serie.json. Sin ancla no hay contra qué ' +
          'generar: cada placa saldría con otra cara.',
        { reintentable: false, http: 500 }
      );
    }
    ponerReferencia(referencias, {
      placa: idAncla,
      instruccion:
        typeof laPlaca.instruccion_referencia === 'string' && laPlaca.instruccion_referencia.trim()
          ? laPlaca.instruccion_referencia
          : instruccionDeBanco(laPlaca.personaje),
      cupo: 'personaje'
    });
  }

  // 2. La cadena de linaje: la misma persona a otra edad.
  if (laPlaca.encadena_a) {
    placa(laPlaca.encadena_a); // que exista de verdad, y si no que lo diga con palabras
    ponerReferencia(referencias, {
      placa: laPlaca.encadena_a,
      instruccion:
        typeof laPlaca.instruccion_referencia === 'string' && laPlaca.instruccion_referencia.trim()
          ? laPlaca.instruccion_referencia
          : instruccionDeLinaje(),
      cupo: 'personaje'
    });
  }

  return { texto: sellar(cuerpo), negativo: negativoDeEstilo(), referencias };
}

/**
 * El prompt de un escenario. Sin referencias: un escenario se genera una vez,
 * solo con texto, y a partir de ahí es su propia placa la que viaja como
 * referencia en todos los planos que ocurren ahí.
 *
 * Composición: descripción + encuadre + luz + sello.
 *
 * @param {string} id
 * @returns {{texto:string, negativo:string, referencias:[]}}
 */
/**
 * UN ESCENARIO SE GENERA VACÍO, Y ESTO NO ES UNA MANÍA.
 *
 * La placa del escenario viaja como referencia de OBJETO en TODOS los planos que
 * ocurren ahí —es lo que hace que once planos de la cripta sean la misma cripta—.
 * Así que si la placa sale con tres encapuchados de relleno, esos tres
 * encapuchados se heredan en los once planos, se colarán al lado del personaje
 * que sí toca, y no hay forma de quitarlos después: habría que regenerar la placa
 * y con ella todos los planos que ya se hubieran hecho contra ella.
 *
 * Y el modelo los pone solo. A un «plano general de un santuario con altar y
 * antorchas» le salen figuras encapuchadas sin que nadie las pida, porque es lo
 * que se ve en cualquier imagen parecida. Hay que decirlo, y decirlo dos veces:
 * en el prompt y en el negativo.
 *
 * La gente la ponen los PLANOS, cada uno la suya, con sus placas de personaje.
 */
const SITIO_VACIO =
  'The location is completely EMPTY: no people, no figures, no characters, nobody ' +
  'at all anywhere in frame. Only the place itself.';

/** Y lo mismo por el otro lado, que es donde el modelo hace más caso. */
const NEGATIVO_DE_GENTE =
  'people, person, figures, characters, crowd, silhouettes of people, hooded figures, ' +
  'monks, worshippers, bystanders, anyone in frame';

export function promptEscenario(id) {
  const elEscenario = escenario(id);

  if (typeof elEscenario.descripcion !== 'string' || !elEscenario.descripcion.trim()) {
    throw new ErrorDeCara(
      `El escenario «${id}» no tiene descripción escrita en escenarios.placas de ` +
        'datos/serie.json, y la descripción es todo el prompt: sin ella no hay sitio que ' +
        'dibujar.',
      { reintentable: false, http: 500 }
    );
  }

  const cuerpo = unir(
    elEscenario.descripcion,
    elEscenario.encuadre,
    SITIO_VACIO,
    luzDe(elEscenario.luz, `El escenario «${id}»`)
  );

  return {
    texto: sellar(cuerpo),
    negativo: unir(negativoDeEstilo(), NEGATIVO_DE_GENTE),
    referencias: []
  };
}

/**
 * El prompt del keyframe de una toma: la imagen fija que luego anima Veo.
 *
 * Composición: `toma.imagen` + luz de la toma + sello.
 *
 * Referencias:
 *  - La placa del escenario de la toma, como referencia de OBJETO, con una línea
 *    propia que le pide copiar el SITIO —arquitectura, materiales, disposición—
 *    y no el encuadre. Sin esa placa, once planos de «la cripta» son once
 *    criptas distintas.
 *  - Cada `toma.refs`, que son placas del banco, como referencia de PERSONAJE,
 *    cada una con `instrucciones_referencia.toma` y el nombre del personaje
 *    puesto. Los cupos de objeto y de personaje no compiten entre sí.
 *
 * @param {string} idPieza
 * @param {string} idToma
 * @returns {{texto:string, negativo:string, referencias:{placa?:string, escenario?:string, instruccion:string, cupo:string}[]}}
 */
export function promptKeyframe(idPieza, idToma) {
  const laToma = toma(idPieza, idToma);

  if (typeof laToma.imagen !== 'string' || !laToma.imagen.trim()) {
    throw new ErrorDeCara(
      `La toma «${idToma}» de la pieza «${idPieza}» no tiene escrito su campo «imagen», ` +
        'que es la descripción del keyframe. Sin ella no hay nada que generar.',
      { reintentable: false, http: 500 }
    );
  }

  const cuerpo = unir(
    laToma.imagen,
    luzDe(laToma.luz, `La toma «${idToma}» de la pieza «${idPieza}»`)
  );

  const referencias = [];

  // El escenario, como objeto. Su placa viaja en todos los planos que ocurren
  // ahí: sin ella, once planos de «la cripta» son once criptas distintas.
  //
  // Un plano puede no ocurrir en ningún sitio, y eso no es un dato incompleto:
  // la toma de la cartela (E3 del teaser) es un fotograma negro puro sobre el
  // que el montador compone el título, y lleva `escenario: null` a propósito.
  // Adjuntarle una placa de escenario haría justo lo contrario de lo que se
  // pide: dibujaría una habitación donde tiene que haber negro. Si la toma sí
  // nombra un escenario, `escenario()` comprueba que existe de verdad.
  if (laToma.escenario) {
    const suEscenario = escenario(laToma.escenario);
    ponerReferencia(referencias, {
      escenario: suEscenario.id,
      instruccion: instruccionDeEscenario(),
      cupo: 'objeto'
    });
  }

  // Los personajes, como personaje. Cada uno con su línea de qué copiar.
  for (const idRef of laToma.refs || []) {
    const laPlaca = placa(idRef);
    ponerReferencia(referencias, {
      placa: laPlaca.id,
      instruccion: instruccionDeToma(laPlaca.personaje),
      cupo: 'personaje'
    });
  }

  return { texto: sellar(cuerpo), negativo: negativoDeEstilo(), referencias };
}

// ---------------------------------------------------------------------------
// Prompt de vídeo
// ---------------------------------------------------------------------------

/**
 * El prompt del clip de una toma.
 *
 * Composición: `toma.video` + luz de la toma + sello. Igual que la imagen: el
 * bloque de estilo va pegado al prompt también aquí, porque Veo redibuja y sin
 * el bloque el clip sale con otro aspecto que el keyframe del que parte.
 *
 * El negativo se devuelve además aparte porque Veo tiene su propio campo
 * `negativePrompt`, y ahí es donde de verdad lo escucha.
 *
 * @param {string} idPieza
 * @param {string} idToma
 * @returns {{texto:string, negativo:string}}
 */
export function promptVideo(idPieza, idToma) {
  const laToma = toma(idPieza, idToma);

  if (typeof laToma.video !== 'string' || !laToma.video.trim()) {
    throw new ErrorDeCara(
      `La toma «${idToma}» de la pieza «${idPieza}» no tiene escrito su campo «video», ` +
        'que es lo que se mueve en el plano. Sin eso Veo no sabe qué animar.',
      { reintentable: false, http: 500 }
    );
  }

  const cuerpo = unir(
    laToma.video,
    luzDe(laToma.luz, `La toma «${idToma}» de la pieza «${idPieza}»`)
  );

  return { texto: sellar(cuerpo), negativo: negativoDeEstilo() };
}

// ---------------------------------------------------------------------------
// Encargo de música
// ---------------------------------------------------------------------------

/**
 * El encargo de una pieza de música, tal cual está escrito en
 * `serie.musica.piezas`, en inglés y sin tocar una palabra.
 *
 * AQUÍ NO SE SELLA, y no es un olvido: `estilo.bloque` describe cómo se dibuja
 * un fotograma —grosor de línea, cel shading, halación—, que en un encargo de
 * música no significa nada. Y hay una razón más dura: Lyria rechaza la petición
 * entera con «Unsupported language detected» en cuanto detecta un idioma que no
 * sea inglés, y el bloque viene acompañado de la palabra «negativo:». Pegarlo
 * aquí no empeoraría el resultado: no habría resultado.
 *
 * @param {string} idPieza la pieza a la que pertenece; se comprueba que exista.
 *   Vale `temporada` para las piezas del banco, que no son de ninguna pieza.
 * @param {string} idMusica p. ej. `teaser-lecho` o `bso-cripta`.
 * @returns {{texto:string, negativo:string, durS:number}} `texto` es el encargo
 *   literal en inglés; `durS` sale de `duracion_s`.
 */
export function encargoMusica(idPieza, idMusica) {
  const piezasDeMusica = (serie.musica && serie.musica.piezas) || [];
  const encontrada = piezasDeMusica.find((m) => m.id === idMusica);

  // Primero el id de la música, porque es el que suele estar mal escrito y su
  // frase dice exactamente cuáles hay.
  if (!encontrada) {
    const hay = piezasDeMusica.map((m) => m.id);
    throw new ErrorDeCara(
      `No existe la pieza de música «${idMusica}». Debería estar en musica.piezas de ` +
        `datos/serie.json. Las que hay ahora mismo son: ${hay.join(', ') || 'ninguna'}.`,
      { reintentable: false, http: 400 }
    );
  }

  // EL BANCO DE LA TEMPORADA NO ES DE NADIE, Y ESO NO ES UN AGUJERO.
  //
  // Las piezas marcadas `temporada` se componen una vez y suenan en los doce
  // episodios, igual que el opening y el ending. Exigirles una pieza a la que
  // pertenecer obligaría a inventarle una dueña a cada una, y la primera vez que
  // alguien la moviera de sitio dejaría de generarse sin motivo. La pieza sí se
  // comprueba para las demás: los encargos están escritos por id, así que la
  // pieza no aporta texto, pero pedir música de una pieza que no existe es un
  // error que vale más ver aquí que después de haberla pagado.
  if (encontrada.temporada !== true) pieza(idPieza);

  if (typeof encontrada.encargo !== 'string' || !encontrada.encargo.trim()) {
    throw new ErrorDeCara(
      `La pieza de música «${idMusica}» no tiene encargo escrito en musica.piezas de ` +
        'datos/serie.json. El encargo es el prompt entero y va en inglés.',
      { reintentable: false, http: 500 }
    );
  }

  const durS = Number(encontrada.duracion_s);
  if (!Number.isFinite(durS) || durS <= 0) {
    throw new ErrorDeCara(
      `La pieza de música «${idMusica}» no tiene bien escrita su duración (duracion_s) en ` +
        'datos/serie.json, y sin duración no se puede ni pedir ni colocar en el montaje.',
      { reintentable: false, http: 500 }
    );
  }

  // Lyria 3 Pro llega a tres minutos y ni un segundo más. Un episodio se pide
  // por bloques y se une en el montaje con fundidos; pedir más de la cuenta es
  // un fallo que sale caro y que aquí se ve antes de gastar.
  const maximo = Number((serie.musica.modelo || {}).maximo_s);
  if (Number.isFinite(maximo) && maximo > 0 && durS > maximo) {
    throw new ErrorDeCara(
      `La pieza de música «${idMusica}» pide ${durS} segundos y el modelo no pasa de ` +
        `${maximo}. Una pieza más larga se parte en varias y se unen en el montaje con ` +
        'fundidos de dos segundos y medio; los fundidos cortos suenan a tajo.',
      { reintentable: false, http: 400 }
    );
  }

  return {
    texto: encontrada.encargo,
    negativo: typeof encontrada.negativo === 'string' ? encontrada.negativo : '',
    durS
  };
}

// ---------------------------------------------------------------------------
// Guion de voz
// ---------------------------------------------------------------------------

// Las etiquetas en línea que admite el modelo. Están escritas en
// `serie.voces.expresividad.control`; de ahí se sacan para no tenerlas en dos
// sitios, y esta lista es solo la red por debajo si ese texto cambiara de forma.
const ETIQUETAS_POR_DEFECTO = ['[susurra]', '[grita]', '[con la voz rota]'];

// Qué hacer con una línea que no trae intención escrita. Las del teaser no la
// traen: van colocadas al segundo dentro de piezas.teaser.audio.voz y sin campo
// «intencion». Dejarla sin ninguna indicación haría que el modelo se agarrase a
// lo único que le queda —la intención de la muestra, que es la del grito— y
// diría susurros a voces. Esta frase no es una invención: es lo que dice la
// propia serie de sí misma, en voces.expresividad.donde_funciona («el registro
// es contenido», susurro, agotamiento, frialdad, tensión contenida) y en
// estilo.bloque («understated expressions»). Está aquí, escrita una vez, para
// que la dirección se componga siempre igual carácter por carácter.
const REGISTRO_SI_LA_LINEA_NO_DICE =
  'dila en el registro contenido de la serie, en voz baja, sin subrayar nada y sin ' +
  'levantar el volumen.';

/**
 * Las etiquetas en línea admitidas, leídas de serie.json.
 * @returns {string[]}
 */
function etiquetasAdmitidas() {
  const control = ((serie.voces || {}).expresividad || {}).control;
  const encontradas = typeof control === 'string' ? control.match(/\[[^\]\n]+\]/g) : null;
  return encontradas && encontradas.length ? encontradas : ETIQUETAS_POR_DEFECTO;
}

/**
 * La ficha de reparto de un personaje: cuántas líneas tiene, qué voz se le
 * eligió y —lo que importa aquí— su intención, que es la mitad de la dirección.
 * @param {string} idPersonaje
 * @returns {object}
 */
function fichaDeReparto(idPersonaje) {
  const reparto = (serie.voces && serie.voces.reparto) || [];
  const ficha = reparto.find((r) => r.personaje === idPersonaje);
  if (!ficha) {
    throw new ErrorDeCara(
      `«${idPersonaje}» habla en esta pieza pero no está en el reparto de voces de ` +
        'datos/serie.json (voces.reparto), así que no tiene ni voz elegida ni intención ' +
        'escrita con la que componer su dirección de actuación. Hay que añadirlo al ' +
        'reparto antes de generar su voz.',
      { reintentable: false, http: 500 }
    );
  }
  return ficha;
}

/**
 * Compone la dirección de actuación de una línea. **Siempre igual, carácter por
 * carácter**, y por eso está aquí y no se escribe a mano en ningún sitio.
 *
 * Es la única defensa que tenemos, junto con meter el bloque entero en una sola
 * llamada, contra la deriva de tono: el timbre no cambia entre llamadas —es la
 * voz elegida— pero la entrega sí, y una dirección redactada de dos maneras
 * distintas para el mismo personaje garantiza dos entregas distintas.
 *
 * La dirección va en español a propósito: la lee el modelo, que entiende
 * español. Lo que se pronuncia es el japonés de `texto_ja`.
 *
 * CÓMO SE NOMBRA LA INTENCIÓN DEL PERSONAJE, que importa más de lo que parece.
 * `voces.reparto[].muestra.intencion` no es el registro medio del personaje: es
 * la intención de su frase MÁS DIFÍCIL de toda la serie, la que se usa para
 * elegirle voz escuchándola. La de la madre es «grito puro de terror», y en el
 * teaser la madre susurra. Por eso se le dice al modelo lo que ese dato es —la
 * referencia con la que se eligió esa voz, idéntica en todas sus llamadas— y no
 * se le da como orden de entrega para esta línea. Quien manda sobre la entrega
 * es la intención de la línea, cuando la línea la trae.
 *
 * @param {string} idPersonaje
 * @param {string|null} intencionDeLaLinea la de la línea, si la tiene.
 * @returns {string}
 */
function direccionDeActuacion(idPersonaje, intencionDeLaLinea) {
  const ficha = fichaDeReparto(idPersonaje);
  const intencionDelPersonaje = ((ficha.muestra || {}).intencion || '').trim();

  if (!intencionDelPersonaje) {
    throw new ErrorDeCara(
      `El personaje «${idPersonaje}» no tiene intención escrita en su muestra de ` +
        'voces.reparto (muestra.intencion) en datos/serie.json. Esa intención es la base ' +
        'de su dirección de actuación en todas sus líneas, y sin ella cada llamada le ' +
        'saldría con un carácter distinto.',
      { reintentable: false, http: 500 }
    );
  }

  const nombre = nombreLegible(idPersonaje);
  const partes = [
    `Habla como ${nombre}, y sostén esa misma voz y ese mismo carácter en todo el bloque.`,
    `Su voz se eligió escuchando su frase más difícil de la serie, dicha con esta ` +
      `intención: «${intencionDelPersonaje}». Es la referencia de quién es, la misma en ` +
      'todas sus llamadas, no la orden de cómo decir esta línea.'
  ];

  const deLaLinea = String(
    intencionDeLaLinea === null || intencionDeLaLinea === undefined ? '' : intencionDeLaLinea
  ).trim();
  partes.push(
    deLaLinea
      ? `Esta línea se dice así: ${frase(deLaLinea)}`
      : `Esta línea no lleva intención propia escrita: ${REGISTRO_SI_LA_LINEA_NO_DICE}`
  );

  return partes.join(' ');
}

/**
 * El guion de voz de un bloque, listo para una sola llamada a Gemini TTS.
 *
 * Un bloque es **una sola llamada** con todas sus líneas dentro y hasta dos
 * hablantes. Nunca se regenera una línea suelta: se rehace el bloque entero,
 * porque una línea regenerada sola es justo la que canta.
 *
 * Cada parte lleva `quien`, `texto_ja` —lo único que se pronuncia— y
 * `direccion`, compuesta siempre igual por `direccionDeActuacion()`.
 *
 * AQUÍ TAMPOCO SE SELLA: el bloque de estilo describe cómo se dibuja un plano y
 * esto es audio. Lo que sí hay es una instrucción global equivalente, que fija
 * el registro de toda la llamada.
 *
 * @param {string} idPieza
 * @param {string} idBloque el id que devuelve `bloquesDeVoz()`: «madre», «esc-3».
 * @returns {{partes:{quien:string, texto_ja:string, direccion:string}[], instruccion:string}}
 */
export function guionDeVoz(idPieza, idBloque) {
  const bloques = bloquesDeVoz(idPieza);
  const elBloque = bloques.find((b) => b.id === String(idBloque));
  if (!elBloque) {
    const hay = bloques.map((b) => b.id);
    throw new ErrorDeCara(
      `La pieza «${idPieza}» no tiene ningún bloque de voz «${idBloque}». Los bloques se ` +
        'arman solos a partir de las líneas de la pieza: uno por personaje en una pieza ' +
        `corta, uno por escena en un episodio. Los de esta pieza son: ${hay.join(', ') || 'ninguno'}.`,
      { reintentable: false, http: 400 }
    );
  }

  const partes = elBloque.lineas.map((linea) => {
    if (typeof linea.ja !== 'string' || !linea.ja.trim()) {
      throw new ErrorDeCara(
        `Una línea de ${nombreLegible(linea.quien)} en el bloque «${elBloque.id}» de la ` +
          `pieza «${idPieza}» no tiene texto en japonés. El audio va en japonés y el ` +
          'subtítulo en español; sin el japonés no hay nada que decir.',
        { reintentable: false, http: 500 }
      );
    }
    return {
      quien: linea.quien,
      texto_ja: linea.ja,
      direccion: direccionDeActuacion(linea.quien, linea.intencion)
    };
  });

  const idioma = (serie.voces && serie.voces.idioma) || 'ja-JP';
  const quienes = elBloque.personajes.map((p) => nombreLegible(p));
  const etiquetas = etiquetasAdmitidas();

  const instruccion = [
    `Lee en japonés (${idioma}) el texto de cada parte, y solo el texto.`,
    'Las direcciones son indicaciones de actuación, van en español y no se pronuncian nunca.',
    `En este bloque habla${quienes.length === 1 ? '' : 'n'}: ${quienes.join(' y ')}.`,
    'Mantén el mismo registro, la misma energía y el mismo ritmo de principio a fin del ' +
      'bloque: es una conversación seguida, se genera de una vez a propósito, y si la ' +
      'entrega cambia a mitad se oye como si fuera otra persona.',
    `Dentro del texto puedes usar estas etiquetas en línea cuando la dirección lo pida, y ` +
      `ninguna otra: ${etiquetas.join(', ')}.`
  ].join(' ');

  return { partes, instruccion };
}

// ---------------------------------------------------------------------------
// Cupos de referencias
// ---------------------------------------------------------------------------

/**
 * Lee un cupo escrito en serie.json y lo devuelve masticado.
 *
 * Vienen de dos formas: un número suelto (`"veo": 3`), que es un tope para
 * todas las referencias juntas, y una frase (`"6 de objeto + 5 de personaje + 3
 * de estilo"`), que es un tope por cupo.
 *
 * @param {*} escrito
 * @returns {{total:number|null, porCupo:Object<string,number>}|null} null si no
 *   hay nada legible.
 */
function leerCupo(escrito) {
  if (typeof escrito === 'number' && Number.isFinite(escrito)) {
    return { total: escrito, porCupo: {} };
  }
  if (typeof escrito !== 'string') return null;

  const porCupo = {};
  const trozos = escrito.matchAll(/(\d+)\s+de\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/g);
  for (const trozo of trozos) porCupo[normalizarCupo(trozo[2])] = Number(trozo[1]);

  if (Object.keys(porCupo).length) return { total: null, porCupo };

  // Un número escrito como texto («3») también vale.
  const suelto = escrito.trim().match(/^(\d+)$/);
  if (suelto) return { total: Number(suelto[1]), porCupo: {} };

  return null;
}

/**
 * Deja un nombre de cupo comparable: minúsculas y sin tildes.
 * @param {*} cupo
 * @returns {string}
 */
function normalizarCupo(cupo) {
  return String(cupo === null || cupo === undefined ? '' : cupo)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Busca el cupo del modelo dentro de `instrucciones_referencia.maximo_referencias`.
 * Primero por id exacto, y si no, por la clave que sea prefijo del id: así
 * la clave «veo» vale para cualquiera de los tres ids de Veo que estén escritos
 * en serie.json, sin tener que repetirlos aquí.
 * @param {string} idModelo
 * @returns {{clave:string, cupo:{total:number|null, porCupo:Object<string,number>}}|null}
 */
function cupoDelModelo(idModelo) {
  const maximos = (serie.instrucciones_referencia || {}).maximo_referencias || {};
  const id = String(idModelo === null || idModelo === undefined ? '' : idModelo).trim();
  if (!id) return null;

  const exacto = leerCupo(maximos[id]);
  if (exacto) return { clave: id, cupo: exacto };

  // La clave más larga que encaje, para que una clave más concreta gane siempre
  // a otra más general que también empiece igual.
  const candidatas = Object.keys(maximos)
    .filter((clave) => id === clave || id.startsWith(`${clave}-`))
    .sort((a, b) => b.length - a.length);
  for (const clave of candidatas) {
    const cupo = leerCupo(maximos[clave]);
    if (cupo) return { clave, cupo };
  }
  return null;
}

/**
 * Comprueba que las referencias caben en el modelo **antes de gastar**.
 *
 * Los cupos de objeto y de personaje NO compiten entre sí: el escenario viaja
 * como objeto y los personajes como personaje, y son huecos distintos. Por eso
 * se cuenta por cupo y no en total, salvo cuando serie.json escribe un número
 * suelto (el caso de Veo), que sí es un tope para todo junto.
 *
 * Pasarse no da un error claro del otro lado: da una llamada fallida ya cobrada.
 * Por eso esto se mira aquí, con las referencias todavía en la mano.
 *
 * @param {{cupo:string}[]} referencias las que devuelven `promptPlaca()` y
 *   `promptKeyframe()`, o las que ya lleva `imagen.js` con sus bytes dentro.
 * @param {string} idModelo el id del modelo al que se le van a mandar.
 * @returns {{porCupo:Object<string,number>, total:number}} el recuento, para que
 *   quien quiera pueda enseñarlo o medirlo.
 */
export function comprobarCupos(referencias, idModelo) {
  const lista = Array.isArray(referencias) ? referencias : [];

  const porCupo = {};
  for (const referencia of lista) {
    const cupo = normalizarCupo(referencia && referencia.cupo);
    if (!cupo) {
      throw new ErrorDeCara(
        'Una de las referencias que se iban a adjuntar no dice de qué cupo es (objeto o ' +
          'personaje). Eso es un fallo de programación: las referencias salen de prompt.js ' +
          'y siempre llevan su cupo puesto.',
        {
          detalle: JSON.stringify(referencia && (referencia.placa || referencia.escenario)) || null,
          reintentable: false,
          http: 500
        }
      );
    }
    porCupo[cupo] = (porCupo[cupo] || 0) + 1;
  }
  const total = lista.length;

  const encontrado = cupoDelModelo(idModelo);
  if (!encontrado) {
    // No hay número escrito para este modelo —el económico no lo tiene, y un
    // modelo puesto por variable de entorno tampoco lo tendrá—. No se inventa:
    // por lo bajo bloquearía una generación legítima y por lo alto no evitaría
    // nada. Se sigue, y quien se pase lo verá en el error de Google, literal.
    return { porCupo, total };
  }

  const { clave, cupo } = encontrado;

  if (cupo.total !== null && total > cupo.total) {
    throw new ErrorDeCara(
      `Al modelo «${idModelo}» solo se le pueden adjuntar ${cupo.total} referencias y se le ` +
        `están pasando ${total}. Hay que quitar ${total - cupo.total} antes de generar: ` +
        'la llamada fallaría igual, pero después de haberla pagado.',
      { reintentable: false, http: 400 }
    );
  }

  for (const [nombreCupo, cuantas] of Object.entries(porCupo)) {
    const maximo = cupo.porCupo[nombreCupo];
    if (maximo === undefined) continue; // ese cupo no está escrito para este modelo
    if (cuantas > maximo) {
      throw new ErrorDeCara(
        `El modelo «${idModelo}» admite como mucho ${maximo} referencias de ${nombreCupo} y ` +
          `se le están pasando ${cuantas}. Hay que quitar ${cuantas - maximo} antes de ` +
          'generar: la llamada fallaría igual, pero después de haberla pagado. ' +
          `El cupo escrito para «${clave}» en datos/serie.json es: ` +
          `${Object.entries(cupo.porCupo).map(([c, n]) => `${n} de ${c}`).join(' + ')}.`,
        { reintentable: false, http: 400 }
      );
    }
  }

  return { porCupo, total };
}

// ---------------------------------------------------------------------------
// Los pósters y las miniaturas
// ---------------------------------------------------------------------------

/**
 * El prompt de un póster o de una miniatura de episodio.
 *
 * NO ES UN FOTOGRAMA. Un póster es una composición propia: se dibuja de cero
 * usando como referencia las placas ya aprobadas, para que sea la misma cara,
 * la misma luz y el mismo estilo que el resto de la serie. Por eso lleva las
 * mismas referencias de personaje que un keyframe y con la misma línea pegada
 * detrás — sin ella el modelo copia el ENCUADRE de la placa en vez de la cara.
 *
 * EL TÍTULO VA DENTRO DE LA IMAGEN, y es una decisión tomada a sabiendas por
 * quien paga. Los modelos de imagen escriben mal las tildes y las eñes, así que
 * «LA MIRADA QUE EL MUNDO TEMERÁ» puede salir con letras inventadas. Se pide
 * escrito con todas las letras, se mira, y se rehace hasta que salga. Lo que NO
 * se hace es corregirlo por detrás: un título mal escrito que nadie mira acaba
 * publicado.
 *
 * @param {string} id el id de `difusion.posters.piezas`
 * @returns {{texto:string, negativo:string, referencias:object[]}}
 */
export function promptPoster(id, proporcion = null) {
  const laPieza = posterDeDifusion(id);
  const posters = (serie.difusion && serie.difusion.posters) || {};

  const partes = [laPieza.encargo];

  // La proporción no solo se le pasa al modelo como ajuste: se le DICE, porque
  // una composición vertical y una horizontal no son la misma imagen recortada.
  //
  // Pero se le dice como REENCUADRE, no como composición nueva: la composición
  // ya la manda el encargo, que es quien sabe dónde está la banda del título y
  // qué figura pesa. Una frase genérica del tipo «el sujeto a un lado y el hueco
  // abriéndose de lado» pelearía con un encargo que ha puesto la cabeza arriba,
  // y esa pelea la resuelve el modelo a su gusto.
  const forma = String(proporcion || '').trim();
  if (forma === '9:16') {
    partes.push(
      'Frame this as a tall vertical image. Keep the composition described above and let its ' +
        'depth run upwards and downwards; do not crop the subject away to make it fit.'
    );
  } else if (forma === '16:9') {
    partes.push(
      'Frame this as a wide horizontal image. Keep the composition described above and re-stage ' +
        'it for the wider frame: the depth opens sideways and the reserved title band stretches ' +
        'across, but nothing that the composition places is cropped out or moved on top of a face.'
    );
  }

  // EL TÍTULO. Cada encargo reserva su banda —dónde está el hueco oscuro donde
  // el título no compite con ninguna cara es una decisión de composición, y por
  // eso vive en la pieza—, pero CÓMO se escribe es de la serie entera y vive
  // aquí: doce miniaturas con doce tipografías distintas no parecen una serie.
  //
  // Y el interruptor de apagarlo tiene que decir «deja esa banda vacía», no un
  // «sin texto» a secas: los encargos hablan de su banda de título, así que una
  // negación suelta al final los contradiría y el modelo resolvería la
  // contradicción a su gusto. Se le dice qué hacer con la banda que ya conoce.
  if (posters.titulo_en_la_imagen === true) {
    const titulo = String(posters.titulo || '').trim();
    if (titulo) {
      partes.push(
        `In the empty band reserved for it, and nowhere else, the exact title "${titulo}" is ` +
        'written: tall condensed heavy uppercase letters, wide letterspacing, a single hairline ' +
        'rule beneath them, the letters sitting on the darkness rather than floating over any ' +
        'face. Spelled EXACTLY like that, letter by letter, accents included. Nothing else is ' +
        'written anywhere in the image: no subtitle, no episode number, no credits, no ' +
        'watermark, no logo, no lettering of any kind on any surface.'
      );
    }
  } else {
    partes.push(
      'The band reserved for the title stays completely empty: no title, no words, no letters, ' +
        'no numbers, no watermark, no lettering anywhere in the image. Leave that area as clean ' +
        'darkness.'
    );
  }

  const referencias = [];
  for (const idRef of Array.isArray(laPieza.refs) ? laPieza.refs : []) {
    const laPlaca = placa(idRef);
    ponerReferencia(referencias, {
      placa: laPlaca.id,
      instruccion: instruccionDeToma(laPlaca.personaje),
      cupo: 'personaje'
    });
  }

  return {
    texto: sellar(unir(...partes)),
    negativo: negativoDelPoster(posters.titulo_en_la_imagen === true),
    referencias
  };
}

/**
 * El negativo de un póster.
 *
 * ESTE ERA UN FALLO DE VERDAD, y de los que no dan ningún error. El negativo de
 * la serie lleva «text» dentro, porque en un keyframe o en un clip cualquier
 * letra que aparezca es basura. Pero en un póster el título va DENTRO de la
 * imagen y se pide con todas las letras: mandarlo con «text» en el negativo es
 * pedirle al modelo una cosa y prohibírsela en la misma llamada.
 *
 * El modelo no contesta con un error: contesta con un título flojo, o torcido, o
 * pegado encima como una pegatina, y eso pasa por «así escriben los modelos» sin
 * que nadie sospeche de la lista de negativos. Se paga la generación igual.
 *
 * Así que cuando el título va dentro, se quitan del negativo las palabras que
 * hablan de texto y NADA MÁS: la marca de agua y la firma se quedan, porque esas
 * sí sobran siempre, y el resto del negativo —paleta shonen, render 3D, ojos
 * brillantes— es lo que hace que el póster se parezca a la serie.
 *
 * @param {boolean} conTitulo si el título va escrito dentro de la imagen
 * @returns {string}
 */
function negativoDelPoster(conTitulo) {
  const negativo = negativoDeEstilo();
  if (!conTitulo) return negativo;

  const quitar = new Set(['text', 'lettering', 'typography', 'letters', 'words']);
  const quedan = negativo
    .split(',')
    .map((una) => una.trim())
    .filter((una) => una && !quitar.has(una.toLowerCase()));

  return quedan.join(', ');
}

/**
 * Un póster o una miniatura de `difusion.posters.piezas`.
 * @param {string} id
 * @returns {object}
 */
export function posterDeDifusion(id) {
  const posters = (serie.difusion && serie.difusion.posters) || {};
  const piezas = Array.isArray(posters.piezas) ? posters.piezas : [];
  const encontrada = piezas.find((una) => una && una.id === id);
  if (!encontrada) {
    throw new ErrorDeCara(
      `No existe el póster «${id}». Debería estar en difusion.posters.piezas de datos/serie.json, ` +
        `que hoy tiene ${piezas.length}. Los que hay son: ` +
        `${piezas.map((una) => una.id).join(', ') || 'ninguno'}.`,
      { reintentable: false, http: 400 }
    );
  }
  if (typeof encontrada.encargo !== 'string' || !encontrada.encargo.trim()) {
    throw new ErrorDeCara(
      `El póster «${id}» no tiene encargo escrito, y el encargo es todo el prompt: sin él no hay ` +
        'nada que dibujar.',
      { reintentable: false, http: 500 }
    );
  }
  return encontrada;
}
