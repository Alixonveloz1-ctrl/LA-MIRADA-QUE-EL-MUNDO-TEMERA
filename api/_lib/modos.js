// La tabla de modos: lo único que hay detrás de la puerta.
//
// `api/g.js` no sabe hacer nada. Lee el cuerpo, mira el campo `modo`, busca aquí
// y llama. Todo lo que el estudio sabe hacer está en este archivo, un modo por
// cosa, con la firma que manda docs/contrato.md §2: `async (cuerpo) => datos`, y
// la puerta responde `{ ok:true, ...datos }`.
//
// LAS CUATRO REGLAS QUE GOBIERNAN ESTE ARCHIVO, y que están escritas en la forma
// del código y no en un aviso:
//
//   1. NADA PESADO VIAJA. El PNG de 2K se queda en el bucket (unos 6,8 MB, unos
//      9,1 MB en base64: no cabe en los 4,5 MB de la respuesta) y el MP4 tampoco
//      pasa nunca por aquí. Lo que vuelve es la ruta y una URL firmada de seis
//      horas. Esta es la razón de que el censor deje pasar enteras las URLs
//      firmadas: sin ellas no se podría mirar nada de lo generado.
//
//   2. LOS CERROJOS SE COMPRUEBAN AQUÍ OTRA VEZ. La interfaz no enseña el botón
//      de generar vídeo sin keyframe aprobado; este archivo lo vuelve a exigir
//      con `exigirAprobada()`. Dos cerrojos, no un aviso. Lo mismo con el ancla
//      de una placa y con la placa del escenario de un keyframe.
//
//   3. TODO LO QUE ESCRIBE EN EL ESTADO LO HACE LEYENDO, MODIFICANDO Y
//      ESCRIBIENDO CON GENERACIÓN, y reintenta una vez ante un 409. El bucket es
//      la única verdad y hay dos escritores a la vez —esta función y el
//      navegador—: guardar sin condición es como se pierde el trabajo del otro.
//
//   4. NINGUNA OPERACIÓN DE VEO QUEDA HUÉRFANA. `veo-lanzar` guarda
//      `operacion_en_curso` ANTES de contestar, y si esa escritura falla el
//      mensaje lleva dentro el nombre de la operación: una operación lanzada y
//      perdida es un clip pagado que nadie recoge.
//
// DÓNDE VIVEN LOS ARCHIVOS (docs/contrato.md §11). Las rutas son lógicas: el
// prefijo del proyecto lo pone y lo quita `gcs.js`, y aquí no se nombra jamás.
//
// FALTA EN EL CONTRATO: §11 escribe UNA ruta por placa del banco
// (`banco/{personaje}/{placa}.png`) y una por escenario (`escenarios/{id}.png`),
// pero §2 dice que el modo `imagen` devuelve el número de `intento`, §5 guarda
// una lista de `intentos` por placa y `datos/serie.json` declara esa lista como
// «rutas». Un intento por ruta necesita una ruta por intento: si todos los
// intentos se escribieran en el mismo sitio, regenerar una placa borraría la que
// ya estaba aprobada y todo lo generado contra ella pasaría a parecerse a una
// imagen que ya no existe. Así que las tres cosas que se generan mirándolas
// numeran sus intentos dentro de una carpeta, igual que los keyframes, que es lo
// único que §11 sí escribe con `{n}`:
//
//     banco/{personaje}/{placa}/{n}.png      escenarios/{id}/{n}.png
//     keyframes/{pieza}/{toma}/{n}.png       veo/{pieza}/{toma}/{n}/
//
// y `aprobada` guarda la ruta del intento elegido. Conviene apuntarlo en §11.
//
// FALTA EN EL CONTRATO: `estado.reprobarCadena()` (§12) no tiene ningún modo que
// la llame. Reprobar la cadena de un ancla hace falta cuando cambia
// `estado.banco[ancla].aprobada`, y eso lo escribe hoy el navegador con
// `estado-escribir`, que manda el estado entero ya cambiado; el navegador no
// puede llamar a `reprobarCadena()` porque vive en el servidor. Aquí no se hace
// magia con lo que llega —comparar el estado nuevo con el viejo costaría una
// lectura más en cada guardado de la cola, y devolvería al navegador un estado
// distinto del que mandó—, así que se deja apuntado: o `estado-escribir` reproba
// la cadena y devuelve los ids reprobados, o hace falta un modo `aprobar`.

import { Buffer } from 'node:buffer';

import { ErrorDeCara } from './errores.js';
import {
  serie,
  toma as tomaDeLaPieza,
  placa as placaDelBanco,
  escenario as escenarioDelBanco,
  bloquesDeVoz,
  nivelImagen,
  rutaPlaca
} from './datos.js';
import {
  leerBytes,
  escribir as escribirEnElBucket,
  listar as listarElBucket,
  borrar as borrarDelBucket,
  firmar as firmarRutas,
  gsUri
} from './gcs.js';
import {
  leer as leerElEstado,
  escribir as escribirElEstado,
  exigirAprobada
} from './estado.js';
import {
  promptPlaca,
  promptEscenario,
  promptKeyframe,
  promptVideo,
  encargoMusica,
  guionDeVoz,
  comprobarCupos
} from './prompt.js';
import { generar as generarImagen } from './imagen.js';
import { lanzar as lanzarVeo, consultar as consultarVeo } from './veo.js';
import {
  musica as generarMusica,
  voz as generarVoz,
  listarVoces,
  alinear as alinearAudio
} from './audio.js';
import { traducirAJapones, desglosarEscena } from './texto.js';
import { salud as comprobarSalud } from './salud.js';
import { lanzar as lanzarMontaje, estado as estadoDeMontaje } from './montaje.js';

// ---------------------------------------------------------------------------
// Números fijos de este archivo
// ---------------------------------------------------------------------------

/** Lo que se puede pedir de una vez en `firmar` y en `borrar`. Una pantalla con
 *  400 planos no puede ser 400 peticiones, pero tampoco una sola descomunal. */
const MAXIMO_RUTAS = 200;

/** Lo que devuelve `listar` como mucho de una vez. A 99 bytes por objeto son
 *  ~500 KB, la novena parte del tope de 4,5 MB, y deja sitio de sobra aunque el
 *  día de mañana cada objeto traiga más campos. Lo que no cabe se sigue pidiendo
 *  con `cursor`, nunca se corta en silencio. */
const TOPE_LISTAR = 5000;

/** Límite propio de `veo-consultar`, por debajo de los 60 s de la plataforma:
 *  si se agota se contesta `hecho:false` en vez de morir sin excepción. */
const PLAZO_DE_CONSULTA_MS = 45_000;

/** Los tres tipos de imagen que se generan mirándolos. */
const TIPOS_DE_IMAGEN = ['placa', 'escenario', 'keyframe'];

/** Extensión según lo que conteste el modelo. El 2K llega en PNG. */
const EXTENSIONES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// ---------------------------------------------------------------------------
// Comprobaciones del cuerpo de la petición
//
// Todas explican en español qué campo falta y para qué servía. Un 400 nunca es
// un código: es una frase que se pinta en el teléfono.
// ---------------------------------------------------------------------------

/** Un objeto de verdad: ni null, ni array, ni cadena. */
function esObjeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

/**
 * Un texto limpio, o cadena vacía. Vale para null, para números y para basura.
 *
 * Se usa para los nombres de operación de Veo, que en el estado pueden estar
 * como texto —el nombre de verdad, en el bucket— o como `true` —lo que ve el
 * navegador, con el nombre quitado para que el censor no lo destroce—. Preguntar
 * «¿esto es un texto con algo dentro?» es lo que distingue los dos casos.
 *
 * ESTABA USADA EN SIETE SITIOS DE ESTE ARCHIVO Y NO ESTABA ESCRITA EN NINGUNO.
 * Existía solo en los archivos del navegador, y de ahí no se importa nada: cada
 * llamada lanzaba «soloTexto is not defined» y tumbaba el modo entero. Como leer
 * el estado pasa por aquí, se caían los ocho pantallas a la vez.
 */
function soloTexto(valor) {
  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
}

/**
 * Un campo de texto obligatorio. Un número también vale: los ids de escena del
 * guion son cadenas («3») pero llegan como número más veces de las que parece.
 * @param {object} cuerpo
 * @param {string} campo
 * @param {string} paraQue para qué se usa, en español, dentro de la frase.
 * @returns {string}
 */
function exigirTexto(cuerpo, campo, paraQue) {
  const valor = cuerpo[campo];
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  throw new ErrorDeCara(
    `A esta petición le falta el campo «${campo}», o ha llegado vacío: ${paraQue}. Es un fallo ` +
      'del propio estudio, no de tu cuenta: la pantalla compone la petición y algo no ha puesto.',
    { reintentable: false, http: 400 }
  );
}

/**
 * Un campo de texto que puede no venir.
 * @param {object} cuerpo
 * @param {string} campo
 * @returns {string|null}
 */
function textoSiViene(cuerpo, campo) {
  const valor = cuerpo[campo];
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

/**
 * Una lista de rutas, con tope. El tope no es capricho: por encima, la respuesta
 * firmada de 400 URLs se acerca al límite de 4,5 MB.
 * @param {object} cuerpo
 * @param {string} campo
 * @param {string} paraQue
 * @returns {string[]}
 */
function exigirRutas(cuerpo, campo, paraQue) {
  const valor = cuerpo[campo];
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new ErrorDeCara(
      `A esta petición le falta la lista «${campo}», o ha llegado vacía: ${paraQue}.`,
      { reintentable: false, http: 400 }
    );
  }
  if (valor.length > MAXIMO_RUTAS) {
    throw new ErrorDeCara(
      `Se han pedido ${valor.length} archivos de una vez y el máximo por llamada es ` +
        `${MAXIMO_RUTAS}. Pídelos por tandas: la pantalla los va cogiendo de ${MAXIMO_RUTAS} en ` +
        `${MAXIMO_RUTAS} sin que se note.`,
      { reintentable: false, http: 400 }
    );
  }
  return valor.map((ruta, i) => {
    if (typeof ruta !== 'string' || !ruta.trim()) {
      throw new ErrorDeCara(
        `El elemento número ${i + 1} de «${campo}» no es la ruta de un archivo. Es un fallo del ` +
          'propio estudio, no de tu cuenta.',
        { reintentable: false, http: 400 }
      );
    }
    return ruta.trim();
  });
}

// ---------------------------------------------------------------------------
// El estado: leer, modificar y escribir sin pisar a nadie
// ---------------------------------------------------------------------------

/**
 * Aplica un cambio al estado del bucket con `ifGenerationMatch`, y si otro ha
 * guardado por debajo vuelve a leer, reaplica el cambio y guarda otra vez. Una
 * sola vez: si al segundo intento sigue habiendo carrera, es que hay algo mal y
 * seguir dando vueltas dentro de la función solo agota el minuto.
 *
 * @param {(estado:object) => any} aplicar cambia el estado EN EL SITIO. Se
 *   ejecuta una vez por vuelta, así que no puede tener efectos fuera del estado.
 * @param {{estado:object, generacion:string}|null} [yaLeido] un estado recién
 *   leído que se aprovecha para la primera vuelta y ahorra una lectura.
 * @returns {Promise<{estado:object, generacion:string, devuelto:any}>}
 */
async function cambiarElEstado(aplicar, yaLeido = null) {
  let partida = yaLeido;

  for (let vuelta = 1; vuelta <= 2; vuelta += 1) {
    const actual = partida || (await leerElEstado());
    partida = null; // la segunda vuelta relee siempre: es de lo que va el reintento

    const devuelto = aplicar(actual.estado);

    try {
      const { generacion } = await escribirElEstado(actual.estado, actual.generacion);
      return { estado: actual.estado, generacion, devuelto };
    } catch (fallo) {
      const esCarrera = fallo instanceof ErrorDeCara && fallo.http === 409;
      if (!esCarrera || vuelta === 2) throw fallo;
    }
  }

  // Inalcanzable: el bucle o devuelve o lanza. Está por si alguien toca el de arriba.
  throw new ErrorDeCara(
    'No se ha podido guardar el estado: alguien lo está cambiando a la vez desde otro sitio. ' +
      'Vuelve a intentarlo dentro de un momento.',
    { reintentable: true, http: 409 }
  );
}

/**
 * Guarda en el estado lo que se acaba de generar, y si eso falla lo dice sin
 * perder lo generado: el archivo ya está en el bucket y ya está pagado, así que
 * el mensaje lleva su ruta dentro y el fallo no se reintenta (repetir volvería a
 * gastar).
 *
 * @param {(estado:object) => any} aplicar
 * @param {{estado:object, generacion:string}|null} yaLeido
 * @param {string} queSeGuardo frase en español: «la imagen», «la música»…
 * @param {string} donde la ruta lógica de lo generado.
 */
async function anotarLoGenerado(aplicar, yaLeido, queSeGuardo, donde) {
  try {
    await cambiarElEstado(aplicar, yaLeido);
  } catch (fallo) {
    throw new ErrorDeCara(
      `${queSeGuardo} se ha generado bien y está guardada en el bucket, en «${donde}». Lo único ` +
        'que ha fallado es apuntarla en el estado de la producción, así que no se ha perdido ' +
        'nada: vuelve a abrir la aplicación para que lea el estado del bucket y la verás ahí. No ' +
        'la generes otra vez, que se pagaría dos veces. Debajo está el motivo exacto.',
      {
        detalle: fallo && fallo.mensaje ? fallo.mensaje : String(fallo),
        reintentable: false,
        http: fallo && fallo.http ? fallo.http : 500
      }
    );
  }
}

/** La entrada de una toma en el estado, creándola si el estado venía corto. */
function entradaDeToma(estado, clave) {
  if (!esObjeto(estado.tomas)) estado.tomas = {};
  if (!esObjeto(estado.tomas[clave])) {
    estado.tomas[clave] = {
      keyframe_aprobado: null,
      intentos_keyframe: [],
      clip_elegido: null,
      intentos_clip: [],
      operacion_en_curso: null
    };
  }
  return estado.tomas[clave];
}

/** Añade una ruta a una lista de intentos sin repetirla. Los intentos son rutas. */
function apuntarIntento(entrada, campo, ruta) {
  if (!Array.isArray(entrada[campo])) entrada[campo] = [];
  if (!entrada[campo].includes(ruta)) entrada[campo].push(ruta);
}

// ---------------------------------------------------------------------------
// Carpetas e intentos
// ---------------------------------------------------------------------------

/**
 * La carpeta donde se numeran los intentos de una placa del banco. Sale de la
 * plantilla de `serie.banco.ruta` a través de `rutaPlaca()`, quitándole la
 * extensión: `banco/madre/madre-ancla.png` → `banco/madre/madre-ancla/`.
 * @param {string} idPlaca
 * @returns {string}
 */
function carpetaDePlaca(idPlaca) {
  return `${quitarExtension(rutaPlaca(idPlaca))}/`;
}

/**
 * Lo mismo para un escenario, desde `serie.escenarios.ruta`.
 * FALTA EN EL CONTRATO: `datos.js` exporta `rutaPlaca()` pero no una
 * `rutaEscenario()`, así que la plantilla se lee aquí. Si algún día se añade esa
 * función, esto se sustituye por una llamada y nada más.
 * @param {string} id
 * @returns {string}
 */
function carpetaDeEscenario(id) {
  const elEscenario = escenarioDelBanco(id);
  const plantilla = (serie.escenarios && serie.escenarios.ruta) || '';
  if (typeof plantilla !== 'string' || !plantilla.includes('{id}')) {
    throw new ErrorDeCara(
      'La plantilla de rutas de los escenarios (escenarios.ruta en datos/serie.json) no lleva ' +
        `{id}, así que no se sabe dónde guardar el escenario «${id}».`,
      { detalle: plantilla || null, reintentable: false, http: 500 }
    );
  }
  return `${quitarExtension(plantilla.replace('{id}', elEscenario.id))}/`;
}

/** La carpeta de los intentos de keyframe de una toma (docs/contrato.md §11). */
function carpetaDeKeyframe(idPieza, idToma) {
  return `keyframes/${idPieza}/${idToma}/`;
}

/** La carpeta donde Veo escribe los clips de una toma (docs/contrato.md §11). */
function carpetaDeClips(idPieza, idToma) {
  return `veo/${idPieza}/${idToma}/`;
}

/** «banco/madre/madre-ancla.png» → «banco/madre/madre-ancla». */
function quitarExtension(ruta) {
  return String(ruta).replace(/\.[A-Za-z0-9]+$/, '');
}

/**
 * El número del siguiente intento, LISTANDO LA CARPETA del bucket y nunca de un
 * contador en memoria: la función serverless se apaga entre llamada y llamada, y
 * dos móviles pueden estar generando lo mismo. El bucket es la única verdad,
 * también para contar.
 *
 * @param {string} carpeta prefijo lógico, terminado en barra.
 * @param {{comoCarpeta?:boolean}} [opciones] `comoCarpeta` para los clips, que no
 *   son un archivo `{n}.mp4` sino una carpeta `{n}/` con dentro el archivo cuyo
 *   nombre pone Veo.
 * @returns {Promise<number>} 1 la primera vez.
 */
async function siguienteIntento(carpeta, { comoCarpeta = false } = {}) {
  const objetos = await listarElBucket(carpeta);
  const patron = comoCarpeta ? /^(\d+)\// : /^(\d+)(?:\.[A-Za-z0-9]+)?$/;

  let mayor = 0;
  for (const objeto of objetos) {
    if (!objeto.ruta.startsWith(carpeta)) continue;
    const encontrado = patron.exec(objeto.ruta.slice(carpeta.length));
    if (!encontrado) continue;
    const numero = Number(encontrado[1]);
    if (Number.isFinite(numero) && numero > mayor) mayor = numero;
  }

  return mayor + 1;
}

// ---------------------------------------------------------------------------
// Medir una imagen sin descomprimirla
// ---------------------------------------------------------------------------

/**
 * El ancho y el alto de la imagen, leídos de su cabecera. No se descomprime
 * nada: un PNG de 2K son casi siete megas y solo hacen falta ocho bytes.
 *
 * @param {Buffer} datos
 * @returns {{ancho:number|null, alto:number|null}} null cuando no se reconoce el
 *   formato: mentir sobre el tamaño sería peor que no decirlo.
 */
function medidaDeImagen(datos) {
  // PNG: firma de ocho bytes, y detrás el trozo IHDR con ancho y alto.
  if (
    datos.length >= 24 &&
    datos.readUInt32BE(0) === 0x89504e47 &&
    datos.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { ancho: datos.readUInt32BE(16), alto: datos.readUInt32BE(20) };
  }

  // JPEG: se saltan los marcadores hasta el de comienzo de fotograma (SOF).
  if (datos.length >= 4 && datos[0] === 0xff && datos[1] === 0xd8) {
    let i = 2;
    while (i + 9 < datos.length) {
      if (datos[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marca = datos[i + 1];
      // Marcadores sin cuerpo: relleno, reinicios y el propio comienzo.
      if (marca === 0xff || marca === 0x01 || marca === 0xd8 || (marca >= 0xd0 && marca <= 0xd7)) {
        i += 2;
        continue;
      }
      const largo = datos.readUInt16BE(i + 2);
      if (largo < 2) break;
      // Los SOF llevan el tamaño; C4, C8 y CC son otra cosa (tablas y arte).
      const esComienzoDeFotograma =
        marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc;
      if (esComienzoDeFotograma) {
        return { alto: datos.readUInt16BE(i + 5), ancho: datos.readUInt16BE(i + 7) };
      }
      i += 2 + largo;
    }
  }

  return { ancho: null, alto: null };
}

// ---------------------------------------------------------------------------
// URLs firmadas
// ---------------------------------------------------------------------------

/**
 * La URL firmada de un solo archivo. Es lo que permite mirar un PNG de 2K o
 * reproducir un MP4 de 35 MB sin que pasen por la función.
 * @param {string} ruta
 * @returns {Promise<string>}
 */
async function urlDe(ruta) {
  const urls = await firmarRutas([ruta]);
  return urls[ruta];
}

// ---------------------------------------------------------------------------
// salud
// ---------------------------------------------------------------------------

/**
 * Comprueba credenciales, bucket y una llamada mínima a cada modelo, y contesta
 * qué tiene permitido esta cuenta. NO devuelve la clave privada ni el JSON de la
 * service account, y NO comprueba el CORS del bucket: eso no se puede ver desde
 * el servidor, así que deja un objeto de prueba y su URL para que lo intente el
 * navegador.
 */
async function modoSalud() {
  return comprobarSalud();
}

// ---------------------------------------------------------------------------
// voces
// ---------------------------------------------------------------------------

/**
 * Devuelve las voces que Google tiene de verdad para el idioma de la serie. NO
 * inventa ni un id y NO elige ninguna: la voz se elige escuchándola.
 */
async function modoVoces(cuerpo) {
  // Con `personaje`, solo las voces de su género: un personaje masculino no
  // enseña voces femeninas. Sin él, las treinta.
  const idPersonaje = textoSiViene(cuerpo || {}, 'personaje');
  const genero = idPersonaje ? generoDelPersonaje(idPersonaje) : null;
  return { voces: await listarVoces({ genero }), genero };
}

/**
 * El género de un personaje, para filtrar sus voces candidatas.
 *
 * Sale de datos/serie.json, donde el parche lo deduce de la propia identidad del
 * personaje. Un personaje que no esté en la ficha —un figurante— no filtra nada:
 * más vale enseñar de más que esconder la voz buena.
 */
function generoDelPersonaje(id) {
  // Del REPARTO, no de serie.personajes. Once de los que hablan son figurantes y
  // no tienen ficha de personaje —no necesitan identidad visual, les basta un
  // ancla genérica— pero sí tienen voz, así que su género vive donde vive su
  // voz. Lo pone ahí herramientas/parche-datos.mjs para todos, con ficha y sin
  // ella; leerlo de serie.personajes dejaba a esos once sin filtrar, enseñándoles
  // las treinta voces, que es justo lo que no se quería.
  const reparto = (serie.voces && serie.voces.reparto) || [];
  const ficha = reparto.find((r) => r && r.personaje === id);
  const genero = ficha && typeof ficha.genero === 'string' ? ficha.genero.trim() : '';
  return genero && genero !== 'sin decidir' ? genero : null;
}

// ---------------------------------------------------------------------------
// voz-muestra
// ---------------------------------------------------------------------------

/**
 * Genera la frase de muestra de un personaje con una voz candidata, para poder
 * compararlas oyéndolas. NO vuelve a traducir la frase si ya está traducida en
 * el estado: si cada candidata dijera un japonés distinto no se podrían comparar.
 */
async function modoVozMuestra(cuerpo) {
  const idPersonaje = exigirTexto(cuerpo, 'personaje', 'de qué personaje es la frase de muestra');
  const vozId = exigirTexto(cuerpo, 'voz_id', 'qué voz candidata tiene que decirla');

  const ficha = fichaDelReparto(idPersonaje);
  const muestra = esObjeto(ficha.muestra) ? ficha.muestra : {};
  const textoEs = typeof muestra.texto === 'string' ? muestra.texto.trim() : '';
  const intencion = typeof muestra.intencion === 'string' ? muestra.intencion.trim() : '';

  if (!textoEs) {
    throw new ErrorDeCara(
      `El personaje «${idPersonaje}» no tiene frase de muestra escrita en ` +
        'voces.reparto[].muestra.texto de datos/serie.json. La muestra es su frase más difícil de ' +
        'toda la serie, y es lo que se oye para elegirle voz: sin ella no hay nada que decir.',
      { reintentable: false, http: 500 }
    );
  }

  const leido = await leerElEstado();

  // NO SE PAGA UNA MUESTRA QUE NO SE VA A PODER ELEGIR. Si esa voz ya está
  // fijada en otro personaje, generarla es tirar el dinero: se oiría, gustaría,
  // y al fijarla saltaría el choque. Se dice antes de gastar y se dice de quién
  // es, que es lo único que hace falta para decidir.
  const deQuienEs = duenoDeLaVoz(leido.estado, vozId);
  if (deQuienEs && deQuienEs !== idPersonaje && !puedenCompartir(idPersonaje, deQuienEs)) {
    throw new ErrorDeCara(
      `No se ha generado nada y no se ha gastado nada: la voz «${vozId}» ya está fijada en ` +
        `«${deQuienEs}» y esos dos no pueden compartir timbre, así que esta muestra no se podría ` +
        `elegir aunque sonara bien. ${porQueNoPuedenCompartir(idPersonaje, deQuienEs)} ` +
        `Elige otra de la lista, o ve a la tarjeta de «${deQuienEs}» y dale a «Cambiar la voz ` +
        'elegida».',
      { reintentable: false, http: 409 }
    );
  }

  const yaTraducida = japonesGuardado(leido.estado, idPersonaje);

  // La traducción se hace UNA vez por personaje y se guarda. La segunda voz
  // candidata ya no la paga, y —lo que importa— dice exactamente lo mismo.
  const ja = yaTraducida || (await traducirAJapones(textoEs, intencion));

  const generada = await generarVoz({
    partes: [
      {
        quien: idPersonaje,
        texto_ja: ja,
        direccion: direccionDeLaMuestra(idPersonaje, intencion)
      }
    ],
    instruccion: instruccionDeLaMuestra(idPersonaje),
    voces: { [idPersonaje]: vozId }
  });

  const ruta = `muestras/${idPersonaje}/${vozId}.wav`;
  await escribirEnElBucket(ruta, generada.wav, { tipo: 'audio/wav' });

  await anotarLoGenerado(
    (estado) => {
      if (!esObjeto(estado.voces)) estado.voces = {};
      if (!esObjeto(estado.voces[idPersonaje])) {
        estado.voces[idPersonaje] = { voz_id: null, ja: null, muestras: {} };
      }
      const entrada = estado.voces[idPersonaje];
      entrada.ja = ja;
      if (!esObjeto(entrada.muestras)) entrada.muestras = {};
      entrada.muestras[vozId] = ruta;
    },
    leido,
    'La muestra de voz',
    ruta
  );

  return { es: textoEs, ja, ruta, url: await urlDe(ruta), dur_s: generada.durS };
}

/** La ficha de reparto de un personaje, o una queja que dice dónde se escribe. */
function fichaDelReparto(idPersonaje) {
  const reparto = (serie.voces && serie.voces.reparto) || [];
  const ficha = reparto.find((r) => r && r.personaje === idPersonaje);
  if (!ficha) {
    throw new ErrorDeCara(
      `«${idPersonaje}» no está en el reparto de voces de datos/serie.json (voces.reparto), así ` +
        'que no tiene ni frase de muestra ni intención con la que componer su dirección de ' +
        `actuación. Los que hay son: ${reparto.map((r) => r.personaje).join(', ') || 'ninguno'}.`,
      { reintentable: false, http: 400 }
    );
  }
  return ficha;
}

/** El japonés ya traducido de un personaje, si el estado lo tiene guardado. */
function japonesGuardado(estado, idPersonaje) {
  const entrada = esObjeto(estado) && esObjeto(estado.voces) ? estado.voces[idPersonaje] : null;
  const ja = esObjeto(entrada) ? entrada.ja : null;
  return typeof ja === 'string' && ja.trim() ? ja.trim() : null;
}

/** Cómo se llama un personaje cuando hay que nombrarlo en una dirección. */
function nombreDelPersonaje(idPersonaje) {
  const ficha = (serie.personajes || {})[idPersonaje];
  const nombre = ficha && ficha.nombre;
  return typeof nombre === 'string' && nombre.trim() ? nombre.trim() : String(idPersonaje);
}

// FALTA EN EL CONTRATO: `prompt.js` compone la dirección de actuación de las
// líneas de una pieza (`guionDeVoz()`), pero no hay nada que componga la de la
// FRASE DE MUESTRA, que no pertenece a ninguna pieza. Se compone aquí, siempre
// igual, y con una diferencia a propósito respecto a las líneas: en la muestra
// la intención del personaje SÍ es la orden de entrega, porque la muestra es
// justo esa frase difícil dicha con esa intención (plan §11.2: «nunca un saludo
// neutro»). Lo suyo sería que `prompt.js` exportara `guionDeMuestra(personaje)`.

/** La dirección de actuación de la frase de muestra, compuesta siempre igual. */
function direccionDeLaMuestra(idPersonaje, intencion) {
  const nombre = nombreDelPersonaje(idPersonaje);
  const como = intencion
    ? `Se dice así: ${intencion.replace(/[.;,]+$/, '')}.`
    : 'No lleva intención escrita: dila en el registro contenido de la serie, en voz baja y sin ' +
      'subrayar nada.';
  return (
    `Habla como ${nombre}, y sostén esa misma voz y ese mismo carácter de principio a fin. ` +
    `Esta es su frase más difícil de toda la serie. ${como}`
  );
}

/** La instrucción global de la llamada de muestra. */
function instruccionDeLaMuestra(idPersonaje) {
  const idioma = (serie.voces && serie.voces.idioma) || 'ja-JP';
  return [
    `Lee en japonés (${idioma}) el texto de la parte, y solo el texto.`,
    'La dirección es una indicación de actuación, va en español y no se pronuncia nunca.',
    `Habla ${nombreDelPersonaje(idPersonaje)}, y nadie más.`,
    'Esta grabación es una prueba de voz: todas las candidatas dicen exactamente la misma frase ' +
      'con la misma intención, porque es lo único que permite compararlas.'
  ].join(' ');
}

// ---------------------------------------------------------------------------
// imagen
// ---------------------------------------------------------------------------

/**
 * Genera una placa del banco, un escenario o un keyframe: compone el prompt,
 * adjunta las referencias aprobadas, comprueba los cupos antes de gastar, guarda
 * el PNG de 2K en el bucket y devuelve su ruta con una URL firmada. El PNG NO
 * viaja en la respuesta —no cabe— y NO se aprueba solo: aprobar es mirarlo.
 */
async function modoImagen(cuerpo) {
  const tipo = exigirTexto(cuerpo, 'tipo', `qué se genera: ${TIPOS_DE_IMAGEN.join(', ')}`);
  if (!TIPOS_DE_IMAGEN.includes(tipo)) {
    throw new ErrorDeCara(
      `«${tipo}» no es algo que se pueda generar. Lo que se genera con imagen es: ` +
        `${TIPOS_DE_IMAGEN.join(', ')}.`,
      { reintentable: false, http: 400 }
    );
  }

  const id = exigirTexto(cuerpo, 'id', 'qué placa, qué escenario o qué toma se genera');
  const nivel = textoSiViene(cuerpo, 'nivel');

  // El id del modelo no se escribe aquí: sale de datos/serie.json y lo sustituye
  // IMAGE_MODEL. Hace falta antes de nada para poder mirar los cupos.
  const modelo = nivelImagen(nivel);

  let compuesto;
  let carpeta;
  let paraQue;
  let idPiezaDelKeyframe = null;

  if (tipo === 'placa') {
    placaDelBanco(id); // que exista de verdad, y si no que lo diga con palabras
    compuesto = promptPlaca(id);
    carpeta = carpetaDePlaca(id);
    paraQue = `generar la placa «${id}»`;
  } else if (tipo === 'escenario') {
    escenarioDelBanco(id);
    compuesto = promptEscenario(id);
    carpeta = carpetaDeEscenario(id);
    paraQue = `generar el escenario «${id}»`;
  } else {
    idPiezaDelKeyframe = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma del keyframe');
    tomaDeLaPieza(idPiezaDelKeyframe, id);
    compuesto = promptKeyframe(idPiezaDelKeyframe, id);
    carpeta = carpetaDeKeyframe(idPiezaDelKeyframe, id);
    paraQue = `generar el keyframe de la toma ${id} de la pieza «${idPiezaDelKeyframe}»`;
  }

  // Los cupos, ANTES de leer un solo byte del bucket: pasarse no da un error
  // claro del otro lado, da una llamada fallida ya cobrada.
  comprobarCupos(compuesto.referencias, modelo.id);

  const leido = await leerElEstado();

  // Cada referencia tiene que estar APROBADA. Este es el cerrojo de servidor del
  // invariante «ninguna placa que no sea ancla se genera sin el ancla de su
  // personaje aprobada»: si falta, se dice cuál falta y cómo se arregla.
  const pendientes = compuesto.referencias.map((referencia) => {
    const esEscenario = Boolean(referencia.escenario);
    const rutaAprobada = exigirAprobada(
      leido.estado,
      esEscenario ? 'escenario' : 'banco',
      esEscenario ? referencia.escenario : referencia.placa,
      paraQue
    );
    return { referencia, rutaAprobada };
  });

  const referencias = await Promise.all(
    pendientes.map(async ({ referencia, rutaAprobada }) => {
      const archivo = await leerBytes(rutaAprobada);
      if (!archivo) {
        throw new ErrorDeCara(
          `Para ${paraQue} hace falta «${referencia.escenario || referencia.placa}», que figura ` +
            `como aprobada en «${rutaAprobada}», y ese archivo ya no está en el bucket. O se ha ` +
            'borrado, o se aprobó una ruta que nunca llegó a guardarse. Genérala otra vez y ' +
            'apruébala mirándola.',
          { reintentable: false, http: 400 }
        );
      }
      return {
        datos: archivo.datos,
        instruccion: referencia.instruccion,
        cupo: referencia.cupo
      };
    })
  );

  // El número de intento sale de listar la carpeta, no de un contador: entre dos
  // llamadas la función se ha apagado y ha vuelto a arrancar.
  const intento = await siguienteIntento(carpeta);

  const generada = await generarImagen({
    texto: compuesto.texto,
    negativo: compuesto.negativo,
    referencias,
    nivel
  });

  const datos = Buffer.from(generada.b64, 'base64');
  const ruta = `${carpeta}${intento}.${EXTENSIONES[generada.mime] || 'png'}`;
  const guardado = await escribirEnElBucket(ruta, datos, { tipo: generada.mime || 'image/png' });
  const medida = medidaDeImagen(datos);

  await anotarLoGenerado(
    (estado) => {
      if (tipo === 'keyframe') {
        const entrada = entradaDeToma(estado, `${idPiezaDelKeyframe}/${id}`);
        apuntarIntento(entrada, 'intentos_keyframe', ruta);
        return;
      }
      const donde = tipo === 'placa' ? 'banco' : 'escenarios';
      if (!esObjeto(estado[donde])) estado[donde] = {};
      if (!esObjeto(estado[donde][id])) estado[donde][id] = { aprobada: null, intentos: [] };
      apuntarIntento(estado[donde][id], 'intentos', ruta);
    },
    leido,
    'La imagen',
    ruta
  );

  return {
    ruta,
    url: await urlDe(ruta),
    intento,
    bytes: guardado.bytes,
    ancho: medida.ancho,
    alto: medida.alto
  };
}

// ---------------------------------------------------------------------------
// veo-lanzar
// ---------------------------------------------------------------------------

/**
 * Lanza la generación del clip de una toma y guarda su operación en el estado
 * ANTES de contestar. NO llama a Veo si el keyframe de esa toma no está aprobado
 * —segundo cerrojo; el primero es que el botón no existe en la interfaz— y NO
 * devuelve ningún MP4: Veo lo escribe directo en el bucket.
 */
async function modoVeoLanzar(cuerpo) {
  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma');
  const idToma = exigirTexto(cuerpo, 'toma', 'qué toma se genera');
  const laToma = tomaDeLaPieza(idPieza, idToma);
  const clave = `${idPieza}/${idToma}`;

  const leido = await leerElEstado();

  // EL SEGUNDO CERROJO. Un keyframe malo cuesta céntimos y un clip malo cuesta
  // un euro: aquí se vuelve a comprobar lo que la interfaz ya impide.
  exigirAprobada(leido.estado, 'keyframe', clave, `generar el vídeo de ${idToma}`);

  const encargo = promptVideo(idPieza, idToma);

  // El fotograma de enlace solo viaja si esta toma encadena de verdad. Una toma
  // que no encadena y llevara lastFrame saldría interpolando hacia una imagen
  // que no le toca.
  const encadena = laToma.encadena_con !== null && laToma.encadena_con !== undefined;
  const lastFrame = encadena ? cuerpo.lastFrame_b64 ?? null : null;

  const intento = await siguienteIntento(carpetaDeClips(idPieza, idToma), { comoCarpeta: true });
  const prefijo = `${carpetaDeClips(idPieza, idToma)}${intento}/`;

  const lanzado = await lanzarVeo({
    texto: encargo.texto,
    negativo: encargo.negativo,
    imagenB64: cuerpo.imagen_b64,
    lastFrameB64: lastFrame,
    nivel: laToma.veo,
    durGen: laToma.dur_gen,
    storageUri: gsUri(prefijo)
  });

  // PRIMER APUNTE, y el que de verdad garantiza que ninguna operación quede
  // huérfana: el nombre se escribe en un archivo suyo, al lado de donde Veo va a
  // dejar el MP4.
  //
  // El estado se guarda con generación y puede fallar por conflicto; este
  // archivo no compite con nadie, así que si el estado no llega a escribirse el
  // nombre sigue existiendo y `veo-consultar` lo encuentra. Una operación
  // lanzada y perdida es un clip pagado que nadie recoge.
  const apunte = `${prefijo}operacion.txt`;
  try {
    await escribirEnElBucket(apunte, lanzado.operacion, { tipo: 'text/plain; charset=utf-8' });
  } catch {
    // Que no se pueda dejar el apunte no es motivo para tirar el clip lanzado:
    // queda el estado, que es el camino normal.
  }

  // SEGUNDO APUNTE, y ANTES de contestar. Si el navegador se cierra en este
  // instante, la operación sigue apuntada y se recoge al volver a abrir.
  try {
    await cambiarElEstado((estado) => {
      const entrada = entradaDeToma(estado, clave);
      entrada.operacion_en_curso = lanzado.operacion;
      // FALTA EN EL CONTRATO: §5 guarda el nombre de la operación pero no dónde
      // va a dejar Veo el MP4, y `veo-consultar` necesita ese prefijo para
      // listarlo. Si solo viajara en la respuesta, una operación recuperada al
      // abrir la aplicación no sabría dónde buscar su archivo. Se apunta al lado.
      entrada.operacion_prefijo = prefijo;
    }, leido);
  } catch (fallo) {
    // El nombre de la operación NO se pone en este mensaje: lleva el project id
    // dentro, el censor lo tacharía y quedaría un «tachado» que no sirve de
    // nada. No hace falta: está apuntado en el bucket y la aplicación lo
    // encuentra sola.
    throw new ErrorDeCara(
      'El clip se ha lanzado y se está generando, pero no se ha podido apuntar en el estado. No se ' +
        `pierde: ha quedado apuntado en el bucket, en «${prefijo}», y el vídeo aparecerá ahí. ` +
        'Vuelve a abrir la aplicación dentro de un momento y lo recogerá sola. Debajo está el ' +
        'motivo exacto del fallo.',
      {
        detalle: fallo && fallo.mensaje ? fallo.mensaje : String(fallo),
        reintentable: false,
        http: fallo && fallo.http ? fallo.http : 500
      }
    );
  }

  // El nombre de la operación NO sale de aquí, y no es un descuido.
  //
  // Ese nombre lleva el project id dentro («projects/{id}/locations/…»), así que
  // al salir por la puerta el censor lo tacha —hace lo que tiene que hacer— y el
  // navegador se queda con un nombre roto con el que ningún clip se puede
  // recoger jamás. Peor todavía: al guardar el estado, ese nombre tachado
  // pisaría en el bucket el único ejemplar bueno.
  //
  // Así que el nombre se queda donde tiene sentido que esté: en el estado, en el
  // bucket, escrito por la función. El navegador solo necesita SABER que hay una
  // operación en vuelo, no cómo se llama, y `veo-consultar` la busca él mismo
  // por pieza y toma.
  return {
    lanzada: true,
    prefijo,
    intento,
    aviso_sin_lastframe: Boolean(lanzado.avisoSinLastFrame)
  };
}

// ---------------------------------------------------------------------------
// veo-consultar
// ---------------------------------------------------------------------------

/**
 * Pregunta cómo va un clip y, cuando termina, LISTA el prefijo para coger el MP4
 * nuevo —el nombre lo pone Veo— y limpia `operacion_en_curso`. NO adivina el
 * nombre del archivo y NO se muere si se agota el tiempo: contesta `hecho:false`
 * y se vuelve a preguntar.
 */
async function modoVeoConsultar(cuerpo) {
  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma');
  const idToma = exigirTexto(cuerpo, 'toma', 'qué toma se estaba generando');
  const laToma = tomaDeLaPieza(idPieza, idToma);
  const clave = `${idPieza}/${idToma}`;

  // El nombre de la operación se lee del estado, NO de lo que mande el
  // navegador: lleva el project id dentro y por eso nunca ha viajado hasta allí.
  const antesDeConsultar = await leerElEstado();
  const enEstado = entradaDeToma(antesDeConsultar.estado, clave);
  let operacion = soloTexto(enEstado.operacion_en_curso);
  let prefijoApuntado = soloTexto(enEstado.operacion_prefijo);

  // Si el estado no lo tiene —porque su escritura falló justo después de
  // lanzar—, se busca el apunte que `veo-lanzar` deja en el bucket. Es lo que
  // impide que una operación lanzada y pagada se quede sin nadie que la recoja.
  if (!operacion) {
    const rescatado = await buscarOperacionApuntada(idPieza, idToma);
    if (rescatado) {
      operacion = rescatado.operacion;
      prefijoApuntado = rescatado.prefijo;
    }
  }

  if (!operacion) {
    return {
      hecho: false,
      sin_operacion: true,
      aviso:
        `No hay ninguna generación de vídeo en curso para ${idToma}. O ya terminó y se recogió, ` +
        'o nunca llegó a lanzarse.'
    };
  }

  const finDelPlazo = Date.now() + PLAZO_DE_CONSULTA_MS;

  const preguntado = await consultarVeo(operacion, laToma.veo);

  if (!preguntado.hecho) return { hecho: false };

  // La operación ha terminado: pase lo que pase, ya no está en curso.
  if (preguntado.error) {
    await cambiarElEstado((estado) => {
      const entrada = entradaDeToma(estado, clave);
      entrada.operacion_en_curso = null;
      entrada.operacion_prefijo = null;
    });
    return { hecho: true, error: preguntado.error };
  }

  if (Date.now() > finDelPlazo) {
    // El clip está hecho y sigue en el bucket; lo único que no ha dado tiempo es
    // a buscarlo. Se contesta que no, y la cola vuelve a preguntar enseguida.
    return { hecho: false };
  }

  const leido = await leerElEstado();
  // El prefijo se busca en tres sitios, en este orden: el que ya se conocía al
  // empezar (del estado o del apunte del bucket), el del estado ahora mismo, y
  // como último recurso la carpeta de la toma entera. Nunca sale del cuerpo de
  // la petición: el navegador no tiene por qué saber dónde escribe Veo.
  const prefijo = prefijoApuntado || prefijoGuardado(leido.estado, clave);
  const carpeta = prefijo || carpetaDeClips(idPieza, idToma);

  const objetos = await listarElBucket(carpeta);
  const videos = objetos
    .filter((objeto) => /\.mp4$/i.test(objeto.ruta))
    .sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));

  if (!videos.length) {
    await cambiarElEstado((estado) => {
      const entrada = entradaDeToma(estado, clave);
      entrada.operacion_en_curso = null;
      entrada.operacion_prefijo = null;
    }, leido);
    return {
      hecho: true,
      error:
        `Veo dice que ha terminado, pero en «${carpeta}» no hay ningún vídeo. Casi siempre es el ` +
        'filtro de contenido, que se queda con el clip y da la operación por buena igualmente: ' +
        'hay que cambiar lo que se le pide a esa toma en datos/serie.json. Si no, comprueba que ' +
        'la service account tiene permiso de escritura sobre el bucket.'
    };
  }

  const ruta = videos[0].ruta;

  await cambiarElEstado((estado) => {
    const entrada = entradaDeToma(estado, clave);
    entrada.operacion_en_curso = null;
    entrada.operacion_prefijo = null;
    apuntarIntento(entrada, 'intentos_clip', ruta);
  }, leido);

  return { hecho: true, ruta, url: await urlDe(ruta) };
}

/** El prefijo que se apuntó al lanzar, para saber dónde buscar el MP4. */
function prefijoGuardado(estado, clave) {
  const entrada = esObjeto(estado) && esObjeto(estado.tomas) ? estado.tomas[clave] : null;
  const prefijo = esObjeto(entrada) ? entrada.operacion_prefijo : null;
  return typeof prefijo === 'string' && prefijo.trim() ? prefijo.trim() : null;
}

// ---------------------------------------------------------------------------
// musica
// ---------------------------------------------------------------------------

/**
 * Genera una pieza de música con Lyria y la guarda en el bucket con su duración
 * REAL medida del WAV. NO traduce el encargo ni le añade nada en español: Lyria
 * rechaza la petición entera en cuanto ve otro idioma.
 */
async function modoMusica(cuerpo) {
  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es esta música');
  const idMusica = exigirTexto(cuerpo, 'id', 'qué pieza de música se genera');

  const encargo = encargoMusica(idPieza, idMusica);

  const leido = await leerElEstado();
  const generada = await generarMusica({
    texto: encargo.texto,
    negativo: encargo.negativo,
    durS: encargo.durS
  });

  const ruta = `audio/musica/${idMusica}.wav`;
  await escribirEnElBucket(ruta, generada.wav, { tipo: 'audio/wav' });

  await anotarLoGenerado(
    (estado) => {
      if (!esObjeto(estado.audio)) estado.audio = { musica: {}, voz: {} };
      if (!esObjeto(estado.audio.musica)) estado.audio.musica = {};
      if (!esObjeto(estado.audio.musica[idMusica])) {
        estado.audio.musica[idMusica] = { ruta: null, dur_s: 0, aprobada: false, intentos: [] };
      }
      const entrada = estado.audio.musica[idMusica];
      entrada.ruta = ruta;
      entrada.dur_s = generada.durS;
      // Es una grabación nueva: la que hubiera aprobada ya no es esta.
      entrada.aprobada = false;
      apuntarIntento(entrada, 'intentos', ruta);
    },
    leido,
    'La música',
    ruta
  );

  return { ruta, url: await urlDe(ruta), dur_s: generada.durS };
}

// ---------------------------------------------------------------------------
// voz
// ---------------------------------------------------------------------------

/**
 * Genera un bloque de voz entero en UNA sola llamada, con todas sus líneas
 * dentro y hasta dos hablantes. NO genera nunca una línea suelta: se rehace el
 * bloque, porque una línea regenerada sola es justo la que canta.
 */
async function modoVoz(cuerpo) {
  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es el bloque de voz');
  const idBloque = exigirTexto(cuerpo, 'bloque', 'qué bloque de voz se genera');

  // `guionDeVoz()` ya se planta con su frase en español si el bloque no existe,
  // así que a partir de aquí el bloque está.
  const guion = guionDeVoz(idPieza, idBloque);
  const elBloque = bloquesDeVoz(idPieza).find((b) => b.id === idBloque);

  const leido = await leerElEstado();

  // Las voces salen del estado, que es donde queda la elección que se hizo
  // escuchando. Si a alguien le falta, `audio.js` lo dice con su nombre.
  const reparto = {};
  for (const quien of elBloque.personajes) {
    const entrada = esObjeto(leido.estado.voces) ? leido.estado.voces[quien] : null;
    reparto[quien] = esObjeto(entrada) ? entrada.voz_id : null;
  }

  const generada = await generarVoz({
    partes: guion.partes,
    instruccion: guion.instruccion,
    voces: reparto
  });

  const ruta = `audio/voz/${idPieza}/${idBloque}.wav`;
  await escribirEnElBucket(ruta, generada.wav, { tipo: 'audio/wav' });

  const clave = `${idPieza}/${idBloque}`;
  await anotarLoGenerado(
    (estado) => {
      if (!esObjeto(estado.audio)) estado.audio = { musica: {}, voz: {} };
      if (!esObjeto(estado.audio.voz)) estado.audio.voz = {};
      if (!esObjeto(estado.audio.voz[clave])) {
        estado.audio.voz[clave] = {
          ruta: null,
          dur_s: 0,
          aprobada: false,
          lineas: [],
          intentos: []
        };
      }
      const entrada = estado.audio.voz[clave];
      entrada.ruta = ruta;
      entrada.dur_s = generada.durS;
      entrada.aprobada = false;
      // Los tiempos de línea eran de la grabación anterior: se miden otra vez
      // con `alinear`. Dejarlos puestos desplazaría todos los subtítulos.
      entrada.lineas = elBloque.lineas.map(() => ({ inicio: 0, fin: 0 }));
      apuntarIntento(entrada, 'intentos', ruta);
    },
    leido,
    'La voz de este bloque',
    ruta
  );

  return {
    ruta,
    url: await urlDe(ruta),
    dur_s: generada.durS,
    lineas: elBloque.lineas.map((linea) => ({
      quien: linea.quien,
      ja: linea.ja,
      es: linea.es,
      t: linea.t,
      hasta: linea.hasta
    }))
  };
}

// ---------------------------------------------------------------------------
// alinear
// ---------------------------------------------------------------------------

/**
 * Mide dónde empieza y dónde acaba cada línea dentro del WAV de un bloque. NO
 * alinea palabra a palabra —el audio va en japonés y el subtítulo en español, y
 * el número de palabras no coincide— y NO toca el estado: quien pidió la medida
 * es quien sabe en qué bloque guardarla.
 */
async function modoAlinear(cuerpo) {
  const ruta = exigirTexto(cuerpo, 'ruta', 'qué grabación se mide');
  const lineas = cuerpo.lineas;

  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new ErrorDeCara(
      'Se ha pedido medir los tiempos de una grabación sin decir qué líneas hay dentro. Lo que se ' +
        'mide es la entrada y la salida de cada intervención, así que sin las líneas no hay nada ' +
        'que medir.',
      { reintentable: false, http: 400 }
    );
  }

  const archivo = await leerBytes(ruta);
  if (!archivo) {
    throw new ErrorDeCara(
      `No hay ninguna grabación en «${ruta}». O se ha borrado, o el bloque todavía no se ha ` +
        'generado: genera antes la voz de ese bloque y después mide sus tiempos.',
      { reintentable: false, http: 404 }
    );
  }

  return { lineas: await alinearAudio(archivo.datos, lineas) };
}

// ---------------------------------------------------------------------------
// desglosar-escena
// ---------------------------------------------------------------------------

/**
 * Propone los planos de UNA escena del guion, ya validados contra las reglas del
 * desglose. NO desglosa un episodio entero —son 24 llamadas independientes, no
 * una gigante— y NO escribe nada: devuelve los planos y quien los pidió decide
 * dónde se guardan.
 */
async function modoDesglosarEscena(cuerpo) {
  const episodio = exigirTexto(cuerpo, 'episodio', 'de qué episodio es la escena');
  const escena = exigirTexto(cuerpo, 'escena', 'qué escena se desglosa');
  return desglosarEscena(episodio, escena);
}

// ---------------------------------------------------------------------------
// estado-leer / estado-escribir
// ---------------------------------------------------------------------------

/**
 * Lee el estado del bucket con su generación, ya relleno desde serie.json. NO
 * inventa nada: si el bucket está vacío devuelve la forma base y generación «0»,
 * que es lo que sirve para crearlo solo si sigue sin existir.
 */
async function modoEstadoLeer() {
  const { estado, generacion } = await leerElEstado();
  return { estado: sinNombresDeOperacion(estado), generacion };
}

/**
 * El estado tal y como puede verlo el navegador: igual, pero con el nombre de
 * cada operación de Veo cambiado por `true`.
 *
 * El nombre lleva el project id dentro. Si viajara, el censor lo tacharía —que
 * es su trabajo— y el navegador se quedaría con un nombre roto que además
 * acabaría pisando el bueno en el bucket al guardar. Con `true` el navegador
 * sabe lo único que necesita saber: que esa toma tiene vídeo en vuelo.
 *
 * @param {object} estado
 * @returns {object} una copia; el original no se toca
 */
function sinNombresDeOperacion(estado) {
  const copia = JSON.parse(JSON.stringify(estado));
  for (const entrada of Object.values(copia.tomas || {})) {
    if (!esObjeto(entrada)) continue;
    if (soloTexto(entrada.operacion_en_curso)) entrada.operacion_en_curso = true;
    if (soloTexto(entrada.operacion_prefijo)) entrada.operacion_prefijo = true;
  }
  return copia;
}

/**
 * Se niega a guardar un estado en el que dos personajes tengan la misma voz.
 *
 * POR QUÉ NO SE COMPARTE UNA VOZ. Dos personajes con el mismo timbre son el
 * mismo personaje para el oído, por mucho que el guion los llame distinto. En
 * doce capítulos eso no se arregla después: habría que volver a grabar todo lo
 * del segundo. Y no es un problema de sitio: hay treinta voces y veintinueve
 * personajes, así que cada uno puede tener la suya.
 *
 * SE NIEGA, PERO NO ENCIERRA. Soltar una voz —dejarla en null— quita el choque,
 * así que un estado que ya viniera mal siempre se puede arreglar: se suelta una
 * de las dos y se vuelve a guardar. Si esto rechazara cualquier escritura
 * mientras hubiera un duplicado, no habría manera de deshacerlo.
 *
 * @param {object} estado el que manda el navegador
 */
/**
 * De qué personaje es ya una voz, según el estado del bucket.
 * @param {object} estado
 * @param {string} vozId
 * @returns {string|null} el id del personaje, o null si la voz está libre
 */
function duenoDeLaVoz(estado, vozId) {
  const voces = esObjeto(estado) && esObjeto(estado.voces) ? estado.voces : null;
  if (!voces) return null;
  const buscada = soloTexto(vozId);
  if (!buscada) return null;

  for (const [personaje, dentro] of Object.entries(voces)) {
    if (!esObjeto(dentro)) continue;
    if (soloTexto(dentro.voz_id) === buscada) return personaje;
  }
  return null;
}

function comprobarQueNadieComparteVoz(estado) {
  const voces = esObjeto(estado.voces) ? estado.voces : null;
  if (!voces) return;

  // Quién tiene cada voz. Puede ser más de uno: compartir está permitido entre
  // los que no se llegan a reconocer, y `puedenCompartir` dice entre cuáles.
  const quienes = new Map();
  for (const [personaje, dentro] of Object.entries(voces)) {
    if (!esObjeto(dentro)) continue;
    const vozId = soloTexto(dentro.voz_id);
    if (!vozId) continue;
    if (!quienes.has(vozId)) quienes.set(vozId, []);
    quienes.get(vozId).push(personaje);
  }

  for (const [vozId, deQuienes] of quienes) {
    if (deQuienes.length < 2) continue;

    for (let i = 0; i < deQuienes.length; i += 1) {
      for (let j = i + 1; j < deQuienes.length; j += 1) {
        const [uno, otro] = [deQuienes[i], deQuienes[j]];
        if (puedenCompartir(uno, otro)) continue;

        throw new ErrorDeCara(
          `No se ha guardado nada: la voz «${vozId}» estaría a la vez en «${uno}» y en ` +
            `«${otro}», y esos dos no pueden compartir timbre. ${porQueNoPuedenCompartir(uno, otro)} ` +
            'En la tarjeta de uno de los dos, «Cambiar la voz elegida», y vuelve a elegir.',
          { reintentable: false, http: 409 }
        );
      }
    }
  }
}

/**
 * ¿Pueden dos personajes decir sus líneas con el mismo timbre?
 *
 * Solo si los dos dicen una o dos líneas en toda la serie Y no salen juntos en
 * ninguna escena. Las dos condiciones hacen falta: alguien a quien se oye lo
 * suficiente se reconoce aunque nunca coincida con el otro, y dos que coinciden
 * se delatan aunque digan una línea cada uno —se oye seguido, en la misma
 * escena, y suena a la misma persona hablando sola—.
 *
 * `comparte` y `con` los calcula herramientas/parche-datos.mjs desde el guion,
 * que es quien sabe quién sale con quién. Aquí no se cuenta nada: se lee.
 *
 * @param {string} unId
 * @param {string} otroId
 * @returns {boolean}
 */
function puedenCompartir(unId, otroId) {
  const reparto = (serie.voces && serie.voces.reparto) || [];
  const uno = reparto.find((r) => r && r.personaje === unId);
  const otro = reparto.find((r) => r && r.personaje === otroId);

  // Quien no está en el reparto no comparte nada: no se sabe cuánto habla ni con
  // quién sale, y ante esa duda manda la regla estricta.
  if (!uno || !otro) return false;
  if (uno.comparte !== true || otro.comparte !== true) return false;

  const conUno = Array.isArray(uno.con) ? uno.con : [];
  const conOtro = Array.isArray(otro.con) ? otro.con : [];
  return !conUno.includes(otroId) && !conOtro.includes(unId);
}

/** Por qué dos personajes no pueden compartir voz, dicho para leerlo en el móvil. */
function porQueNoPuedenCompartir(unId, otroId) {
  const reparto = (serie.voces && serie.voces.reparto) || [];
  const uno = reparto.find((r) => r && r.personaje === unId);
  const otro = reparto.find((r) => r && r.personaje === otroId);

  if (!uno || !otro) {
    return 'Uno de los dos no está en el reparto de voces de datos/serie.json, así que no se sabe ' +
      'cuánto habla ni con quién sale, y ante esa duda cada uno lleva la suya.';
  }

  const conUno = Array.isArray(uno.con) ? uno.con : [];
  const conOtro = Array.isArray(otro.con) ? otro.con : [];
  if (conUno.includes(otroId) || conOtro.includes(unId)) {
    return 'Salen juntos en alguna escena: se oirían seguidos y sonaría a la misma persona ' +
      'hablando sola, aunque digan una línea cada uno.';
  }

  const hablador = uno.comparte !== true ? uno : otro;
  return `«${hablador.personaje}» dice ${hablador.lineas} líneas en la serie y a quien se oye eso ` +
    'se le reconoce el timbre: solo pueden repetir voz los de una o dos líneas.';
}

/**
 * Guarda el estado solo si nadie lo ha cambiado por debajo. NO pisa nunca el
 * trabajo de otra pestaña o de otro móvil: ante conflicto contesta 409 con el
 * estado bueno y su generación para que el navegador reaplique su cambio encima.
 */
async function modoEstadoEscribir(cuerpo) {
  const estado = cuerpo.estado;
  if (!esObjeto(estado)) {
    throw new ErrorDeCara(
      'Se ha intentado guardar como estado algo que no es un estado. No se guarda nada: el bucket ' +
        'es la única verdad de la producción y escribir ahí cualquier cosa borraría todo lo ' +
        'aprobado hasta ahora.',
      { reintentable: false, http: 400 }
    );
  }

  const generacion = exigirTexto(
    cuerpo,
    'generacion',
    'sobre qué versión del estado estás guardando, que es lo que impide pisar lo que se haya ' +
      'hecho desde otro sitio'
  );

  // UNA VOZ, UN PERSONAJE. Se comprueba AQUÍ, en la única puerta por la que
  // pasan todos los cambios de estado, y no solo en la pantalla: dos pestañas
  // pueden elegir la misma voz a la vez, y en una carrera de las que se
  // resuelven con 409 el que pierde vuelve a aplicar su cambio encima del bueno
  // —que es lo correcto para todo lo demás— y colaría el duplicado.
  comprobarQueNadieComparteVoz(estado);

  try {
    // Los nombres de operación se conservan de lo que hay en el bucket: el
    // navegador nunca los ha tenido —viajan como `true`— así que lo que mande en
    // ese campo no puede mandar sobre el original. Sin esto, guardar el estado
    // borraría el único ejemplar bueno del nombre y el clip no se podría
    // recoger nunca.
    const enElBucket = await leerElEstado();
    const aGuardar = conNombresDeOperacion(estado, enElBucket.estado);

    const guardado = await escribirElEstado(aGuardar, generacion);
    return { generacion: guardado.generacion };
  } catch (fallo) {
    if (!(fallo instanceof ErrorDeCara) || fallo.http !== 409) throw fallo;

    // La carrera se contesta con el estado bueno dentro, para que el navegador
    // vuelva a aplicar su cambio encima y guarde otra vez sin perder nada.
    const actual = await leerElEstado();
    fallo.extra = { estado: actual.estado, generacion: actual.generacion };
    throw fallo;
  }
}

// ---------------------------------------------------------------------------
// firmar / listar / borrar / guardar-texto
// ---------------------------------------------------------------------------

/**
 * Devuelve una URL firmada de seis horas por cada ruta, hasta 200 de una vez. NO
 * mueve ni un byte: es lo que permite que una pantalla con 400 planos sea una
 * sola petición y que el MP4 y el PNG no pasen nunca por la función.
 */
async function modoFirmar(cuerpo) {
  const rutas = exigirRutas(cuerpo, 'rutas', 'qué archivos hay que poder mirar u oír');
  return { urls: await firmarRutas(rutas) };
}

/**
 * Lista lo que hay colgando de un prefijo del bucket. NO devuelve el contenido
 * de nada: solo ruta, tamaño y cuándo se escribió.
 */
async function modoListar(cuerpo) {
  const prefijo = typeof cuerpo.prefijo === 'string' ? cuerpo.prefijo : '';
  const todos = await listarElBucket(prefijo);

  // Tope y cursor, y aquí está el motivo.
  //
  // `firmar` y `borrar` tienen tope escrito (200 rutas) porque la petición la
  // compone quien llama. `listar` era el único modo cuya respuesta la decide lo
  // que haya en el bucket y no lo que se le pida: a 99 bytes por objeto, la
  // respuesta se pasa de los 4,5 MB a partir de unos 45.000 objetos.
  //
  // Hoy no se llega: un episodio deja ~1.400 objetos entre keyframes y clips, y
  // la serie entera ~16.800, que es el 37% del tope. Pero ese margen de 2,7
  // veces lo gasta cualquier cosa que hoy no está ahí —los intentos que nadie
  // borra, las muestras de voz de cada candidata, los montajes por capas— y el
  // día que se gaste, el fallo llega como una respuesta cortada que parece un
  // tiempo agotado. Se pone tope ahora, que cuesta diez líneas.
  const tope = Math.min(Math.max(Number(cuerpo.tope) || TOPE_LISTAR, 1), TOPE_LISTAR);
  const desde = typeof cuerpo.cursor === 'string' && cuerpo.cursor ? cuerpo.cursor : null;

  const empieza = desde ? todos.findIndex((o) => o.ruta > desde) : 0;
  const arranque = empieza < 0 ? todos.length : empieza;
  const objetos = todos.slice(arranque, arranque + tope);
  const quedan = todos.length - arranque - objetos.length;

  return {
    objetos,
    total: todos.length,
    // Con cursor, la siguiente llamada sigue por donde esta lo dejó. Sin él, se
    // sabe que faltan y cuántas: nunca se devuelve una lista corta en silencio.
    cursor: quedan > 0 ? objetos[objetos.length - 1].ruta : null,
    quedan: Math.max(0, quedan),
  };
}

/**
 * Borra archivos del bucket, hasta 200 de una vez. NO toca el estado: si lo
 * borrado estaba aprobado, quien lo borró es quien tiene que desaprobarlo.
 */
async function modoBorrar(cuerpo) {
  const rutas = exigirRutas(cuerpo, 'rutas', 'qué archivos hay que borrar');
  let borradas = 0;
  for (const ruta of rutas) {
    // Una a una y en orden: si una falla, se sabe cuántas se habían borrado ya.
    if (await borrarDelBucket(ruta)) borradas += 1;
  }
  return { borradas };
}

/**
 * Guarda un texto en el bucket —un manifiesto, una lista de planos, un SRT—. NO
 * admite binario: lo que se guarda aquí es texto, y lo pesado lo escriben los
 * modelos directamente en el bucket.
 */
async function modoGuardarTexto(cuerpo) {
  const ruta = exigirTexto(cuerpo, 'ruta', 'dónde se guarda el texto');
  const contenido = cuerpo.contenido;

  if (typeof contenido !== 'string') {
    throw new ErrorDeCara(
      `Se ha pedido guardar «${ruta}» pero lo que se manda en «contenido» no es texto. Este modo ` +
        'guarda texto: manifiestos, listas de planos, subtítulos. Es un fallo del propio estudio, ' +
        'no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  const guardado = await escribirEnElBucket(ruta, contenido);
  return { ruta: guardado.ruta, bytes: guardado.bytes };
}

// ---------------------------------------------------------------------------
// montar / montaje-estado
// ---------------------------------------------------------------------------

/**
 * Escribe el manifiesto en el bucket y lanza el Job de Cloud Run pasándole solo
 * la ruta del manifiesto. NO le dice al montador el nombre de ningún archivo: si
 * alguna vez hubiera que editar el montador para añadir un material nuevo, el
 * diseño estaría mal.
 */
async function modoMontar(cuerpo) {
  const manifiesto = cuerpo.manifiesto;
  if (!esObjeto(manifiesto)) {
    throw new ErrorDeCara(
      'Se ha pedido montar sin manifiesto. El manifiesto es lo único que recibe el montador: dice ' +
        'qué clip va en qué segundo, qué audio se mezcla, qué subtítulos se queman y dónde se deja ' +
        'el resultado. Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  const lanzado = await lanzarMontaje(manifiesto);
  return { ejecucion: lanzado.ejecucion, manifiesto_ruta: lanzado.manifiestoRuta };
}

/**
 * Dice cómo va un montaje y, si ha fallado, POR QUÉ: la queja sale del archivo
 * que el montador escribe en el bucket antes de salir con error. NO se conforma
 * con el código de salida: un código de salida no es un mensaje de error.
 */
async function modoMontajeEstado(cuerpo) {
  const ejecucion = exigirTexto(cuerpo, 'ejecucion', 'por qué montaje se pregunta');
  const como = await estadoDeMontaje(ejecucion);
  return {
    hecho: Boolean(como.hecho),
    bien: Boolean(como.bien),
    queja: como.queja ?? null,
    salidas: Array.isArray(como.salidas) ? como.salidas : []
  };
}

// ---------------------------------------------------------------------------
// La tabla
// ---------------------------------------------------------------------------

// NOTA SOBRE EL CONTRATO: §2 escribe los modos como `async (cuerpo, ctx) => datos`
// con `ctx = { serie, guiones, gcs, vertex, entorno }`, y §12 —que es la lista de
// firmas exactas— escribe `{ "<modo>": async (cuerpo) => datos }`. Manda §12: aquí
// cada modo recibe solo el cuerpo, y lo que §2 llama `ctx` son las importaciones
// de arriba, que es lo mismo pero sin poder llegar a un modo a medio construir.

/** Los modos, uno por cosa que sabe hacer el estudio. */
export const MODOS = {
  salud: modoSalud,
  voces: modoVoces,
  'voz-muestra': modoVozMuestra,
  imagen: modoImagen,
  'veo-lanzar': modoVeoLanzar,
  'veo-consultar': modoVeoConsultar,
  musica: modoMusica,
  voz: modoVoz,
  alinear: modoAlinear,
  'desglosar-escena': modoDesglosarEscena,
  'estado-leer': modoEstadoLeer,
  'estado-escribir': modoEstadoEscribir,
  firmar: modoFirmar,
  listar: modoListar,
  borrar: modoBorrar,
  'guardar-texto': modoGuardarTexto,
  montar: modoMontar,
  'montaje-estado': modoMontajeEstado
};

/**
 * Devuelve el estado que manda el navegador con los nombres de operación de Veo
 * puestos de vuelta desde el bucket, que es donde viven de verdad.
 *
 * El navegador puede decir que una operación TERMINÓ —manda `null` o `false` y
 * eso se respeta, porque limpiar es suyo—, pero no puede inventarse un nombre ni
 * cambiar el que hay: si sigue habiendo operación, el nombre es el del bucket.
 *
 * @param {object} delNavegador
 * @param {object} delBucket
 * @returns {object}
 */
function conNombresDeOperacion(delNavegador, delBucket) {
  const copia = JSON.parse(JSON.stringify(delNavegador));
  const tomasBucket = esObjeto(delBucket) && esObjeto(delBucket.tomas) ? delBucket.tomas : {};

  for (const [clave, entrada] of Object.entries(copia.tomas || {})) {
    if (!esObjeto(entrada)) continue;
    const original = tomasBucket[clave];
    const nombre = esObjeto(original) ? soloTexto(original.operacion_en_curso) : '';
    const prefijoOriginal = esObjeto(original) ? soloTexto(original.operacion_prefijo) : '';

    // Si el navegador dice que ya no hay operación, se le hace caso: la ha
    // terminado él o la ha dado por perdida, y esa decisión es suya.
    if (!entrada.operacion_en_curso) {
      entrada.operacion_en_curso = null;
      entrada.operacion_prefijo = null;
      continue;
    }

    entrada.operacion_en_curso = nombre || null;
    entrada.operacion_prefijo = prefijoOriginal || null;
  }
  return copia;
}

/**
 * Busca el nombre de una operación de Veo en los apuntes que `veo-lanzar` deja
 * en el bucket, para cuando el estado no lo tiene.
 *
 * Se mira el intento más alto, que es el último lanzado. Existe por el
 * invariante de que ninguna operación queda huérfana: si la escritura del estado
 * falló justo después de lanzar, este archivo es lo único que queda entre un
 * clip pagado y nadie que lo recoja.
 *
 * @param {string} idPieza
 * @param {string} idToma
 * @returns {Promise<{operacion:string, prefijo:string}|null>}
 */
async function buscarOperacionApuntada(idPieza, idToma) {
  const carpeta = carpetaDeClips(idPieza, idToma);
  let objetos;
  try {
    objetos = await listarElBucket(carpeta);
  } catch {
    return null;
  }

  const apuntes = objetos
    .map((uno) => soloTexto(uno && uno.ruta))
    .filter((ruta) => ruta && ruta.endsWith('/operacion.txt'))
    .sort();
  if (!apuntes.length) return null;

  const ultimo = apuntes[apuntes.length - 1];
  try {
    const leido = await leerBytes(ultimo);
    if (!leido) return null;
    const operacion = Buffer.from(leido.datos).toString('utf8').trim();
    if (!operacion) return null;
    return { operacion, prefijo: ultimo.slice(0, -'operacion.txt'.length) };
  } catch {
    return null;
  }
}
