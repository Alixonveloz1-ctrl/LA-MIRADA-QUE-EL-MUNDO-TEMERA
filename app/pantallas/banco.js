// El Banco: los personajes y los escenarios de toda la serie.
//
// Aquí se genera, se mira, se aprueba y se vuelve a pedir. Es la pantalla donde
// se decide qué cara tiene cada personaje para siempre, así que está construida
// alrededor de tres cosas que el plan (§6) y el contrato (§2, §5, §13.1) dan por
// ley y esta pantalla tiene que hacer VISIBLES, no solo cumplir:
//
//   1. EL ANCLA VA PRIMERO Y SE VE QUE ES EL ANCLA. Un ancla se genera solo con
//      texto, sin referencias. Todas las demás placas de ese personaje se
//      generan con esa imagen delante. Por eso, mientras el ancla no esté
//      aprobada, las demás placas NO TIENEN BOTÓN DE GENERAR: no está apagado,
//      es que no existe, y en su sitio hay una frase que dice qué falta. Un
//      botón que se puede pulsar y siempre falla enseña a desconfiar de la
//      pantalla; una frase enseña qué hacer.
//
//   2. LA CADENA DE EDAD SE ENSEÑA, NO SE ESCONDE. Saharis aparece de bebé, a
//      los cinco, a los diez, a los doce y de adulto. Cada edad es una entrada
//      distinta del banco, pero TODAS encadenan al mismo ancla de linaje —la del
//      adulto—. Si eso no se ve, son cinco personas distintas y los flashbacks
//      no significan nada. Se pinta como una fila: el ancla de linaje a la
//      izquierda y una flecha a cada edad. La flecha sale del ancla y va a la
//      edad, nunca de una edad a la siguiente, porque no es así como está hecha.
//
//   3. CAMBIAR UN ANCLA APROBADA CUESTA. Deja por reprobar todas las placas que
//      se generaron pareciéndose a ella, en profundidad: las de su personaje y
//      las de las edades que le encadenan. Así que se pregunta antes, con la
//      cuenta y con los nombres delante, y solo entonces se hace.
//
// POR QUÉ LOS ESCENARIOS ENSEÑAN EN CUÁNTAS ESCENAS SALEN. Un escenario no tiene
// cadena: es una placa única, y esa placa viaja como referencia en TODOS los
// planos que ocurren ahí. Que «tuneles» salga en 46 escenas y «puerto» en una
// dice, sin más explicación, cuál de las dos hay que mirar con lupa antes de
// aprobar. El dato está en `escenarios.placas[].escenas` y se pinta tal cual.
//
// POR QUÉ LOS DOS BOTONES GRANDES ENCOLAN Y NO LANZAN. Son 73 placas y 28
// escenarios. Lanzarlos de golpe satura las cuotas de Vertex, y cuando eso pasa
// los errores que llegan parecen falta de acceso al modelo aunque la cuenta lo
// tenga (plan §8). Todo pasa por `encolarVarios()`, que escribe una sola vez y
// deja que la cola los saque de uno en uno.
//
// POR QUÉ LOS GRUPOS DE PERSONAJE SE ABREN UNO A UNO. Son veintisiete personajes
// y ciento una placas con su imagen. Pintarlas todas a la vez en un teléfono es
// una pantalla que se arrastra y en la que no se encuentra nada. Cada personaje
// es un pliegue que dice su nombre y por cuántas placas va; dentro están sus
// tarjetas, y solo se construyen cuando se abre.

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
import { plural } from '../formato.js';

// ---------------------------------------------------------------------------
// Números y palabras fijas de esta pantalla
// ---------------------------------------------------------------------------

/** Cuántas rutas caben en una llamada a `firmar` (docs/contrato.md §2). */
const MAXIMO_POR_FIRMA = 200;

/**
 * Cuánto se da por buena una URL firmada. La función las hace de seis horas;
 * aquí se tiran a las cinco para que nunca se pinte una imagen con un enlace que
 * caduca mientras se mira.
 */
const VIDA_DE_URL_MS = 5 * 60 * 60 * 1000;

/** La flecha de la cadena de edad. Es decorativa: al lado siempre va el texto. */
const FLECHA = '→';

/** Los estados por los que se puede filtrar la pantalla. */
const FILTROS = {
  todo: 'Todo',
  anclas: 'Anclas',
  'sin-generar': 'Sin generar',
  'por-aprobar': 'Por aprobar',
  aprobadas: 'Aprobadas'
};

// ---------------------------------------------------------------------------
// Lo que esta pantalla recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** `datos/serie.json`, pedido una sola vez. */
let promesaDeLaSerie = null;

/** Ruta lógica → `{ url, hasta }`. Las URL firmadas se reaprovechan. */
const enlaces = new Map();

/**
 * Rutas por las que ya se preguntó y no hay enlace: o el bucket no lo dio, o la
 * petición entera falló. No se vuelve a preguntar por ellas solas, y eso es a
 * propósito: si al fallar se reintentara en el repintado siguiente, y el
 * repintado siguiente lo dispara el propio fallo, la pantalla se quedaría dando
 * vueltas contra el mismo error para siempre. Se limpia entero con el botón de
 * «Volver a pedir los enlaces», que es cuando alguien decide reintentar.
 */
const sinEnlace = new Set();

/** Si hay una petición de firmas en marcha ahora mismo. */
let pidiendoEnlaces = false;

/** Por qué no se han podido conseguir los enlaces, si es que no se han podido. */
let quejaDeEnlaces = null;

/** El último fallo de una acción de esta pantalla, para pintarlo arriba. */
let queja = null;

/** Qué intento se está mirando de cada placa: `id de placa → ruta`. */
const mirando = new Map();

/** Qué grupos de personaje están abiertos. */
const abiertos = new Set();

/** El filtro puesto. */
let filtroPuesto = 'todo';

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'banco',
  titulo: 'Banco',
  icono: '\u{1F5C2}',

  /**
   * Pinta el banco dentro de `raiz` y se queda escuchando el estado.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>} cómo desapuntarse al cambiar de pestaña
   */
  async montar(raiz) {
    const marco = h('div', { clase: 'banco' });
    raiz.appendChild(marco);

    /** Cómo desapuntarse de lo que esté montado ahora mismo. */
    let soltar = null;

    const arrancar = async () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
      vaciar(marco);

      const cartel = espera('Trayendo el banco de la serie…');
      marco.appendChild(cartel);

      let modelo;
      try {
        modelo = construirModelo(await laSerie());
      } catch (fallo) {
        const error = comoErrorDeCara(fallo);
        vaciar(marco);
        marco.appendChild(
          pantalla(
            'Banco',
            seccion(
              null,
              aviso(error.mensaje, { tono: 'error', detalle: error.detalle }),
              h(
                'div',
                { clase: 'tarjeta-acciones' },
                boton('Volver a intentarlo', () => {
                  promesaDeLaSerie = null;
                  arrancar();
                }, { tono: 'principal' })
              )
            )
          )
        );
        return;
      }

      vaciar(marco);

      const repintar = () => {
        vaciar(marco);
        marco.appendChild(construir(modelo, repintar));
      };

      const desapuntar = alCambiar(repintar);
      soltar = () => desapuntar();
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
// módulo de datos para el navegador; `app/cola.js` ya se bajó `serie.json` por su
// cuenta con este mismo patrón por la misma razón. Esta pantalla necesita saber
// qué placas y qué escenarios existen, quién encadena con quién y en cuántas
// escenas sale cada sitio. Nada de eso es componer un prompt ni conocer un id de
// modelo, que es lo único que §0 le prohíbe al navegador. Que se revise si debe
// acabar en un `app/datos.js` compartido.

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
      'No se ha podido leer datos/serie.json, que es donde está escrito el banco entero de la ' +
        'serie: qué personajes hay, qué placas tiene cada uno y qué escenarios existen. Sin él ' +
        'esta pantalla no tiene nada que enseñar. Comprueba la conexión del teléfono; si tienes ' +
        'cobertura, es que el despliegue está a medias.',
      { detalle: fallo && fallo.message ? String(fallo.message) : null, reintentable: true, http: 0 }
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
      { detalle: fallo && fallo.message ? String(fallo.message) : null, reintentable: false, http: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// El modelo: el banco tal como se pinta
// ---------------------------------------------------------------------------

/**
 * Ordena el banco en lo que esta pantalla necesita: los grupos de personaje con
 * su ancla la primera, las cadenas de linaje, los escenarios y los índices para
 * poder ir de una placa a sus dependientes sin recorrerlo todo cada vez.
 *
 * @param {object} datos `datos/serie.json` entero
 * @returns {object}
 */
function construirModelo(datos) {
  const placas = (datos && datos.banco && Array.isArray(datos.banco.placas)
    ? datos.banco.placas
    : []
  ).filter((p) => p && typeof p.id === 'string');

  const escenarios = (datos && datos.escenarios && Array.isArray(datos.escenarios.placas)
    ? datos.escenarios.placas
    : []
  ).filter((e) => e && typeof e.id === 'string');

  if (!placas.length && !escenarios.length) {
    throw new ErrorDeCara(
      'datos/serie.json se ha leído bien pero no trae ninguna placa de personaje ni ningún ' +
        'escenario, así que el banco está vacío. Es un fallo del propio estudio, no de tu cuenta: ' +
        'el archivo del repositorio no es el que debería.',
      { reintentable: false, http: 500 }
    );
  }

  const fichas = (datos && datos.personajes) || {};
  const porId = new Map(placas.map((p) => [p.id, p]));

  // Los grupos, en el orden en que los personajes aparecen en el banco: es el
  // orden en que están escritos y ese orden es el de la serie.
  const grupos = [];
  const porPersonaje = new Map();
  for (const laPlaca of placas) {
    const idPersonaje = String(laPlaca.personaje ?? '');
    let grupo = porPersonaje.get(idPersonaje);
    if (!grupo) {
      grupo = {
        personaje: idPersonaje,
        nombre: nombreDePersonaje(idPersonaje, fichas),
        ancla: null,
        placas: []
      };
      porPersonaje.set(idPersonaje, grupo);
      grupos.push(grupo);
    }
    grupo.placas.push(laPlaca);
  }

  for (const grupo of grupos) {
    grupo.ancla = grupo.placas.find((p) => p.ancla === true) || null;
    // El ancla primero: es el orden en que se generan y el orden en que se miran.
    grupo.placas = [
      ...grupo.placas.filter((p) => p.ancla === true),
      ...grupo.placas.filter((p) => p.ancla !== true)
    ];
  }

  // Quién encadena a quién. `encadena_a` es la cadena de linaje: la misma
  // persona a otra edad, colgando siempre del ancla del adulto.
  const encadenadasA = new Map();
  for (const laPlaca of placas) {
    const padre = typeof laPlaca.encadena_a === 'string' ? laPlaca.encadena_a.trim() : '';
    if (!padre || padre === laPlaca.id) continue;
    if (!encadenadasA.has(padre)) encadenadasA.set(padre, []);
    encadenadasA.get(padre).push(laPlaca);
  }

  // Las cadenas que se pintan: un ancla y todas las edades que le cuelgan.
  const cadenas = placas
    .filter((p) => encadenadasA.has(p.id))
    .map((p) => ({
      ancla: p,
      grupo: porPersonaje.get(String(p.personaje ?? '')) || null,
      eslabones: encadenadasA.get(p.id).map((edad) => ({
        placa: edad,
        grupo: porPersonaje.get(String(edad.personaje ?? '')) || null
      }))
    }));

  const anclas = placas.filter((p) => p.ancla === true);

  return {
    placas,
    porId,
    grupos,
    porPersonaje,
    anclas,
    encadenadasA,
    cadenas,
    escenarios: [...escenarios].sort(
      (a, b) => (Number(b.escenas) || 0) - (Number(a.escenas) || 0)
    ),
    fichas
  };
}

/**
 * Cómo se llama un personaje en pantalla.
 *
 * Manda `personajes[id].nombre` cuando está escrito. Cuando no está —y casi
 * nunca lo está—, se compone desde el propio id, que es lo único que hay: los
 * guiones se vuelven espacios, y las dos formas que el banco usa para las edades
 * se leen como se dicen, porque «Saharis 5» al lado de «Saharis 10» en una fila
 * de cadena no se entiende y «Saharis a los 5» sí. El id se sigue enseñando
 * siempre al lado, así que ningún nombre compuesto puede confundirse con un dato.
 *
 * @param {string} id
 * @param {object} fichas `serie.personajes`
 * @returns {string}
 */
function nombreDePersonaje(id, fichas) {
  const ficha = fichas && typeof fichas === 'object' ? fichas[id] : null;
  const escrito = ficha && typeof ficha.nombre === 'string' ? ficha.nombre.trim() : '';
  if (escrito) return escrito;

  const crudo = String(id ?? '').trim();
  if (!crudo) return 'sin personaje';

  const edad = /^(.+)-(\d+)$/.exec(crudo);
  if (edad) return `${conMayuscula(edad[1].replace(/-/g, ' '))} a los ${edad[2]}`;

  const bebe = /^(.+)-bebe$/.exec(crudo);
  if (bebe) return `${conMayuscula(bebe[1].replace(/-/g, ' '))} de bebé`;

  return conMayuscula(crudo.replace(/-/g, ' '));
}

/** Primera letra en mayúscula y nada más: no es un título, es un nombre. */
function conMayuscula(texto) {
  const t = String(texto || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

// ---------------------------------------------------------------------------
// Las dos cadenas del banco
// ---------------------------------------------------------------------------

/**
 * Las placas que dependen DIRECTAMENTE de una.
 *
 * Es la misma regla que aplica la función en `api/_lib/estado.js`, y tiene que
 * serlo: si aquí se contaran menos placas de las que la función va a reprobar, la
 * confirmación mentiría sobre lo que va a pasar.
 *
 *   · Si la placa es el ancla de su personaje → todas las demás placas suyas,
 *     porque son las que se generan con ella delante.
 *   · Cualquier placa que la nombre en `encadena_a`, sea del personaje que sea:
 *     así es como las edades de Saharis cuelgan del ancla del adulto.
 *
 * @param {object} modelo
 * @param {string} idPlaca
 * @returns {string[]} ids, sin repetir
 */
function dependientesDirectas(modelo, idPlaca) {
  const esta = modelo.porId.get(idPlaca);
  const hijas = [];

  if (esta && esta.ancla === true) {
    const grupo = modelo.porPersonaje.get(String(esta.personaje ?? ''));
    for (const suya of (grupo && grupo.placas) || []) {
      if (suya.id !== idPlaca) hijas.push(suya.id);
    }
  }

  for (const edad of modelo.encadenadasA.get(idPlaca) || []) {
    if (edad.id !== idPlaca) hijas.push(edad.id);
  }

  return [...new Set(hijas)];
}

/**
 * Todas las placas que cuelgan de una, en profundidad. Cambiar el ancla del
 * adulto mueve las cinco edades y todos sus detalles, no solo el primer nivel.
 * @param {object} modelo
 * @param {string} idPlaca
 * @returns {string[]}
 */
function cadenaDe(modelo, idPlaca) {
  const vistas = new Set([idPlaca]);
  const cola = dependientesDirectas(modelo, idPlaca).filter((id) => !vistas.has(id));
  for (const id of cola) vistas.add(id);

  const todas = [];
  while (cola.length) {
    const id = cola.shift();
    todas.push(id);
    for (const hija of dependientesDirectas(modelo, id)) {
      if (!vistas.has(hija)) {
        vistas.add(hija);
        cola.push(hija);
      }
    }
  }
  return todas;
}

/**
 * Qué placas tienen que estar APROBADAS para poder generar esta, y por qué.
 *
 * Es exactamente lo que `promptPlaca()` va a adjuntar y lo que la función va a
 * exigir con `exigirAprobada()`. Aquí no se decide nada nuevo: se dice antes.
 *
 * @param {object} modelo
 * @param {object} laPlaca
 * @returns {{id:string, porque:string}[]}
 */
function requisitosDe(modelo, laPlaca) {
  const requisitos = [];

  if (laPlaca.ancla !== true) {
    const grupo = modelo.porPersonaje.get(String(laPlaca.personaje ?? ''));
    const ancla = grupo && grupo.ancla;
    if (ancla) {
      requisitos.push({
        id: ancla.id,
        porque: `el ancla de ${grupo.nombre}`
      });
    }
  }

  const linaje = typeof laPlaca.encadena_a === 'string' ? laPlaca.encadena_a.trim() : '';
  if (linaje && modelo.porId.has(linaje)) {
    requisitos.push({ id: linaje, porque: 'el ancla de linaje a la que encadena' });
  }

  return requisitos;
}

/**
 * Por qué esta placa todavía no se puede generar, con palabras. Null si se puede.
 *
 * Esto es lo que sustituye al botón de generar: mientras devuelva una frase, la
 * tarjeta no lleva botón ninguno. No es un botón apagado, es que no hay botón.
 *
 * @param {object} modelo
 * @param {object} laPlaca
 * @param {object} estado
 * @returns {string|null}
 */
function porQueNoSePuedeGenerar(modelo, laPlaca, estado) {
  // Una placa que no es ancla y cuyo personaje no tiene ninguna: eso no es que
  // falte aprobar algo, es que el banco está mal escrito. Se dice distinto.
  if (laPlaca.ancla !== true) {
    const grupo = modelo.porPersonaje.get(String(laPlaca.personaje ?? ''));
    if (!grupo || !grupo.ancla) {
      return (
        `«${laPlaca.id}» no está marcada como ancla y su personaje no tiene ninguna placa ancla ` +
        'en el banco de datos/serie.json. Sin ancla no hay contra qué generarla: cada placa ' +
        'saldría con otra cara. Es un fallo de los datos, no de tu cuenta.'
      );
    }
  }

  const faltan = requisitosDe(modelo, laPlaca).filter(
    (requisito) => !leerEntrada(estado, 'banco', requisito.id).aprobada
  );
  if (!faltan.length) return null;

  const lista = faltan
    .map((requisito) => `«${requisito.id}» (${requisito.porque})`)
    .join(' y ');

  const detrasDeOtra = faltan
    .map((requisito) => modelo.porId.get(requisito.id))
    .filter(Boolean)
    .map((otra) => porQueNoSePuedeGenerar(modelo, otra, estado))
    .filter(Boolean);

  const arrastre = detrasDeOtra.length
    ? ' Y esa, a su vez, todavía espera a la suya: hay que subir la cadena hasta el ancla de ' +
      'linaje y bajar aprobando.'
    : '';

  return (
    `Falta aprobar ${lista}. Una placa que no es ancla se genera con esa imagen delante, y hasta ` +
    'que no esté aprobada no hay contra qué generarla. Por eso aquí no hay botón de generar ' +
    `todavía: no serviría de nada pulsarlo.${arrastre}`
  );
}

// ---------------------------------------------------------------------------
// El estado, leído sin romperse
// ---------------------------------------------------------------------------

/**
 * El estado de la producción, o un estado vacío si todavía no ha llegado. Una
 * pantalla que se pinte antes de tiempo no puede quedarse en blanco.
 * @returns {object}
 */
function leerEstado() {
  try {
    return actual();
  } catch {
    return { banco: {}, escenarios: {}, cola: [] };
  }
}

/**
 * Lo aprobado y los intentos de una placa o de un escenario, ya limpios.
 * @param {object} estado
 * @param {'banco'|'escenarios'} donde
 * @param {string} id
 * @returns {{aprobada:string|null, intentos:string[]}}
 */
function leerEntrada(estado, donde, id) {
  const mapa = estado && typeof estado[donde] === 'object' && estado[donde] ? estado[donde] : {};
  const entrada = mapa[id];
  const aprobada =
    entrada && typeof entrada.aprobada === 'string' && entrada.aprobada.trim()
      ? entrada.aprobada
      : null;
  const intentos =
    entrada && Array.isArray(entrada.intentos)
      ? entrada.intentos.filter((ruta) => typeof ruta === 'string' && ruta.trim())
      : [];
  return { aprobada, intentos };
}

/**
 * La misma entrada, pero creada dentro del estado que se está cambiando.
 * @param {object} estado
 * @param {'banco'|'escenarios'} donde
 * @param {string} id
 * @returns {object}
 */
function entradaMutable(estado, donde, id) {
  if (!estado[donde] || typeof estado[donde] !== 'object') estado[donde] = {};
  const entrada = estado[donde][id];
  if (entrada && typeof entrada === 'object') return entrada;
  estado[donde][id] = { aprobada: null, intentos: [] };
  return estado[donde][id];
}

/**
 * Qué está haciendo la cola con cada placa y con cada escenario, para poder
 * pintar «generando» y, sobre todo, para pintar POR QUÉ falló lo que falló:
 * un trabajo fallido cuyo error solo viva en la pantalla de Cola obliga a
 * cambiar de pestaña para saber qué pasa con la tarjeta que se está mirando.
 *
 * @param {object} estado
 * @returns {Map<string, {estado:string, error:string|null, detalle:string|null}>}
 *   la clave es `«tipo»:«id»`
 */
function indexarCola(estado) {
  const indice = new Map();
  const cola = estado && Array.isArray(estado.cola) ? estado.cola : [];

  for (const trabajo of cola) {
    if (!trabajo || (trabajo.tipo !== 'placa' && trabajo.tipo !== 'escenario')) continue;
    const id = trabajo.args && typeof trabajo.args.id === 'string' ? trabajo.args.id : '';
    if (!id) continue;
    const clave = `${trabajo.tipo}:${id}`;
    const anterior = indice.get(clave);
    // De un trabajo revivido solo interesa lo último que le ha pasado.
    if (anterior && mandaSobre(anterior.estado, trabajo.estado)) continue;
    indice.set(clave, {
      estado: String(trabajo.estado || ''),
      error: typeof trabajo.error === 'string' && trabajo.error.trim() ? trabajo.error : null,
      detalle: typeof trabajo.detalle === 'string' && trabajo.detalle.trim() ? trabajo.detalle : null
    });
  }

  return indice;
}

/** Cuál de dos estados de trabajo se enseña cuando hay dos para el mismo id. */
function mandaSobre(anterior, nuevo) {
  const peso = { en_curso: 4, pendiente: 3, fallido: 2, detenido: 1, hecho: 0 };
  return (peso[anterior] ?? 0) >= (peso[String(nuevo || '')] ?? 0);
}

// ---------------------------------------------------------------------------
// Las URL firmadas
// ---------------------------------------------------------------------------

/**
 * El enlace para mirar una ruta, o null si todavía no hay.
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
 * Todas las rutas que esta pantalla puede necesitar enseñar: lo aprobado y todos
 * los intentos, de las placas y de los escenarios.
 * @param {object} modelo
 * @param {object} estado
 * @returns {string[]}
 */
function rutasQueSeMiran(modelo, estado) {
  const rutas = new Set();

  const meter = (entrada) => {
    if (entrada.aprobada) rutas.add(entrada.aprobada);
    for (const ruta of entrada.intentos) rutas.add(ruta);
  };

  for (const laPlaca of modelo.placas) meter(leerEntrada(estado, 'banco', laPlaca.id));
  for (const elEscenario of modelo.escenarios) meter(leerEntrada(estado, 'escenarios', elEscenario.id));

  return [...rutas];
}

/**
 * Pide de una vez los enlaces que falten, en lotes de 200 —el tope de `firmar`—,
 * y repinta cuando los tenga. Cuatrocientas imágenes no pueden ser cuatrocientas
 * peticiones de firma.
 *
 * @param {object} modelo
 * @param {object} estado
 * @param {() => void} repintar
 */
function pedirEnlacesQueFalten(modelo, estado, repintar) {
  if (pidiendoEnlaces) return;

  const faltan = rutasQueSeMiran(modelo, estado).filter(
    (ruta) => !enlaceDe(ruta) && !sinEnlace.has(ruta)
  );
  if (!faltan.length) return;

  pidiendoEnlaces = true;
  quejaDeEnlaces = null;

  (async () => {
    for (let i = 0; i < faltan.length; i += MAXIMO_POR_FIRMA) {
      const lote = faltan.slice(i, i + MAXIMO_POR_FIRMA);
      const respuesta = await llamar('firmar', { rutas: lote });
      const dadas = (respuesta && respuesta.urls) || {};
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
      // Sin esto, el repintado que anuncia el fallo volvería a pedirlos y el
      // fallo volvería a pintar otro repintado, sin fin.
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

// ---------------------------------------------------------------------------
// Pintar
// ---------------------------------------------------------------------------

/**
 * La pantalla entera.
 * @param {object} modelo
 * @param {() => void} repintar
 * @returns {HTMLElement}
 */
function construir(modelo, repintar) {
  const estado = leerEstado();
  const trabajos = indexarCola(estado);
  const ctx = { modelo, estado, trabajos, repintar };

  pedirEnlacesQueFalten(modelo, estado, repintar);

  return pantalla(
    'Banco',
    seccionCabecera(ctx),
    seccionPersonajes(ctx),
    seccionEscenarios(ctx)
  );
}

// ---------------------------------------------------------------------------
// La cabecera: cuánto hay hecho y los dos botones que encolan
// ---------------------------------------------------------------------------

/**
 * El resumen de arriba: progreso total, progreso de las anclas, los dos botones
 * de encolar y el filtro que gobierna las dos secciones.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionCabecera(ctx) {
  const { modelo, estado, repintar } = ctx;

  const placasAprobadas = modelo.placas.filter(
    (p) => leerEntrada(estado, 'banco', p.id).aprobada
  ).length;
  const escenariosAprobados = modelo.escenarios.filter(
    (e) => leerEntrada(estado, 'escenarios', e.id).aprobada
  ).length;

  const total = modelo.placas.length + modelo.escenarios.length;
  const hechas = placasAprobadas + escenariosAprobados;

  const anclasSinAprobar = modelo.anclas.filter(
    (p) => !leerEntrada(estado, 'banco', p.id).aprobada
  );
  const anclasQueYaSePueden = anclasSinAprobar.filter(
    (p) => !porQueNoSePuedeGenerar(modelo, p, estado)
  );
  const anclasQueEsperan = anclasSinAprobar.length - anclasQueYaSePueden.length;

  const restoQueFalta = loQueQuedaDelResto(modelo, estado);

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
        `${quejaDeEnlaces.mensaje} Sin esos enlaces no se pueden ver las imágenes, así que tampoco ` +
          'se puede aprobar nada: aprobar es mirar.',
        { tono: 'error', detalle: quejaDeEnlaces.detalle }
      )
    );
  }

  partes.push(
    barra(hechas, total, { etiqueta: 'Aprobado de todo el banco' }),
    barra(modelo.anclas.length - anclasSinAprobar.length, modelo.anclas.length, {
      etiqueta: 'Anclas aprobadas'
    })
  );

  if (pidiendoEnlaces) partes.push(espera('Pidiendo los enlaces para ver las imágenes…'));

  // Las anclas primero, y dicho con nombres: mientras falten, media pantalla no
  // tiene botón de generar y hay que saber por dónde empezar.
  if (anclasSinAprobar.length) {
    partes.push(
      aviso(
        `Primero las anclas. Faltan por aprobar ${plural(
          anclasSinAprobar.length,
          'ancla',
          'anclas'
        )}: ${enumerar(
          anclasSinAprobar.map((p) => nombreDeGrupo(modelo, p)),
          6
        )}. Un ancla se genera sola, solo con texto y sin ninguna referencia; hasta que no está ` +
          'aprobada, las demás placas de ese personaje no se pueden generar.',
        { tono: 'nota' }
      )
    );
  } else {
    partes.push(
      aviso(
        'Todas las anclas están aprobadas. A partir de aquí cualquier placa del banco se puede ' +
          'generar contra la suya.',
        { tono: 'bien' }
      )
    );
  }

  const acciones = [];

  acciones.push(
    anclasQueYaSePueden.length
      ? boton(
          `Generar ${plural(anclasQueYaSePueden.length, 'ancla que falta', 'anclas que faltan')}`,
          () =>
            encolarVariosTrabajos(
              anclasQueYaSePueden.map((p) => ({ tipo: 'placa', args: { id: p.id } })),
              repintar
            ),
          { tono: 'principal' }
        )
      : boton('Generar las anclas que faltan', null, {
          desactivado: anclasSinAprobar.length
            ? 'Las anclas que faltan encadenan a otra que todavía no está aprobada. Aprueba ' +
              'primero el ancla de linaje y estas se podrán generar.'
            : 'No falta ninguna ancla: están todas aprobadas.'
        })
  );

  acciones.push(
    restoQueFalta.length
      ? boton(
          `Generar el resto del banco (${restoQueFalta.length})`,
          () => encolarVariosTrabajos(restoQueFalta, repintar),
          { tono: 'principal' }
        )
      : boton('Generar el resto del banco', null, {
          desactivado:
            'No queda ninguna placa ni ningún escenario sin imagen que se pueda generar ahora ' +
            'mismo. Lo que falte está esperando a que se apruebe su ancla.'
        })
  );

  acciones.push(boton('Volver a pedir los enlaces', () => olvidarEnlaces(repintar)));

  partes.push(h('div', { clase: 'tarjeta-acciones' }, acciones));

  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto tenue' },
      'Los dos botones encolan: no lanzan nada de golpe. La cola los saca de UNO EN UNO ' +
        'porque saturar las cuotas de Vertex devuelve ' +
        'errores que parecen falta de acceso al modelo. «Generar el resto» solo encola lo que ' +
        'todavía no tiene ninguna imagen que mirar; para pedir otra versión de algo que ya la ' +
        'tiene, está el botón de su tarjeta.'
    )
  );

  if (anclasQueEsperan > 0) {
    partes.push(
      h(
        'p',
        { clase: 'tarjeta-texto tenue' },
        `${plural(anclasQueEsperan, 'ancla', 'anclas')} de edad no se pueden encolar todavía: ` +
          'encadenan al ancla de linaje del adulto y esa hay que aprobarla antes, mirándola.'
      )
    );
  }

  partes.push(
    filtro(
      Object.keys(FILTROS).map((id) => ({
        id,
        texto: FILTROS[id],
        cuenta: contarConFiltro(ctx, id)
      })),
      filtroPuesto,
      (id) => {
        filtroPuesto = id;
        repintar();
      }
    )
  );

  return seccion(null, ...partes);
}

/**
 * Lo que encola el botón de «el resto del banco»: las placas no-ancla y los
 * escenarios que no tienen NINGUNA imagen todavía y que se pueden generar ya.
 *
 * Lo que ya tiene un intento sin aprobar no entra a propósito: pedir otra
 * versión de algo que ya se puede mirar es una decisión de gastar, y esa se toma
 * mirándolo, en su tarjeta.
 *
 * @param {object} modelo
 * @param {object} estado
 * @returns {{tipo:string, args:object}[]}
 */
function loQueQuedaDelResto(modelo, estado) {
  const trabajos = [];

  for (const laPlaca of modelo.placas) {
    if (laPlaca.ancla === true) continue;
    const entrada = leerEntrada(estado, 'banco', laPlaca.id);
    if (entrada.aprobada || entrada.intentos.length) continue;
    if (porQueNoSePuedeGenerar(modelo, laPlaca, estado)) continue;
    trabajos.push({ tipo: 'placa', args: { id: laPlaca.id } });
  }

  for (const elEscenario of modelo.escenarios) {
    const entrada = leerEntrada(estado, 'escenarios', elEscenario.id);
    if (entrada.aprobada || entrada.intentos.length) continue;
    trabajos.push({ tipo: 'escenario', args: { id: elEscenario.id } });
  }

  return trabajos;
}

/** El nombre con el que se llama a un ancla cuando se la nombra en una lista. */
function nombreDeGrupo(modelo, laPlaca) {
  const grupo = modelo.porPersonaje.get(String(laPlaca.personaje ?? ''));
  return grupo ? grupo.nombre : laPlaca.id;
}

// ---------------------------------------------------------------------------
// Personajes
// ---------------------------------------------------------------------------

/**
 * La sección de personajes: la cadena de edad arriba, del todo visible, y debajo
 * un pliegue por personaje con sus placas.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionPersonajes(ctx) {
  const { modelo, estado } = ctx;

  const total = modelo.placas.length;
  const hechas = modelo.placas.filter((p) => leerEntrada(estado, 'banco', p.id).aprobada).length;

  const partes = [barra(hechas, total, { etiqueta: 'Placas de personaje aprobadas' })];

  for (const cadena of modelo.cadenas) partes.push(filaDeCadena(cadena, ctx));

  const grupos = modelo.grupos
    .map((grupo) => ({ grupo, suyas: grupo.placas.filter((p) => pasaElFiltro(p, 'banco', ctx)) }))
    .filter(({ suyas }) => suyas.length);

  if (!grupos.length) {
    partes.push(
      aviso(
        `Ninguna placa de personaje está ahora mismo en «${FILTROS[filtroPuesto] || filtroPuesto}». ` +
          'Cambia el filtro de arriba para verlas.',
        { tono: 'nota' }
      )
    );
  }

  for (const { grupo, suyas } of grupos) partes.push(pliegueDePersonaje(grupo, suyas, ctx));

  return seccion('Personajes', ...partes);
}

/**
 * Una cadena de linaje pintada como lo que es: el ancla a la izquierda y una
 * flecha SALIENDO DE ELLA hacia cada edad. Las flechas no van de una edad a la
 * siguiente porque el banco no está hecho así: los cinco años no encadenan a los
 * diez, encadenan al adulto, igual que todas las demás.
 *
 * @param {{ancla:object, grupo:object, eslabones:{placa:object, grupo:object}[]}} cadena
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function filaDeCadena(cadena, ctx) {
  const { modelo, estado } = ctx;
  const nombre = nombreDeGrupo(modelo, cadena.ancla);
  const cuantas = cadena.eslabones.length;

  const aprobadas = cadena.eslabones.filter(
    (uno) => leerEntrada(estado, 'banco', uno.placa.id).aprobada
  ).length;

  // No lleva la clase «tarjeta» a propósito: una cadena es una fila larga y en
  // horizontal la rejilla la metería en media columna, que es justo donde no se
  // puede leer. Sin esa clase, la hoja le da el ancho entero.
  return h(
    'article',
    {
      clase: 'cadena',
      'aria-label': `Cadena de edad de ${nombre}`,
      estilo: {
        display: 'flex',
        'flex-direction': 'column',
        gap: 'var(--espacio-3)',
        padding: 'var(--espacio-3)',
        background: 'var(--fondo-alto)',
        border: '1px solid var(--borde-fuerte)',
        'border-radius': 'var(--radio)',
        'box-shadow': 'var(--sombra)',
        'min-width': '0'
      }
    },
    h(
      'header',
      { clase: 'tarjeta-cabecera' },
      h('h3', { clase: 'tarjeta-titulo' }, `Cadena de edad · ${nombre}`),
      h('span', { clase: 'suave numero' }, `${aprobadas} de ${cuantas}`)
    ),
    h(
      'p',
      { clase: 'tarjeta-texto suave', estilo: { margin: '0' } },
      `${conMayuscula(nombre)} aparece a más de una edad, y cada edad es una placa distinta del ` +
        `banco. En total ${plural(cuantas, 'edad encadena', 'edades encadenan')} a la MISMA ancla ` +
        'de linaje —la de la izquierda—, con la instrucción de conservar la estructura de la cara ' +
        'y cambiar solo lo que cambia con la edad. Generadas por su cuenta serían personas ' +
        'distintas y los flashbacks no significarían nada.'
    ),
    h(
      'div',
      {
        estilo: {
          display: 'flex',
          'align-items': 'flex-start',
          gap: 'var(--espacio-3)',
          'min-width': '0'
        }
      },
      eslabonDeCadena(cadena.ancla, ctx, { linaje: true }),
      h(
        'div',
        {
          estilo: {
            display: 'flex',
            'flex-wrap': 'wrap',
            'align-items': 'flex-start',
            gap: 'var(--espacio-2)',
            flex: '1 1 auto',
            'min-width': '0'
          }
        },
        cadena.eslabones.map((uno) => [
          h(
            'span',
            {
              'aria-hidden': 'true',
              estilo: {
                color: 'var(--texto-tenue)',
                'font-size': '20px',
                'padding-top': '22px',
                'align-self': 'flex-start'
              }
            },
            FLECHA
          ),
          eslabonDeCadena(uno.placa, ctx, { linaje: false })
        ])
      )
    )
  );
}

/**
 * Un eslabón de la cadena: la imagen pequeña, cómo se llama esa edad y en qué
 * estado está. Se pulsa y lleva a su tarjeta, que es donde se aprueba.
 * @param {object} laPlaca
 * @param {object} ctx
 * @param {{linaje:boolean}} opciones
 * @returns {HTMLElement}
 */
function eslabonDeCadena(laPlaca, ctx, { linaje }) {
  const { modelo, estado } = ctx;
  const entrada = leerEntrada(estado, 'banco', laPlaca.id);
  const ruta = entrada.aprobada || entrada.intentos[entrada.intentos.length - 1] || null;
  const nombre = nombreDeGrupo(modelo, laPlaca);
  const comoEsta = entrada.aprobada
    ? 'Aprobada'
    : entrada.intentos.length
      ? 'Por aprobar'
      : 'Sin generar';

  return h(
    'button',
    {
      type: 'button',
      'aria-label': `${linaje ? 'Ancla de linaje' : 'Edad'}: ${nombre}, placa ${laPlaca.id}. ${comoEsta}. Ir a su tarjeta.`,
      estilo: {
        display: 'block',
        width: '124px',
        'flex': '0 0 auto',
        padding: 'var(--espacio-1)',
        background: linaje ? 'var(--fondo-hundido)' : 'transparent',
        border: `1px solid ${linaje ? 'var(--borde-fuerte)' : 'var(--borde)'}`,
        'border-radius': 'var(--radio-chico)',
        color: 'var(--texto)',
        font: 'inherit',
        'text-align': 'left',
        cursor: 'pointer'
      },
      alClic: () => irALaPlaca(laPlaca, ctx)
    },
    h(
      'span',
      {
        estilo: {
          display: 'block',
          position: 'relative',
          'aspect-ratio': '16 / 9',
          background: 'var(--negro)',
          'border-radius': 'var(--radio-chico)',
          overflow: 'hidden'
        }
      },
      // Sin imagen, el recuadro se queda negro y callado: lo que dice que no
      // está generada es la línea de estado de aquí abajo, y repetirlo dentro
      // de un recuadro de ciento y pico píxeles solo quita sitio.
      ruta ? miniatura(ruta, `${nombre}, placa ${laPlaca.id}`) : null
    ),
    h(
      'span',
      { estilo: { display: 'block', 'margin-top': 'var(--espacio-1)', 'font-size': '13px' } },
      linaje ? 'Ancla de linaje' : nombre
    ),
    h(
      'span',
      {
        clase: 'tenue mono',
        estilo: { display: 'block', 'font-size': '11px' }
      },
      laPlaca.id
    ),
    h(
      'span',
      {
        clase: entrada.aprobada ? 'suave' : 'tenue',
        estilo: { display: 'block', 'font-size': '12px' }
      },
      comoEsta
    )
  );
}

/**
 * El pliegue de un personaje: su nombre, por cuántas placas va, y dentro sus
 * tarjetas con el ancla la primera. Las tarjetas solo se construyen cuando el
 * pliegue está abierto: son ciento una placas con su imagen.
 *
 * @param {object} grupo
 * @param {object[]} suyas las placas que pasan el filtro
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function pliegueDePersonaje(grupo, suyas, ctx) {
  const { estado } = ctx;

  const todas = grupo.placas.length;
  const hechas = grupo.placas.filter((p) => leerEntrada(estado, 'banco', p.id).aprobada).length;
  const anclaAprobada = grupo.ancla
    ? Boolean(leerEntrada(estado, 'banco', grupo.ancla.id).aprobada)
    : false;

  // Con un filtro puesto se abre solo lo que tiene algo que enseñar: si no,
  // filtrar dejaría una lista de pliegues cerrados que no dice nada.
  const abierto = filtroPuesto === 'todo' ? abiertos.has(grupo.personaje) : true;

  const cuerpo = h('div', {
    clase: 'rejilla',
    estilo: { padding: '0 var(--espacio-3) var(--espacio-3)' }
  });

  const pliegue = h(
    'details',
    {
      open: abierto,
      id: idDeGrupo(grupo.personaje),
      estilo: {
        background: 'var(--fondo-alto)',
        border: '1px solid var(--borde)',
        'border-radius': 'var(--radio)',
        'box-shadow': 'var(--sombra)'
      },
      alDesplegar: () => {
        // Con un filtro puesto el pliegue lo manda el filtro, no el usuario: si
        // se apuntara aquí lo que el filtro abre solo, al volver a «Todo»
        // estarían abiertos los veintisiete personajes de golpe.
        if (filtroPuesto !== 'todo') return;
        if (pliegue.open) abiertos.add(grupo.personaje);
        else abiertos.delete(grupo.personaje);
        if (pliegue.open && !cuerpo.childElementCount) llenarPliegue(cuerpo, suyas, ctx);
      }
    },
    h(
      'summary',
      {
        estilo: {
          padding: 'var(--espacio-3)',
          'min-height': 'var(--toque)',
          cursor: 'pointer'
        }
      },
      h('span', { estilo: { 'font-weight': '600' } }, grupo.nombre),
      h(
        'span',
        { clase: 'suave numero', estilo: { 'margin-left': 'var(--espacio-2)' } },
        `${hechas} de ${todas} aprobadas`
      ),
      grupo.ancla && !anclaAprobada
        ? h(
            'span',
            { clase: 'tenue', estilo: { display: 'block', 'font-size': '13px' } },
            'Le falta el ancla: sus demás placas todavía no se pueden generar.'
          )
        : null,
      suyas.length !== todas
        ? h(
            'span',
            { clase: 'tenue', estilo: { display: 'block', 'font-size': '13px' } },
            `${plural(suyas.length, 'placa', 'placas')} con el filtro puesto.`
          )
        : null
    ),
    cuerpo
  );

  if (abierto) llenarPliegue(cuerpo, suyas, ctx);

  return pliegue;
}

/** Mete las tarjetas de un personaje dentro de su pliegue. */
function llenarPliegue(cuerpo, suyas, ctx) {
  vaciar(cuerpo);
  for (const laPlaca of suyas) cuerpo.appendChild(tarjetaDePlaca(laPlaca, ctx));
}

/** El id del nodo de un grupo, para poder llevar el pulgar hasta él. */
function idDeGrupo(idPersonaje) {
  return `banco-personaje-${String(idPersonaje).replace(/[^0-9A-Za-z_-]+/g, '-')}`;
}

/** El id del nodo de una tarjeta de placa. */
function idDeTarjeta(idPlaca) {
  return `banco-placa-${String(idPlaca).replace(/[^0-9A-Za-z_-]+/g, '-')}`;
}

/**
 * Abre el personaje de una placa, quita el filtro si hiciera falta y lleva la
 * pantalla hasta su tarjeta. Es lo que hace un eslabón de la cadena al pulsarlo.
 * @param {object} laPlaca
 * @param {object} ctx
 */
function irALaPlaca(laPlaca, ctx) {
  const idPersonaje = String(laPlaca.personaje ?? '');
  abiertos.add(idPersonaje);
  filtroPuesto = 'todo';
  ctx.repintar();

  // Después de repintar: el nodo de antes ya no existe.
  const destino = document.getElementById(idDeTarjeta(laPlaca.id));
  if (destino && typeof destino.scrollIntoView === 'function') {
    destino.scrollIntoView({ block: 'center' });
  }
}

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

/**
 * La sección de escenarios. Sin cadena: cada uno es una placa única y su placa
 * viaja como referencia en todos los planos que ocurren ahí. Van ordenados por
 * en cuántas escenas de la serie salen, porque eso dice cuánto importa que salga
 * bien: el sitio que sale en 46 escenas se mira con lupa; el que sale en una, no.
 *
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionEscenarios(ctx) {
  const { modelo, estado } = ctx;

  const total = modelo.escenarios.length;
  const hechos = modelo.escenarios.filter(
    (e) => leerEntrada(estado, 'escenarios', e.id).aprobada
  ).length;

  const partes = [
    barra(hechos, total, { etiqueta: 'Escenarios aprobados' }),
    aviso(
      'Un escenario no tiene ancla ni cadena: se genera una vez, solo con texto, y a partir de ' +
        'ahí su placa viaja como referencia en TODOS los planos que ocurren ahí. Sin eso, once ' +
        'planos de la cripta son once criptas distintas. Están ordenados por en cuántas escenas ' +
        'de la serie salen: cuanto más arriba, más veces se va a ver.',
      { tono: 'nota' }
    )
  ];

  const suyos = modelo.escenarios.filter((e) => pasaElFiltro(e, 'escenarios', ctx));

  if (!suyos.length) {
    partes.push(
      aviso(
        filtroPuesto === 'anclas'
          ? 'Ningún escenario es un ancla: las anclas son de personaje. Cada escenario es una ' +
            'placa única que se genera sola, sin referencias.'
          : `Ningún escenario está ahora mismo en «${FILTROS[filtroPuesto] || filtroPuesto}». ` +
            'Cambia el filtro de arriba para verlos.',
        { tono: 'nota' }
      )
    );
  }

  for (const elEscenario of suyos) partes.push(tarjetaDeEscenario(elEscenario, ctx));

  return seccion('Escenarios', ...partes);
}

// ---------------------------------------------------------------------------
// Las tarjetas
// ---------------------------------------------------------------------------

/**
 * La tarjeta de una placa de personaje: lo que se mira, lo que se sabe de ella,
 * la tira de intentos y los botones. O, si le falta el ancla, la frase que dice
 * qué falta y ningún botón.
 *
 * @param {object} laPlaca
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function tarjetaDePlaca(laPlaca, ctx) {
  const { modelo, estado, trabajos, repintar } = ctx;
  const entrada = leerEntrada(estado, 'banco', laPlaca.id);
  const enLaCola = trabajos.get(`placa:${laPlaca.id}`) || null;
  const bloqueo = porQueNoSePuedeGenerar(modelo, laPlaca, estado);
  const esAncla = laPlaca.ancla === true;
  // La clave lleva de dónde es: una placa y un escenario pueden llamarse igual
  // y lo que se está mirando de cada uno no es lo mismo.
  const clave = `banco:${laPlaca.id}`;

  const datos = [];
  if (laPlaca.luz) datos.push(`Luz ${laPlaca.luz}`);
  datos.push(plural(entrada.intentos.length, 'intento', 'intentos'));

  const pie = [
    h('p', { clase: 'tarjeta-texto' }, datos.join(' · ')),
    esAncla
      ? h(
          'p',
          { clase: 'tarjeta-texto suave' },
          laPlaca.encadena_a
            ? `Ancla de ${nombreDeGrupo(modelo, laPlaca)}. Encadena al ancla de linaje ` +
              `«${laPlaca.encadena_a}»: la misma persona a otra edad.`
            : `Ancla de ${nombreDeGrupo(modelo, laPlaca)}. Se genera sola, solo con texto y sin ` +
              'ninguna referencia. Todas las demás placas suyas se generan contra esta.'
        )
      : null,
    !esAncla && laPlaca.encadena_a
      ? h(
          'p',
          { clase: 'tarjeta-texto suave' },
          `Encadena a «${laPlaca.encadena_a}»: la misma persona a otra edad.`
        )
      : null,
    laPlaca.detalle === true
      ? h(
          'p',
          { clase: 'tarjeta-texto suave' },
          'Placa de detalle: aquí no sale la cara. Se genera igual, con el ancla delante, pero ' +
            'con su propia instrucción de qué copiar —piel, complexión, cicatrices, pelo— y de ' +
            'qué no dibujar.'
        )
      : null,
    bloqueo ? h('p', { clase: 'tarjeta-texto' }, bloqueo) : null,
    enLaCola && enLaCola.error
      ? aviso(enLaCola.error, { tono: 'error', detalle: enLaCola.detalle })
      : null,
    tiraDeIntentos(clave, entrada, `la placa ${laPlaca.id}`, ctx)
  ].filter(Boolean);

  const nodo = tarjeta({
    titulo: tituloDeTarjeta(laPlaca.id, esAncla ? 'Ancla' : null),
    media: marcoDeImagen(clave, entrada, `Placa ${laPlaca.id}`),
    pie,
    estado: comoEsta(entrada, enLaCola),
    acciones: accionesDeAprobable('banco', laPlaca.id, clave, entrada, {
      bloqueo,
      nombre: `la placa «${laPlaca.id}»`,
      ctx,
      alGenerar: () => encolarUno('placa', laPlaca.id, repintar)
    })
  });

  nodo.id = idDeTarjeta(laPlaca.id);
  return nodo;
}

/**
 * La tarjeta de un escenario. Igual que la de una placa pero sin cadena y sin
 * bloqueo: nunca le falta nada para poder generarse.
 * @param {object} elEscenario
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function tarjetaDeEscenario(elEscenario, ctx) {
  const { estado, trabajos, repintar } = ctx;
  const entrada = leerEntrada(estado, 'escenarios', elEscenario.id);
  const enLaCola = trabajos.get(`escenario:${elEscenario.id}`) || null;
  const escenas = Number(elEscenario.escenas) || 0;
  const clave = `escenarios:${elEscenario.id}`;

  const datos = [];
  if (elEscenario.luz) datos.push(`Luz ${elEscenario.luz}`);
  datos.push(plural(entrada.intentos.length, 'intento', 'intentos'));

  const pie = [
    h(
      'p',
      { clase: 'tarjeta-texto' },
      `Sale en ${plural(escenas, 'escena', 'escenas')} de la serie. Su placa viaja como ` +
        'referencia en todos los planos que ocurren ahí.'
    ),
    h('p', { clase: 'tarjeta-texto suave' }, datos.join(' · ')),
    elEscenario.no_fusionar_con
      ? aviso(
          typeof elEscenario.nota === 'string' && elEscenario.nota.trim()
            ? elEscenario.nota
            : `No se fusiona nunca con «${elEscenario.no_fusionar_con}»: son dos sitios distintos ` +
              'con nombres casi iguales.',
          { tono: 'nota' }
        )
      : null,
    enLaCola && enLaCola.error
      ? aviso(enLaCola.error, { tono: 'error', detalle: enLaCola.detalle })
      : null,
    tiraDeIntentos(clave, entrada, `el escenario ${elEscenario.id}`, ctx)
  ].filter(Boolean);

  return tarjeta({
    titulo: tituloDeTarjeta(
      elEscenario.id,
      escenas ? `${escenas} ${escenas === 1 ? 'escena' : 'escenas'}` : null
    ),
    media: marcoDeImagen(clave, entrada, `Escenario ${elEscenario.id}`),
    pie,
    estado: comoEsta(entrada, enLaCola),
    acciones: accionesDeAprobable('escenarios', elEscenario.id, clave, entrada, {
      bloqueo: null,
      nombre: `el escenario «${elEscenario.id}»`,
      ctx,
      alGenerar: () => encolarUno('escenario', elEscenario.id, repintar)
    })
  });
}

/** El título de una tarjeta: el id y, si toca, su insignia al lado. */
function tituloDeTarjeta(id, insigniaTexto) {
  return h(
    'h3',
    { clase: 'tarjeta-titulo' },
    h('span', { clase: 'mono' }, id),
    insigniaTexto ? insignia(insigniaTexto) : null
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

/** En qué estado se pinta el punto de una tarjeta. */
function comoEsta(entrada, enLaCola) {
  if (enLaCola && (enLaCola.estado === 'en_curso' || enLaCola.estado === 'pendiente')) {
    return 'generando';
  }
  if (enLaCola && enLaCola.estado === 'fallido') return 'fallido';
  if (entrada.aprobada) return 'aprobada';
  if (entrada.intentos.length) return 'por-aprobar';
  return 'sin-empezar';
}

/**
 * Lo que se mira: la imagen aprobada, o el intento que se esté mirando, o un
 * hueco que dice que todavía no hay nada. Nunca un `<img>` roto.
 * @param {string} clave `«banco»:«id»` o `«escenarios»:«id»`
 * @param {{aprobada:string|null, intentos:string[]}} entrada
 * @param {string} alt
 * @returns {HTMLElement}
 */
function marcoDeImagen(clave, entrada, alt) {
  const ruta = rutaQueSeMira(clave, entrada);
  if (!ruta) return hueco('Todavía no se ha generado');

  const url = enlaceDe(ruta);
  if (!url) {
    return hueco(
      sinEnlace.has(ruta)
        ? 'Esta imagen existe en el bucket pero no se ha conseguido enlace para verla. Prueba con ' +
          '«Volver a pedir los enlaces», arriba del todo.'
        : 'Pidiendo el enlace para verla…'
    );
  }

  const esLaAprobada = ruta === entrada.aprobada;
  const img = h('img', {
    src: url,
    alt: `${alt}. ${esLaAprobada ? 'Imagen aprobada' : 'Intento sin aprobar'}.`,
    loading: 'lazy',
    decoding: 'async'
  });

  img.addEventListener('error', () => {
    const fallo = hueco(
      'Esta imagen no se ha podido cargar. Los enlaces para mirar duran seis horas: prueba con ' +
        '«Volver a pedir los enlaces», arriba del todo.'
    );
    if (img.parentNode) img.replaceWith(fallo);
  });

  // EL TAMAÑO DE VERDAD, EN LA ESQUINA. No es un adorno: es la única forma de
  // saber a ciencia cierta qué resolución está devolviendo Google en ESTA cuenta
  // y HOY. La documentación dice que este modelo admite 1K, 2K y 4K; hay
  // informes abiertos de que a veces ignora lo que se le pide y devuelve 1K
  // igual, y ninguna de las dos cosas se puede comprobar discutiendo. Aquí se ve.
  img.addEventListener('load', () => {
    if (!img.naturalWidth || !img.parentNode) return;
    img.parentNode.appendChild(etiquetaDeTamano(img.naturalWidth, img.naturalHeight));
  });

  return img;
}

/**
 * La pastilla que dice cuántos píxeles tiene de verdad la imagen que se está
 * mirando, con el nombre que le da Google al lado.
 */
function etiquetaDeTamano(ancho, alto) {
  return h('span', {
    clase: 'mono',
    estilo: {
      position: 'absolute',
      right: '6px',
      bottom: '6px',
      padding: '2px 6px',
      'border-radius': 'var(--radio-pastilla)',
      background: 'rgba(7, 8, 10, 0.72)',
      color: 'var(--texto-suave)',
      'font-size': '11px',
      'pointer-events': 'none',
    },
  }, `${ancho}×${alto} · ${comoLoLlamaGoogle(ancho, alto)}`);
}

/**
 * De píxeles al nombre que usa Google. El lado mayor es lo que manda, porque
 * estas imágenes son 16:9 y no cuadradas: un «1K» de Google mide 1024 de lado
 * mayor, no 1024 de ancho Y de alto.
 */
function comoLoLlamaGoogle(ancho, alto) {
  const mayor = Math.max(ancho, alto);
  if (mayor >= 3200) return '4K';
  if (mayor >= 1600) return '2K';
  if (mayor >= 800) return '1K';
  return '0,5K';
}

/** Qué ruta se está mirando de una placa: la elegida, la aprobada o la última. */
function rutaQueSeMira(clave, entrada) {
  const elegida = mirando.get(clave);
  if (elegida && (elegida === entrada.aprobada || entrada.intentos.includes(elegida))) {
    return elegida;
  }
  return entrada.aprobada || entrada.intentos[entrada.intentos.length - 1] || null;
}

/** El cuadro negro con una frase dentro, para cuando no hay imagen que enseñar. */
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

/** La miniatura de un eslabón o de un intento. Sin enlace, un hueco con palabras. */
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
 * La tira horizontal de intentos. Se toca uno y se pone arriba, en grande: es
 * ahí donde se mira y donde se aprueba, no en la miniatura.
 *
 * @param {string} clave `«banco»:«id»` o `«escenarios»:«id»`
 * @param {{aprobada:string|null, intentos:string[]}} entrada
 * @param {string} que cómo se llama esto en voz alta
 * @param {object} ctx
 * @returns {HTMLElement|null}
 */
function tiraDeIntentos(clave, entrada, que, ctx) {
  const todas = [...entrada.intentos];
  // La aprobada puede venir de una tanda anterior que ya no está en `intentos`.
  if (entrada.aprobada && !todas.includes(entrada.aprobada)) todas.unshift(entrada.aprobada);
  if (todas.length < 2) return null;

  const puesta = rutaQueSeMira(clave, entrada);

  return h(
    'div',
    {
      role: 'group',
      'aria-label': `Intentos de ${que}`,
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
      const esLaAprobada = ruta === entrada.aprobada;
      return h(
        'button',
        {
          type: 'button',
          'aria-pressed': esta ? 'true' : 'false',
          'aria-label': `Intento ${indice + 1} de ${que}${esLaAprobada ? ', el aprobado' : ''}. Verlo en grande.`,
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
          miniatura(ruta, `Intento ${indice + 1} de ${que}`)
        ),
        h(
          'span',
          {
            clase: esLaAprobada ? 'suave' : 'tenue',
            estilo: { display: 'block', 'font-size': '11px', 'padding-top': '2px' }
          },
          esLaAprobada ? `${indice + 1} · aprobado` : String(indice + 1)
        )
      );
    })
  );
}

/**
 * Los botones de una placa o de un escenario.
 *
 * Con el ancla sin aprobar no devuelve NINGUNO: la frase que dice qué falta ya
 * está en el pie, y un botón que siempre falla es peor que no tener botón.
 *
 * @param {'banco'|'escenarios'} donde
 * @param {string} id
 * @param {string} clave
 * @param {{aprobada:string|null, intentos:string[]}} entrada
 * @param {object} opciones
 * @returns {HTMLElement[]}
 */
function accionesDeAprobable(donde, id, clave, entrada, { bloqueo, nombre, ctx, alGenerar }) {
  if (bloqueo) return [];

  const puesta = rutaQueSeMira(clave, entrada);
  const acciones = [];

  if (puesta) {
    if (puesta === entrada.aprobada) {
      acciones.push(
        boton('Aprobar', null, {
          desactivado:
            'Esta es justo la imagen que ya está aprobada. Si quieres otra, elige un intento de ' +
            'la tira o pide otro intento.'
        })
      );
    } else {
      acciones.push(
        boton(
          entrada.aprobada ? 'Aprobar este intento' : 'Aprobar',
          () => aprobar(donde, id, clave, puesta, { nombre, ctx }),
          { tono: 'principal' }
        )
      );
    }
  }

  acciones.push(
    boton(puesta ? 'Otro intento' : 'Generar', alGenerar, {
      tono: puesta ? 'suave' : 'principal'
    })
  );

  return acciones;
}

// ---------------------------------------------------------------------------
// El filtro
// ---------------------------------------------------------------------------

/**
 * Si una placa o un escenario se enseña con un filtro dado.
 * @param {object} ficha la placa o el escenario
 * @param {'banco'|'escenarios'} donde
 * @param {object} ctx
 * @param {string} [cual] el filtro; por defecto, el que está puesto
 * @returns {boolean}
 */
function pasaElFiltro(ficha, donde, ctx, cual = filtroPuesto) {
  if (cual === 'todo') return true;
  if (cual === 'anclas') return ficha.ancla === true;

  const entrada = leerEntrada(ctx.estado, donde, ficha.id);
  if (cual === 'aprobadas') return Boolean(entrada.aprobada);
  if (cual === 'por-aprobar') return !entrada.aprobada && entrada.intentos.length > 0;
  if (cual === 'sin-generar') return !entrada.aprobada && entrada.intentos.length === 0;
  return true;
}

/** Cuántas cosas caen en cada pastilla del filtro, para poder pintar la cuenta. */
function contarConFiltro(ctx, cual) {
  let cuenta = 0;
  for (const laPlaca of ctx.modelo.placas) {
    if (pasaElFiltro(laPlaca, 'banco', ctx, cual)) cuenta += 1;
  }
  for (const elEscenario of ctx.modelo.escenarios) {
    if (pasaElFiltro(elEscenario, 'escenarios', ctx, cual)) cuenta += 1;
  }
  return cuenta;
}

// ---------------------------------------------------------------------------
// Las acciones
// ---------------------------------------------------------------------------

/**
 * Aprueba una imagen.
 *
 * Si de esa placa cuelga algo que ya estaba aprobado —las demás placas de su
 * personaje cuando es el ancla, y las edades que le encadenan, en profundidad—,
 * antes se cuenta, se enseña con nombres y se pregunta. Cambiar un ancla no es
 * un ajuste: es tirar todo lo que se generó pareciéndose a ella.
 *
 * @param {'banco'|'escenarios'} donde
 * @param {string} id
 * @param {string} clave la del mapa de «qué se está mirando»
 * @param {string} ruta la imagen que se aprueba
 * @param {{nombre:string, ctx:object}} opciones
 */
async function aprobar(donde, id, clave, ruta, { nombre, ctx }) {
  const { modelo, estado, repintar } = ctx;

  // Solo cuelga algo de las placas del banco: un escenario es una placa única y
  // no arrastra a nadie. Y de una placa que no es ancla ni tiene edades
  // encadenadas, `cadenaDe()` devuelve la lista vacía y esto no hace nada.
  const cuelgan = donde === 'banco' ? cadenaDe(modelo, id) : [];
  const seCaen = cuelgan.filter((otra) => leerEntrada(estado, 'banco', otra).aprobada);
  const cambiaAlgoAprobado = Boolean(leerEntrada(estado, donde, id).aprobada);

  if (seCaen.length && cambiaAlgoAprobado) {
    const pregunta =
      `Vas a cambiar ${nombre}, que ya estaba aprobada, y todo lo que se generó pareciéndose a ` +
      `ella deja de valer. Quedan por reprobar ${plural(seCaen.length, 'placa', 'placas')}: ` +
      `${enumerar(seCaen, 8)}. Habrá que mirarlas y aprobarlas otra vez, o volver a generarlas. ` +
      '¿Lo hago?';
    if (!(await confirmar(pregunta))) return;
  }

  try {
    await cambiar((borrador) => {
      const entrada = entradaMutable(borrador, donde, id);
      entrada.aprobada = ruta;
      // El intento aprobado tiene que seguir estando en la lista: si vino de una
      // tanda vieja y ya no estaba, se vuelve a apuntar para no perderlo de vista.
      if (!Array.isArray(entrada.intentos)) entrada.intentos = [];
      if (!entrada.intentos.includes(ruta)) entrada.intentos.push(ruta);

      // La misma cadena que se ha contado arriba, recalculada sobre el estado
      // que se está escribiendo: `cambiar()` puede aplicar esto dos veces si el
      // bucket contesta 409, y las dos veces tiene que dejar lo mismo.
      for (const otra of cuelgan) {
        entradaMutable(borrador, 'banco', otra).aprobada = null;
      }
    });
    mirando.set(clave, ruta);
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  repintar();
}

/**
 * Encola un trabajo suelto: el botón de «Generar» o de «Otro intento» de una
 * tarjeta. No duplica: si ya hay uno idéntico esperando, se queda como estaba.
 * @param {'placa'|'escenario'} tipo
 * @param {string} id
 * @param {() => void} repintar
 */
function encolarUno(tipo, id, repintar) {
  hacer(() => encolar(tipo, { id }), repintar);
}

/**
 * Encola muchos de golpe y con una sola escritura del estado: es lo que hacen
 * los dos botones grandes. Encolarlos uno a uno serían cien escrituras.
 * @param {{tipo:string, args:object}[]} trabajos
 * @param {() => void} repintar
 */
function encolarVariosTrabajos(trabajos, repintar) {
  hacer(() => encolarVarios(trabajos), repintar);
}

/**
 * Hace algo que puede quejarse y deja la queja donde se lee. `encolar()` y
 * `encolarVarios()` no esperan a que el bucket conteste —el usuario no puede
 * quedarse mirando una pantalla quieta—, así que lo que se recoge aquí es lo que
 * falle al preparar el encolado.
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

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/**
 * Una lista legible: «a, b y c», y con un tope, «a, b, c y 9 más».
 * @param {string[]} cosas
 * @param {number} tope
 * @returns {string}
 */
function enumerar(cosas, tope) {
  const lista = cosas.map((c) => String(c)).filter(Boolean);
  if (!lista.length) return 'ninguna';
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
    'El estudio se ha roto por dentro pintando el banco. No es un problema de tu cuenta ni de la ' +
      'nube: es un fallo del propio código. Debajo está lo que dijo el navegador, tal cual.',
    {
      detalle: fallo && fallo.message ? String(fallo.message) : String(fallo),
      reintentable: false,
      http: 500
    }
  );
}
