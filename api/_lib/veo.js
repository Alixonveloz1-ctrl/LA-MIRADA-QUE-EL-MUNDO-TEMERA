// El vídeo: lanzar un clip de Veo y consultar cómo va.
//
// Dos funciones y nada más. `lanzar()` mete la generación en la cola de Google y
// devuelve el nombre de la operación; `consultar()` pregunta por ese nombre.
// Entre las dos pueden pasar minutos, y por eso están separadas: una función
// serverless vive menos de un minuto y un clip de Veo tarda más que eso.
//
// LO QUE ESTE ARCHIVO NO HACE, Y NO ES UN OLVIDO:
//
//   · NO devuelve la ruta del MP4. El nombre del archivo lo pone Veo, no
//     nosotros, y adivinarlo es como se pierde un clip ya pagado. Quien lo busca
//     es el modo `veo-consultar`, listando el prefijo de `storageUri` cuando la
//     operación termina. Ni siquiera se mira el `gcsUri` que Veo escribe dentro
//     de la respuesta: hay un solo camino para encontrar el archivo, y es
//     listar la carpeta.
//   · NO cambia de modelo NUNCA. Si el nivel pedido falla, se devuelve el error
//     de Google tal cual. Un clip generado con otro modelo sale distinto y nadie
//     sabría por qué.
//   · NO compone el prompt. Llega ya sellado desde `prompt.js`, y aquí se
//     comprueba que de verdad lo está: es el último cerrojo antes de gastar un
//     euro. Un clip sin `estilo.bloque` se tira, y se paga igual.
//
// LAS DOS TRAMPAS QUE VIVEN AQUÍ, las dos ya pagadas:
//
//   1. DURACIONES. Veo solo genera 4, 6 u 8 segundos. Los de 2 y 3 no existen.
//      Por eso cada toma de datos/serie.json trae `dur_gen` (lo que se le pide a
//      Veo) y `recorte` (los segundos que de verdad se usan al montar). Pedir 3
//      no da un clip de 3: da una llamada rechazada.
//   2. `lastFrame`. El encadenado se le pide a Veo adjuntando el keyframe de la
//      toma siguiente para que interpole. No todos los modelos ni todas las
//      versiones lo aceptan, así que si lo rechaza se reintenta UNA vez, CON EL
//      MISMO MODELO y sin él, y se avisa por pantalla de que ese corte no va
//      encadenado. Lo que no se hace jamás es bajar de nivel para que pase.

import { Buffer } from 'node:buffer';
import { entorno } from './entorno.js';
import { serie, nivelVeo } from './datos.js';
import { ErrorDeCara } from './errores.js';
import { llamar, urlModelo, conGrafias, comoGrafia } from './vertex.js';

// Los únicos parámetros fijos, tal cual los declara `modelos.video.parametros_fijos`
// en datos/serie.json. El 16:9 tiene que coincidir con el de la imagen o el clip
// recorta el keyframe que se aprobó; `generateAudio` va en false porque la banda
// se compone aparte y con audio cuesta el doble.
const PROPORCION = '16:9';
const CUANTOS = 1;
const CON_AUDIO = false;
const PERSONAS = 'allow_adult';

// Lo único que Veo acepta como duración. No es una preferencia: 2 y 3 segundos
// no existen en el modelo.
const DURACIONES = [4, 6, 8];

// A Veo le viaja SIEMPRE una copia reducida a 1280 px y convertida a JPEG, hecha
// en el navegador. El master 2K en PNG pesa ~6,8 MB (~9,1 MB en base64) y no
// cabe en los 4,5 MB de la petición.
const MIME_DE_LA_IMAGEN = 'image/jpeg';

// Presupuesto de tiempo de `lanzar()`, para las DOS llamadas que puede hacer (la
// que lleva `lastFrame` y la que lo reintenta sin él). Si cada una tuviera su
// propio límite de 45 s, dos intentos sumarían 90 s y la plataforma apagaría la
// función a los 60 sin lanzar ninguna excepción: el clip quedaría lanzado o no
// —no habría manera de saberlo— y sin nombre de operación que consultar.
const PRESUPUESTO_LANZAR_MS = 45_000;

// Por debajo de esto no da tiempo ni a que Google conteste, así que no se
// empieza un reintento que se va a cortar a mitad.
const MINIMO_PARA_REINTENTAR_MS = 5_000;

// Consultar una operación es leer cuatro campos: contesta en menos de un
// segundo. Se le da un límite más corto que el de generar a propósito, para que
// al modo `veo-consultar` le quede tiempo de listar el prefijo y firmar la URL
// dentro del mismo minuto.
const LIMITE_CONSULTA_MS = 20_000;

// Cómo se reconoce que lo que ha fallado es el fotograma de enlace. Google lo
// nombra `lastFrame`, y según la versión de la API aparece también como
// `last_frame`.
const LASTFRAME_EN_EL_TEXTO = /last[\s_-]*frame/i;

// Firmas de archivo, para saber qué se está mandando de verdad mirando los
// primeros bytes, que es lo único que no miente.
const FIRMAS = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }
];

// ---------------------------------------------------------------------------
// Lanzar
// ---------------------------------------------------------------------------

/**
 * Lanza la generación de un clip contra `:predictLongRunning` del modelo de Veo
 * del nivel pedido, y devuelve el nombre de la operación.
 *
 * Devolver el nombre es lo único que importa de esta llamada: mientras no esté
 * guardado, la operación está viva del lado de Google y nadie sabe consultarla.
 * Por eso quien llama tiene que escribirlo en `operacion_en_curso` ANTES de
 * contestarle al navegador (contrato §5).
 *
 * @param {{texto:string, negativo:string, imagenB64:string,
 *          lastFrameB64?:string|null, nivel:string, durGen:number,
 *          storageUri:string}} encargo
 *        `texto` es el prompt YA SELLADO por `prompt.js` (lleva pegado
 *        `estilo.bloque`); aquí se comprueba y si no lo lleva no se gasta nada.
 *        `imagenB64` y `lastFrameB64` son los JPEG de 1280 px que ha preparado
 *        el navegador, en base64 y sin cabecera de data URL.
 *        `durGen` tiene que ser 4, 6 u 8.
 *        `storageUri` es la carpeta del bucket donde Veo escribirá el MP4.
 * @returns {Promise<{operacion:string, avisoSinLastFrame:boolean}>}
 *          `avisoSinLastFrame` en true significa que el modelo rechazó el
 *          fotograma de enlace y el clip se ha lanzado sin encadenar: la
 *          pantalla tiene que decirlo, porque ese corte se notará al montar.
 */
export async function lanzar({
  texto,
  negativo,
  imagenB64,
  lastFrameB64 = null,
  nivel,
  durGen,
  storageUri
} = {}) {
  // Todo lo que se pueda comprobar sin red se comprueba antes de la llamada: un
  // clip cuesta cerca de un euro y un rechazo por un campo mal puesto se paga
  // igual en tiempo aunque no se cobre.
  const prompt = comprobarSellado(texto);
  const negativoFinal = comprobarNegativo(negativo);
  const duracion = comprobarDuracion(durGen);
  const carpeta = comprobarStorageUri(storageUri);
  const imagen = comprobarJpeg(imagenB64, 'el keyframe aprobado de esta toma', true);
  const enlace = comprobarJpeg(lastFrameB64, 'el fotograma de enlace (lastFrame)', false);

  // El id del modelo no se escribe aquí: sale de datos/serie.json por el nivel
  // que pide la toma, y lo puede sustituir la variable VEO_MODEL sin tocar una
  // línea de código.
  const modelo = nivelVeo(nivel);
  const ent = entorno();

  const finDelPlazo = Date.now() + PRESUPUESTO_LANZAR_MS;
  const restante = () => finDelPlazo - Date.now();

  // Por todas las grafías del modelo, igual que en imagen, voz, música y texto:
  // Vertex publica el mismo Veo con el nombre de preview y con el definitivo.
  // Un 404 no cuesta nada y no genera nada, así que probar el otro nombre es
  // gratis; quedarse en el primero es dar por perdida una cuenta que sí lo tiene.
  //
  // El plazo es UNO para toda la llamada, no uno por grafía: lo que no puede
  // pasar es que probar nombres se coma el tiempo de generar.
  return conGrafias(modelo, (id) =>
    lanzarConEsteNombre(comoGrafia(modelo, id), ent, restante, {
      prompt,
      negativo: negativoFinal,
      imagen,
      enlace,
      duracion,
      carpeta
    })
  );
}

/**
 * El lanzamiento con UNA grafía concreta del modelo, con su región.
 *
 * Aquí dentro está el baile del fotograma de enlace: se pide con él y, si el
 * modelo lo rechaza, se vuelve a pedir una sola vez sin él. Los dos intentos son
 * del mismo nombre de modelo, y por eso están juntos: si el que falla es el
 * nombre —un 404—, sale de aquí sin tocar nada y `conGrafias` prueba el
 * siguiente; si el que falla es el fotograma, no hay nombre que arregle eso.
 *
 * @param {{id:string, region:string, variable:string}} conEsteNombre
 * @param {object} ent el entorno ya leído.
 * @param {() => number} restante milisegundos que quedan de los 60 s de la
 *   plataforma. Es UNO para toda la llamada, no uno por grafía.
 * @param {object} pieza prompt, negativo, imagen, enlace, duracion y carpeta,
 *   ya comprobados por `lanzar()`.
 * @returns {Promise<{operacion:string, avisoSinLastFrame:boolean}>}
 */
async function lanzarConEsteNombre(conEsteNombre, ent, restante, pieza) {
  const { prompt, negativo, imagen, enlace, duracion, carpeta } = pieza;
  const url = urlModelo(conEsteNombre, 'predictLongRunning', ent.sa.project_id);

  const contexto = {
    que: 'lanzar la generación del clip',
    modelo: conEsteNombre.id,
    region: conEsteNombre.region,
    variable: conEsteNombre.variable
  };

  // Primer intento: con el fotograma de enlace, si esta toma encadena.
  try {
    const respuesta = await llamar(url, cuerpoDeLanzamiento(prompt, negativo, imagen, enlace, duracion, carpeta), {
      metodo: 'POST',
      limiteMs: restante(),
      contexto
    });
    return { operacion: nombreDeOperacion(respuesta, conEsteNombre), avisoSinLastFrame: false };
  } catch (fallo) {
    if (!esRechazoDeLastFrame(fallo, enlace !== null)) {
      // Ha fallado por otra cosa. Se devuelve el error de Google tal cual, sin
      // tocar el modelo ni la petición: cambiar algo aquí a escondidas es cómo
      // se acaba con un clip distinto y sin saber por qué.
      throw fallo;
    }

    if (restante() < MINIMO_PARA_REINTENTAR_MS) {
      throw new ErrorDeCara(
        'El modelo ha rechazado el fotograma de enlace (lastFrame) y tocaba volver a intentarlo ' +
          'una vez, con el mismo modelo y sin él, pero ya no queda tiempo dentro de esta llamada: ' +
          'la función dura menos de un minuto y el primer intento se lo ha llevado casi entero. No ' +
          'se ha generado nada, así que no se ha gastado nada. Vuelve a lanzar este clip: se ' +
          'intentará otra vez encadenado y, si se vuelve a rechazar, se generará sin encadenar. ' +
          'Debajo está, literal, lo que ha dicho Google.',
        {
          detalle: fallo && fallo.detalle ? fallo.detalle : (fallo && fallo.mensaje) || null,
          reintentable: fallo && fallo.reintentable,
          http: (fallo && fallo.http) || 502
        }
      );
    }

    // Segundo y último intento: EL MISMO MODELO, sin el fotograma de enlace.
    // Este clip se usará entero igual (`dur === dur_gen` en las tomas
    // encadenadas), pero la entrada no interpolará con la toma anterior y el
    // corte se verá. Por eso vuelve el aviso: para que se diga en pantalla.
    const respuesta = await llamar(url, cuerpoDeLanzamiento(prompt, negativo, imagen, null, duracion, carpeta), {
      metodo: 'POST',
      limiteMs: restante(),
      contexto
    });
    return { operacion: nombreDeOperacion(respuesta, conEsteNombre), avisoSinLastFrame: true };
  }
}

/**
 * El cuerpo de `:predictLongRunning`, tal cual lo pide docs/contrato.md §2.
 *
 * @param {string} prompt el prompt sellado.
 * @param {string} negativo lo que no queremos ver; Veo tiene campo propio para
 *   esto (`negativePrompt`) y ahí es donde de verdad lo escucha.
 * @param {string} imagen el keyframe en base64, ya comprobado.
 * @param {string|null} enlace el fotograma de enlace, o null si no encadena.
 * @param {number} duracion 4, 6 u 8.
 * @param {string} carpeta el `gs://…/` donde Veo escribe el MP4.
 * @returns {object}
 */
function cuerpoDeLanzamiento(prompt, negativo, imagen, enlace, duracion, carpeta) {
  const instancia = {
    prompt,
    image: { bytesBase64Encoded: imagen, mimeType: MIME_DE_LA_IMAGEN }
  };

  // Solo va si la toma encadena. Una toma que no encadena y llevara lastFrame
  // saldría interpolando hacia una imagen que no le toca.
  if (enlace !== null) {
    instancia.lastFrame = { bytesBase64Encoded: enlace, mimeType: MIME_DE_LA_IMAGEN };
  }

  return {
    instances: [instancia],
    parameters: {
      aspectRatio: PROPORCION,
      sampleCount: CUANTOS,
      durationSeconds: duracion,
      generateAudio: CON_AUDIO,
      personGeneration: PERSONAS,
      // El MP4 lo escribe Veo directo en el bucket y no pasa por la función
      // jamás: un clip de 8 s a 1080p pesa unos 35 MB y el tope son 4,5 MB.
      storageUri: carpeta,
      negativePrompt: negativo
    }
  };
}

/**
 * ¿Lo que ha fallado es el fotograma de enlace?
 *
 * Se reintenta sin él en dos casos, y solo si se había mandado: cuando Google lo
 * nombra por su nombre, y cuando contesta un 400 —el código con el que rechaza
 * una petición mal formada— habiendo mandado uno.
 *
 * EL 413 QUEDA FUERA A PROPÓSITO. Aligerar la petición quitando una imagen
 * podría hacer que colara, pero un 413 no se reintenta nunca (contrato §4): es
 * tamaño, y lo que hay que hacer con el tamaño es decir en pantalla que no cabe
 * y cuánto pesaba, no probar suerte con media petición.
 *
 * @param {*} fallo el error que lanzó `llamar()`.
 * @param {boolean} seMando si esta llamada llevaba lastFrame.
 * @returns {boolean}
 */
function esRechazoDeLastFrame(fallo, seMando) {
  if (!seMando) return false;

  const http = Number(fallo && fallo.http);
  if (http === 413) return false;

  const dicho = `${(fallo && fallo.detalle) || ''} ${(fallo && fallo.mensaje) || ''}`;
  if (LASTFRAME_EN_EL_TEXTO.test(dicho)) return true;

  return http === 400;
}

/**
 * El nombre de la operación que acaba de crearse. Sin él la generación queda
 * huérfana: viva del lado de Google, cobrándose, y sin nadie que la consulte.
 *
 * @param {object} respuesta lo que contestó `:predictLongRunning`.
 * @param {{id:string}} modelo para poder decir quién contestó así.
 * @returns {string}
 */
function nombreDeOperacion(respuesta, modelo) {
  const nombre = respuesta && typeof respuesta.name === 'string' ? respuesta.name.trim() : '';

  if (!nombre || !nombre.includes('/operations/')) {
    throw new ErrorDeCara(
      `El modelo «${modelo.id}» ha aceptado la petición pero no ha devuelto el nombre de la ` +
        'operación, que es lo único con lo que se puede preguntar después si el clip está listo. ' +
        'Puede que la generación se esté haciendo igualmente: si aparece un MP4 nuevo en la ' +
        'carpeta de esta toma, es este. Debajo está, tal cual, lo que contestó Google.',
      { detalle: comoTexto(respuesta), reintentable: false, http: 502 }
    );
  }

  return nombre;
}

// ---------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------

/**
 * Pregunta por una operación de Veo con `:fetchPredictOperation`.
 *
 * Devuelve solo si ha terminado y, si terminó mal, qué dijo Google. NO devuelve
 * la ruta del MP4 ni la intenta adivinar: el nombre del archivo lo pone Veo, y
 * quien lo busca es el modo `veo-consultar`, listando el prefijo de
 * `storageUri`. La respuesta de Veo trae un `gcsUri` dentro y aquí se ignora a
 * conciencia: dos maneras de encontrar el mismo archivo son dos maneras de
 * perderlo.
 *
 * @param {string} operacion el nombre completo, tal cual lo devolvió `lanzar()`.
 * @param {string} nivel el mismo nivel con el que se lanzó. Tiene que ser el
 *   mismo: la operación vive colgada de su modelo.
 * @returns {Promise<{hecho:boolean, error:string|null}>} `error` trae el texto
 *   literal de Google cuando la operación terminó mal, y null cuando no.
 */
export async function consultar(operacion, nivel) {
  const nombre = comprobarNombreDeOperacion(operacion);
  const modelo = nivelVeo(nivel);

  // Aquí NO se prueban grafías: la operación vive colgada de la que la lanzó y
  // de la región donde se creó, y las dos van escritas dentro de su nombre. Se
  // pregunta exactamente ahí. Probar otro nombre solo conseguiría un 404 por
  // cada uno y dar por perdido un clip que se está generando bien.
  const comoSeLanzo = grafiaDeLaOperacion(nombre, modelo);

  const ent = entorno();
  const url = urlModelo(comoSeLanzo, 'fetchPredictOperation', ent.sa.project_id);

  const respuesta = await llamar(url, { operationName: nombre }, {
    metodo: 'POST',
    limiteMs: LIMITE_CONSULTA_MS,
    contexto: {
      que: 'consultar cómo va el clip',
      modelo: comoSeLanzo.id,
      region: comoSeLanzo.region,
      variable: modelo.variable
    }
  });

  const hecho = respuesta && respuesta.done === true;
  return { hecho: Boolean(hecho), error: hecho ? errorDeLaOperacion(respuesta) : null };
}

/**
 * Lo que Google dice cuando una operación terminó mal, literal.
 *
 * Son dos casos distintos y los dos acaban sin MP4:
 *  · La operación trae `error`: es un `google.rpc.Status`, con su mensaje y a
 *    veces sus `details`. Van los dos, sin reescribir nada.
 *  · La operación termina «bien» pero el filtro de contenido se quedó con el
 *    vídeo (`raiMediaFilteredReasons`). Sin esto, quien busque el archivo solo
 *    vería una carpeta vacía y ningún motivo; con esto se lee en pantalla por
 *    qué no hay clip, que es lo único que dice qué hay que cambiar del prompt.
 *
 * @param {object} respuesta la operación ya terminada.
 * @returns {string|null}
 */
function errorDeLaOperacion(respuesta) {
  const trozos = [];

  const fallo = respuesta && respuesta.error;
  if (fallo) {
    if (typeof fallo === 'string') {
      trozos.push(fallo);
    } else {
      if (fallo.message) trozos.push(String(fallo.message));
      if (Array.isArray(fallo.details) && fallo.details.length) trozos.push(comoTexto(fallo.details));
      if (!trozos.length) trozos.push(comoTexto(fallo));
    }
  }

  const dentro = (respuesta && respuesta.response) || {};
  const motivos = dentro.raiMediaFilteredReasons || dentro.rai_media_filtered_reasons || [];
  const cuantos = Number(dentro.raiMediaFilteredCount ?? dentro.rai_media_filtered_count ?? 0);
  const lista = Array.isArray(motivos) ? motivos.map((m) => String(m).trim()).filter(Boolean) : [];

  if (lista.length) {
    trozos.push(lista.join(' · '));
  } else if (Number.isFinite(cuantos) && cuantos > 0) {
    trozos.push(
      `El filtro de contenido de Google se ha quedado con ${cuantos} de los vídeos generados y no ` +
        'ha dicho por qué.'
    );
  }

  return trozos.length ? trozos.join('\n') : null;
}

/**
 * El nombre de la operación, comprobado.
 * @param {*} operacion
 * @returns {string}
 */
function comprobarNombreDeOperacion(operacion) {
  const nombre = String(operacion === null || operacion === undefined ? '' : operacion).trim();

  if (!nombre) {
    throw new ErrorDeCara(
      'Se ha pedido consultar un clip sin decir qué operación. El nombre de la operación es lo ' +
        'que devuelve Veo al lanzarla y lo que queda guardado en el estado, en ' +
        '«operacion_en_curso» de esa toma. Sin él no hay nada que preguntar.',
      { reintentable: false, http: 400 }
    );
  }

  if (!nombre.includes('/operations/')) {
    throw new ErrorDeCara(
      `«${nombre}» no es el nombre de una operación de Veo. El que vale es el completo, el que ` +
        'devolvió Google al lanzar el clip, y lleva dentro «/operations/».',
      { reintentable: false, http: 400 }
    );
  }

  return nombre;
}

/**
 * Una operación vive colgada del modelo que la creó: se consulta al mismo modelo
 * y en la misma región, o Google contesta un 404 que parece falta de acceso.
 *
 * Si el nombre no tiene la forma habitual no se comprueba nada y se sigue: el
 * que manda es Google, no esta expresión regular.
 *
 * @param {string} nombre
 * @param {{id:string, region:string, variable:string}} modelo
 */
function grafiaDeLaOperacion(nombre, modelo) {
  const partes = /\/locations\/([^/]+)\/publishers\/[^/]+\/models\/([^/]+)\/operations\//.exec(nombre);
  if (!partes) return modelo;

  const regionDelNombre = partes[1];
  const modeloDelNombre = partes[2];

  // Cualquiera de las grafías de ESTE nivel vale: son nombres distintos del
  // mismo modelo y el clip se lanzó con la que contestara ese día. Lo que no
  // vale es otro nivel de Veo, que sí sería otro modelo y otro precio.
  const grafias = Array.isArray(modelo.ids) && modelo.ids.length ? modelo.ids : [modelo.id];
  if (grafias.includes(modeloDelNombre)) {
    // La región sale del nombre y no de la tabla: donde se creó la operación es
    // el único sitio donde se puede consultar, aunque GCP_LOCATION haya cambiado.
    return { ...modelo, id: modeloDelNombre, region: regionDelNombre };
  }

  throw new ErrorDeCara(
    `Este clip se lanzó con el modelo «${modeloDelNombre}» en la región «${regionDelNombre}» y ` +
      `ahora se está preguntando por él a un nivel de Veo que se llama ${grafias.join(' o ')}, ` +
      'que no es el mismo modelo: Google contestaría que no existe. Una operación solo se puede ' +
      'consultar donde se creó. Suele pasar por dos motivos: la toma tiene apuntado otro nivel de ' +
      `Veo del que se usó al lanzarla, o se ha cambiado la variable ${modelo.variable} con el clip ` +
      'a medio generar. Devuélvela a como estaba para recoger este clip, o da la toma por perdida ' +
      'y vuelve a lanzarla.',
    { reintentable: false, http: 400 }
  );
}

// ---------------------------------------------------------------------------
// Comprobaciones antes de gastar
// ---------------------------------------------------------------------------

// FALTA EN EL CONTRATO: docs/contrato.md §12 no da ninguna función para
// PREGUNTAR si un prompt ya viene sellado. `sellar()` lo comprueba por dentro
// —para negarse a sellar dos veces— pero no lo exporta, y este módulo necesita
// preguntarlo antes de gastar. Se comprueba aquí con la misma regla que usa
// `prompt.js`. Si algún día se exporta desde ahí (`llevaElSello(texto)`), esta
// copia sobra y se borra.

/**
 * Compara ignorando cuántos espacios o saltos de línea hay entre palabras: el
 * bloque puede llegar reindentado y seguiría siendo el mismo bloque.
 * @param {string} s
 * @returns {string}
 */
function sinEspaciosDeMas(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * El prompt tiene que llegar con el bloque de estilo pegado. Es el último
 * cerrojo antes de gastar: un clip sin `estilo.bloque` sale con otro aspecto que
 * el keyframe del que parte, hay que tirarlo, y se paga igual.
 *
 * @param {*} texto
 * @returns {string} el prompt, tal cual, listo para mandar.
 */
function comprobarSellado(texto) {
  const prompt = String(texto === null || texto === undefined ? '' : texto).trim();

  if (!prompt) {
    throw new ErrorDeCara(
      'Se ha pedido generar un clip sin prompt. El prompt lo compone la función con ' +
        'promptVideo() a partir de datos/serie.json, así que esto es un fallo del propio estudio, ' +
        'no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  const bloque = serie.estilo && serie.estilo.bloque;
  if (typeof bloque !== 'string' || !bloque.trim()) {
    throw new ErrorDeCara(
      'Falta el bloque de estilo en datos/serie.json (estilo.bloque), que es el texto que se pega ' +
        'literal al final de todos los prompts de imagen y de vídeo. Sin él no se puede ni ' +
        'comprobar que este prompt viene sellado, y sin sellar no se genera nada: saldría con otro ' +
        'aspecto y habría que tirarlo después de pagarlo.',
      { reintentable: false, http: 500 }
    );
  }

  const cuerpo = sinEspaciosDeMas(prompt);
  const sello = sinEspaciosDeMas(bloque);
  const huella = sello.slice(0, 48);
  const sellado = cuerpo.includes(sello) || (huella.length >= 16 && cuerpo.includes(huella));

  if (!sellado) {
    throw new ErrorDeCara(
      'El prompt que se le iba a mandar a Veo no lleva pegado el bloque de estilo de la serie, y ' +
        'sin él el clip saldría con otro aspecto que el keyframe del que parte: habría que tirarlo ' +
        'después de haberlo pagado. Los prompts de vídeo se componen en prompt.js con ' +
        'promptVideo(), que termina siempre en sellar(); aquí tienen que llegar ya sellados. Es un ' +
        'fallo de programación, no de tu cuenta.',
      { detalle: prompt.slice(0, 400), reintentable: false, http: 500 }
    );
  }

  return prompt;
}

/**
 * El negativo. Veo tiene campo propio para esto y es donde de verdad lo escucha,
 * así que llegar vacío no es un detalle: es generar sin la mitad de las reglas
 * de estilo de la serie.
 * @param {*} negativo
 * @returns {string}
 */
function comprobarNegativo(negativo) {
  const texto = String(negativo === null || negativo === undefined ? '' : negativo).trim();
  if (!texto) {
    throw new ErrorDeCara(
      'El clip se iba a lanzar sin negativo. El negativo de la serie (estilo.negativo en ' +
        'datos/serie.json) es la lista de lo que no queremos ver —paleta shonen, ojos brillantes, ' +
        'render 3D, marcas de agua— y Veo tiene un campo propio para escucharlo. Lo compone ' +
        'promptVideo() y aquí ha llegado vacío: es un fallo de programación, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  return texto;
}

/**
 * La duración. Veo SOLO genera 4, 6 u 8 segundos.
 * @param {*} durGen
 * @returns {number}
 */
function comprobarDuracion(durGen) {
  const pedida = Number(durGen);

  if (DURACIONES.includes(pedida)) return pedida;

  const cuanto =
    durGen === null || durGen === undefined || durGen === ''
      ? 'no se ha dicho ninguna'
      : `se han pedido ${JSON.stringify(durGen)}`;

  // «4, 6 u 8», que es como se dice en español: la última va con «u» porque la
  // que sigue empieza por o.
  const enPalabras = `${DURACIONES.slice(0, -1).join(', ')} u ${DURACIONES[DURACIONES.length - 1]}`;

  throw new ErrorDeCara(
    `Veo solo genera clips de ${enPalabras} segundos, y ${cuanto}. Los de 2 y 3 ` +
      'segundos no existen: por eso cada toma de datos/serie.json trae dos números distintos, ' +
      '«dur_gen» —lo que se le pide a Veo, que tiene que ser 4, 6 u 8— y «recorte», los segundos ' +
      'que de verdad se usan al montar. Un plano que dura 3 segundos se genera de 4 y se recorta: ' +
      'dur_gen 4 y recorte [0, 3]. Y ojo con las tomas encadenadas, que se usan enteras y ahí ' +
      'dur tiene que ser igual que dur_gen.',
    { reintentable: false, http: 400 }
  );
}

/**
 * La carpeta del bucket donde Veo escribirá el MP4.
 * @param {*} storageUri
 * @returns {string} la misma dirección, terminada en barra.
 */
function comprobarStorageUri(storageUri) {
  const uri = String(storageUri === null || storageUri === undefined ? '' : storageUri).trim();

  if (!uri) {
    throw new ErrorDeCara(
      'Falta decirle a Veo dónde tiene que dejar el clip. El MP4 no pasa nunca por la función —un ' +
        'clip de 8 segundos a 1080p pesa unos 35 MB y el tope son 4,5 MB—, así que Veo lo escribe ' +
        'directo en el bucket y después se busca listando esa carpeta. Sin esa dirección no hay ' +
        'dónde dejarlo.',
      { reintentable: false, http: 500 }
    );
  }

  if (!uri.startsWith('gs://') || uri.length <= 'gs://'.length || /\s/.test(uri)) {
    throw new ErrorDeCara(
      `«${uri}» no sirve como sitio donde dejar el clip: tiene que ser una dirección del bucket, ` +
        'de las que empiezan por «gs://», y apuntar a la carpeta de esta toma. La compone gcs.js a ' +
        'partir del bucket y del prefijo, así que esto es un fallo del propio estudio, no de tu ' +
        'cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  // Veo trata `storageUri` como carpeta y le pone el nombre al archivo. Sin la
  // barra final, lo que escribe no cuelga de la carpeta sino que empieza por
  // ella, y el modo `veo-consultar` —que busca listando ese prefijo con barra—
  // no encontraría nada. Se pone aquí en vez de fallar porque no cambia dónde
  // acaba el clip: lo deja justo donde se pedía.
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/**
 * Una imagen que viaja a Veo: JPEG, en base64 y sin cabecera de data URL.
 *
 * A Veo le llega SIEMPRE la copia reducida a 1280 px que hace el navegador con
 * `reducirParaVeo()`. El master 2K en PNG pesa ~6,8 MB (~9,1 MB en base64) y no
 * cabe en la petición: si aquí aparece un PNG es que alguien se ha saltado esa
 * reducción, y conviene decirlo con palabras antes de que Google conteste un 400
 * o un 413 que no explican nada.
 *
 * @param {*} b64 lo que llegó.
 * @param {string} cual cómo se llama esta imagen cuando hay que nombrarla.
 * @param {boolean} obligatoria si faltar es un fallo o simplemente es que no hay.
 * @returns {string|null} el base64 limpio, o null si no era obligatoria y no vino.
 */
function comprobarJpeg(b64, cual, obligatoria) {
  if (b64 === null || b64 === undefined || String(b64).trim() === '') {
    if (!obligatoria) return null;
    throw new ErrorDeCara(
      `No se puede generar el clip: falta ${cual}. Ninguna toma genera vídeo sin su keyframe ` +
        'aprobado, y el keyframe viaja a Veo como una copia reducida a 1280 px en JPEG que prepara ' +
        'el navegador. Aprueba antes el keyframe de esta toma.',
      { reintentable: false, http: 400 }
    );
  }

  // Un canvas devuelve «data:image/jpeg;base64,…». Se admite y se le quita la
  // cabecera: lo que Veo quiere es solo el base64.
  const limpio = String(b64)
    .replace(/^data:[^,]*,/, '')
    .replace(/\s+/g, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpio)) {
    throw new ErrorDeCara(
      `Lo que se ha recibido como ${cual} no es base64: lleva caracteres que no pueden estar ahí. ` +
        'La imagen la prepara el navegador con reducirParaVeo(), así que es un fallo del propio ' +
        'estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  // Solo hacen falta los primeros bytes para saber qué es: 24 caracteres de
  // base64 son 18 bytes, y no hay que copiar en memoria una imagen entera para
  // mirar tres.
  const cabecera = Buffer.from(limpio.slice(0, 24), 'base64');
  const mime = mimeDeBytes(cabecera);

  if (mime === MIME_DE_LA_IMAGEN) return limpio;

  if (mime) {
    throw new ErrorDeCara(
      `${primeraMayuscula(cual)} ha llegado como ${mime} y a Veo se le manda JPEG. Lo que viaja es ` +
        'la copia reducida a 1280 px que hace el navegador, no el master: el master en 2K pesa unos ' +
        '6,8 MB (unos 9,1 MB en base64) y no cabe en los 4,5 MB de la petición. Es un fallo del ' +
        'propio estudio, no de tu cuenta.',
      { detalle: `${bytesDeBase64(limpio)} bytes`, reintentable: false, http: 400 }
    );
  }

  throw new ErrorDeCara(
    `${primeraMayuscula(cual)} no parece una imagen: sus primeros bytes no son los de un JPEG ni ` +
      'los de ningún formato conocido. Vuelve a generar y a aprobar el keyframe de esta toma.',
    { detalle: `${bytesDeBase64(limpio)} bytes`, reintentable: false, http: 400 }
  );
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** El tipo de imagen leído de sus primeros bytes. '' si no se reconoce. */
function mimeDeBytes(buf) {
  for (const firma of FIRMAS) {
    if (buf.length < firma.bytes.length) continue;
    let coincide = true;
    for (let i = 0; i < firma.bytes.length; i += 1) {
      if (buf[i] !== firma.bytes[i]) {
        coincide = false;
        break;
      }
    }
    if (coincide) return firma.mime;
  }
  // WEBP: «RIFF» … «WEBP», con el tamaño en medio.
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

/**
 * Cuánto pesa lo que representa un base64, sin decodificarlo: no hace falta
 * copiar una imagen entera en memoria solo para medirla.
 */
function bytesDeBase64(b64) {
  const limpio = String(b64).replace(/\s+/g, '');
  const relleno = limpio.endsWith('==') ? 2 : limpio.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((limpio.length * 3) / 4) - relleno);
}

/** Lo que contestó Google, para `detalle`, sin que un ciclo tumbe el error. */
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

function primeraMayuscula(t) {
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}
