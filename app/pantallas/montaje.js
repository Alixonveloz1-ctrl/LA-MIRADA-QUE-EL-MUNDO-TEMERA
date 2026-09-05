// Montaje: montar por escenas, por actos y por episodio. Reproducir y descargar.
//
// Esta pantalla no monta nada: compone el MANIFIESTO de docs/contrato.md §7 —qué
// clip entra en qué segundo, qué audio se mezcla, qué subtítulos se queman y
// dónde se deja el resultado— y se lo encarga al montador. El montador no conoce
// ningún archivo por su nombre: todo lo que va a usar viaja escrito ahí dentro.
//
// De eso salen las cuatro reglas de la pantalla:
//
//   1. ANTES DE MONTAR SE COMPRUEBA, Y SI FALTA ALGO EL BOTÓN NO EXISTE. En su
//      sitio está la lista de lo que falta, con nombres y con el enlace a la
//      pantalla donde se arregla: clips sin elegir, audio sin aprobar, líneas sin
//      medir, huecos o solapes en la línea de tiempo. Un montaje son minutos de
//      máquina y, en un episodio, un buen rato; descubrir a la mitad que faltaba
//      un plano es tiempo tirado que se ve venir sin gastar nada.
//
//   2. UN EPISODIO SE MONTA POR CAPAS Y CADA CAPA SE GUARDA. Escena, luego acto,
//      luego episodio, cada nivel con su lista y su botón. Si falla la tercera no
//      se rehacen las dos primeras, y eso tiene que VERSE: cada capa ya montada
//      se enseña con su fecha al lado de la que falta.
//
//   3. EL RESULTADO SE DESCARGA POR URL FIRMADA DEL BUCKET. Un episodio a 1080p
//      pesa uno o dos gigas: no pasa por ninguna función, ni siquiera para
//      bajarlo. El navegador recibe el enlace y el peso, y nada más.
//
//   4. SI EL MONTADOR FALLA, SE ENSEÑA SU QUEJA. La que él mismo escribió con sus
//      palabras en «montaje/{trabajo}/queja.txt» antes de salir, no un código de
//      salida. Un código de salida no es un mensaje de error.
//
// POR QUÉ EL MONTAJE PASA POR LA COLA. Tarda minutos, y nada puede depender de
// que el navegador siga abierto (plan §8). `app/cola.js` lanza el trabajo, apunta
// la ejecución en el mismo instante en que Google la devuelve, pregunta cada
// tantos segundos y apunta el resultado en `estado.montajes`. Cerrar el móvil a
// mitad de un montaje no pierde nada.

import { ErrorDeCara, llamar } from '../api.js';
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
import { bytes, fecha, plural, segundos } from '../formato.js';

// Los bloques de voz se agrupan con el criterio del contrato §2, y aquí hacen
// falta exactamente igual que en la pantalla de Audio: para colocar cada línea en
// su segundo y para escribir su subtítulo con los tiempos medidos. Se importan de
// allí en vez de volver a escribirlos, porque dos copias de la misma regla acaban
// separándose y entonces el subtítulo se quema en el segundo equivocado.
//
// FALTA EN EL CONTRATO: esto debería vivir en un `app/datos.js` compartido —el
// contrato §12 no da ningún módulo de datos para el navegador— en vez de en una
// pantalla que exporta algo más que su `default`. Que se revise.
import { bloquesDeVoz, lineasDeVoz } from './audio.js';

// ---------------------------------------------------------------------------
// Números y palabras fijas de esta pantalla
// ---------------------------------------------------------------------------

/** Cuántas rutas caben en una sola llamada a `firmar` (docs/contrato.md §2). */
const MAXIMO_POR_FIRMA = 200;

/** Cuánto se da por buena una URL firmada: la función las hace de seis horas. */
const VIDA_DE_URL_MS = 5 * 60 * 60 * 1000;

/** Cuánto se espera, tras pausar un vídeo, antes de repintar con lo que llegó. */
const ESPERA_TRAS_PAUSA_MS = 4000;

/** Donde vive todo lo montado dentro del bucket (docs/contrato.md §11). */
const CARPETA = 'montaje';

/**
 * El margen con el que se comparan segundos. Un fotograma a 24 fps dura 0,0417 s:
 * por debajo de eso lo que hay no es un hueco, es el redondeo de un número
 * escrito con dos decimales. Es el mismo margen que usa la función al comprobar
 * el manifiesto, y tiene que serlo: si aquí fuera más estrecho, esta pantalla
 * dejaría montar cosas que allí se rechazan.
 */
const MARGEN_S = 0.05;

/** El fundido con el que se unen dos piezas de música seguidas (plan §5). */
const FUNDIDO_ENTRE_PIEZAS_S = 2.5;

/** La ganancia de la música bajo las voces, tal como la escribe el contrato §7. */
const GANANCIA_MUSICA_DB = -6;

/** El fundido de entrada y salida de la cartela, si la serie no dice otro. */
const FUNDIDO_DE_CARTELA_S = 0.5;

/** El alto de la imagen si `formato.resolucion` no se entiende. */
const ALTO_POR_DEFECTO = 1080;

/** Los fotogramas por segundo si `formato.fps` no está escrito. */
const FPS_POR_DEFECTO = 24;

// ---------------------------------------------------------------------------
// Lo que esta pantalla recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** `datos/serie.json`, pedido una sola vez. */
let promesaDeLaSerie = null;

/** Ruta lógica → `{ url, hasta }`. Las URL firmadas se reaprovechan. */
const enlaces = new Map();

/** Rutas por las que ya se preguntó y no hay enlace: no se insiste solo. */
const sinEnlace = new Set();

/** Si hay una petición de firmas en marcha ahora mismo. */
let pidiendoEnlaces = false;

/** Por qué no se han podido conseguir los enlaces, si es que no se han podido. */
let quejaDeEnlaces = null;

/** Ruta lógica → `{ bytes, actualizado }`, de lo que hay en «montaje/». */
const pesos = new Map();

/** Si ya se ha preguntado por los pesos en esta visita a la pantalla. */
let pesosPedidos = false;

/** Si la pregunta por los pesos está en marcha. */
let pidiendoPesos = false;

/** Por qué no se sabe lo que pesa lo montado, si es que no se sabe. */
let quejaDePesos = null;

/** El último fallo de una acción de esta pantalla, para pintarlo arriba. */
let queja = null;

/** Los vídeos que están sonando ahora mismo: mientras haya uno, no se repinta. */
const sonando = new Set();

/** Si ha llegado un cambio del estado mientras se reproducía algo. */
let repintadoPendiente = false;

/** El reloj del repintado diferido. */
let relojDeRepintado = null;

/** Qué listas de «lo que falta» están desplegadas. */
const desplegadas = new Set();

/**
 * Lo que hay que hacer cuando un vídeo se pausa o se acaba. Lo pone `montar()`.
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
  id: 'montaje',
  titulo: 'Montaje',
  icono: '\u{1F39E}',

  /**
   * Pinta las capas de montaje de la pieza activa y se queda escuchando el
   * estado.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>} cómo desapuntarse al cambiar de pestaña
   */
  async montar(raiz) {
    const marco = h('div', { clase: 'montaje' });
    raiz.appendChild(marco);

    pesosPedidos = false;

    /** Cómo desapuntarse de lo que esté montado ahora mismo. */
    let soltar = null;

    const arrancar = async () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
      vaciar(marco);

      marco.appendChild(espera('Trayendo los planos y el audio de la pieza…'));

      let serie;
      try {
        serie = await laSerie();
      } catch (fallo) {
        const error = comoErrorDeCara(fallo);
        vaciar(marco);
        marco.appendChild(
          pantalla(
            'Montaje',
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

      const repintar = () => {
        sonando.clear();
        repintadoPendiente = false;
        pararElReloj();
        vaciar(marco);
        marco.appendChild(construir(serie, repintar, pedirRepintado));
      };

      const pedirRepintado = () => {
        if (sonando.size) {
          repintadoPendiente = true;
          return;
        }
        repintar();
      };

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

/**
 * `datos/serie.json`, bajado una vez y guardado. De ahí sale todo lo que va en el
 * manifiesto menos las rutas: los planos con su recorte, el acabado, las líneas
 * de voz, la música y la cartela.
 * @returns {Promise<object>}
 */
function laSerie() {
  if (!promesaDeLaSerie) {
    promesaDeLaSerie = bajarLaSerie().catch((fallo) => {
      promesaDeLaSerie = null;
      throw fallo;
    });
  }
  return promesaDeLaSerie;
}

/** @returns {Promise<object>} */
async function bajarLaSerie() {
  const direccion = new URL('../../datos/serie.json', import.meta.url).href;

  let respuesta;
  try {
    respuesta = await fetch(direccion, { cache: 'no-cache' });
  } catch (fallo) {
    throw new ErrorDeCara(
      'No se ha podido leer datos/serie.json, que es donde está escrito qué plano va en qué segundo, ' +
        'cómo se recorta cada uno y qué cadena de acabado lleva la pieza. Sin él no se puede componer ' +
        'ningún manifiesto de montaje. Comprueba la conexión del teléfono; si tienes cobertura, es ' +
        'que el despliegue está a medias.',
      { detalle: loQueDijo(fallo), reintentable: true, http: 0 }
    );
  }

  if (!respuesta.ok) {
    throw new ErrorDeCara(
      `No se ha podido leer datos/serie.json: el servidor ha contestado con un ${respuesta.status}. ` +
        'Ese archivo va dentro del repositorio, así que si no está es que el despliegue no ha subido ' +
        'entero.',
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
// El estado
// ---------------------------------------------------------------------------

/** El estado, o uno vacío si todavía no ha llegado del bucket. */
function leerEstado() {
  try {
    return actual() || {};
  } catch {
    return { tomas: {}, audio: { musica: {}, voz: {} }, montajes: [], cola: [], pieza_activa: null };
  }
}

/** El clip elegido de una toma, o null. */
function clipElegido(estado, clave) {
  const tomas = esObjeto(estado.tomas) ? estado.tomas : {};
  const entrada = esObjeto(tomas[clave]) ? tomas[clave] : {};
  return rutaSiVale(entrada.clip_elegido);
}

/** Lo guardado de una pieza de música. */
function musicaGuardada(estado, idMusica) {
  const audio = esObjeto(estado.audio) ? estado.audio : {};
  const mapa = esObjeto(audio.musica) ? audio.musica : {};
  const entrada = esObjeto(mapa[idMusica]) ? mapa[idMusica] : {};
  return {
    ruta: rutaSiVale(entrada.ruta),
    durS: Number(entrada.dur_s) || 0,
    aprobada: entrada.aprobada === true
  };
}

/** Lo guardado de un bloque de voz, con sus tiempos medidos. */
function vozGuardada(estado, clave) {
  const audio = esObjeto(estado.audio) ? estado.audio : {};
  const mapa = esObjeto(audio.voz) ? audio.voz : {};
  const entrada = esObjeto(mapa[clave]) ? mapa[clave] : {};
  const lineas = Array.isArray(entrada.lineas) ? entrada.lineas : [];
  return {
    ruta: rutaSiVale(entrada.ruta),
    durS: Number(entrada.dur_s) || 0,
    aprobada: entrada.aprobada === true,
    tramos: lineas.map((tramo) => ({
      inicio: Number(tramo && tramo.inicio) || 0,
      fin: Number(tramo && tramo.fin) || 0,
      estimado: tramo && typeof tramo.estimado === 'boolean' ? tramo.estimado : null
    }))
  };
}

/**
 * Lo ya montado de una capa, lo más reciente primero.
 *
 * Solo cuentan los archivos que están directamente dentro de «montaje/» y acaban
 * en «.mp4»: son las salidas que pide el manifiesto. Lo que el montador deje
 * dentro de «montaje/{trabajo}/» son sus cosas —el manifiesto, restos de
 * trabajo—, y la cola las apunta igual porque no puede distinguirlas.
 *
 * @param {object} estado
 * @param {string} capa
 * @param {string} id
 * @returns {{ruta:string, capa:string, id:string, cuando:string}[]}
 */
function montajesDe(estado, capa, id) {
  const todos = Array.isArray(estado.montajes) ? estado.montajes : [];
  return todos
    .filter(
      (uno) =>
        esObjeto(uno) &&
        String(uno.capa || '') === capa &&
        String(uno.id || '') === id &&
        esSalidaDeMontaje(uno.ruta)
    )
    .map((uno) => ({
      ruta: String(uno.ruta),
      capa,
      id,
      cuando: soloTexto(uno.cuando)
    }))
    .sort((a, b) => String(b.cuando).localeCompare(String(a.cuando)));
}

/** Todo lo montado que hay apuntado, lo más reciente primero. */
function todosLosMontajes(estado) {
  const todos = Array.isArray(estado.montajes) ? estado.montajes : [];
  return todos
    .filter((uno) => esObjeto(uno) && esSalidaDeMontaje(uno.ruta))
    .map((uno) => ({
      ruta: String(uno.ruta),
      capa: soloTexto(uno.capa) || 'pieza',
      id: soloTexto(uno.id),
      cuando: soloTexto(uno.cuando)
    }))
    .sort((a, b) => String(b.cuando).localeCompare(String(a.cuando)));
}

/** «montaje/teaser-3.mp4» sí; «montaje/teaser-3/manifiesto.json» no. */
function esSalidaDeMontaje(ruta) {
  const limpia = typeof ruta === 'string' ? ruta.trim() : '';
  return /^montaje\/[^/]+\.mp4$/.test(limpia);
}

/**
 * Qué está haciendo la cola con cada capa: `«capa/id» → trabajo`. Es de donde
 * sale la queja del montador cuando algo falla, que es lo único que explica qué
 * ha pasado.
 * @param {object} estado
 * @returns {Map<string, object>}
 */
function indexarCola(estado) {
  const indice = new Map();
  const cola = Array.isArray(estado.cola) ? estado.cola : [];

  for (const trabajo of cola) {
    if (!trabajo || String(trabajo.tipo || '') !== 'montaje') continue;
    const args = esObjeto(trabajo.args) ? trabajo.args : {};
    const capa = soloTexto(args.capa) || 'pieza';
    const id = soloTexto(args.id);
    if (!id) continue;

    const clave = `${capa}/${id}`;
    const anterior = indice.get(clave);
    if (anterior && mandaSobre(anterior.estado, trabajo.estado)) continue;

    indice.set(clave, {
      estado: String(trabajo.estado || ''),
      trabajo: soloTexto(args.trabajo),
      error: soloTexto(trabajo.error) || null,
      detalle: soloTexto(trabajo.detalle) || null,
      ejecucion: soloTexto(trabajo.operacion) || null,
      actualizado: soloTexto(trabajo.actualizado)
    });
  }

  return indice;
}

/** Cuál de dos estados de trabajo manda cuando hay dos para lo mismo. */
function mandaSobre(anterior, nuevo) {
  const peso = { en_curso: 4, pendiente: 3, fallido: 2, detenido: 1, hecho: 0 };
  return (peso[anterior] ?? 0) >= (peso[String(nuevo || '')] ?? 0);
}

/** Si la cola está montando esto ahora mismo. */
function estaEnMarcha(trabajo) {
  return Boolean(trabajo && (trabajo.estado === 'en_curso' || trabajo.estado === 'pendiente'));
}

// ---------------------------------------------------------------------------
// El modelo: la pieza, sus planos y sus capas
// ---------------------------------------------------------------------------

/** Todas las piezas escritas en datos/serie.json. */
function piezasDeLaSerie(serie) {
  const piezas = esObjeto(serie.piezas) ? serie.piezas : {};
  return Object.keys(piezas)
    .filter((id) => esObjeto(piezas[id]))
    .map((id) => ({ id, titulo: soloTexto(piezas[id].titulo) || id, datos: piezas[id] }));
}

/** La pieza que se está produciendo: la del estado, o la primera de la serie. */
function piezaActiva(serie, estado) {
  const todas = piezasDeLaSerie(serie);
  const dicha = soloTexto(estado.pieza_activa);
  return todas.find((una) => una.id === dicha) || todas[0] || null;
}

/**
 * Todo lo que hace falta saber de la pieza para montarla, ya masticado.
 * @param {object} serie
 * @param {{id:string, titulo:string, datos:object}} pieza
 * @returns {object}
 */
function construirModelo(serie, pieza) {
  const datos = pieza.datos;
  const crudas = Array.isArray(datos.tomas) ? datos.tomas : [];
  const acabado = esObjeto(datos.acabado) ? datos.acabado : {};
  const pasoDeDos = Array.isArray(acabado.paso_de_dos) ? acabado.paso_de_dos.map(String) : [];

  const tomas = crudas
    .filter((una) => esObjeto(una) && soloTexto(una.id))
    .map((una) => {
      const recorte = Array.isArray(una.recorte) ? una.recorte : [];
      const desde = Number(recorte[0]);
      const hasta = Number(recorte[1]);
      const inicio = Number(una.inicio);
      return {
        id: String(una.id),
        inicio: Number.isFinite(inicio) ? inicio : null,
        dur: Number(una.dur),
        desde: Number.isFinite(desde) ? desde : null,
        hasta: Number.isFinite(hasta) ? hasta : null,
        pasoDeDos: pasoDeDos.includes(String(una.id)),
        escena: una.escena === undefined || una.escena === null ? null : String(una.escena),
        acto: una.acto === undefined || una.acto === null ? null : String(una.acto)
      };
    })
    .sort((a, b) => (a.inicio ?? 0) - (b.inicio ?? 0));

  const duracionEscrita = Number(datos.duracion_s);
  const finDeLosPlanos = tomas.reduce(
    (mayor, una) => Math.max(mayor, largoDeLaToma(una) + (una.inicio ?? 0)),
    0
  );

  return {
    id: pieza.id,
    titulo: pieza.titulo,
    datos,
    tomas,
    esLarga: tomas.some((una) => una.escena !== null),
    duracion: Number.isFinite(duracionEscrita) && duracionEscrita > 0 ? duracionEscrita : finDeLosPlanos,
    bloques: bloquesDeVoz(datos),
    lineas: lineasDeVoz(datos),
    musica: musicaDeLaPieza(serie, pieza.id, piezasDeLaSerie(serie).length),
    silencios: silenciosDeLaPieza(datos),
    cartela: cartelaDeLaPieza(serie, datos, tomas),
    formato: formatoDeSalida(serie),
    acabado: {
      cadena: soloTexto(acabado.cadena_ffmpeg),
      pasoDeDos
    },
    cantoEntraS: cantoEntraS(serie, datos)
  };
}

/** Lo que dura un plano en pantalla: su recorte, que es lo que se monta. */
function largoDeLaToma(toma) {
  if (toma.desde === null || toma.hasta === null) return Number(toma.dur) || 0;
  return Math.max(0, toma.hasta - toma.desde);
}

/**
 * Las piezas de música de una pieza de la serie, emparejadas por el prefijo del
 * id. Es lo mismo que hace la pantalla de Audio y por el mismo motivo: en
 * `musica.piezas` ninguna entrada dice a qué pieza pertenece.
 */
function musicaDeLaPieza(serie, idPieza, cuantasPiezas) {
  const musica = esObjeto(serie.musica) ? serie.musica : {};
  const todas = (Array.isArray(musica.piezas) ? musica.piezas : []).filter(
    (una) => esObjeto(una) && soloTexto(una.id)
  );

  const suyas = todas.filter(
    (una) => una.id === idPieza || String(una.id).startsWith(`${idPieza}-`)
  );
  if (suyas.length) return suyas;
  if (cuantasPiezas === 1) return todas;
  return [];
}

/**
 * Los tramos de silencio absoluto de la pieza, siempre como lista de pares.
 * En datos/serie.json el teaser lo escribe como un solo par (`[69, 72]`), así que
 * las dos formas valen.
 */
function silenciosDeLaPieza(datos) {
  const audio = esObjeto(datos.audio) ? datos.audio : {};
  const crudo = audio.silencio_absoluto_s;
  if (!Array.isArray(crudo) || !crudo.length) return [];

  const pares = Array.isArray(crudo[0]) ? crudo : [crudo];
  return pares
    .filter((par) => Array.isArray(par) && par.length === 2)
    .map((par) => [Number(par[0]), Number(par[1])])
    .filter((par) => Number.isFinite(par[0]) && Number.isFinite(par[1]) && par[1] > par[0]);
}

/**
 * La cartela final: en qué toma cae, cuánto dura y qué dice. En pantalla solo hay
 * español, así que el texto sale de `piezas[].cartela_final.es` o de
 * `cartela.texto`, nunca del campo japonés.
 */
function cartelaDeLaPieza(serie, datos, tomas) {
  const dicha = esObjeto(serie.cartela) ? serie.cartela : {};
  const idToma = soloTexto(dicha.toma);
  if (!idToma) return null;

  const suya = tomas.find((una) => una.id === idToma);
  if (!suya) return null;

  const propia = esObjeto(datos.cartela_final) ? datos.cartela_final : {};
  const texto = soloTexto(propia.es) || soloTexto(dicha.texto);

  return {
    toma: idToma,
    inicio: suya.inicio ?? 0,
    dur: largoDeLaToma(suya),
    texto,
    fundido: fundidoDeLaCartela(dicha)
  };
}

/**
 * El fundido de la cartela.
 *
 * FALTA EN EL CONTRATO: datos/serie.json no da el fundido como número; lo dice
 * dentro de la prosa de `cartela.estilo` («Fundido de 0.5 s y se queda quieto»), y
 * el contrato §7 escribe 0,5 en su ejemplo. Se lee del texto si está escrito así,
 * y si no se usa medio segundo. Conviene añadir un campo `fundido_s`.
 */
function fundidoDeLaCartela(cartela) {
  const escrito = Number(cartela.fundido_s);
  if (Number.isFinite(escrito) && escrito >= 0) return escrito;

  const dicho = /fundido\s+de\s+([0-9]+(?:[.,][0-9]+)?)\s*s/i.exec(soloTexto(cartela.estilo));
  if (dicho) {
    const leido = Number(String(dicho[1]).replace(',', '.'));
    if (Number.isFinite(leido) && leido >= 0) return leido;
  }

  return FUNDIDO_DE_CARTELA_S;
}

/**
 * En qué segundo entra el canto sobre el lecho. Lo dicen dos sitios y los dos
 * dicen lo mismo: la pieza (`audio.cancion_entra_s`) y la mezcla de la música.
 */
function cantoEntraS(serie, datos) {
  const audio = esObjeto(datos.audio) ? datos.audio : {};
  const dePieza = Number(audio.cancion_entra_s);
  if (Number.isFinite(dePieza) && dePieza >= 0) return dePieza;

  const musica = esObjeto(serie.musica) ? serie.musica : {};
  const mezcla = esObjeto(musica.mezcla) ? musica.mezcla : {};
  const deMezcla = Number(mezcla.canto_entra_s);
  if (Number.isFinite(deMezcla) && deMezcla >= 0) return deMezcla;

  return 0;
}

/**
 * El formato de salida del manifiesto.
 *
 * FALTA EN EL CONTRATO: `formato` de datos/serie.json dice «16:9» y «1080p», no
 * ancho y alto, y el manifiesto de §7 pide los dos números. Se calculan: el alto
 * sale de la resolución y el ancho de la proporción, redondeado a par porque un
 * ancho impar no lo admite ningún códec. Con los datos de hoy dan exactamente los
 * 1920 × 1080 del ejemplo del contrato.
 */
function formatoDeSalida(serie) {
  const formato = esObjeto(serie.formato) ? serie.formato : {};

  const fps = Math.round(Number(formato.fps)) || FPS_POR_DEFECTO;

  const dicha = /(\d{3,5})\s*p/i.exec(soloTexto(formato.resolucion));
  const alto = dicha ? Number(dicha[1]) : ALTO_POR_DEFECTO;

  const proporcion = /(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(soloTexto(formato.proporcion));
  const ancha = proporcion ? Number(proporcion[1]) : 16;
  const alta = proporcion ? Number(proporcion[2]) : 9;
  const razon = alta > 0 ? ancha / alta : 16 / 9;

  return { ancho: aPar(alto * razon), alto: aPar(alto), fps };
}

/** Un entero par: los códecs de vídeo no admiten lados impares. */
function aPar(valor) {
  const entero = Math.max(2, Math.round(Number(valor) || 0));
  return entero % 2 === 0 ? entero : entero + 1;
}

/**
 * Si un canto entra sobre el lecho o si es una pieza que va seguida de otra.
 *
 * FALTA EN EL CONTRATO: `musica.piezas` no dice en qué segundo entra cada pieza.
 * Lo único escrito es el segundo en que entra el CANTO (`audio.cancion_entra_s` y
 * `musica.mezcla.canto_entra_s`), así que se reconoce por su pista y por su id, y
 * se acepta además un `entra_s` propio para cuando un episodio traiga varias.
 */
function esCanto(laMusica) {
  const texto = `${soloTexto(laMusica.id)} ${soloTexto(laMusica.pista)}`.toLowerCase();
  return /cant|voz|vocal|coro/.test(texto);
}

// ---------------------------------------------------------------------------
// Los ámbitos: qué se monta en cada capa
// ---------------------------------------------------------------------------

/**
 * Un ámbito es un trozo de la pieza que se monta de una vez: la pieza entera, una
 * escena, un acto o el episodio completo. Todos tienen la misma forma para que la
 * revisión y el manifiesto se escriban una sola vez.
 *
 * @param {object} modelo
 * @returns {{corta:object|null, escenas:object[], actos:object[]|null, episodio:object|null}}
 */
function ambitosDe(modelo) {
  if (!modelo.esLarga) {
    return { corta: ambitoDeLaPieza(modelo), escenas: [], actos: null, episodio: null };
  }

  const escenas = ambitosDeEscenas(modelo);
  const actos = ambitosDeActos(modelo, escenas);
  const episodio = ambitoDelEpisodio(modelo, escenas, actos);

  return { corta: null, escenas, actos, episodio };
}

/** La pieza corta entera: un solo trabajo con todo dentro. */
function ambitoDeLaPieza(modelo) {
  return {
    clave: `pieza/${modelo.id}`,
    capa: 'pieza',
    id: modelo.id,
    base: nombreDeTrabajo(modelo.id),
    titulo: modelo.titulo,
    desde: 0,
    hasta: modelo.duracion,
    tomas: modelo.tomas,
    musica: modelo.musica,
    conCartela: true,
    conSubtitulos: true,
    previas: null
  };
}

/** Una escena de un episodio: sus planos, sus voces y sus subtítulos. */
function ambitosDeEscenas(modelo) {
  const porEscena = new Map();

  for (const toma of modelo.tomas) {
    if (toma.escena === null) continue;
    if (!porEscena.has(toma.escena)) porEscena.set(toma.escena, []);
    porEscena.get(toma.escena).push(toma);
  }

  return [...porEscena.entries()].map(([escena, tomas]) => {
    const desde = tomas.reduce((menor, una) => Math.min(menor, una.inicio ?? 0), Infinity);
    const hasta = tomas.reduce(
      (mayor, una) => Math.max(mayor, (una.inicio ?? 0) + largoDeLaToma(una)),
      0
    );
    return {
      clave: `escena/${modelo.id}/esc-${escena}`,
      capa: 'escena',
      id: `${modelo.id}/esc-${escena}`,
      base: nombreDeTrabajo(`${modelo.id}-esc-${escena}`),
      titulo: `Escena ${escena}`,
      escena,
      acto: tomas[0] ? tomas[0].acto : null,
      desde: Number.isFinite(desde) ? desde : 0,
      hasta,
      tomas,
      // La música va en el acto, no en la escena: es lo que permite ponerle sus
      // fundidos sin que se corten en cada corte de escena (plan §9).
      musica: [],
      conCartela: true,
      conSubtitulos: true,
      previas: null
    };
  });
}

/**
 * Los actos, si la pieza dice cuáles son.
 *
 * FALTA EN EL CONTRATO: ni `piezas[]` ni `guiones.json` dicen qué escenas forman
 * cada acto de un episodio —el `acto` de `guiones.json` es el acto de la
 * TEMPORADA al que pertenece el episodio entero—. Se aceptan las dos formas
 * obvias: una lista `actos` en la pieza, o un campo `acto` en cada plano. Si no
 * hay ninguna, esta capa no existe y el episodio concatena las escenas
 * directamente, que es exactamente lo mismo pero en dos pasos en vez de tres.
 *
 * @param {object} modelo
 * @param {object[]} escenas
 * @returns {object[]|null}
 */
function ambitosDeActos(modelo, escenas) {
  const escritos = Array.isArray(modelo.datos.actos) ? modelo.datos.actos : null;

  const grupos = new Map();

  if (escritos && escritos.length) {
    for (const acto of escritos) {
      if (!esObjeto(acto)) continue;
      const id = soloTexto(acto.id);
      if (!id) continue;
      const suyas = (Array.isArray(acto.escenas) ? acto.escenas : []).map(String);
      grupos.set(
        id,
        escenas.filter((una) => suyas.includes(una.escena))
      );
    }
  } else {
    for (const escena of escenas) {
      if (escena.acto === null) continue;
      if (!grupos.has(escena.acto)) grupos.set(escena.acto, []);
      grupos.get(escena.acto).push(escena);
    }
  }

  if (!grupos.size) return null;

  return [...grupos.entries()]
    .filter(([, suyas]) => suyas.length > 0)
    .map(([acto, suyas]) => ({
      clave: `acto/${modelo.id}/acto-${acto}`,
      capa: 'acto',
      id: `${modelo.id}/acto-${acto}`,
      base: nombreDeTrabajo(`${modelo.id}-acto-${acto}`),
      titulo: `Acto ${acto}`,
      desde: 0,
      hasta: suyas.reduce((suma, una) => suma + (una.hasta - una.desde), 0),
      tomas: [],
      // La música del acto: la que lleve su id por delante. Si no hay ninguna, el
      // acto sale sin música y esta pantalla lo dice.
      musica: modelo.musica.filter((una) =>
        String(una.id).startsWith(`${modelo.id}-acto-${acto}`)
      ),
      conCartela: false,
      conSubtitulos: false,
      previas: suyas
    }));
}

/** El episodio entero: concatena los actos, o las escenas si no hay actos. */
function ambitoDelEpisodio(modelo, escenas, actos) {
  const hijos = actos && actos.length ? actos : escenas;
  const usadaEnActos = new Set();
  if (actos) {
    for (const acto of actos) for (const una of acto.musica) usadaEnActos.add(una.id);
  }

  return {
    clave: `episodio/${modelo.id}`,
    capa: 'episodio',
    id: modelo.id,
    base: nombreDeTrabajo(modelo.id),
    titulo: modelo.titulo,
    desde: 0,
    hasta: hijos.reduce((suma, una) => suma + (una.hasta - una.desde), 0),
    tomas: [],
    // Lo que no se haya puesto ya en ningún acto se pone aquí: si el episodio no
    // tiene actos, esto es toda su música.
    musica: modelo.musica.filter((una) => !usadaEnActos.has(una.id)),
    conCartela: false,
    conSubtitulos: false,
    previas: hijos
  };
}

/** Un nombre que sirva como carpeta del bucket: letras, números, punto y guion. */
function nombreDeTrabajo(crudo) {
  const limpio = String(crudo || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return limpio || 'montaje';
}

// ---------------------------------------------------------------------------
// La revisión: qué falta antes de montar
// ---------------------------------------------------------------------------

/**
 * Comprueba un ámbito entero y, de paso, compone su manifiesto. Las dos cosas
 * juntas a propósito: lo que se revisa es exactamente lo que se iba a mandar, no
 * una lista parecida escrita aparte que puede quedarse vieja.
 *
 * @param {object} modelo
 * @param {object} ambito
 * @param {object} estado
 * @returns {{faltas:{texto:string, donde:string|null}[], notas:string[],
 *   manifiesto:object|null, resumen:string[]}}
 */
function revisar(modelo, ambito, estado) {
  const faltas = [];
  const notas = [];
  const resumen = [];

  const duracion = Math.max(0, ambito.hasta - ambito.desde);

  const video = ambito.previas ? [] : componerVideo(modelo, ambito, estado, faltas);
  const previas = ambito.previas ? componerPrevias(ambito, estado, faltas) : [];

  const audio = [];
  const subtitulos = [];

  // Las voces solo entran en la capa que lleva los planos. Una capa que solo
  // concatena lo ya montado las trae dentro de esos archivos: volver a mezclarlas
  // encima haría sonar cada línea dos veces, una sobre otra. La música sí va
  // aquí, porque es lo único que se pone en el acto (plan §9).
  if (!ambito.previas) {
    componerVoz(modelo, ambito, estado, { audio, subtitulos, faltas, notas });
  }
  componerMusica(modelo, ambito, estado, duracion, { audio, faltas, notas });

  const silencios = ambito.previas ? [] : silenciosDelAmbito(modelo, ambito, duracion);
  const cartela = ambito.conCartela ? cartelaDelAmbito(modelo, ambito, faltas) : null;

  if (!ambito.previas) {
    if (!modelo.acabado.cadena) {
      faltas.push({
        texto:
          'La pieza no tiene escrita su cadena de acabado (piezas[…].acabado.cadena_ffmpeg en ' +
          'datos/serie.json). Es el paso de dos, la aberración cromática, la halación, el grano y ' +
          'la viñeta: sin ella el montaje sale con cara de vídeo de inteligencia artificial.',
        donde: null
      });
    }
    // Que no haya ni un plano escrito es otra cosa que no haberlos generado:
    // eso ya lo cuenta `componerVideo()` con los nombres de los que faltan, y
    // repetirlo aquí sería decir dos veces lo mismo con distintas palabras.
    if (!ambito.tomas.length) {
      faltas.push({
        texto:
          'Este tramo no tiene ni un plano escrito en datos/serie.json, así que no hay nada que ' +
          'montar. Los planos de un episodio salen de la pantalla de Desglose.',
        donde: null
      });
    }
  } else if (!ambito.previas.length) {
    // Distinto de que las capas de abajo estén sin montar —eso ya lo cuenta
    // `componerPrevias()` con su nombre—: aquí es que no hay ninguna debajo.
    faltas.push({
      texto:
        'Esta capa no tiene ninguna capa debajo que concatenar. Un acto sin escenas o un episodio ' +
        'sin actos ni escenas no es un montaje vacío: es que la pieza no dice de qué se compone.',
      donde: null
    });
  }

  // El resumen de lo que se va a montar, que es lo que se lee antes de pulsar.
  if (video.length) resumen.push(plural(video.length, 'plano', 'planos'));
  if (previas.length) resumen.push(plural(previas.length, 'capa ya montada', 'capas ya montadas'));
  const voces = audio.filter((una) => una.pista === 'voz').length;
  const musicas = audio.filter((una) => una.pista === 'musica').length;
  if (musicas) resumen.push(plural(musicas, 'pista de música', 'pistas de música'));
  if (voces) resumen.push(plural(voces, 'línea hablada', 'líneas habladas'));
  if (subtitulos.length) resumen.push(plural(subtitulos.length, 'subtítulo', 'subtítulos'));
  if (silencios.length) resumen.push(plural(silencios.length, 'silencio', 'silencios'));
  if (cartela) resumen.push('la cartela final');

  if (faltas.length) return { faltas, notas, manifiesto: null, resumen };

  const manifiesto = {
    trabajo: '',
    capa: ambito.capa,
    salida: '',
    formato: modelo.formato,
    video,
    audio,
    silencios,
    subtitulos,
    capas_previas: previas
  };

  if (video.length) {
    manifiesto.acabado = {
      cadena: modelo.acabado.cadena,
      paso_de_dos: video.filter((uno) => uno.paso_de_dos).map((uno) => uno.id)
    };
  }
  if (cartela) manifiesto.cartela = cartela;

  return { faltas, notas, manifiesto, resumen };
}

/** Los planos del ámbito, con su recorte y su segundo de entrada. */
function componerVideo(modelo, ambito, estado, faltas) {
  const video = [];
  const sinClip = [];

  for (const toma of ambito.tomas) {
    const origen = clipElegido(estado, `${modelo.id}/${toma.id}`);
    if (!origen) {
      sinClip.push(toma.id);
      continue;
    }

    if (toma.inicio === null) {
      faltas.push({
        texto:
          `El plano ${toma.id} no dice en qué segundo entra (falta «inicio» en datos/serie.json), ` +
          'así que no se puede colocar en la línea de tiempo.',
        donde: null
      });
      continue;
    }

    const desde = toma.desde === null ? 0 : toma.desde;
    const hasta = toma.hasta === null ? desde + (Number(toma.dur) || 0) : toma.hasta;

    if (!(hasta > desde)) {
      faltas.push({
        texto:
          `El recorte del plano ${toma.id} no coge nada: empieza en ${segundos(desde)} y acaba en ` +
          `${segundos(hasta)}. Se arregla en «recorte» de datos/serie.json.`,
        donde: null
      });
      continue;
    }

    video.push({
      id: toma.id,
      origen,
      desde,
      hasta,
      en: redondear(toma.inicio - ambito.desde),
      paso_de_dos: toma.pasoDeDos
    });
  }

  if (sinClip.length) {
    faltas.push({
      texto:
        `${plural(sinClip.length, 'plano no tiene', 'planos no tienen')} clip elegido: ` +
        `${enumerar(sinClip, 8)}. Un clip se elige reproduciéndolo, en la pantalla de Tomas.`,
      donde: '#tomas'
    });
  }

  comprobarLaLineaDeTiempo(ambito, faltas);
  return video;
}

/**
 * Que la línea de tiempo no tenga huecos ni solapes. Es un invariante de la serie
 * y este es su segundo cerrojo: un solape serían dos planos a la vez —el montador
 * corta, no compone— y un hueco, un negro que nadie ha pedido.
 *
 * Se mira sobre TODOS los planos del tramo, tengan clip elegido o no, y no sobre
 * los que ya se pueden montar. Si se mirara sobre esos, cada plano sin clip
 * abriría un hueco de mentira y la lista de lo que falta se llenaría de avisos
 * que se arreglan solos en cuanto se elige el clip, tapando el único que
 * importa: que falta ese clip.
 */
function comprobarLaLineaDeTiempo(ambito, faltas) {
  const orden = ambito.tomas
    .filter((toma) => toma.inicio !== null && largoDeLaToma(toma) > 0)
    .map((toma) => ({ id: toma.id, en: toma.inicio - ambito.desde, largo: largoDeLaToma(toma) }))
    .sort((a, b) => a.en - b.en);

  if (orden.length < 2) return;

  for (let i = 1; i < orden.length; i += 1) {
    const antes = orden[i - 1];
    const ahora = orden[i];
    const fin = antes.en + antes.largo;

    if (ahora.en < fin - MARGEN_S) {
      faltas.push({
        texto:
          `Se solapan los planos ${antes.id} y ${ahora.id}: el primero acaba en ${segundos(fin)} y ` +
          `el segundo entra en ${segundos(ahora.en)}. Dos planos no pueden estar en pantalla a la ` +
          'vez. Se arregla en los segundos de datos/serie.json.',
        donde: null
      });
    } else if (ahora.en > fin + MARGEN_S) {
      faltas.push({
        texto:
          `Queda un hueco de ${segundos(ahora.en - fin)} entre los planos ${antes.id}, que acaba en ` +
          `${segundos(fin)}, y ${ahora.id}, que entra en ${segundos(ahora.en)}. Ahí saldría un ` +
          'negro que nadie ha pedido.',
        donde: null
      });
    }
  }
}

/** Las capas ya montadas que se concatenan, y las que faltan por montar. */
function componerPrevias(ambito, estado, faltas) {
  const previas = [];
  const sinMontar = [];

  for (const hijo of ambito.previas) {
    const suyos = montajesDe(estado, hijo.capa, hijo.id);
    if (!suyos.length) {
      sinMontar.push(hijo.titulo);
      continue;
    }
    previas.push(suyos[0].ruta);
  }

  if (sinMontar.length) {
    faltas.push({
      texto:
        `${plural(sinMontar.length, 'capa está', 'capas están')} sin montar todavía: ` +
        `${enumerar(sinMontar, 8)}. Cada capa se guarda por separado, así que lo que ya esté ` +
        'montado no se rehace: solo faltan estas.',
      donde: null
    });
  }

  return previas;
}

/**
 * Las voces del ámbito y sus subtítulos.
 *
 * Cada línea entra como un trozo del WAV de su bloque, cortado por los tiempos
 * MEDIDOS y colocado en el segundo que le toca en la pieza. El subtítulo español
 * se escribe con esos mismos tiempos: es la única forma de que la letra entre
 * cuando entra la voz, y es la trampa que ya se pagó una vez con tiempos
 * estimados.
 */
function componerVoz(modelo, ambito, estado, salida) {
  const { audio, subtitulos, faltas, notas } = salida;

  const sinGrabar = [];
  const sinAprobar = [];
  const sinMedir = [];
  const estimados = [];

  for (const bloque of modelo.bloques) {
    const suyas = bloque.lineas
      .map((linea, i) => ({ linea, i }))
      .filter(({ linea }) => dentroDelAmbito(linea.t, ambito));

    if (!suyas.length) continue;

    const clave = `${modelo.id}/${bloque.id}`;
    const guardado = vozGuardada(estado, clave);

    if (!guardado.ruta) {
      sinGrabar.push(bloque.id);
      continue;
    }
    if (!guardado.aprobada) sinAprobar.push(bloque.id);

    for (const { linea, i } of suyas) {
      const tramo = guardado.tramos[i] || null;

      if (!tramo || !(tramo.fin > tramo.inicio)) {
        if (!sinMedir.includes(bloque.id)) sinMedir.push(bloque.id);
        continue;
      }
      if (tramo.estimado === true && !estimados.includes(bloque.id)) estimados.push(bloque.id);

      const largo = tramo.fin - tramo.inicio;
      const en = redondear(linea.t - ambito.desde);
      const fin = en + largo;
      const duracion = ambito.hasta - ambito.desde;

      if (fin > duracion + MARGEN_S) {
        faltas.push({
          texto:
            `La línea «${recortar(linea.es || linea.quien, 40)}» entra en ${segundos(en)} y, ` +
            `medida, dura ${segundos(largo)}: acabaría en ${segundos(fin)}, cuando este tramo dura ` +
            `${segundos(duracion)}. O se rehace el bloque más corto, o hay que mover la línea en ` +
            'datos/serie.json.',
          donde: '#audio'
        });
        continue;
      }

      audio.push({
        pista: 'voz',
        origen: guardado.ruta,
        desde: redondear(tramo.inicio),
        hasta: redondear(tramo.fin),
        en,
        ganancia_db: 0,
        agacha: false
      });

      if (!ambito.conSubtitulos) continue;

      if (!linea.es) {
        faltas.push({
          texto:
            `Una línea del bloque «${bloque.id}» no tiene texto español escrito, y el subtítulo se ` +
            'quema en español: en pantalla no hay japonés en ningún momento. Está en ' +
            `piezas.${modelo.id}.audio.voz de datos/serie.json.`,
          donde: null
        });
        continue;
      }

      subtitulos.push({ desde: en, hasta: redondear(fin), texto: linea.es });
    }
  }

  if (sinGrabar.length) {
    faltas.push({
      texto:
        `${plural(sinGrabar.length, 'bloque de voz está', 'bloques de voz están')} sin grabar: ` +
        `${enumerar(sinGrabar, 8)}. Se graban enteros, nunca línea a línea, en la pantalla de Audio.`,
      donde: '#audio'
    });
  }
  if (sinMedir.length) {
    faltas.push({
      texto:
        `${plural(sinMedir.length, 'bloque tiene', 'bloques tienen')} líneas sin medir: ` +
        `${enumerar(sinMedir, 8)}. Los subtítulos se queman con la entrada y la salida REALES de ` +
        'cada línea, no con las estimadas; el botón de medir está en la pantalla de Audio.',
      donde: '#audio'
    });
  }
  if (sinAprobar.length) {
    faltas.push({
      texto:
        `${plural(sinAprobar.length, 'bloque de voz está', 'bloques de voz están')} sin aprobar: ` +
        `${enumerar(sinAprobar, 8)}. Nada suena en un montaje sin haber sonado antes en la pantalla ` +
        'de Audio.',
      donde: '#audio'
    });
  }
  if (estimados.length) {
    notas.push(
      `${plural(estimados.length, 'bloque tiene', 'bloques tienen')} algún tramo estimado en vez de ` +
        `medido (${enumerar(estimados, 6)}). Se puede montar, pero algún subtítulo puede entrar o ` +
        'salir un poco desplazado; volver a medirlos en Audio suele arreglarlo.'
    );
  }
}

/**
 * Las pistas de música del ámbito, colocadas en su segundo y recortadas a lo que
 * dura el tramo. La música y el ambiente se agachan bajo cada línea de voz, que es
 * lo que hace el montador con `agacha`.
 */
function componerMusica(modelo, ambito, estado, duracion, salida) {
  const { audio, faltas, notas } = salida;
  if (!ambito.musica.length) return;

  const sinGenerar = [];
  const sinAprobar = [];

  // Cuando las piezas van seguidas —un episodio pide una por acto o por bloque—
  // se colocan una detrás de otra. Cuando una es el canto, entra sobre el lecho
  // en su segundo.
  let acumulado = 0;
  const seguidas = ambito.musica.filter((una) => !esCanto(una)).length > 1;

  for (const laMusica of ambito.musica) {
    const guardado = musicaGuardada(estado, String(laMusica.id));

    if (!guardado.ruta) {
      sinGenerar.push(String(laMusica.id));
      continue;
    }
    if (!guardado.aprobada) sinAprobar.push(String(laMusica.id));

    const propia = Number(laMusica.entra_s);
    const en = Number.isFinite(propia) && propia >= 0
      ? propia
      : esCanto(laMusica)
        ? modelo.cantoEntraS
        : acumulado;

    const cabe = duracion > 0 ? duracion - en : guardado.durS;
    if (cabe <= MARGEN_S) {
      faltas.push({
        texto:
          `La pieza de música «${laMusica.id}» entraría en ${segundos(en)}, cuando este tramo ya ha ` +
          `terminado (dura ${segundos(duracion)}), así que no llegaría a oírse.`,
        donde: null
      });
      continue;
    }

    const largo = duracion > 0 ? Math.min(guardado.durS, cabe) : guardado.durS;
    if (largo + MARGEN_S < guardado.durS) {
      notas.push(
        `La música «${laMusica.id}» dura ${segundos(guardado.durS)} y en este tramo caben ` +
          `${segundos(largo)} desde el segundo ${segundos(en)}: se monta recortada al final.`
      );
    }

    const pista = {
      pista: 'musica',
      origen: guardado.ruta,
      desde: 0,
      hasta: redondear(largo),
      en: redondear(en),
      ganancia_db: GANANCIA_MUSICA_DB,
      agacha: true
    };

    // FALTA EN EL CONTRATO: el manifiesto de §7 no lleva ningún campo para el
    // fundido con el que se unen dos piezas de música seguidas, y datos/serie.json
    // lo pide expresamente: 2,5 s, porque más corto se oye como un tajo. Se
    // escribe `fundido_s` para que el montador que lo entienda lo aplique; el que
    // no lo entienda las deja pegadas, que es lo que pasaría igualmente sin este
    // campo. Que se revise y se añada al contrato.
    if (seguidas && !esCanto(laMusica)) pista.fundido_s = FUNDIDO_ENTRE_PIEZAS_S;

    audio.push(pista);
    if (!esCanto(laMusica)) acumulado = en + largo;
  }

  if (sinGenerar.length) {
    faltas.push({
      texto:
        `${plural(sinGenerar.length, 'pieza de música está', 'piezas de música están')} sin ` +
        `generar: ${enumerar(sinGenerar, 6)}. Se generan y se escuchan en la pantalla de Audio.`,
      donde: '#audio'
    });
  }
  if (sinAprobar.length) {
    faltas.push({
      texto:
        `${plural(sinAprobar.length, 'pieza de música está', 'piezas de música están')} sin ` +
        `aprobar: ${enumerar(sinAprobar, 6)}. Nada suena en un montaje sin haber sonado antes en la ` +
        'pantalla de Audio.',
      donde: '#audio'
    });
  }
}

/** Los silencios absolutos que caen dentro del ámbito, ya en su tiempo local. */
function silenciosDelAmbito(modelo, ambito, duracion) {
  const dentro = [];

  for (const [desde, hasta] of modelo.silencios) {
    const inicio = Math.max(desde, ambito.desde);
    const fin = Math.min(hasta, ambito.hasta);
    if (fin - inicio <= MARGEN_S) continue;
    const en = redondear(inicio - ambito.desde);
    const acaba = Math.min(redondear(fin - ambito.desde), duracion);
    if (acaba - en <= MARGEN_S) continue;
    dentro.push([en, acaba]);
  }

  return dentro;
}

/** La cartela, si su plano cae dentro de este ámbito. */
function cartelaDelAmbito(modelo, ambito, faltas) {
  const cartela = modelo.cartela;
  if (!cartela) return null;
  if (!ambito.tomas.some((una) => una.id === cartela.toma)) return null;

  if (!cartela.texto) {
    faltas.push({
      texto:
        'La cartela final no tiene texto español escrito. Sale de ' +
        `piezas.${modelo.id}.cartela_final.es o de cartela.texto en datos/serie.json, y se quema ` +
        'en la imagen: en pantalla no hay japonés en ningún momento.',
      donde: null
    });
    return null;
  }

  if (!(cartela.dur > 0)) {
    faltas.push({
      texto: `El plano de la cartela (${cartela.toma}) no dura nada, así que no se podría leer.`,
      donde: null
    });
    return null;
  }

  return {
    en: redondear(cartela.inicio - ambito.desde),
    dur: redondear(cartela.dur),
    texto: cartela.texto,
    fundido: cartela.fundido
  };
}

/** Si un segundo de la pieza cae dentro de este ámbito. */
function dentroDelAmbito(t, ambito) {
  if (!Number.isFinite(t)) return false;
  return t >= ambito.desde - MARGEN_S && t < ambito.hasta - MARGEN_S;
}

// ---------------------------------------------------------------------------
// La pantalla entera
// ---------------------------------------------------------------------------

/**
 * @param {object} serie
 * @param {() => void} repintar el repintado inmediato: lo que toca el usuario
 * @param {() => void} repintarLuego el que espera a que acabe lo que se reproduce
 * @returns {HTMLElement}
 */
function construir(serie, repintar, repintarLuego) {
  const estado = leerEstado();
  const pieza = piezaActiva(serie, estado);

  if (!pieza) {
    return pantalla(
      'Montaje',
      seccion(
        null,
        aviso(
          'No hay ninguna pieza en datos/serie.json, así que no hay nada que montar. El teaser viene ' +
            'escrito en el repositorio, de modo que si falta es que el despliegue subió a medias.',
          { tono: 'error' }
        )
      )
    );
  }

  const modelo = construirModelo(serie, pieza);
  const ambitos = ambitosDe(modelo);

  const ctx = {
    serie,
    estado,
    modelo,
    ambitos,
    todas: piezasDeLaSerie(serie),
    trabajos: indexarCola(estado),
    repintar,
    repintarLuego
  };

  const hechos = todosLosMontajes(estado);
  pedirEnlacesQueFalten(hechos.map((uno) => uno.ruta), repintarLuego);
  pedirLosPesos(hechos.map((uno) => uno.ruta), repintarLuego);

  const secciones = [seccionCabecera(ctx)];

  if (ambitos.corta) {
    secciones.push(seccionDeUnaCapa(ctx, ambitos.corta, textosDeLaPiezaCorta(modelo)));
  } else {
    secciones.push(seccionDeEscenas(ctx));
    secciones.push(seccionDeActos(ctx));
    secciones.push(seccionDeUnaCapa(ctx, ambitos.episodio, textosDelEpisodio(ctx)));
  }

  secciones.push(seccionDeLoMontado(ctx, hechos));

  return pantalla('Montaje', ...secciones);
}

/** Lo de arriba: la pieza, cómo se monta y los fallos que haya que contar. */
function seccionCabecera(ctx) {
  const { modelo, todas, repintar } = ctx;
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
        `${quejaDeEnlaces.mensaje} Sin enlace no se puede ni reproducir ni descargar lo montado, ` +
          'aunque el archivo siga en el bucket.',
        { tono: 'error', detalle: quejaDeEnlaces.detalle }
      ),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Volver a pedir los enlaces', () => olvidarEnlaces(repintar), { tono: 'principal' })
      )
    );
  }

  if (quejaDePesos) {
    partes.push(
      aviso(
        `${quejaDePesos.mensaje} Lo montado se puede ver y descargar igual; lo único que falta es ` +
          'saber lo que pesa.',
        { tono: 'nota', detalle: quejaDePesos.detalle }
      )
    );
  }

  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      todas.length > 1
        ? 'Pieza que se está montando. Todo lo de abajo es de la pieza puesta.'
        : `Pieza que se está montando: ${modelo.titulo}.`
    )
  );

  if (todas.length > 1) {
    partes.push(
      filtro(
        todas.map((una) => ({ id: una.id, texto: una.titulo })),
        modelo.id,
        (id) => cambiarDePieza(id, ctx)
      )
    );
  }

  partes.push(
    h(
      'p',
      { clase: 'tenue' },
      modelo.esLarga
        ? `Esta pieza tiene ${plural(modelo.tomas.length, 'plano', 'planos')} y no cabe en un solo ` +
          'trabajo, así que se monta por capas: primero cada escena, luego cada acto y por último el ' +
          'episodio entero. Cada capa se guarda: si falla la última, las anteriores siguen ahí y no ' +
          'se rehacen.'
        : `Esta pieza son ${plural(modelo.tomas.length, 'plano', 'planos')} y ` +
          `${segundos(modelo.duracion)}: cabe en un solo trabajo, así que se monta de una vez.`
    )
  );

  return seccion(null, partes);
}

/** Cambia la pieza activa y lo guarda en el bucket. */
function cambiarDePieza(id, ctx) {
  cambiar((borrador) => {
    borrador.pieza_activa = id;
  }).catch((fallo) => {
    queja = comoErrorDeCara(fallo);
    ctx.repintar();
  });
}

/** Los textos de la sección de una pieza corta. */
function textosDeLaPiezaCorta(modelo) {
  return {
    titulo: `${modelo.titulo}, entero`,
    boton: `Montar «${modelo.titulo}»`,
    explicacion:
      'Un solo trabajo: recorte de cada clip, concatenado, acabado, mezcla del audio, subtítulos ' +
      'quemados y cartela. Tarda unos minutos y no hace falta tener la pantalla abierta.'
  };
}

/** Los textos de la sección del episodio entero. */
function textosDelEpisodio(ctx) {
  const { ambitos, modelo } = ctx;
  const porActos = Boolean(ambitos.actos && ambitos.actos.length);
  return {
    titulo: 'El episodio entero',
    boton: 'Montar el episodio',
    explicacion: porActos
      ? 'Se concatenan los actos ya montados, tal cual. No se vuelve a codificar ni a acabar nada: ' +
        'lo que se hizo en las capas de abajo se respeta.'
      : `Esta pieza no dice qué escenas forman cada acto, así que el episodio concatena ` +
        `directamente sus ${plural(ambitos.escenas.length, 'escena', 'escenas')} ya montadas y le ` +
        `pone encima la música de ${modelo.titulo}.`
  };
}

// ---------------------------------------------------------------------------
// Las secciones de cada capa
// ---------------------------------------------------------------------------

/**
 * Una capa con un solo ámbito: la pieza corta o el episodio entero.
 * @param {object} ctx
 * @param {object} ambito
 * @param {{titulo:string, boton:string, explicacion:string}} textos
 * @returns {HTMLElement}
 */
function seccionDeUnaCapa(ctx, ambito, textos) {
  const partes = [h('p', { clase: 'suave' }, textos.explicacion)];
  partes.push(tarjetaDeAmbito(ctx, ambito, textos.boton));
  return seccion(textos.titulo, partes);
}

/** La capa de escenas de un episodio: una tarjeta por escena. */
function seccionDeEscenas(ctx) {
  const { ambitos, estado, modelo } = ctx;
  const partes = [
    h(
      'p',
      { clase: 'suave' },
      'Cada escena se monta con sus planos, su voz y sus subtítulos, y sale un archivo por escena. ' +
        'Es el único trozo que se codifica de verdad: las dos capas de arriba solo concatenan.'
    )
  ];

  // Un plano sin escena en una pieza que se monta por escenas no entra en
  // ninguna, así que se caería del episodio sin que nadie lo notara.
  const sueltos = modelo.tomas.filter((una) => una.escena === null);
  if (sueltos.length) {
    partes.push(
      aviso(
        `${plural(sueltos.length, 'plano no dice', 'planos no dicen')} de qué escena ` +
          `${sueltos.length === 1 ? 'es' : 'son'} (${enumerar(sueltos.map((una) => una.id), 8)}), ` +
          'y esta pieza se monta por escenas: no entrarían en ninguna y se caerían del episodio sin ' +
          'avisar. Hay que escribirles su «escena» en datos/serie.json.',
        { tono: 'error' }
      )
    );
  }

  if (!ambitos.escenas.length) {
    partes.push(
      aviso(
        'Esta pieza no tiene ninguna escena escrita en sus planos, así que no hay nada que montar ' +
          'por escenas.',
        { tono: 'nota' }
      )
    );
    return seccion('Escenas', partes);
  }

  const montadas = ambitos.escenas.filter(
    (una) => montajesDe(estado, una.capa, una.id).length > 0
  ).length;
  partes.push(barra(montadas, ambitos.escenas.length, { etiqueta: 'Escenas montadas' }));

  const listas = ambitos.escenas.filter((una) => {
    if (montajesDe(estado, una.capa, una.id).length) return false;
    return revisar(ctx.modelo, una, estado).manifiesto !== null;
  });

  if (listas.length > 1) {
    partes.push(
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton(
          `Montar las ${listas.length} escenas que ya se pueden`,
          () => montarVarias(ctx, listas),
          { tono: 'principal' }
        )
      )
    );
  }

  for (const una of ambitos.escenas) partes.push(tarjetaDeAmbito(ctx, una, 'Montar esta escena'));

  return seccion('Escenas', partes);
}

/** La capa de actos: concatena escenas y les pone su música. */
function seccionDeActos(ctx) {
  const { ambitos, estado } = ctx;
  const partes = [];

  if (!ambitos.actos || !ambitos.actos.length) {
    partes.push(
      aviso(
        'Esta pieza no dice qué escenas forman cada acto, así que esta capa no existe y el episodio ' +
          'se monta concatenando directamente las escenas. Para montarlo por actos hay que escribir ' +
          'una lista «actos» en la pieza —cada acto con su id y sus escenas— o un campo «acto» en ' +
          'cada plano, dentro de datos/serie.json.',
        { tono: 'nota' }
      )
    );
    return seccion('Actos', partes);
  }

  partes.push(
    h(
      'p',
      { clase: 'suave' },
      'Cada acto concatena sus escenas ya montadas y les pone su pista de música. No se vuelve a ' +
        'codificar nada de lo que ya está hecho.'
    )
  );

  const montados = ambitos.actos.filter(
    (una) => montajesDe(estado, una.capa, una.id).length > 0
  ).length;
  partes.push(barra(montados, ambitos.actos.length, { etiqueta: 'Actos montados' }));

  for (const una of ambitos.actos) partes.push(tarjetaDeAmbito(ctx, una, 'Montar este acto'));

  return seccion('Actos', partes);
}

/**
 * La tarjeta de un ámbito: qué se va a montar, qué falta para poder hacerlo, el
 * botón —o la lista de lo que falta en su lugar— y lo que ya salió de ahí.
 *
 * @param {object} ctx
 * @param {object} ambito
 * @param {string} textoDelBoton
 * @returns {HTMLElement}
 */
function tarjetaDeAmbito(ctx, ambito, textoDelBoton) {
  const { modelo, estado, trabajos, repintarLuego } = ctx;
  const revision = revisar(modelo, ambito, estado);
  const enLaCola = trabajos.get(`${ambito.capa}/${ambito.id}`) || null;
  const montando = estaEnMarcha(enLaCola);
  const hechos = montajesDe(estado, ambito.capa, ambito.id);
  const ultimo = hechos[0] || null;

  const pie = h('div', null);

  pie.appendChild(
    h(
      'p',
      { clase: 'suave', estilo: { margin: '0' } },
      `${segundos(ambito.hasta - ambito.desde)}` +
        (revision.resumen.length ? ` · ${enumerar(revision.resumen, 6)}` : '')
    )
  );

  if (ambito.previas) {
    pie.appendChild(pintarLasCapasDeAbajo(ctx, ambito));
  }

  for (const nota of revision.notas) {
    pie.appendChild(aviso(nota, { tono: 'nota' }));
  }

  if (revision.faltas.length) {
    pie.appendChild(pintarLoQueFalta(ctx, ambito, revision.faltas));
  }

  if (enLaCola && enLaCola.error) {
    pie.appendChild(pintarLaQueja(enLaCola));
  }

  if (montando) {
    pie.appendChild(
      espera(
        enLaCola && enLaCola.ejecucion
          ? 'El montador está trabajando. Tarda minutos y sigue aunque cierres el móvil.'
          : 'Encargándole el montaje al montador…'
      )
    );
  }

  if (ultimo) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '8px 0 0', 'font-size': '13px' } },
        `Ya montado ${fecha(ultimo.cuando)}` +
          (hechos.length > 1 ? ` · ${plural(hechos.length, 'versión', 'versiones')}` : '') +
          '. Volver a montar deja la anterior donde está y escribe una versión nueva.'
      )
    );
  }

  const acciones = h('div', { clase: 'tarjeta-acciones' });

  if (montando) {
    acciones.appendChild(
      boton('Montándose…', () => {}, {
        desactivado:
          'Este montaje ya está en marcha. Lanzarlo otra vez costaría otros minutos de máquina para ' +
          'el mismo resultado.'
      })
    );
  } else if (!revision.faltas.length) {
    // El botón SOLO existe cuando no falta nada. Cuando falta algo, en su sitio
    // está la lista de lo que falta, que es lo único que se puede hacer.
    acciones.appendChild(
      boton(ultimo ? `${textoDelBoton} otra vez` : textoDelBoton, () => montarAmbito(ctx, ambito), {
        tono: ultimo ? 'suave' : 'principal'
      })
    );
  }

  const media = ultimo ? reproductorDeMontaje(ultimo.ruta, ambito.titulo, repintarLuego) : null;

  return tarjeta({
    titulo: ambito.titulo,
    media,
    estado: estadoDelAmbito(revision, montando, Boolean(ultimo), Boolean(enLaCola && enLaCola.error)),
    pie,
    acciones: acciones.childElementCount ? acciones : null
  });
}

/**
 * Lo que ha pasado cuando un montaje falla: la frase en español y, DEBAJO Y A LA
 * VISTA, la queja que el propio montador escribió en «montaje/{trabajo}/queja.txt»
 * antes de salir.
 *
 * Va desplegada y no dentro de un `<details>` como el resto de los detalles de la
 * aplicación, y es a propósito: aquí la queja no es el volcado de lo que dijo
 * Google, es la única explicación que existe de por qué no hay vídeo. Un código de
 * salida no es un mensaje de error, y una explicación que hay que abrir tampoco
 * lo es del todo.
 *
 * @param {object} enLaCola
 * @returns {HTMLElement}
 */
function pintarLaQueja(enLaCola) {
  const caja = h('div', null, aviso(enLaCola.error, { tono: 'error' }));

  caja.appendChild(
    h(
      'p',
      { clase: 'tenue', estilo: { margin: '8px 0 4px', 'font-size': '12px' } },
      enLaCola.detalle
        ? 'Lo que dejó escrito el montador antes de parar, tal cual:'
        : 'El montador no llegó a dejar nada escrito:'
    )
  );

  caja.appendChild(
    h(
      'pre',
      {
        clase: 'mono',
        estilo: {
          margin: '0',
          padding: '10px 12px',
          background: 'var(--fondo-hundido)',
          border: '1px solid var(--borde)',
          'border-radius': 'var(--radio-chico)',
          'white-space': 'pre-wrap',
          'font-size': '12px',
          'overflow-x': 'auto'
        }
      },
      enLaCola.detalle ||
        'Se fue de golpe, sin escribir su queja. Suele ser que se quedó sin memoria con una pieza ' +
          'larga, o que el contenedor se paró antes de poder contarlo.'
    )
  );

  return caja;
}

/** El punto de estado de un ámbito. */
function estadoDelAmbito(revision, montando, hayMontaje, hayFallo) {
  if (montando) return { tipo: 'en-curso', texto: 'Montándose' };
  if (hayFallo) return { tipo: 'fallido', texto: 'Ha fallado' };
  if (hayMontaje) return { tipo: 'listo', texto: 'Montado' };
  if (revision.faltas.length) return { tipo: 'pendiente', texto: 'Faltan cosas' };
  return { tipo: 'por-aprobar', texto: 'Listo para montar' };
}

/**
 * La lista de lo que falta, que es lo que ocupa el sitio del botón. Va abierta
 * cuando son pocas cosas y plegada cuando son muchas: con 400 planos, «faltan 118
 * clips por elegir» ya lo dice todo y la lista entera taparía la pantalla.
 */
function pintarLoQueFalta(ctx, ambito, faltas) {
  const { repintar } = ctx;
  const caja = h('div', { estilo: { 'margin-top': '10px' } });

  caja.appendChild(
    h(
      'p',
      { estilo: { margin: '0 0 6px' } },
      faltas.length === 1
        ? 'No se puede montar todavía. Falta esto:'
        : `No se puede montar todavía. Faltan ${faltas.length} cosas:`
    )
  );

  const abierta = faltas.length <= 3 || desplegadas.has(ambito.clave);

  if (abierta) {
    const lista = h('ul', {
      estilo: {
        margin: '0',
        padding: '0',
        'list-style': 'none',
        display: 'flex',
        'flex-direction': 'column',
        gap: '10px'
      }
    });

    for (const falta of faltas) {
      const fila = h(
        'li',
        {
          estilo: {
            padding: '10px 12px',
            background: 'var(--fondo-hundido)',
            'border-left': '3px solid var(--pendiente)',
            'border-radius': 'var(--radio-chico)'
          }
        },
        h('p', { estilo: { margin: '0' } }, falta.texto)
      );

      if (falta.donde) {
        fila.appendChild(
          h(
            'div',
            { clase: 'tarjeta-acciones', estilo: { 'margin-top': '8px' } },
            h(
              'a',
              { clase: 'boton boton-suave', href: falta.donde },
              falta.donde === '#tomas' ? 'Ir a Tomas' : 'Ir a Audio'
            )
          )
        );
      }

      lista.appendChild(fila);
    }

    caja.appendChild(lista);

    if (faltas.length > 3) {
      caja.appendChild(
        h(
          'div',
          { clase: 'tarjeta-acciones', estilo: { 'margin-top': '10px' } },
          boton('Plegar la lista', () => {
            desplegadas.delete(ambito.clave);
            repintar();
          })
        )
      );
    }
  } else {
    const lista = h('ul', { estilo: { margin: '0 0 10px', 'padding-left': '20px' } });
    for (const falta of faltas.slice(0, 2)) {
      lista.appendChild(h('li', null, recortar(falta.texto, 120)));
    }
    caja.appendChild(lista);
    caja.appendChild(
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton(`Ver las ${faltas.length} cosas que faltan`, () => {
          desplegadas.add(ambito.clave);
          repintar();
        })
      )
    );
  }

  return caja;
}

/**
 * Las capas de abajo de un acto o del episodio, con su estado. Es lo que hace
 * visible la regla: si falla la tercera capa, las dos primeras siguen montadas y
 * no se rehacen.
 */
function pintarLasCapasDeAbajo(ctx, ambito) {
  const { estado } = ctx;

  const caja = h('div', { estilo: { 'margin-top': '10px' } });
  caja.appendChild(
    h(
      'p',
      { clase: 'tenue', estilo: { margin: '0 0 6px', 'font-size': '12px' } },
      'Lo que se concatena aquí, y que ya está guardado:'
    )
  );

  const lista = h('ul', {
    estilo: { margin: '0', padding: '0', 'list-style': 'none', display: 'grid', gap: '4px' }
  });

  for (const hijo of ambito.previas) {
    const suyos = montajesDe(estado, hijo.capa, hijo.id);
    const hecho = suyos[0] || null;
    lista.appendChild(
      h(
        'li',
        { clase: hecho ? 'suave' : 'tenue', estilo: { 'font-size': '13px' } },
        `· ${hijo.titulo}: ` + (hecho ? `montada ${fecha(hecho.cuando)}` : 'todavía sin montar')
      )
    );
  }

  caja.appendChild(lista);
  return caja;
}

// ---------------------------------------------------------------------------
// Lo montado: reproducir, ver el peso y descargar
// ---------------------------------------------------------------------------

/** La sección de abajo: todo lo que ha salido del montador, con su descarga. */
function seccionDeLoMontado(ctx, hechos) {
  const partes = [];

  if (!hechos.length) {
    partes.push(
      h(
        'p',
        { clase: 'tenue' },
        'Todavía no hay nada montado. Lo que salga aparecerá aquí, con su reproductor, su peso y su ' +
          'enlace de descarga.'
      )
    );
    return seccion('Lo montado', partes);
  }

  partes.push(
    h(
      'p',
      { clase: 'suave' },
      'La descarga es un enlace firmado del bucket, no un archivo que pase por la aplicación: un ' +
        'episodio a 1080p pesa uno o dos gigas y no cabe en ninguna función. El enlace caduca a las ' +
        'seis horas; si deja de servir, se vuelve a entrar en esta pantalla y sale uno nuevo.'
    )
  );

  for (const uno of hechos) partes.push(tarjetaDeLoMontado(ctx, uno));

  return seccion('Lo montado', partes);
}

/** Una tarjeta de algo ya montado: se ve, se sabe lo que pesa y se descarga. */
function tarjetaDeLoMontado(ctx, montaje) {
  const { repintarLuego } = ctx;
  const url = enlaceDe(montaje.ruta);
  const peso = pesos.get(montaje.ruta) || null;

  const pie = h('div', null);

  pie.appendChild(
    h(
      'p',
      { clase: 'suave numero', estilo: { margin: '0' } },
      `${nombreDeLaCapa(montaje.capa)} · ${peso ? bytes(peso.bytes) : 'peso sin medir'} · ` +
        `${fecha(montaje.cuando)}`
    )
  );

  pie.appendChild(
    h('p', { clase: 'tenue mono', estilo: { margin: '2px 0 0', 'font-size': '12px' } }, montaje.ruta)
  );

  if (!peso && !pidiendoPesos) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '12px' } },
        'No se ha podido saber lo que pesa este archivo: puede que se haya borrado del bucket, o que ' +
          'la lista no haya llegado. Se puede intentar descargar igual.'
      )
    );
  }

  const acciones = h('div', { clase: 'tarjeta-acciones' });

  if (url) {
    acciones.appendChild(
      h(
        'a',
        {
          clase: 'boton boton-principal',
          href: url,
          download: montaje.ruta.slice(montaje.ruta.lastIndexOf('/') + 1),
          target: '_blank',
          rel: 'noopener'
        },
        peso ? `Descargar (${bytes(peso.bytes)})` : 'Descargar'
      )
    );
  } else {
    acciones.appendChild(
      boton('Descargar', () => {}, {
        desactivado:
          'Todavía no hay enlace firmado para este archivo. Se piden solos al entrar en la pantalla; ' +
          'si no llegan, vuelve a pedirlos desde arriba.'
      })
    );
  }

  return tarjeta({
    titulo: montaje.id || montaje.ruta,
    media: reproductorDeMontaje(montaje.ruta, montaje.id || montaje.ruta, repintarLuego),
    estado: { tipo: 'listo', texto: 'Montado' },
    pie,
    acciones
  });
}

/** Cómo se llama cada capa cuando hay que escribirla. */
function nombreDeLaCapa(capa) {
  if (capa === 'escena') return 'Una escena';
  if (capa === 'acto') return 'Un acto';
  if (capa === 'episodio') return 'El episodio entero';
  return 'La pieza entera';
}

/**
 * El `<video controls>` de un montaje. `preload` va en «none» porque un episodio
 * pesa uno o dos gigas y ni siquiera su cabecera tiene por qué bajarse sola.
 */
function reproductorDeMontaje(ruta, queEs, repintarLuego) {
  const url = enlaceDe(ruta);
  if (!url) return null;

  return h('video', {
    controls: true,
    preload: 'none',
    playsinline: true,
    src: url,
    'aria-label': `Montaje de ${queEs}`,
    estilo: { width: '100%', height: '100%', display: 'block', background: 'var(--negro)' },
    alReproducir: () => {
      sonando.add(ruta);
    },
    alPausar: () => {
      sonando.delete(ruta);
      if (typeof alSoltarUnVideo === 'function') alSoltarUnVideo();
    },
    alTerminar: () => {
      sonando.delete(ruta);
      if (typeof alSoltarUnVideo === 'function') alSoltarUnVideo();
    },
    alError: () => {
      sonando.delete(ruta);
      // El enlace ha caducado o el archivo ya no está. Se olvida y se vuelve a
      // pedir en el siguiente repintado, que es lo que arregla el caso normal.
      enlaces.delete(ruta);
      if (typeof repintarLuego === 'function') repintarLuego();
    }
  });
}

// ---------------------------------------------------------------------------
// Montar
// ---------------------------------------------------------------------------

/**
 * Compone el manifiesto de un ámbito y se lo encarga a la cola.
 *
 * El nombre del trabajo lleva su versión (`teaser-1`, `teaser-2`) por dos
 * motivos: es la carpeta donde el montador deja su queja si algo sale mal, y es
 * también el nombre del archivo de salida, así que montar otra vez no pisa lo
 * anterior. La versión sube solo cuando la anterior llegó a montarse: si el
 * último intento falló, se reintenta con el mismo nombre y el montador borra la
 * queja vieja antes de empezar.
 *
 * @param {object} ctx
 * @param {object} ambito
 * @returns {Promise<void>}
 */
async function montarAmbito(ctx, ambito) {
  const { modelo, estado, repintar } = ctx;
  const revision = revisar(modelo, ambito, estado);

  if (!revision.manifiesto) {
    queja = new ErrorDeCara(
      'Algo ha cambiado mientras mirabas: ahora falta alguna cosa para poder montar este tramo. La ' +
        'lista de lo que falta está en la tarjeta, ya puesta al día.',
      { reintentable: false, http: 400 }
    );
    repintar();
    return;
  }

  const preparado = prepararManifiesto(revision.manifiesto, estado, ambito);

  if (ambito.capa === 'episodio' || ambito.capa === 'pieza') {
    const seguro = await confirmar(
      `¿Montar «${ambito.titulo}»? Son varios minutos de máquina y, cuando termine, el archivo ` +
        `quedará en «${preparado.salida}» para verlo y descargarlo.`
    );
    if (!seguro) return;
  }

  try {
    encolar('montaje', {
      trabajo: preparado.trabajo,
      capa: ambito.capa,
      id: ambito.id,
      manifiesto: preparado
    });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  repintar();
}

/** Encola de una vez todas las escenas que ya se pueden montar. */
function montarVarias(ctx, ambitos) {
  const { modelo, estado, repintar } = ctx;
  const trabajos = [];

  for (const ambito of ambitos) {
    const revision = revisar(modelo, ambito, estado);
    if (!revision.manifiesto) continue;
    const preparado = prepararManifiesto(revision.manifiesto, estado, ambito);
    trabajos.push({
      tipo: 'montaje',
      args: {
        trabajo: preparado.trabajo,
        capa: ambito.capa,
        id: ambito.id,
        manifiesto: preparado
      }
    });
  }

  if (!trabajos.length) return;

  try {
    encolarVarios(trabajos);
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  repintar();
}

/** Le pone al manifiesto su nombre de trabajo y su salida. */
function prepararManifiesto(manifiesto, estado, ambito) {
  const version = siguienteVersion(estado, ambito);
  const trabajo = `${ambito.base}-${version}`;
  return { ...manifiesto, trabajo, salida: `${CARPETA}/${trabajo}.mp4` };
}

/**
 * Qué versión toca. Se mira lo ya montado, no lo intentado: un montaje que falló
 * se vuelve a lanzar con el mismo nombre para que su queja se sustituya por la
 * nueva en vez de dejar carpetas huérfanas por el bucket.
 */
function siguienteVersion(estado, ambito) {
  let mayor = 0;
  for (const uno of montajesDe(estado, ambito.capa, ambito.id)) {
    const nombre = uno.ruta.slice(CARPETA.length + 1).replace(/\.mp4$/i, '');
    if (!nombre.startsWith(`${ambito.base}-`)) continue;
    const numero = Number(nombre.slice(ambito.base.length + 1));
    if (Number.isFinite(numero) && numero > mayor) mayor = numero;
  }
  return mayor + 1;
}

// ---------------------------------------------------------------------------
// Las URL firmadas y los pesos
// ---------------------------------------------------------------------------

/** El enlace de una ruta, si lo hay y todavía sirve. */
function enlaceDe(ruta) {
  const guardado = enlaces.get(ruta);
  if (!guardado) return null;
  if (guardado.hasta <= Date.now()) {
    enlaces.delete(ruta);
    return null;
  }
  return guardado.url;
}

/** Pide de una vez los enlaces que falten, en lotes de 200. */
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
          sinEnlace.add(ruta);
        }
      }
    }
  })()
    .catch((fallo) => {
      quejaDeEnlaces = comoErrorDeCara(fallo);
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
  pesosPedidos = false;
  repintar();
}

/**
 * Pregunta lo que pesa lo montado. Es una sola llamada para toda la carpeta
 * —`listar` devuelve ruta, bytes y fecha—, y hace falta porque el peso es la
 * única cifra que dice si esto se puede bajar con datos del móvil o hay que
 * esperar a tener wifi.
 */
function pedirLosPesos(rutas, repintar) {
  if (pidiendoPesos) return;
  if (!rutas.length) return;

  const faltan = rutas.filter((ruta) => !pesos.has(ruta));
  if (!faltan.length) return;
  // Ya se preguntó por toda la carpeta y estas siguen sin aparecer: preguntar
  // otra vez daría la misma respuesta y dejaría la pantalla dando vueltas.
  if (pesosPedidos) return;

  pidiendoPesos = true;
  pesosPedidos = true;
  quejaDePesos = null;

  llamar('listar', { prefijo: `${CARPETA}/` })
    .then((respuesta) => {
      const objetos = esObjeto(respuesta) && Array.isArray(respuesta.objetos) ? respuesta.objetos : [];
      for (const objeto of objetos) {
        if (!esObjeto(objeto)) continue;
        const ruta = soloTexto(objeto.ruta);
        if (!ruta) continue;
        pesos.set(ruta, {
          bytes: Number(objeto.bytes) || 0,
          actualizado: soloTexto(objeto.actualizado)
        });
      }
    })
    .catch((fallo) => {
      quejaDePesos = comoErrorDeCara(fallo);
    })
    .finally(() => {
      pidiendoPesos = false;
      repintar();
    });
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/** Si algo es un objeto de verdad, no null ni una lista. */
function esObjeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

/** Un texto limpio, o cadena vacía. */
function soloTexto(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (valor == null) return '';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  return '';
}

/** Una ruta si la hay, o null. */
function rutaSiVale(valor) {
  const limpia = typeof valor === 'string' ? valor.trim() : '';
  return limpia || null;
}

/**
 * Los segundos, redondeados a milésimas. Sin esto, restar dos números con dos
 * decimales deja colas como 23.999999999999996 dentro del manifiesto, que no
 * cambian el montaje pero lo hacen ilegible cuando hay que mirarlo a mano.
 */
function redondear(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/** Un texto cortado por lo sano, con puntos suspensivos. */
function recortar(texto, maximo) {
  const t = String(texto || '').trim();
  if (t.length <= maximo) return t;
  return `${t.slice(0, maximo).trimEnd()}…`;
}

/** Una lista legible: «a, b y c», y con tope, «a, b, c y 9 más». */
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
 * Cualquier cosa que se haya lanzado, convertida en el error que se enseña.
 * @param {*} fallo
 * @returns {ErrorDeCara}
 */
function comoErrorDeCara(fallo) {
  if (fallo instanceof ErrorDeCara) return fallo;
  return new ErrorDeCara(
    'El estudio se ha roto por dentro preparando el montaje. No es un problema de tu cuenta ni de la ' +
      'nube: es un fallo del propio código. Debajo está lo que dijo el navegador, tal cual.',
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
