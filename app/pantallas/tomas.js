// Tomas: la lista de planos de la pieza activa. Aquí se pasan las horas.
//
// Esta pantalla tiene que aguantar el teaser de 24 planos y un episodio de 400
// en la pantalla de un teléfono, y tiene que hacerlo sin que se pueda gastar un
// euro por accidente. De ahí sale todo lo que parece manía y no lo es:
//
//   1. EL BOTÓN DE GENERAR VÍDEO NO EXISTE SIN KEYFRAME APROBADO. No está
//      apagado con un aviso: no está. En su sitio hay una frase que dice que
//      primero se mira la imagen y se aprueba. Un keyframe malo cuesta céntimos
//      y un clip malo cuesta un euro (plan §11, contrato §9). El segundo
//      cerrojo lo pone la función, que vuelve a comprobarlo antes de llamar a
//      Veo; este es el primero, y es el que evita el gasto.
//
//   2. EL FILTRO POR ESTADO ES OBLIGATORIO. Con 400 planos, una lista sin
//      filtros no se puede usar: no se sabe qué falta ni por dónde seguir. Las
//      seis pastillas son las del plan §8 —sin keyframe · keyframe pendiente de
//      aprobar · listo para vídeo · vídeo en curso · intentos sin elegir ·
//      listo— y llevan su cuenta al lado, que es lo que de verdad se mira.
//
//   3. EL PROGRESO VA POR BLOQUE, NO SOLO POR PLANO. «171 de 400» no dice si el
//      episodio va por la mitad; «escena 12 de 24 terminada» sí. Para el teaser
//      el bloque es la letra del id (A, B, C, D, E), que es como está escrito;
//      para un episodio son sus escenas y, si las tomas traen acto, sus actos.
//
//   4. LA LISTA VA PAGINADA Y LOS VÍDEOS NO SE PRECARGAN. Cuatrocientas
//      tarjetas con vídeo dentro son cuatrocientas peticiones de cabecera y un
//      teléfono que se arrastra. Se pinta una página cada vez, las URL firmadas
//      se piden en tandas —el modo «firmar» admite 200 de golpe, así que una
//      página entera es UNA petición— y cada `<video>` va con `preload="none"`
//      y con el keyframe de poster: no baja un solo byte hasta que se toca.
//
//   5. UN CLIP NO SE ELIGE SIN HABERLO REPRODUCIDO. El botón de elegir aparece
//      apagado, con su motivo escrito, hasta que ese vídeo se ha reproducido en
//      esta pantalla. Es la regla del producto: nada entra en el montaje sin
//      haber pasado por los ojos del usuario (plan §11).
//
//   6. UNA TOMA ENCADENADA SE USA ENTERA. Con `encadena_con`, Veo interpola
//      hacia el keyframe de la toma siguiente y `dur == dur_gen`. Se enseña
//      dicho con palabras y no se ofrece recorte para ella: recortarla dejaría
//      la interpolación sin llegar al corte. Y hace falta el keyframe de la
//      toma SIGUIENTE aprobado, así que mientras no lo esté tampoco hay botón.
//
//   7. AQUÍ NO SE VE NI SE EDITA EL PROMPT DE UN PLANO. El plano es un detalle
//      interno de la máquina: lo que el usuario juzga es la imagen y el vídeo.
//      Por eso en ninguna tarjeta se pinta `toma.imagen` ni `toma.video`.
//
// POR QUÉ LOS BOTONES DE TANDA ENCOLAN Y NO LANZAN. Saturar las cuotas de Vertex
// devuelve errores que parecen falta de acceso al modelo (plan §8). Todo pasa
// por `encolarVarios()`, que escribe el estado una sola vez y deja que la cola
// los saque de tres en tres. Y el de los clips pregunta antes, con el número
// delante: veinte clips son veinte euros.

import { llamar, ErrorDeCara } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import { encolar, encolarVarios } from '../cola.js';
import {
  aviso,
  barra,
  boton,
  confirmar,
  espera,
  filtro,
  h,
  pantalla,
  seccion,
  tarjeta,
  vaciar
} from '../ui.js';
import { plural, segundos } from '../formato.js';

// ---------------------------------------------------------------------------
// Números y palabras fijas de esta pantalla
// ---------------------------------------------------------------------------

/** Cuántas rutas caben en una llamada a `firmar` (docs/contrato.md §2). */
const MAXIMO_POR_FIRMA = 200;

/**
 * Cuánto se da por buena una URL firmada. La función las hace de seis horas y
 * aquí se tiran a las cinco, para que no caduque un enlace mientras se está
 * mirando la imagen o reproduciendo el clip.
 */
const VIDA_DE_URL_MS = 5 * 60 * 60 * 1000;

/**
 * Cuántas tarjetas se pintan de una vez. Doce, y no cuatrocientas, porque cada
 * tarjeta trae un keyframe de 2K dentro y hasta tres vídeos debajo. Con el
 * botón de «ver más» se añade otra página; con el filtro puesto casi nunca hace
 * falta pasar de la primera.
 */
const TAMANO_DE_PAGINA = 12;

/**
 * Cuánto se espera, después de pausar un vídeo, antes de repintar la pantalla
 * con los cambios que hayan llegado mientras tanto. Repintar borra el `<video>`
 * y con él el punto donde se había parado; esperar unos segundos deja mirar el
 * fotograma sin que se mueva nada debajo.
 */
const ESPERA_TRAS_PAUSA_MS = 4000;

/** A partir de cuántos bloques el progreso se pliega para no ocupar la pantalla. */
const BLOQUES_SIN_PLEGAR = 8;

/**
 * Los seis estados por los que se filtra, tal como los pide el plan §8, más
 * «Todo». El orden es el del trabajo: de lo que no tiene nada a lo terminado.
 */
const FILTROS = {
  todo: 'Todo',
  'sin-keyframe': 'Sin keyframe',
  'keyframe-por-aprobar': 'Keyframe por aprobar',
  'listo-para-video': 'Listo para vídeo',
  'video-en-curso': 'Vídeo en curso',
  'sin-elegir': 'Intentos sin elegir',
  listo: 'Listo'
};

/** Cómo se dice en pantalla cada nivel de Veo. En los datos van sin tilde. */
const NIVELES_DE_VEO = {
  calidad: 'calidad',
  medio: 'medio',
  economico: 'económico'
};

/** Cómo se pinta el punto de estado de cada tarjeta. */
const PUNTOS = {
  'sin-keyframe': { tipo: 'sin-keyframe', texto: 'Sin keyframe' },
  'keyframe-por-aprobar': { tipo: 'por-aprobar', texto: 'Keyframe por aprobar' },
  'listo-para-video': { tipo: 'pendiente', texto: 'Listo para vídeo' },
  'video-en-curso': { tipo: 'generando', texto: 'Vídeo en curso' },
  'sin-elegir': { tipo: 'por-aprobar', texto: 'Intentos sin elegir' },
  listo: { tipo: 'listo', texto: 'Listo' }
};

// ---------------------------------------------------------------------------
// Lo que esta pantalla recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** `datos/serie.json`, pedido una sola vez. */
let promesaDeLaSerie = null;

/** Ruta lógica → `{ url, hasta }`. Las URL firmadas se reaprovechan. */
const enlaces = new Map();

/**
 * Rutas por las que ya se preguntó y no hay enlace. No se vuelve a preguntar
 * por ellas solas: si al fallar se reintentara en el repintado siguiente —y el
 * repintado siguiente lo dispara el propio fallo—, la pantalla se quedaría
 * dando vueltas contra el mismo error. Se limpia con «Volver a pedir los
 * enlaces», que es cuando alguien decide reintentar.
 */
const sinEnlace = new Set();

/** Si hay una petición de firmas en marcha ahora mismo. */
let pidiendoEnlaces = false;

/** Por qué no se han podido conseguir los enlaces, si es que no se han podido. */
let quejaDeEnlaces = null;

/** El último fallo de una acción de esta pantalla, para pintarlo arriba. */
let queja = null;

/** Qué keyframe se está mirando de cada toma: `«pieza/toma» → ruta`. */
const mirando = new Map();

/** Los clips que se han reproducido en esta sesión. Sin esto no se elige uno. */
const vistos = new Set();

/** Los vídeos que están sonando ahora mismo: mientras haya uno, no se repinta. */
const sonando = new Set();

/** Si ha llegado un cambio del estado mientras se reproducía algo. */
let repintadoPendiente = false;

/** El reloj que repinta poco después de pausar. */
let relojDeRepintado = null;

/** El filtro de estado puesto. */
let filtroPuesto = 'todo';

/** El bloque puesto: «todo» o el id de una escena o letra. */
let bloquePuesto = 'todo';

/** Cuántas páginas de tarjetas se están enseñando. */
let paginas = 1;

/**
 * Lo que hay que hacer cuando un vídeo se pausa o se acaba. Lo pone `montar()` y
 * lo llaman los reproductores; fuera de un montaje vale null.
 * @type {(() => void)|null}
 */
let alSoltarUnVideo = null;

/** Para el reloj del repintado diferido, si estaba puesto. */
function pararElReloj() {
  if (relojDeRepintado) {
    clearTimeout(relojDeRepintado);
    relojDeRepintado = null;
  }
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'tomas',
  titulo: 'Tomas',
  icono: '\u{1F3AC}',

  /**
   * Pinta la lista de la pieza activa dentro de `raiz` y se queda escuchando el
   * estado.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>} cómo desapuntarse al cambiar de pestaña
   */
  async montar(raiz) {
    const marco = h('div', { clase: 'tomas' });
    raiz.appendChild(marco);

    /** Cómo desapuntarse de lo que esté montado ahora mismo. */
    let soltar = null;

    const arrancar = async () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
      vaciar(marco);

      marco.appendChild(espera('Trayendo los planos de la pieza…'));

      let modelo;
      try {
        modelo = construirModelo(await laSerie());
      } catch (fallo) {
        const error = comoErrorDeCara(fallo);
        vaciar(marco);
        marco.appendChild(
          pantalla(
            'Tomas',
            seccion(
              null,
              aviso(error.mensaje, { tono: 'error', detalle: error.detalle }),
              h(
                'div',
                { clase: 'tarjeta-acciones' },
                boton(
                  'Volver a intentarlo',
                  () => {
                    promesaDeLaSerie = null;
                    arrancar();
                  },
                  { tono: 'principal' }
                )
              )
            )
          )
        );
        return;
      }

      /**
       * El repintado de verdad, el que se hace cuando el usuario toca algo.
       *
       * Rehacer la pantalla se lleva por delante los `<video>` que hubiera, así
       * que lo primero es olvidarse de los que estuvieran sonando: esos nodos ya
       * no van a existir y nunca van a avisar de que se han pausado. Sin esto,
       * un vídeo que se estaba reproduciendo cuando se tocó un filtro dejaría la
       * pantalla congelada para siempre, esperando una pausa que no llega.
       */
      const repintar = () => {
        sonando.clear();
        repintadoPendiente = false;
        pararElReloj();
        vaciar(marco);
        marco.appendChild(construir(modelo, repintar, pedirRepintado));
      };

      /**
       * El repintado que espera a que termine lo que se está reproduciendo.
       *
       * Por aquí pasa solo lo que NO ha pedido el usuario: los cambios de estado
       * que escribe la cola cada pocos segundos y la llegada de las URL
       * firmadas. Repintar por eso en mitad de un clip lo cortaría justo cuando
       * se está juzgando, que es lo único que esta pantalla no puede hacer.
       *
       * Lo que sí pide el usuario —un filtro, un botón— repinta en el acto
       * aunque haya algo sonando: si toca algo y no pasa nada, la pantalla está
       * rota aunque el vídeo siga.
       */
      const pedirRepintado = () => {
        if (sonando.size) {
          repintadoPendiente = true;
          return;
        }
        repintar();
      };

      // Cuando se pausa o se acaba un vídeo, se repinta lo que quedó pendiente,
      // pero unos segundos después: pausar para mirar un fotograma no puede
      // hacer que la tarjeta se rehaga bajo el dedo.
      alSoltarUnVideo = () => {
        if (!repintadoPendiente || sonando.size) return;
        pararElReloj();
        relojDeRepintado = setTimeout(() => {
          relojDeRepintado = null;
          if (!sonando.size && repintadoPendiente) pedirRepintado();
        }, ESPERA_TRAS_PAUSA_MS);
      };

      const desapuntar = alCambiar(pedirRepintado);
      soltar = () => {
        desapuntar();
        sonando.clear();
        repintadoPendiente = false;
        pararElReloj();
        alSoltarUnVideo = null;
      };

      vaciar(marco);
      repintar();
    };

    await arrancar();

    return () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
    };
  }
};

// ---------------------------------------------------------------------------
// datos/serie.json, del lado del navegador
// ---------------------------------------------------------------------------

// FALTA EN EL CONTRATO: §12 da `api/_lib/datos.js` para la función, pero ningún
// módulo de datos para el navegador; `app/cola.js` y `app/pantallas/banco.js` ya
// se bajan `serie.json` por su cuenta con este mismo patrón. Esta pantalla
// necesita saber qué planos tiene la pieza, cuánto duran, con qué nivel de Veo
// se generan y cuál encadena con cuál. Nada de eso es componer un prompt ni
// conocer un id de modelo, que es lo único que §0 le prohíbe al navegador. Que
// se revise si debe acabar en un `app/datos.js` compartido.

/**
 * `datos/serie.json`, bajado una vez y guardado.
 * @returns {Promise<object>}
 */
function laSerie() {
  if (!promesaDeLaSerie) {
    promesaDeLaSerie = bajarLaSerie().catch((fallo) => {
      // Una caída de red no puede dejar la pantalla sin datos para siempre.
      promesaDeLaSerie = null;
      throw fallo;
    });
  }
  return promesaDeLaSerie;
}

/**
 * Baja el archivo. La dirección se calcula desde la de este módulo, así que da
 * igual si la aplicación cuelga de la raíz o de una subcarpeta.
 * @returns {Promise<object>}
 */
async function bajarLaSerie() {
  const direccion = new URL('../../datos/serie.json', import.meta.url).href;

  let respuesta;
  try {
    respuesta = await fetch(direccion, { cache: 'no-cache' });
  } catch (fallo) {
    throw new ErrorDeCara(
      'No se ha podido leer datos/serie.json, que es donde están escritos los planos de cada ' +
        'pieza: cuánto dura cada uno, con qué nivel de Veo se genera y cuál encadena con cuál. ' +
        'Sin él esta pantalla no tiene nada que enseñar. Comprueba la conexión del teléfono; si ' +
        'tienes cobertura, es que el despliegue está a medias.',
      { detalle: loQueDijo(fallo), reintentable: true, http: 0 }
    );
  }

  if (!respuesta.ok) {
    throw new ErrorDeCara(
      `No se ha podido leer datos/serie.json: el servidor ha contestado con un ${respuesta.status}. ` +
        'Ese archivo va dentro del repositorio, así que si no está es que el despliegue no ha ' +
        'subido entero.',
      {
        detalle: `HTTP ${respuesta.status}`,
        reintentable: respuesta.status >= 500,
        http: respuesta.status
      }
    );
  }

  try {
    return await respuesta.json();
  } catch (fallo) {
    throw new ErrorDeCara(
      'datos/serie.json se ha bajado pero no se entiende: no es un JSON válido. Es un fallo del ' +
        'propio estudio, no de tu cuenta.',
      { detalle: loQueDijo(fallo), reintentable: false, http: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// El modelo: las piezas y sus bloques
// ---------------------------------------------------------------------------

/**
 * Ordena lo que esta pantalla necesita de la serie: las piezas con sus tomas en
 * orden, agrupadas en bloques, y los ids del banco y de los escenarios para
 * poder decir qué falta por aprobar antes de gastar un keyframe.
 *
 * @param {object} datos `datos/serie.json` entero
 * @returns {object}
 */
function construirModelo(datos) {
  const mapa = esObjeto(datos) && esObjeto(datos.piezas) ? datos.piezas : {};
  const ids = Object.keys(mapa);

  if (!ids.length) {
    throw new ErrorDeCara(
      'datos/serie.json se ha leído bien pero no trae ninguna pieza, así que no hay planos que ' +
        'enseñar. Es un fallo del propio estudio, no de tu cuenta: el archivo del repositorio no ' +
        'es el que debería.',
      { reintentable: false, http: 500 }
    );
  }

  const piezas = ids.map((id) => {
    const cruda = esObjeto(mapa[id]) ? mapa[id] : {};
    const tomas = (Array.isArray(cruda.tomas) ? cruda.tomas : []).filter(
      (una) => una && typeof una.id === 'string' && una.id.trim()
    );
    return {
      id,
      titulo: soloTexto(cruda.titulo) || id,
      duracionS: Number(cruda.duracion_s) || 0,
      tomas,
      grupos: agrupar(tomas)
    };
  });

  const placas = new Set(
    ((esObjeto(datos.banco) && Array.isArray(datos.banco.placas) ? datos.banco.placas : []) || [])
      .map((una) => (una && typeof una.id === 'string' ? una.id : ''))
      .filter(Boolean)
  );

  const escenarios = new Set(
    ((esObjeto(datos.escenarios) && Array.isArray(datos.escenarios.placas)
      ? datos.escenarios.placas
      : []) || [])
      .map((uno) => (uno && typeof uno.id === 'string' ? uno.id : ''))
      .filter(Boolean)
  );

  return { piezas, porId: new Map(piezas.map((una) => [una.id, una])), placas, escenarios };
}

/**
 * Agrupa las tomas en bloques para el progreso y para el filtro.
 *
 * Dos niveles, y los dos salen de los datos, no de una tabla escrita aquí:
 *
 *   · El bloque bajo es la ESCENA cuando la toma la trae (los episodios, que
 *     salen del desglose), y la LETRA del id cuando no (el teaser: A, B, C, D,
 *     E, que es exactamente como está escrito en serie.json).
 *   · El bloque alto es el ACTO cuando la toma lo trae. Si no lo trae pero el id
 *     empieza por letra y la escena es otra cosa, esa letra hace de acto. En el
 *     teaser la letra ya es el bloque bajo, así que no hay nivel alto y no se
 *     inventa ninguno.
 *
 * @param {object[]} tomas
 * @returns {{bloques:object[], actos:object[]}}
 */
function agrupar(tomas) {
  const bloques = [];
  const porBloque = new Map();

  for (const una of tomas) {
    const letra = letraDe(una.id);
    const conEscena = tieneValor(una.escena);
    const idBloque = conEscena ? String(una.escena).trim() : letra || 'unico';
    const idActo = tieneValor(una.acto)
      ? String(una.acto).trim()
      : letra && letra !== idBloque
        ? letra
        : '';

    let bloque = porBloque.get(idBloque);
    if (!bloque) {
      bloque = {
        id: idBloque,
        acto: idActo,
        titulo: conEscena
          ? `Escena ${idBloque}`
          : letra
            ? `Bloque ${letra}`
            : 'Todos los planos',
        tomas: []
      };
      porBloque.set(idBloque, bloque);
      bloques.push(bloque);
    }
    bloque.tomas.push(una);
  }

  const actos = [];
  const porActo = new Map();
  for (const bloque of bloques) {
    if (!bloque.acto) continue;
    let acto = porActo.get(bloque.acto);
    if (!acto) {
      acto = { id: bloque.acto, titulo: `Acto ${bloque.acto}`, bloques: [], tomas: [] };
      porActo.set(bloque.acto, acto);
      actos.push(acto);
    }
    acto.bloques.push(bloque);
    acto.tomas.push(...bloque.tomas);
  }

  return { bloques, actos };
}

/** La letra con la que empieza un id de toma («A4» → «A»), o cadena vacía. */
function letraDe(id) {
  const encontrado = /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\d/.exec(String(id ?? '').trim());
  return encontrado ? encontrado[1].toUpperCase() : '';
}

// ---------------------------------------------------------------------------
// El estado, leído sin romperse
// ---------------------------------------------------------------------------

/**
 * El estado de la producción, o uno vacío si todavía no ha llegado. Una pantalla
 * que se pinte antes de tiempo no puede quedarse en blanco.
 * @returns {object}
 */
function leerEstado() {
  try {
    return actual();
  } catch {
    return { tomas: {}, banco: {}, escenarios: {}, cola: [], pieza_activa: null };
  }
}

/**
 * Lo que hay guardado de una toma, ya limpio y con la forma del contrato §5.
 * @param {object} estado
 * @param {string} clave `{pieza}/{toma}`
 * @returns {{keyframe:string|null, intentosKeyframe:string[], clip:string|null,
 *   intentosClip:string[], operacion:string|null}}
 */
function leerToma(estado, clave) {
  const mapa = esObjeto(estado) && esObjeto(estado.tomas) ? estado.tomas : {};
  const entrada = esObjeto(mapa[clave]) ? mapa[clave] : {};
  return {
    keyframe: rutaSiVale(entrada.keyframe_aprobado),
    intentosKeyframe: soloRutas(entrada.intentos_keyframe),
    clip: rutaSiVale(entrada.clip_elegido),
    intentosClip: soloRutas(entrada.intentos_clip),
    operacion: soloTexto(entrada.operacion_en_curso) || null
  };
}

/**
 * La entrada de una toma dentro del estado que se está cambiando, creada con la
 * forma del contrato §5 si no estaba.
 * @param {object} estado
 * @param {string} clave
 * @returns {object}
 */
function entradaMutable(estado, clave) {
  if (!esObjeto(estado.tomas)) estado.tomas = {};
  const entrada = estado.tomas[clave];
  if (esObjeto(entrada)) return entrada;
  estado.tomas[clave] = {
    keyframe_aprobado: null,
    intentos_keyframe: [],
    clip_elegido: null,
    intentos_clip: [],
    operacion_en_curso: null
  };
  return estado.tomas[clave];
}

/** Si una placa del banco o un escenario está aprobado. */
function estaAprobada(estado, donde, id) {
  const mapa = esObjeto(estado) && esObjeto(estado[donde]) ? estado[donde] : {};
  const entrada = mapa[id];
  return Boolean(esObjeto(entrada) && rutaSiVale(entrada.aprobada));
}

/**
 * Qué está haciendo la cola con cada toma, para poder pintar «generando» y,
 * sobre todo, POR QUÉ falló lo que falló: un trabajo fallido cuyo error solo
 * viva en la pantalla de Cola obliga a cambiar de pestaña para saber qué le pasa
 * a la tarjeta que se está mirando.
 *
 * @param {object} estado
 * @returns {Map<string, object>} la clave es `«keyframe»:«pieza/toma»` o
 *   `«clip»:«pieza/toma»`
 */
function indexarCola(estado) {
  const indice = new Map();
  const cola = esObjeto(estado) && Array.isArray(estado.cola) ? estado.cola : [];

  for (const trabajo of cola) {
    if (!trabajo) continue;
    const tipo = String(trabajo.tipo || '');
    const familia =
      tipo === 'keyframe' ? 'keyframe' : tipo === 'clip' || tipo === 'clip-consultar' ? 'clip' : '';
    if (!familia) continue;

    const args = esObjeto(trabajo.args) ? trabajo.args : {};
    const pieza = soloTexto(args.pieza);
    const id = soloTexto(args.id);
    if (!pieza || !id) continue;

    const clave = `${familia}:${pieza}/${id}`;
    const anterior = indice.get(clave);
    // De un trabajo revivido solo interesa lo último que le ha pasado.
    if (anterior && mandaSobre(anterior.estado, trabajo.estado)) continue;

    indice.set(clave, {
      estado: String(trabajo.estado || ''),
      error: soloTexto(trabajo.error) || null,
      detalle: soloTexto(trabajo.detalle) || null,
      aviso: soloTexto(trabajo.aviso) || null
    });
  }

  return indice;
}

/** Cuál de dos estados de trabajo se enseña cuando hay dos para la misma toma. */
function mandaSobre(anterior, nuevo) {
  const peso = { en_curso: 4, pendiente: 3, fallido: 2, detenido: 1, hecho: 0 };
  return (peso[anterior] ?? 0) >= (peso[String(nuevo || '')] ?? 0);
}

// ---------------------------------------------------------------------------
// En qué estado está cada toma
// ---------------------------------------------------------------------------

/**
 * El estado de una toma: uno solo, y siempre uno de los seis del filtro, para
 * que las cuentas de las pastillas sumen exactamente el total de planos.
 *
 * El orden importa. «Vídeo en curso» manda sobre todo lo demás porque es lo
 * único que dice «no toques esto, que ya se está pagando».
 *
 * @param {object} guardado lo que devuelve `leerToma()`
 * @param {object|null} enLaCola lo que dice `indexarCola()` del clip
 * @returns {string}
 */
function estadoDeToma(guardado, enLaCola) {
  const enVuelo =
    Boolean(guardado.operacion) ||
    Boolean(enLaCola && (enLaCola.estado === 'en_curso' || enLaCola.estado === 'pendiente'));

  if (enVuelo) return 'video-en-curso';
  if (guardado.clip) return 'listo';
  if (guardado.intentosClip.length) return 'sin-elegir';
  if (guardado.keyframe) return 'listo-para-video';
  if (guardado.intentosKeyframe.length) return 'keyframe-por-aprobar';
  return 'sin-keyframe';
}

/**
 * Cuánto hay hecho de un puñado de tomas.
 * @param {object[]} tomas
 * @param {object} ctx
 * @returns {{total:number, keyframes:number, elegidos:number, sinNada:number}}
 */
function progresoDe(tomas, ctx) {
  const cuenta = { total: tomas.length, keyframes: 0, elegidos: 0, sinNada: 0 };
  for (const una of tomas) {
    const guardado = leerToma(ctx.estado, `${ctx.pieza.id}/${una.id}`);
    if (guardado.keyframe) cuenta.keyframes += 1;
    if (guardado.clip) cuenta.elegidos += 1;
    if (!guardado.keyframe && !guardado.intentosKeyframe.length) cuenta.sinNada += 1;
  }
  return cuenta;
}

// ---------------------------------------------------------------------------
// Lo que falta antes de poder generar
// ---------------------------------------------------------------------------

/**
 * Por qué todavía no se puede generar el keyframe de una toma, con palabras.
 * Null si se puede.
 *
 * Es exactamente lo que va a exigir la función: la placa del escenario viaja
 * como referencia de objeto y cada `ref` como referencia de personaje, y si
 * alguna no está aprobada, `exigirAprobada()` falla y dice cuál. Aquí se dice
 * antes, para no gastar la llamada.
 *
 * @param {object} laToma
 * @param {object} ctx
 * @returns {string|null}
 */
function porQueNoSePuedeKeyframe(laToma, ctx) {
  const faltan = [];
  const inexistentes = [];

  const elEscenario = soloTexto(laToma.escenario);
  if (elEscenario) {
    if (!ctx.modelo.escenarios.has(elEscenario)) inexistentes.push(`el escenario «${elEscenario}»`);
    else if (!estaAprobada(ctx.estado, 'escenarios', elEscenario)) {
      faltan.push(`el escenario «${elEscenario}»`);
    }
  }

  for (const idRef of Array.isArray(laToma.refs) ? laToma.refs : []) {
    const ref = soloTexto(idRef);
    if (!ref) continue;
    if (!ctx.modelo.placas.has(ref)) inexistentes.push(`la placa «${ref}»`);
    else if (!estaAprobada(ctx.estado, 'banco', ref)) faltan.push(`la placa «${ref}»`);
  }

  if (inexistentes.length) {
    return (
      `Esta toma pide ${enumerar(inexistentes, 4)}, y eso no está en el banco de datos/serie.json. ` +
      'Es un fallo de los datos, no de tu cuenta: hasta que no exista, este plano no se puede ' +
      'generar contra nada.'
    );
  }

  if (!faltan.length) return null;

  return (
    `Falta aprobar ${enumerar(faltan, 4)} en la pantalla de Banco. Un keyframe se genera con esas ` +
    'imágenes delante —el escenario como objeto y cada personaje como personaje—, y sin ellas ' +
    'saldría otra cripta y otra cara. Por eso aquí todavía no hay botón de generar: no serviría ' +
    'de nada pulsarlo.'
  );
}

/**
 * Por qué no hay botón de generar vídeo, con palabras. Null si lo hay.
 *
 * La primera razón es LA regla dura de toda la herramienta y por eso va la
 * primera: sin keyframe aprobado no existe el botón. La segunda es la del
 * encadenado, que es la misma regla mirando una toma más allá.
 *
 * @param {object} laToma
 * @param {object} guardado
 * @param {object} ctx
 * @returns {string|null}
 */
function porQueNoHayBotonDeVideo(laToma, guardado, ctx) {
  if (!guardado.keyframe) {
    return (
      'Primero hay que aprobar el keyframe. Mientras no lo esté, aquí no hay botón de generar ' +
      'vídeo: no está apagado, es que no existe. Un keyframe malo cuesta céntimos y un clip malo ' +
      'cuesta un euro, así que la imagen se mira antes de pagar el movimiento.'
    );
  }

  const siguiente = soloTexto(laToma.encadena_con);
  if (siguiente) {
    const suyo = leerToma(ctx.estado, `${ctx.pieza.id}/${siguiente}`);
    if (!suyo.keyframe) {
      return (
        `Esta toma encadena con ${siguiente}, y para encadenar hace falta el keyframe de ` +
        `${siguiente} aprobado: es la imagen a la que Veo tiene que llegar interpolando. Genera y ` +
        `aprueba antes el keyframe de ${siguiente} y aquí aparecerá el botón.`
      );
    }
  }

  if (guardado.operacion) {
    return (
      'Veo está generando ahora mismo el vídeo de esta toma. No hace falta tener la pantalla ' +
      'abierta: la cola vuelve a preguntar sola y el clip aparecerá aquí en cuanto esté. Pedir ' +
      'otro mientras tanto sería pagar dos.'
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Las URL firmadas
// ---------------------------------------------------------------------------

/**
 * El enlace para mirar u oír una ruta, o null si todavía no hay.
 * @param {string} ruta
 * @returns {string|null}
 */
function enlaceDe(ruta) {
  const guardado = enlaces.get(ruta);
  if (!guardado) return null;
  if (guardado.hasta <= Date.now()) {
    enlaces.delete(ruta);
    return null;
  }
  return guardado.url;
}

/**
 * Pide de una vez los enlaces que falten de lo que se está pintando, en lotes de
 * 200 —el tope de `firmar`—, y repinta cuando los tenga.
 *
 * Solo se piden los de las tarjetas que hay en pantalla. Con 400 planos, firmar
 * todo lo que existe serían miles de rutas y varias peticiones que nadie va a
 * mirar; con una página son setenta y pico y una sola llamada.
 *
 * @param {string[]} rutas
 * @param {() => void} repintar
 */
function pedirEnlacesQueFalten(rutas, repintar) {
  if (pidiendoEnlaces) return;

  const faltan = [...new Set(rutas)].filter((ruta) => !enlaceDe(ruta) && !sinEnlace.has(ruta));
  if (!faltan.length) return;

  pidiendoEnlaces = true;
  quejaDeEnlaces = null;

  (async () => {
    for (let i = 0; i < faltan.length; i += MAXIMO_POR_FIRMA) {
      const lote = faltan.slice(i, i + MAXIMO_POR_FIRMA);
      const respuesta = await llamar('firmar', { rutas: lote });
      const dadas = esObjeto(respuesta) && esObjeto(respuesta.urls) ? respuesta.urls : {};
      for (const ruta of lote) {
        const url = dadas[ruta];
        if (typeof url === 'string' && url) {
          enlaces.set(ruta, { url, hasta: Date.now() + VIDA_DE_URL_MS });
        } else {
          // Vino sin enlace: se apunta para no preguntar por ella en bucle.
          sinEnlace.add(ruta);
        }
      }
    }
  })()
    .catch((fallo) => {
      quejaDeEnlaces = comoErrorDeCara(fallo);
      // Lo que no llegó se aparta hasta que alguien pida los enlaces otra vez.
      for (const ruta of faltan) if (!enlaceDe(ruta)) sinEnlace.add(ruta);
    })
    .finally(() => {
      pidiendoEnlaces = false;
      repintar();
    });
}

/** Tira todos los enlaces guardados y vuelve a pedirlos. */
function olvidarEnlaces(repintar) {
  enlaces.clear();
  sinEnlace.clear();
  quejaDeEnlaces = null;
  repintar();
}

/**
 * Todas las rutas que hace falta firmar para pintar una tarjeta: el keyframe que
 * se mira, la tira de intentos si se enseña, y los clips, que además necesitan
 * el keyframe aprobado de poster.
 * @param {object} guardado
 * @returns {string[]}
 */
function rutasDeLaTarjeta(guardado) {
  const rutas = [];
  if (guardado.keyframe) rutas.push(guardado.keyframe);
  rutas.push(...guardado.intentosKeyframe);
  if (guardado.clip) rutas.push(guardado.clip);
  rutas.push(...guardado.intentosClip);
  return rutas.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Pintar
// ---------------------------------------------------------------------------

/**
 * La pantalla entera.
 * @param {object} modelo
 * @param {() => void} repintar el repintado inmediato: lo que toca el usuario
 * @param {() => void} repintarLuego el que espera a que acabe lo que suena
 * @returns {HTMLElement}
 */
function construir(modelo, repintar, repintarLuego) {
  const estado = leerEstado();
  const pieza = piezaActiva(modelo, estado);

  if (!pieza) {
    return pantalla(
      'Tomas',
      seccion(
        null,
        aviso(
          'No hay ninguna pieza que enseñar: datos/serie.json no trae planos escritos. El teaser ' +
            'viene desglosado en el repositorio, así que si falta es que el despliegue subió a ' +
            'medias.',
          { tono: 'error' }
        )
      )
    );
  }

  const ctx = {
    modelo,
    estado,
    pieza,
    trabajos: indexarCola(estado),
    repintar
  };

  // El filtro de bloque puede estar apuntando a un bloque de otra pieza.
  if (bloquePuesto !== 'todo' && !pieza.grupos.bloques.some((uno) => uno.id === bloquePuesto)) {
    bloquePuesto = 'todo';
  }

  const visibles = tomasVisibles(ctx);
  const enPantalla = visibles.slice(0, paginas * TAMANO_DE_PAGINA);

  const rutas = [];
  for (const una of enPantalla) {
    rutas.push(...rutasDeLaTarjeta(leerToma(estado, `${pieza.id}/${una.id}`)));
  }
  // Las firmas llegan solas, sin que nadie las haya pedido a mano: su repintado
  // es de los que esperan a que termine el clip que se esté mirando.
  pedirEnlacesQueFalten(rutas, repintarLuego);

  return pantalla(
    'Tomas',
    seccionCabecera(ctx),
    seccionProgreso(ctx),
    seccionPlanos(ctx, visibles, enPantalla)
  );
}

/** La pieza que se está produciendo: la del estado, o la primera de la serie. */
function piezaActiva(modelo, estado) {
  const dicha = soloTexto(estado.pieza_activa);
  if (dicha && modelo.porId.has(dicha)) return modelo.porId.get(dicha);
  return modelo.piezas[0] || null;
}

// ---------------------------------------------------------------------------
// La cabecera: la pieza, el progreso de arriba, las tandas y los filtros
// ---------------------------------------------------------------------------

/**
 * Lo de arriba: qué pieza se está produciendo, cuánto lleva hecho, los dos
 * botones que encolan tandas y los dos filtros.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionCabecera(ctx) {
  const { modelo, pieza, repintar } = ctx;
  const partes = [];

  if (queja) {
    partes.push(
      aviso(queja.mensaje, { tono: 'error', detalle: queja.detalle }),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Quitar este aviso', () => {
          queja = null;
          repintar();
        })
      )
    );
  }

  if (quejaDeEnlaces) {
    partes.push(
      aviso(
        `${quejaDeEnlaces.mensaje} Sin esos enlaces no se pueden ver los keyframes ni reproducir ` +
          'los clips, así que tampoco se puede aprobar ni elegir nada: aquí se decide mirando.',
        { tono: 'error', detalle: quejaDeEnlaces.detalle }
      )
    );
  }

  // El selector de pieza. Hoy solo está el teaser; en cuanto se desglose el
  // episodio 1, «ep01» sale a su lado sin tocar esta pantalla.
  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      modelo.piezas.length > 1
        ? 'Pieza que se está produciendo. Todo lo de abajo es de la pieza puesta.'
        : `Pieza que se está produciendo: ${pieza.titulo}. Cuando se desglose un episodio ` +
          'aparecerá aquí al lado, con esta misma pantalla.'
    ),
    filtro(
      modelo.piezas.map((una) => ({
        id: una.id,
        texto: una.titulo,
        cuenta: una.tomas.length
      })),
      pieza.id,
      (id) => cambiarDePieza(id, ctx)
    )
  );

  const total = pieza.tomas.length;
  const cuenta = progresoDe(pieza.tomas, ctx);

  partes.push(
    barra(cuenta.keyframes, total, { etiqueta: 'Keyframes aprobados' }),
    barra(cuenta.elegidos, total, { etiqueta: 'Planos terminados (clip elegido)' })
  );

  if (pieza.duracionS > 0) {
    partes.push(
      h(
        'p',
        { clase: 'tarjeta-texto suave' },
        `${plural(total, 'plano', 'planos')} para ${segundos(pieza.duracionS)} de pieza.`
      )
    );
  }

  if (pidiendoEnlaces) partes.push(espera('Pidiendo los enlaces para ver los planos…'));

  partes.push(...accionesDeTanda(ctx));

  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto tenue' },
      'Los dos botones encolan: no lanzan nada de golpe. La cola los saca de tres en tres —o de ' +
        'las que digas en la pantalla de Cola—, porque saturar las cuotas de Vertex devuelve ' +
        'errores que parecen falta de acceso al modelo. Solo encolan lo que no tiene nada todavía; ' +
        'para pedir otra versión de algo que ya se puede mirar está el botón de su tarjeta.'
    )
  );

  // El filtro por estado. Es obligatorio y va aquí arriba porque con 400 planos
  // es lo primero que se toca al entrar.
  partes.push(
    h('p', { clase: 'tarjeta-texto suave' }, 'Filtrar por estado'),
    filtro(
      Object.keys(FILTROS).map((id) => ({
        id,
        texto: FILTROS[id],
        cuenta: contarPorEstado(ctx, id)
      })),
      filtroPuesto,
      (id) => {
        filtroPuesto = id;
        paginas = 1;
        repintar();
      }
    )
  );

  if (pieza.grupos.bloques.length > 1) {
    partes.push(
      h(
        'p',
        { clase: 'tarjeta-texto suave' },
        pieza.grupos.actos.length ? 'Filtrar por escena' : 'Filtrar por bloque'
      ),
      filtro(
        [
          { id: 'todo', texto: 'Todos', cuenta: contarPorBloque(ctx, 'todo') },
          ...pieza.grupos.bloques.map((bloque) => ({
            id: bloque.id,
            texto: bloque.titulo,
            cuenta: contarPorBloque(ctx, bloque.id)
          }))
        ],
        bloquePuesto,
        (id) => {
          bloquePuesto = id;
          paginas = 1;
          repintar();
        }
      )
    );
  }

  return seccion(null, ...partes);
}

/**
 * Los dos botones de tanda: los keyframes que faltan y los clips que faltan.
 *
 * El de los clips pregunta antes. No es una cortesía: son veinte euros si son
 * veinte planos, y ese número tiene que estar delante antes de pulsar.
 *
 * @param {object} ctx
 * @returns {HTMLElement[]}
 */
function accionesDeTanda(ctx) {
  const { pieza, repintar } = ctx;

  const keyframesQueFaltan = [];
  const keyframesQueEsperan = [];
  const clipsQueFaltan = [];
  const clipsQueEsperan = [];

  for (const una of pieza.tomas) {
    const clave = `${pieza.id}/${una.id}`;
    const guardado = leerToma(ctx.estado, clave);

    if (!guardado.keyframe && !guardado.intentosKeyframe.length) {
      if (porQueNoSePuedeKeyframe(una, ctx)) keyframesQueEsperan.push(una.id);
      else keyframesQueFaltan.push({ tipo: 'keyframe', args: { pieza: pieza.id, id: una.id } });
    }

    const sinVideo =
      !guardado.clip && !guardado.intentosClip.length && !guardado.operacion;
    if (sinVideo) {
      if (porQueNoHayBotonDeVideo(una, guardado, ctx)) clipsQueEsperan.push(una.id);
      else clipsQueFaltan.push({ tipo: 'clip', args: { pieza: pieza.id, id: una.id } });
    }
  }

  const acciones = [];

  acciones.push(
    keyframesQueFaltan.length
      ? boton(
          `Generar los ${keyframesQueFaltan.length} keyframes que faltan`,
          () => hacer(() => encolarVarios(keyframesQueFaltan), repintar),
          { tono: 'principal' }
        )
      : boton('Generar los keyframes que faltan', null, {
          desactivado: keyframesQueEsperan.length
            ? `Los ${keyframesQueEsperan.length} planos sin keyframe esperan a que se apruebe su ` +
              'escenario o alguna placa del banco. Aprueba eso primero en la pantalla de Banco.'
            : 'No falta ningún keyframe por generar en esta pieza.'
        })
  );

  acciones.push(
    clipsQueFaltan.length
      ? boton(
          `Generar los ${clipsQueFaltan.length} clips que faltan`,
          () => encolarLosClips(clipsQueFaltan, ctx),
          { tono: 'peligro' }
        )
      : boton('Generar los clips que faltan', null, {
          desactivado: clipsQueEsperan.length
            ? `Los ${clipsQueEsperan.length} planos sin vídeo todavía no tienen keyframe aprobado ` +
              '—o encadenan con una toma que tampoco lo tiene—. Aprueba esos keyframes y ' +
              'aparecerán aquí.'
            : 'No falta ningún clip por generar en esta pieza.'
        })
  );

  acciones.push(boton('Volver a pedir los enlaces', () => olvidarEnlaces(repintar)));

  return [h('div', { clase: 'tarjeta-acciones' }, acciones)];
}

// ---------------------------------------------------------------------------
// El progreso por bloque
// ---------------------------------------------------------------------------

/**
 * El progreso por acto y por escena, que es lo que dice si un episodio va por la
 * mitad. Por plano ya está arriba; esto es lo que no se puede sacar de ahí.
 *
 * Con un solo bloque no se pinta nada: repetiría la barra de arriba.
 *
 * @param {object} ctx
 * @returns {HTMLElement|null}
 */
function seccionProgreso(ctx) {
  const { pieza } = ctx;
  const { bloques, actos } = pieza.grupos;

  if (bloques.length < 2) return null;

  const partes = [
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      'La barra de cada bloque cuenta los planos TERMINADOS —los que ya tienen clip elegido—, y ' +
        'debajo va cuántos keyframes hay aprobados. Es lo que permite saber si la pieza va por la ' +
        'mitad sin contar planos a mano.'
    )
  ];

  if (actos.length) {
    for (const acto of actos) {
      partes.push(filaDeGrupo(acto.titulo, acto.tomas, ctx, null));
      const dentro = h('div', {
        estilo: { display: 'flex', 'flex-direction': 'column', gap: 'var(--espacio-3)' }
      });
      for (const bloque of acto.bloques) {
        dentro.appendChild(filaDeGrupo(bloque.titulo, bloque.tomas, ctx, bloque.id));
      }
      partes.push(
        plegado(
          `Ver las ${plural(acto.bloques.length, 'escena', 'escenas')} del ${acto.titulo}`,
          dentro
        )
      );
    }
  } else if (bloques.length > BLOQUES_SIN_PLEGAR) {
    const dentro = h('div', {
      estilo: { display: 'flex', 'flex-direction': 'column', gap: 'var(--espacio-3)' }
    });
    for (const bloque of bloques) {
      dentro.appendChild(filaDeGrupo(bloque.titulo, bloque.tomas, ctx, bloque.id));
    }
    partes.push(plegado(`Ver el progreso de los ${bloques.length} bloques`, dentro));
  } else {
    for (const bloque of bloques) {
      partes.push(filaDeGrupo(bloque.titulo, bloque.tomas, ctx, bloque.id));
    }
  }

  return seccion('Progreso por bloque', ...partes);
}

/**
 * Una fila de progreso: la barra de terminados, la cuenta de keyframes y, si el
 * grupo se puede filtrar, el botón que deja la lista con solo esos planos.
 * @param {string} titulo
 * @param {object[]} tomas
 * @param {object} ctx
 * @param {string|null} idBloque
 * @returns {HTMLElement}
 */
function filaDeGrupo(titulo, tomas, ctx, idBloque) {
  const cuenta = progresoDe(tomas, ctx);

  return h(
    'div',
    { estilo: { display: 'flex', 'flex-direction': 'column', gap: 'var(--espacio-1)' } },
    barra(cuenta.elegidos, cuenta.total, { etiqueta: `${titulo} · terminados` }),
    h(
      'p',
      { clase: 'tarjeta-texto suave', estilo: { margin: '0' } },
      `Keyframes aprobados: ${cuenta.keyframes} de ${cuenta.total}.` +
        (cuenta.sinNada ? ` Sin empezar: ${cuenta.sinNada}.` : '')
    ),
    idBloque
      ? h(
          'div',
          { clase: 'tarjeta-acciones' },
          bloquePuesto === idBloque
            ? boton('Ver todos los planos otra vez', () => {
                bloquePuesto = 'todo';
                paginas = 1;
                ctx.repintar();
                irALaLista();
              })
            : boton(`Ver solo ${titulo}`, () => {
                bloquePuesto = idBloque;
                paginas = 1;
                ctx.repintar();
                irALaLista();
              })
        )
      : null
  );
}

/** Un pliegue con su título: lo de dentro solo se lee cuando se abre. */
function plegado(titulo, cuerpo) {
  return h(
    'details',
    {
      estilo: {
        background: 'var(--fondo-alto)',
        border: '1px solid var(--borde)',
        'border-radius': 'var(--radio)',
        'box-shadow': 'var(--sombra)'
      }
    },
    h(
      'summary',
      { estilo: { padding: 'var(--espacio-3)', 'min-height': 'var(--toque)', cursor: 'pointer' } },
      titulo
    ),
    h('div', { estilo: { padding: '0 var(--espacio-3) var(--espacio-3)' } }, cuerpo)
  );
}

// ---------------------------------------------------------------------------
// La lista de planos
// ---------------------------------------------------------------------------

/**
 * La lista, paginada, con un separador cada vez que cambia de bloque para no
 * perder el sitio entre cuatrocientas tarjetas.
 * @param {object} ctx
 * @param {object[]} visibles las que pasan los filtros
 * @param {object[]} enPantalla las que se pintan ahora
 * @returns {HTMLElement}
 */
function seccionPlanos(ctx, visibles, enPantalla) {
  const { pieza, repintar } = ctx;
  const partes = [];

  if (!visibles.length) {
    partes.push(
      aviso(
        `Ningún plano de ${pieza.titulo} está ahora mismo en «${FILTROS[filtroPuesto] || filtroPuesto}»` +
          (bloquePuesto === 'todo' ? '' : ` dentro del bloque puesto`) +
          '. Cambia el filtro de arriba para ver otros.',
        { tono: 'nota' }
      )
    );
    const lista = seccion('Planos', ...partes);
    lista.id = 'tomas-lista';
    return lista;
  }

  let bloqueEscrito = null;
  for (const una of enPantalla) {
    const suyo = bloqueDeLaToma(pieza, una.id);
    if (suyo && suyo.id !== bloqueEscrito) {
      bloqueEscrito = suyo.id;
      partes.push(separadorDeBloque(suyo, ctx));
    }
    partes.push(tarjetaDeToma(una, ctx));
  }

  const quedan = visibles.length - enPantalla.length;
  if (quedan > 0) {
    partes.push(
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton(
          `Ver ${quedan > TAMANO_DE_PAGINA ? TAMANO_DE_PAGINA : quedan} planos más (quedan ${quedan})`,
          () => {
            paginas += 1;
            repintar();
          },
          { tono: 'principal' }
        )
      ),
      h(
        'p',
        { clase: 'tarjeta-texto tenue' },
        'Se pintan de doce en doce a propósito: cada tarjeta trae un keyframe de 2K y sus vídeos, ' +
          'y cuatrocientas a la vez dejan el teléfono inservible. Con el filtro puesto casi nunca ' +
          'hace falta pasar de aquí.'
      )
    );
  }

  const lista = seccion(
    `Planos de ${pieza.titulo}`,
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      `${plural(visibles.length, 'plano', 'planos')} con lo que hay puesto, de ` +
        `${plural(pieza.tomas.length, 'plano', 'planos')} en la pieza.`
    ),
    ...partes
  );
  lista.id = 'tomas-lista';
  return lista;
}

/** El bloque al que pertenece una toma. */
function bloqueDeLaToma(pieza, idToma) {
  for (const bloque of pieza.grupos.bloques) {
    if (bloque.tomas.some((una) => una.id === idToma)) return bloque;
  }
  return null;
}

/** El encabezado que separa un bloque del siguiente dentro de la lista. */
function separadorDeBloque(bloque, ctx) {
  const cuenta = progresoDe(bloque.tomas, ctx);
  return h(
    'div',
    {
      estilo: {
        display: 'flex',
        'align-items': 'baseline',
        'justify-content': 'space-between',
        gap: 'var(--espacio-2)',
        padding: 'var(--espacio-2) 0 0',
        'border-top': '1px solid var(--borde)'
      }
    },
    h('h3', { estilo: { margin: '0', 'font-size': '16px' } }, bloque.titulo),
    h(
      'span',
      { clase: 'suave numero', estilo: { 'font-size': '13px' } },
      `${cuenta.elegidos} de ${cuenta.total} terminados`
    )
  );
}

// ---------------------------------------------------------------------------
// La tarjeta de una toma
// ---------------------------------------------------------------------------

/**
 * Una toma: el keyframe (o el hueco), su duración, su nivel de Veo, si encadena
 * con otra, los intentos de clip que se reproducen y los botones que le tocan.
 *
 * Lo que NO lleva, a propósito: el prompt. Ni el de imagen ni el de vídeo. El
 * plano es un detalle interno de la máquina y lo que se juzga aquí es la imagen.
 *
 * @param {object} laToma
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function tarjetaDeToma(laToma, ctx) {
  const { pieza } = ctx;
  const clave = `${pieza.id}/${laToma.id}`;
  const guardado = leerToma(ctx.estado, clave);
  const trabajoKeyframe = ctx.trabajos.get(`keyframe:${clave}`) || null;
  const trabajoClip = ctx.trabajos.get(`clip:${clave}`) || null;
  const como = estadoDeToma(guardado, trabajoClip);
  const bloqueoKeyframe = porQueNoSePuedeKeyframe(laToma, ctx);
  const sinBotonDeVideo = porQueNoHayBotonDeVideo(laToma, guardado, ctx);

  const pie = [];

  pie.push(h('p', { clase: 'tarjeta-texto' }, datosDeLaToma(laToma)));
  pie.push(h('p', { clase: 'tarjeta-texto suave' }, comoSeUsaLaToma(laToma)));

  if (bloqueoKeyframe) pie.push(h('p', { clase: 'tarjeta-texto' }, bloqueoKeyframe));

  // La frase que ocupa el sitio del botón que no existe. Va siempre que no haya
  // botón de vídeo, incluso cuando el motivo es que ya se está generando.
  if (sinBotonDeVideo) pie.push(h('p', { clase: 'tarjeta-texto' }, sinBotonDeVideo));

  if (guardado.operacion) {
    pie.push(espera(`Veo está generando el vídeo de ${laToma.id}…`));
  }

  if (trabajoKeyframe && trabajoKeyframe.error) {
    pie.push(aviso(trabajoKeyframe.error, { tono: 'error', detalle: trabajoKeyframe.detalle }));
  }
  if (trabajoClip && trabajoClip.error) {
    pie.push(aviso(trabajoClip.error, { tono: 'error', detalle: trabajoClip.detalle }));
  }
  if (trabajoClip && trabajoClip.aviso) {
    pie.push(aviso(trabajoClip.aviso, { tono: 'nota' }));
  }

  const tira = tiraDeKeyframes(clave, guardado, laToma.id, ctx);
  if (tira) pie.push(tira);

  const clips = zonaDeClips(clave, guardado, laToma, ctx);
  if (clips) pie.push(clips);

  const nodo = tarjeta({
    titulo: tituloDeTarjeta(laToma),
    media: marcoDeKeyframe(clave, guardado, laToma.id),
    pie,
    estado:
      (trabajoKeyframe && trabajoKeyframe.estado === 'fallido') ||
      (trabajoClip && trabajoClip.estado === 'fallido')
        ? { tipo: 'fallido', texto: 'Ha fallado' }
        : PUNTOS[como] || { tipo: como },
    acciones: accionesDeLaToma(laToma, clave, guardado, ctx, {
      bloqueoKeyframe,
      sinBotonDeVideo
    })
  });

  nodo.id = idDeTarjeta(laToma.id);
  return nodo;
}

/** El id del nodo de una tarjeta, para poder llevar el pulgar hasta ella. */
function idDeTarjeta(idToma) {
  return `tomas-plano-${String(idToma).replace(/[^0-9A-Za-z_-]+/g, '-')}`;
}

/** El título: el id del plano y su nivel de Veo al lado. */
function tituloDeTarjeta(laToma) {
  return h(
    'h3',
    { clase: 'tarjeta-titulo' },
    h('span', { clase: 'mono' }, laToma.id),
    insignia(`Veo ${NIVELES_DE_VEO[soloTexto(laToma.veo)] || soloTexto(laToma.veo) || 'sin nivel'}`)
  );
}

/** Una etiqueta pequeña al lado del título. */
function insignia(texto) {
  return h(
    'span',
    {
      estilo: {
        display: 'inline-block',
        'margin-left': 'var(--espacio-2)',
        padding: '2px 8px',
        'border-radius': 'var(--radio-pastilla)',
        border: '1px solid var(--borde-fuerte)',
        background: 'var(--fondo-hundido)',
        color: 'var(--texto-suave)',
        'font-size': '12px',
        'font-weight': '600',
        'vertical-align': 'middle',
        'white-space': 'nowrap'
      }
    },
    texto
  );
}

/** La línea de datos: cuánto dura, dónde ocurre y con qué encadena. */
function datosDeLaToma(laToma) {
  const trozos = [segundos(Number(laToma.dur) || 0)];

  const donde = soloTexto(laToma.escenario);
  trozos.push(donde ? `en ${donde}` : 'sin escenario: negro puro');

  const siguiente = soloTexto(laToma.encadena_con);
  if (siguiente) trozos.push(`encadena con ${siguiente}`);

  return trozos.join(' · ');
}

/**
 * Cómo se usa este plano en el montaje. Es donde se dice, con palabras, que una
 * toma encadenada se usa ENTERA y que para ella no hay recorte que ofrecer: la
 * interpolación de Veo va hacia el keyframe de la toma siguiente y recortarla
 * dejaría el movimiento sin llegar al corte.
 *
 * @param {object} laToma
 * @returns {string}
 */
function comoSeUsaLaToma(laToma) {
  const dur = Number(laToma.dur) || 0;
  const durGen = Number(laToma.dur_gen) || 0;
  const siguiente = soloTexto(laToma.encadena_con);

  if (siguiente) {
    return (
      `Se generan ${segundos(durGen)} y se usan los ${segundos(dur)} enteros: una toma encadenada ` +
      `no se recorta, porque Veo interpola hacia el keyframe de ${siguiente} y el movimiento ` +
      'llega justo al corte. Por eso aquí no se ofrece recorte para este plano.'
    );
  }

  const recorte = Array.isArray(laToma.recorte) ? laToma.recorte : null;
  if (recorte && recorte.length === 2 && dur < durGen) {
    return (
      `Se generan ${segundos(durGen)} —Veo solo hace 4, 6 u 8— y en el montaje se usan del ` +
      `segundo ${recorte[0]} al ${recorte[1]}: ${segundos(dur)}.`
    );
  }

  return `Se generan ${segundos(durGen)} y se usan enteros.`;
}

// ---------------------------------------------------------------------------
// El keyframe de la tarjeta
// ---------------------------------------------------------------------------

/** Qué keyframe se está mirando: el elegido a mano, el aprobado o el último. */
function rutaQueSeMira(guardado, clave) {
  const elegida = clave ? mirando.get(clave) : null;
  if (elegida && (elegida === guardado.keyframe || guardado.intentosKeyframe.includes(elegida))) {
    return elegida;
  }
  return (
    guardado.keyframe || guardado.intentosKeyframe[guardado.intentosKeyframe.length - 1] || null
  );
}

/**
 * Lo que se mira para aprobar: el keyframe aprobado, el intento que se esté
 * mirando, o un hueco que dice con palabras qué falta. Nunca un `<img>` roto.
 * @param {string} clave
 * @param {object} guardado
 * @param {string} idToma
 * @returns {HTMLElement}
 */
function marcoDeKeyframe(clave, guardado, idToma) {
  const ruta = rutaQueSeMira(guardado, clave);
  if (!ruta) return hueco('Todavía no hay keyframe de este plano.');

  const url = enlaceDe(ruta);
  if (!url) {
    return hueco(
      sinEnlace.has(ruta)
        ? 'Este keyframe existe en el bucket pero no se ha conseguido enlace para verlo. Prueba ' +
          'con «Volver a pedir los enlaces», arriba del todo.'
        : 'Pidiendo el enlace para verlo…'
    );
  }

  const esElAprobado = ruta === guardado.keyframe;
  const img = h('img', {
    src: url,
    alt: `Keyframe del plano ${idToma}. ${esElAprobado ? 'Aprobado' : 'Intento sin aprobar'}.`,
    loading: 'lazy',
    decoding: 'async'
  });

  img.addEventListener('error', () => {
    const fallo = hueco(
      'Este keyframe no se ha podido cargar. Los enlaces para mirar duran seis horas: prueba con ' +
        '«Volver a pedir los enlaces», arriba del todo.'
    );
    if (img.parentNode) img.replaceWith(fallo);
  });

  return img;
}

/** El cuadro negro con una frase dentro, para cuando no hay nada que enseñar. */
function hueco(texto) {
  return h(
    'p',
    {
      clase: 'tenue',
      estilo: {
        position: 'absolute',
        inset: '0',
        margin: '0',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'text-align': 'center',
        padding: 'var(--espacio-3)',
        'font-size': '13px'
      }
    },
    texto
  );
}

/** La miniatura de un intento de keyframe. Sin enlace, un hueco con palabras. */
function miniatura(ruta, alt) {
  const url = enlaceDe(ruta);
  if (!url) return hueco(sinEnlace.has(ruta) ? 'Sin enlace' : 'Pidiendo enlace…');

  const img = h('img', {
    src: url,
    alt,
    loading: 'lazy',
    decoding: 'async',
    estilo: { width: '100%', height: '100%', 'object-fit': 'cover', display: 'block' }
  });
  img.addEventListener('error', () => {
    if (img.parentNode) img.replaceWith(hueco('No carga'));
  });
  return img;
}

/**
 * La tira de intentos de keyframe. Se toca uno y se pone arriba, en grande: es
 * ahí donde se mira y donde se aprueba, no en la miniatura.
 * @param {string} clave
 * @param {object} guardado
 * @param {string} idToma
 * @param {object} ctx
 * @returns {HTMLElement|null}
 */
function tiraDeKeyframes(clave, guardado, idToma, ctx) {
  const todas = [...guardado.intentosKeyframe];
  if (guardado.keyframe && !todas.includes(guardado.keyframe)) todas.unshift(guardado.keyframe);
  if (todas.length < 2) return null;

  const puesta = rutaQueSeMira(guardado, clave);

  return h(
    'div',
    {
      role: 'group',
      'aria-label': `Intentos de keyframe del plano ${idToma}`,
      estilo: {
        display: 'flex',
        gap: 'var(--espacio-2)',
        'overflow-x': 'auto',
        padding: 'var(--espacio-1) 0',
        '-webkit-overflow-scrolling': 'touch'
      }
    },
    todas.map((ruta, indice) => {
      const esta = ruta === puesta;
      const esElAprobado = ruta === guardado.keyframe;
      return h(
        'button',
        {
          type: 'button',
          'aria-pressed': esta ? 'true' : 'false',
          'aria-label':
            `Intento ${indice + 1} de keyframe del plano ${idToma}` +
            `${esElAprobado ? ', el aprobado' : ''}. Verlo en grande.`,
          estilo: {
            flex: '0 0 auto',
            width: '96px',
            padding: '2px',
            background: esta ? 'var(--fondo-hundido)' : 'transparent',
            border: `2px solid ${esta ? 'var(--acento)' : 'var(--borde)'}`,
            'border-radius': 'var(--radio-chico)',
            color: 'var(--texto)',
            font: 'inherit',
            cursor: 'pointer'
          },
          alClic: () => {
            mirando.set(clave, ruta);
            ctx.repintar();
          }
        },
        h(
          'span',
          {
            estilo: {
              display: 'block',
              position: 'relative',
              'aspect-ratio': '16 / 9',
              background: 'var(--negro)',
              'border-radius': '4px',
              overflow: 'hidden'
            }
          },
          miniatura(ruta, `Intento ${indice + 1} de keyframe del plano ${idToma}`)
        ),
        h(
          'span',
          {
            clase: esElAprobado ? 'suave' : 'tenue',
            estilo: { display: 'block', 'font-size': '11px', 'padding-top': '2px' }
          },
          esElAprobado ? `${indice + 1} · aprobado` : String(indice + 1)
        )
      );
    })
  );
}

// ---------------------------------------------------------------------------
// Los intentos de clip
// ---------------------------------------------------------------------------

/**
 * La zona de vídeos: un reproductor por intento, con el keyframe de poster, y
 * debajo el botón de elegirlo.
 *
 * El botón está apagado hasta que ese vídeo se ha reproducido, y el motivo se
 * lee al tocarlo. No es una molestia gratuita: lo que se elige aquí es lo que
 * entra en el montaje, y elegir sin mirar es como no elegir.
 *
 * @param {string} clave
 * @param {object} guardado
 * @param {object} laToma
 * @param {object} ctx
 * @returns {HTMLElement|null}
 */
function zonaDeClips(clave, guardado, laToma, ctx) {
  const todos = [...guardado.intentosClip];
  if (guardado.clip && !todos.includes(guardado.clip)) todos.unshift(guardado.clip);
  if (!todos.length) return null;

  const poster = guardado.keyframe ? enlaceDe(guardado.keyframe) : null;

  const caja = h(
    'div',
    {
      role: 'group',
      'aria-label': `Vídeos del plano ${laToma.id}`,
      estilo: { display: 'flex', 'flex-direction': 'column', gap: 'var(--espacio-3)' }
    },
    h(
      'p',
      { clase: 'tarjeta-texto suave', estilo: { margin: '0' } },
      guardado.clip
        ? `${plural(todos.length, 'vídeo generado', 'vídeos generados')}. El elegido es el que ` +
          'entra en el montaje; se puede cambiar reproduciendo otro y eligiéndolo.'
        : `${plural(todos.length, 'vídeo generado', 'vídeos generados')} y ninguno elegido ` +
          'todavía. Reprodúcelos y elige uno: sin elegir, este plano no entra en el montaje.'
    )
  );

  todos.forEach((ruta, indice) => {
    caja.appendChild(unClip(ruta, indice, todos.length, clave, guardado, laToma, poster, ctx));
  });

  return caja;
}

/**
 * Un intento de clip: su reproductor y su botón de elegir.
 * @returns {HTMLElement}
 */
function unClip(ruta, indice, cuantos, clave, guardado, laToma, poster, ctx) {
  const esElElegido = ruta === guardado.clip;
  const nombre = `Vídeo ${indice + 1} de ${cuantos} del plano ${laToma.id}`;

  const nota = h('p', { clase: 'tarjeta-texto tenue', estilo: { margin: '0' } });
  const acciones = h('div', { clase: 'tarjeta-acciones' });

  /** Pinta el botón de elegir según si ese vídeo ya se ha reproducido. */
  const pintarElegir = () => {
    vaciar(acciones);
    if (esElElegido) {
      acciones.appendChild(
        boton('Elegido', null, {
          desactivado:
            'Este es justo el vídeo que ya está elegido: es el que va a entrar en el montaje. Para ' +
            'cambiarlo, reproduce otro intento y elígelo.'
        })
      );
      return;
    }
    if (!vistos.has(ruta)) {
      acciones.appendChild(
        boton('Elegir este', null, {
          desactivado:
            'Primero reprodúcelo. Lo que se elige aquí es lo que entra en el montaje, y nada entra ' +
            'sin haberse visto antes: dale al play y el botón se enciende solo.'
        })
      );
      return;
    }
    acciones.appendChild(
      boton('Elegir este', () => elegirClip(clave, ruta, ctx), { tono: 'principal' })
    );
  };

  const url = enlaceDe(ruta);

  const marco = h(
    'div',
    {
      estilo: {
        position: 'relative',
        'aspect-ratio': '16 / 9',
        background: 'var(--negro)',
        'border-radius': 'var(--radio-chico)',
        overflow: 'hidden',
        border: `2px solid ${esElElegido ? 'var(--listo)' : 'var(--borde)'}`
      }
    },
    url
      ? reproductor(url, nombre, poster, ruta, nota, pintarElegir)
      : hueco(
          sinEnlace.has(ruta)
            ? 'Este vídeo existe en el bucket pero no se ha conseguido enlace para reproducirlo. ' +
              'Prueba con «Volver a pedir los enlaces», arriba del todo.'
            : 'Pidiendo el enlace para reproducirlo…'
        )
  );

  pintarElegir();

  return h(
    'div',
    { estilo: { display: 'flex', 'flex-direction': 'column', gap: 'var(--espacio-1)' } },
    marco,
    h(
      'p',
      { clase: esElElegido ? 'suave' : 'tenue', estilo: { margin: '0', 'font-size': '13px' } },
      esElElegido ? `Intento ${indice + 1} · elegido` : `Intento ${indice + 1}`
    ),
    nota,
    acciones
  );
}

/**
 * El `<video controls>` de un intento.
 *
 * `preload="none"` y el keyframe de poster: así una página de doce tarjetas no
 * se baja doce vídeos de treinta megas que nadie ha pedido. Solo se mueve un
 * byte cuando alguien le da al play, que es justo cuando hay que verlo.
 *
 * Mientras suena, la pantalla no se repinta: la cola escribe el estado cada poco
 * y un repintado en mitad de un clip lo cortaría por la mitad.
 *
 * @returns {HTMLElement}
 */
function reproductor(url, queEs, poster, ruta, nota, pintarElegir) {
  const video = h('video', {
    controls: true,
    preload: 'none',
    playsinline: true,
    src: url,
    poster: poster || null,
    'aria-label': queEs,
    estilo: { width: '100%', height: '100%', display: 'block', background: 'var(--negro)' },
    alReproducir: () => {
      sonando.add(video);
      if (!vistos.has(ruta)) {
        vistos.add(ruta);
        // Se enciende el botón sin repintar la tarjeta: repintarla borraría este
        // mismo vídeo justo cuando acaba de empezar a sonar.
        pintarElegir();
      }
    },
    alPausar: () => {
      sonando.delete(video);
      if (typeof alSoltarUnVideo === 'function') alSoltarUnVideo();
    },
    alTerminar: () => {
      sonando.delete(video);
      if (typeof alSoltarUnVideo === 'function') alSoltarUnVideo();
    },
    alError: () => {
      sonando.delete(video);
      nota.textContent =
        'Este vídeo no se ha podido reproducir. Los enlaces duran seis horas: prueba con «Volver a ' +
        'pedir los enlaces», arriba del todo. El clip sigue guardado en el bucket, no hay que ' +
        'volver a pagarlo.';
    }
  });

  return video;
}

// ---------------------------------------------------------------------------
// Los botones de la tarjeta
// ---------------------------------------------------------------------------

/**
 * Los botones de una toma.
 *
 * El de generar vídeo NO SE DEVUELVE mientras `sinBotonDeVideo` diga algo: la
 * frase ya está en el pie y un botón que siempre falla enseña a desconfiar de la
 * pantalla. Y con el keyframe bloqueado por una referencia sin aprobar tampoco
 * hay botón de generar keyframe, por lo mismo.
 *
 * @param {object} laToma
 * @param {string} clave
 * @param {object} guardado
 * @param {object} ctx
 * @param {{bloqueoKeyframe:string|null, sinBotonDeVideo:string|null}} porQues
 * @returns {HTMLElement[]}
 */
function accionesDeLaToma(laToma, clave, guardado, ctx, { bloqueoKeyframe, sinBotonDeVideo }) {
  const acciones = [];
  const puesta = rutaQueSeMira(guardado, clave);

  if (puesta) {
    if (puesta === guardado.keyframe) {
      acciones.push(
        boton('Aprobar keyframe', null, {
          desactivado:
            'Este es justo el keyframe que ya está aprobado. Si quieres otro, elige un intento de ' +
            'la tira o pide otro intento.'
        })
      );
    } else {
      acciones.push(
        boton(
          guardado.keyframe ? 'Aprobar este keyframe' : 'Aprobar keyframe',
          () => aprobarKeyframe(clave, puesta, laToma.id, guardado, ctx),
          { tono: 'principal' }
        )
      );
    }
  }

  if (!bloqueoKeyframe) {
    acciones.push(
      boton(
        puesta ? 'Otro keyframe' : 'Generar keyframe',
        () => hacer(() => encolar('keyframe', { pieza: ctx.pieza.id, id: laToma.id }), ctx.repintar),
        { tono: puesta ? 'suave' : 'principal' }
      )
    );
  }

  // LA REGLA DURA. Sin keyframe aprobado —o sin el de la toma siguiente, cuando
  // encadena— aquí no se añade nada. No hay botón que pulsar.
  if (!sinBotonDeVideo) {
    const yaHayVideo = guardado.intentosClip.length > 0;
    acciones.push(
      boton(
        yaHayVideo ? 'Otro intento de vídeo' : 'Generar vídeo',
        () => encolarUnClip(laToma, ctx),
        { tono: yaHayVideo ? 'peligro' : 'principal' }
      )
    );
  }

  return acciones;
}

// ---------------------------------------------------------------------------
// Las acciones
// ---------------------------------------------------------------------------

/**
 * Aprueba un keyframe. Si ya había vídeos generados a partir de otro, se avisa
 * antes: esos clips salieron de una imagen que ya no es la aprobada, y eso hay
 * que saberlo antes de tocar nada.
 *
 * No se toca `clip_elegido`: el clip que ya se eligió mirándolo sigue siendo el
 * que se eligió. Lo que cambia es de qué imagen partirán los siguientes.
 */
async function aprobarKeyframe(clave, ruta, idToma, guardado, ctx) {
  const cuantos = guardado.intentosClip.length;

  if (guardado.keyframe && cuantos) {
    const pregunta =
      `Vas a cambiar el keyframe aprobado de ${idToma}, y ya hay ` +
      `${plural(cuantos, 'vídeo generado', 'vídeos generados')} a partir del anterior. Esos clips ` +
      'no se borran ni se descartan solos: siguen ahí y se pueden seguir eligiendo, pero salieron ' +
      'de otra imagen. Los vídeos que pidas a partir de ahora partirán de este keyframe. ¿Lo hago?';
    if (!(await confirmar(pregunta))) return;
  }

  try {
    await cambiar((borrador) => {
      const entrada = entradaMutable(borrador, clave);
      entrada.keyframe_aprobado = ruta;
      // El intento aprobado tiene que seguir en la lista: si vino de una tanda
      // vieja y ya no estaba, se vuelve a apuntar para no perderlo de vista.
      if (!Array.isArray(entrada.intentos_keyframe)) entrada.intentos_keyframe = [];
      if (!entrada.intentos_keyframe.includes(ruta)) entrada.intentos_keyframe.push(ruta);
    });
    mirando.set(clave, ruta);
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/**
 * Elige el clip que entra en el montaje. Aquí no se pregunta nada: elegir es
 * gratis, se ha reproducido antes —el botón no existía si no— y cambiar de
 * elección es un toque.
 */
async function elegirClip(clave, ruta, ctx) {
  try {
    await cambiar((borrador) => {
      const entrada = entradaMutable(borrador, clave);
      entrada.clip_elegido = ruta;
      if (!Array.isArray(entrada.intentos_clip)) entrada.intentos_clip = [];
      if (!entrada.intentos_clip.includes(ruta)) entrada.intentos_clip.push(ruta);
    });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/**
 * Encola el clip de una toma. Se pregunta antes solo cuando ya hay vídeos: el
 * primero es el trabajo normal, el segundo es gastar otro euro en lo mismo.
 */
async function encolarUnClip(laToma, ctx) {
  const clave = `${ctx.pieza.id}/${laToma.id}`;
  const guardado = leerToma(ctx.estado, clave);

  if (guardado.intentosClip.length) {
    const pregunta =
      `Ya hay ${plural(guardado.intentosClip.length, 'vídeo', 'vídeos')} de ${laToma.id}. Pedir ` +
      'otro cuesta cerca de un euro y no borra los anteriores: se añade a la lista y se elige ' +
      'mirándolos. ¿Lo pido?';
    if (!(await confirmar(pregunta))) return;
  }

  hacer(() => encolar('clip', { pieza: ctx.pieza.id, id: laToma.id }), ctx.repintar);
}

/**
 * Encola la tanda de clips que faltan, con el número por delante. Veinte clips
 * son veinte euros, y ese número tiene que verse antes de pulsar.
 */
async function encolarLosClips(trabajos, ctx) {
  const pregunta =
    `Vas a encolar ${plural(trabajos.length, 'clip', 'clips')}. Cada uno cuesta cerca de un euro, ` +
    `así que esto son alrededor de ${trabajos.length} euros. Todos tienen su keyframe aprobado, ` +
    'así que no se gasta a ciegas. La cola los saca de tres en tres y se puede detener en la ' +
    'pantalla de Cola. ¿Los encolo?';
  if (!(await confirmar(pregunta))) return;

  hacer(() => encolarVarios(trabajos), ctx.repintar);
}

/**
 * Cambia la pieza que se está produciendo. Se guarda en el bucket, así que al
 * volver a abrir se sigue en la misma.
 */
async function cambiarDePieza(id, ctx) {
  if (id === ctx.pieza.id) return;
  try {
    await cambiar((borrador) => {
      borrador.pieza_activa = id;
    });
    filtroPuesto = 'todo';
    bloquePuesto = 'todo';
    paginas = 1;
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/**
 * Hace algo que puede quejarse y deja la queja donde se lee. `encolar()` y
 * `encolarVarios()` no esperan a que el bucket conteste —quien pulsa un botón no
 * puede quedarse mirando una pantalla quieta—, así que lo que se recoge aquí es
 * lo que falle al preparar el encolado.
 * @param {() => void} fn
 * @param {() => void} repintar
 */
function hacer(fn, repintar) {
  try {
    fn();
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  repintar();
}

/** Lleva la pantalla hasta la lista de planos, después de repintar. */
function irALaLista() {
  const destino = document.getElementById('tomas-lista');
  if (destino && typeof destino.scrollIntoView === 'function') {
    destino.scrollIntoView({ block: 'start' });
  }
}

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

/**
 * Las tomas que se enseñan: las que pasan el filtro de estado y el de bloque, en
 * el orden en que están escritas, que es el orden de la pieza.
 * @param {object} ctx
 * @returns {object[]}
 */
function tomasVisibles(ctx) {
  return ctx.pieza.tomas.filter(
    (una) => pasaElBloque(una, ctx, bloquePuesto) && pasaElEstado(una, ctx, filtroPuesto)
  );
}

/** Si una toma cae dentro del filtro de estado que se le pase. */
function pasaElEstado(laToma, ctx, cual) {
  if (cual === 'todo') return true;
  const clave = `${ctx.pieza.id}/${laToma.id}`;
  const guardado = leerToma(ctx.estado, clave);
  return estadoDeToma(guardado, ctx.trabajos.get(`clip:${clave}`) || null) === cual;
}

/** Si una toma cae dentro del bloque que se le pase. */
function pasaElBloque(laToma, ctx, cual) {
  if (cual === 'todo') return true;
  const bloque = bloqueDeLaToma(ctx.pieza, laToma.id);
  return Boolean(bloque && bloque.id === cual);
}

/**
 * Cuántas tomas caen en una pastilla de estado, contando dentro del bloque
 * puesto: la cuenta tiene que decir cuántas se verían al tocarla, no cuántas hay
 * en total.
 */
function contarPorEstado(ctx, cual) {
  let cuenta = 0;
  for (const una of ctx.pieza.tomas) {
    if (pasaElBloque(una, ctx, bloquePuesto) && pasaElEstado(una, ctx, cual)) cuenta += 1;
  }
  return cuenta;
}

/** Lo mismo para las pastillas de bloque, contando dentro del estado puesto. */
function contarPorBloque(ctx, cual) {
  let cuenta = 0;
  for (const una of ctx.pieza.tomas) {
    if (pasaElBloque(una, ctx, cual) && pasaElEstado(una, ctx, filtroPuesto)) cuenta += 1;
  }
  return cuenta;
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/** Si algo es un objeto de verdad y no null ni un array. */
function esObjeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

/** Un texto limpio, o cadena vacía. Vale para null, números y basura. */
function soloTexto(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (valor == null) return '';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  return '';
}

/** Si un campo trae algo escrito: `0` y `"0"` cuentan, null y `""` no. */
function tieneValor(valor) {
  return valor !== undefined && valor !== null && String(valor).trim() !== '';
}

/** Una ruta si la hay, o null. */
function rutaSiVale(valor) {
  const limpia = typeof valor === 'string' ? valor.trim() : '';
  return limpia || null;
}

/** Una lista de rutas, sin huecos ni basura. */
function soloRutas(valor) {
  if (!Array.isArray(valor)) return [];
  return valor.filter((ruta) => typeof ruta === 'string' && ruta.trim());
}

/**
 * Una lista legible: «a, b y c», y con un tope, «a, b, c y 9 más».
 * @param {string[]} cosas
 * @param {number} tope
 * @returns {string}
 */
function enumerar(cosas, tope) {
  const lista = cosas.map((c) => String(c)).filter(Boolean);
  if (!lista.length) return 'nada';
  if (lista.length === 1) return lista[0];
  if (lista.length <= tope) {
    return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
  }
  return `${lista.slice(0, tope).join(', ')} y ${lista.length - tope} más`;
}

/**
 * Cualquier cosa que se haya lanzado, convertida en el error que se enseña. Un
 * fallo del propio navegador saldría en inglés y sin decir qué hacer.
 * @param {*} fallo
 * @returns {ErrorDeCara}
 */
function comoErrorDeCara(fallo) {
  if (fallo instanceof ErrorDeCara) return fallo;
  return new ErrorDeCara(
    'El estudio se ha roto por dentro pintando la lista de planos. No es un problema de tu cuenta ' +
      'ni de la nube: es un fallo del propio código. Debajo está lo que dijo el navegador, tal cual.',
    { detalle: loQueDijo(fallo), reintentable: false, http: 500 }
  );
}

/** Lo que dijo un fallo del navegador, para el detalle plegado. */
function loQueDijo(fallo) {
  if (fallo == null) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}
