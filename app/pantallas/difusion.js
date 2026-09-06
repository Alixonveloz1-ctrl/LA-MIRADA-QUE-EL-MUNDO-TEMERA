// Difusión: lo que hace falta para PUBLICAR, que no es lo que hace falta para
// producir.
//
// Las otras siete pantallas sirven para hacer la serie. Esta sirve para sacarla:
// el título con el que se sube cada pieza, su descripción, sus etiquetas, y el
// paquete con el vídeo y esa ficha dentro para no tener que acordarse de
// descargar dos cosas.
//
// TRES REGLAS, y las tres vienen de trabajar en un teléfono:
//
//   1. LA FICHA NO SE ESCRIBE A MANO. Un título y cinco frases de descripción,
//      doce veces, en el teclado de un móvil, es exactamente el trabajo que este
//      estudio existe para no hacer. Y hay algo más duro que la comodidad: la
//      descripción no puede contar el final ni nombrar a quien todavía no ha
//      aparecido, y eso, escrito con prisa, se falla. Aquí se pide, se lee, y si
//      no gusta se vuelve a pedir.
//
//   2. LAS ETIQUETAS NO SE INVENTAN. Salen de una lista escrita en
//      datos/serie.json y el modelo solo elige de ahí. Una etiqueta inventada no
//      la busca nadie —y puede estar cogida por otra cosa—, así que dejarla al
//      azar sería pagar por que no la vea nadie. Son GENERALES a propósito: una
//      etiqueta propia de esta serie solo la busca quien ya la conoce, y todavía
//      no la conoce nadie.
//
//   3. NADA SE PUBLICA SIN HABERLO LEÍDO. Igual que en Audio no se aprueba una
//      pista sin oírla, aquí el botón de aprobar la ficha está apagado hasta que
//      la ficha está delante. Una descripción que cuenta el final se publica una
//      vez y ya no se puede recoger.
//
//   4. UN PÓSTER NO ES UN FOTOGRAMA. El póster oficial y las doce miniaturas se
//      GENERAN aquí, con las placas ya aprobadas de los personajes delante como
//      referencia, para que sea la misma cara y la misma luz. No se sacan del
//      capítulo: un fotograma cualquiera no compone, y una miniatura tiene que
//      leerse del tamaño de una uña.
//
//      El FORMATO se elige antes de generar, y no se recorta después: 9:16 es lo
//      vertical y 16:9 es lo que pide una miniatura de YouTube. Recortar uno para
//      sacar el otro deja la cabeza fuera del cuadro, así que cada formato es su
//      propia imagen, con sus intentos y su aprobación.
//
//      El TÍTULO va escrito DENTRO de la imagen, pedido en el prompt. Es una
//      decisión tomada a sabiendas: los modelos de imagen escriben mal las tildes
//      y las eñes, así que puede salir con letras inventadas. Por eso el botón de
//      «Otro intento» está siempre a mano y cada intento se queda guardado.
//
//   5. UN REEL NO GENERA NADA. Los treinta segundos en vertical se arman con los
//      clips que YA están elegidos y la música que YA está aprobada, en el orden
//      del guion. Ni una llamada a un modelo, ni un céntimo: es un montaje de
//      material ya pagado. Por eso su botón puede estar apagado con todo bien
//      escrito —lo que falta no es una decisión, es material—, y por eso se
//      rehace sin pensarlo en cuanto hay un clip más.
//
//      Y las BARRAS NEGRAS son a propósito. Todo está rodado en 16:9; recortar
//      a vertical dejaría media cara fuera de cuadro en casi todos los planos.
//      Se escala el plano entero y lo que sobra se rellena de negro.
//
// EL ORDEN DE LA PANTALLA no es casual: primero el paquete de descarga, que es
// lo primero que hace falta —en cuanto haya un teaser montado ya se puede
// subir—, luego los reels, que salen de ese mismo material, y al final los
// pósters, que son lo único de aquí que sí cuesta dinero.

import { ErrorDeCara, llamar } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import { encolar } from '../cola.js';
import { ajustesDelReel, manifiestoDelReel, nombreDelReel, esReelDe, CAPA_DEL_REEL } from '../reel.js';
import {
  aviso,
  boton,
  confirmar,
  espera,
  h,
  pantalla,
  seccion,
  tarjeta,
  vaciar
} from '../ui.js';
import { bytes, fecha, plural } from '../formato.js';

// ---------------------------------------------------------------------------
// Números y palabras fijas
// ---------------------------------------------------------------------------

/** Cuántas rutas caben en una sola llamada a `firmar` (docs/contrato.md §2). */
const MAXIMO_POR_FIRMA = 200;

/** Cuánto se da por buena una URL firmada. La función las hace de seis horas. */
const VIDA_DE_URL_MS = 5 * 60 * 60 * 1000;

/** Dónde deja el montador los paquetes, dentro del bucket. */
const CARPETA = 'difusion';

/** La capa con la que se apunta un paquete, para no confundirlo con un montaje. */
const CAPA_DEL_PAQUETE = 'paquete';

// ---------------------------------------------------------------------------
// Lo que esta pantalla recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** `datos/serie.json`, pedido una sola vez. */
let promesaDeLaSerie = null;

/** Ruta lógica → `{ url, hasta }`. */
const enlaces = new Map();

/** Rutas por las que ya se preguntó y no hay enlace. */
const sinEnlace = new Set();

/** Si hay una petición de firmas en marcha ahora mismo. */
let pidiendoEnlaces = false;

/** Por qué no se han podido conseguir los enlaces. */
let quejaDeEnlaces = null;

/** El último fallo de una acción de esta pantalla. */
let queja = null;

/** Las fichas que se han leído en esta visita: sin leerla no se aprueba. */
const leidas = new Set();

/** Ruta lógica → bytes, de lo que hay en «difusion/». */
const pesos = new Map();

/**
 * El formato en el que se está trabajando: «9:16» o «16:9». Uno para toda la
 * sección y no uno por tarjeta, porque en un teléfono trece selectores iguales
 * son trece formas de equivocarse. Null hasta que se lee serie.json.
 */
let formaElegida = null;

/** «{poster}/{forma}» → qué intento se está mirando de esa tarjeta. */
const mirandoPoster = new Map();

/** Si ya se ha preguntado por los pesos en esta visita. */
let pesosPedidos = false;

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'difusion',
  titulo: 'Difusión',
  icono: '\u{1F4E3}',

  /**
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>} cómo desapuntarse al cambiar de pestaña
   */
  async montar(raiz) {
    const marco = h('div', { clase: 'difusion' });
    raiz.appendChild(marco);

    pesosPedidos = false;

    let soltar = null;

    const arrancar = async () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
      vaciar(marco);
      marco.appendChild(espera('Trayendo las piezas y lo que ya está montado…'));

      let serie;
      try {
        serie = await laSerie();
      } catch (fallo) {
        const error = comoErrorDeCara(fallo);
        vaciar(marco);
        marco.appendChild(
          pantalla(
            'Difusión',
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

      const repintar = () => {
        vaciar(marco);
        marco.appendChild(construir(serie, repintar));
      };

      repintar();
      soltar = alCambiar(repintar);
    };

    await arrancar();

    return () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
    };
  }
};

/** `datos/serie.json`, una sola vez por sesión. */
function laSerie() {
  if (!promesaDeLaSerie) {
    promesaDeLaSerie = fetch('datos/serie.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`datos/serie.json ha contestado ${r.status}`);
        return r.json();
      })
      .catch((fallo) => {
        promesaDeLaSerie = null;
        throw new ErrorDeCara(
          'No se ha podido leer datos/serie.json, que es donde está escrito cómo se llama cada ' +
            'pieza y qué etiquetas se pueden usar. Sin él esta pantalla no sabe qué enseñar. Es un ' +
            'fallo del propio estudio, no de tu cuenta.',
          { detalle: mensajeDe(fallo), reintentable: true, http: 0 }
        );
      });
  }
  return promesaDeLaSerie;
}

// ---------------------------------------------------------------------------
// Construir
// ---------------------------------------------------------------------------

/**
 * @param {object} serie
 * @param {() => void} repintar
 * @returns {HTMLElement}
 */
function construir(serie, repintar) {
  const estado = elEstado();
  const piezas = piezasQueSePublican(serie);
  const montajes = Array.isArray(estado.montajes) ? estado.montajes : [];

  const ctx = {
    serie,
    estado,
    piezas,
    montajes,
    repintar,
    trabajos: indexarCola(estado),
    forma: formaDeTrabajo(serie)
  };

  // Las firmas y los pesos llegan solos.
  const rutas = [];
  for (const una of piezas) {
    const suyo = loMontadoDe(montajes, una.id);
    if (suyo) rutas.push(suyo.ruta);
    const paquete = elPaqueteDe(montajes, una.id);
    if (paquete) rutas.push(paquete.ruta);
  }
  // Los pósters: el intento que se esté mirando de cada uno, en el formato
  // elegido. Solo esos: pedir enlace de los veintitantos intentos viejos sería
  // una llamada enorme para enseñar una sola imagen por tarjeta.
  for (const unPoster of piezasDePoster(serie)) {
    const guardado = posterGuardado(estado, unPoster.id, ctx.forma);
    const ruta = rutaQueSeMira(unPoster.id, ctx.forma, guardado);
    if (ruta) rutas.push(ruta);
  }

  pedirEnlacesQueFalten(rutas, repintar);
  pedirLosPesos(repintar);

  // Los reels ya montados, para poder verlos y descargarlos.
  for (const una of piezas) {
    const suyo = elReelDe(montajes, una.id);
    if (suyo) rutas.push(suyo.ruta);
  }

  return pantalla(
    'Difusión',
    seccionCabecera(ctx),
    seccionPiezas(ctx),
    seccionReels(ctx),
    seccionPosters(ctx)
  );
}

/** El último reel montado de una pieza, si lo hay. */
function elReelDe(montajes, idPieza) {
  const suyos = montajes.filter(
    (uno) => esObjeto(uno) && soloTexto(uno.ruta) && esReelDe(uno.ruta, idPieza)
  );
  return suyos.length ? suyos[suyos.length - 1] : null;
}

/** Qué versión de reel toca. Se mira lo ya montado, no lo intentado. */
function siguienteVersionDeReel(montajes, idPieza) {
  let mayor = 0;
  for (const uno of montajes) {
    if (!esObjeto(uno) || !esReelDe(soloTexto(uno.ruta), idPieza)) continue;
    const nombre = soloTexto(uno.ruta).replace(/^montaje\//, '').replace(/\.mp4$/i, '');
    const numero = Number(nombre.slice(`reel-${idPieza}-`.length));
    if (Number.isFinite(numero) && numero > mayor) mayor = numero;
  }
  return mayor + 1;
}

/**
 * Los formatos en los que se puede hacer un póster, tal como están escritos en
 * datos/serie.json. Si allí no hay nada, no se inventa ninguno: se devuelve la
 * lista vacía y la sección lo dice con palabras.
 * @param {object} serie
 * @returns {string[]}
 */
function formatosDePoster(serie) {
  const posters = ajustesDePoster(serie);
  return Array.isArray(posters.formatos) ? posters.formatos.filter((uno) => soloTexto(uno)) : [];
}

/** El bloque `difusion.posters` de la serie, o un objeto vacío. */
function ajustesDePoster(serie) {
  const difusion = esObjeto(serie && serie.difusion) ? serie.difusion : {};
  return esObjeto(difusion.posters) ? difusion.posters : {};
}

/** El póster oficial y las doce miniaturas, en el orden en que están escritos. */
function piezasDePoster(serie) {
  const posters = ajustesDePoster(serie);
  const piezas = Array.isArray(posters.piezas) ? posters.piezas : [];
  return piezas.filter((una) => esObjeto(una) && soloTexto(una.id));
}

/** El formato con el que se trabaja: el elegido, y si no el que dice la serie. */
function formaDeTrabajo(serie) {
  const formatos = formatosDePoster(serie);
  if (formaElegida && formatos.includes(formaElegida)) return formaElegida;
  const porDefecto = soloTexto(ajustesDePoster(serie).formato_por_defecto);
  if (porDefecto && formatos.includes(porDefecto)) return porDefecto;
  return formatos[0] || '';
}

/** «9:16» → «9-16». Los dos puntos no se llevan bien con las rutas. */
function formaEnRuta(forma) {
  return String(forma).replace(/:/g, '-');
}

/** La clave con la que vive un póster en el estado: la pieza Y su formato. */
function claveDePoster(id, forma) {
  return `${id}/${formaEnRuta(forma)}`;
}

/**
 * Las piezas que se publican. El archivo NO: es una biblioteca de planos de
 * ambiente que no se sube a ninguna parte.
 * @param {object} serie
 * @returns {{id:string, titulo:string, datos:object}[]}
 */
function piezasQueSePublican(serie) {
  const piezas = esObjeto(serie.piezas) ? serie.piezas : {};
  return Object.keys(piezas)
    .filter((id) => esObjeto(piezas[id]) && piezas[id].archivo !== true)
    .map((id) => ({ id, titulo: soloTexto(piezas[id].titulo) || id, datos: piezas[id] }));
}

/** El montaje entero de una pieza, si lo hay: el último que se hizo. */
function loMontadoDe(montajes, idPieza) {
  const suyos = montajes.filter(
    (uno) =>
      esObjeto(uno) &&
      soloTexto(uno.ruta) &&
      uno.capa !== CAPA_DEL_PAQUETE &&
      (soloTexto(uno.id) === idPieza || soloTexto(uno.id).startsWith(`${idPieza}-`))
  );
  return suyos.length ? suyos[suyos.length - 1] : null;
}

/** El paquete de difusión de una pieza, si ya se ha hecho. */
function elPaqueteDe(montajes, idPieza) {
  const suyos = montajes.filter(
    (uno) =>
      esObjeto(uno) &&
      soloTexto(uno.ruta) &&
      uno.capa === CAPA_DEL_PAQUETE &&
      soloTexto(uno.id) === paqueteDe(idPieza)
  );
  return suyos.length ? suyos[suyos.length - 1] : null;
}

/** El nombre del trabajo del paquete de una pieza. */
function paqueteDe(idPieza) {
  return `difusion-${idPieza}`;
}

// ---------------------------------------------------------------------------
// La cabecera
// ---------------------------------------------------------------------------

function seccionCabecera(ctx) {
  const { repintar } = ctx;
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
        `${quejaDeEnlaces.mensaje} Sin esos enlaces no se puede descargar nada.`,
        { tono: 'error', detalle: quejaDeEnlaces.detalle }
      ),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Volver a pedir los enlaces', () => {
          enlaces.clear();
          sinEnlace.clear();
          quejaDeEnlaces = null;
          repintar();
        }, { tono: 'principal' })
      )
    );
  }

  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      'Lo que hace falta para publicar cada pieza: el título con el que se sube, la descripción, ' +
        'las etiquetas, y el paquete con el vídeo y esa ficha dentro.'
    ),
    h(
      'p',
      { clase: 'tenue' },
      'Las etiquetas son GENERALES de animé y salen de una lista escrita en datos/serie.json. No ' +
        'son de esta serie a propósito: una etiqueta propia solo la busca quien ya la conoce, y ' +
        'todavía no la conoce nadie.'
    )
  );

  return seccion(null, partes);
}

// ---------------------------------------------------------------------------
// Una pieza
// ---------------------------------------------------------------------------

function seccionPiezas(ctx) {
  const { piezas } = ctx;

  if (!piezas.length) {
    return seccion(
      'Piezas',
      aviso(
        'No hay ninguna pieza en datos/serie.json, así que no hay nada que publicar.',
        { tono: 'error' }
      )
    );
  }

  return seccion('Para subir', piezas.map((una) => tarjetaDePieza(ctx, una)));
}

/**
 * Una pieza: su ficha, su montaje y su paquete.
 * @param {object} ctx
 * @param {{id:string, titulo:string, datos:object}} laPieza
 * @returns {HTMLElement}
 */
function tarjetaDePieza(ctx, laPieza) {
  const { estado, montajes, trabajos, repintar } = ctx;

  const guardado = difusionDe(estado, laPieza.id);
  const montado = loMontadoDe(montajes, laPieza.id);
  const paquete = elPaqueteDe(montajes, laPieza.id);

  const enLaColaFicha = trabajos.get(`ficha:${laPieza.id}`) || null;
  const enLaColaPaquete = trabajos.get(`montaje:${paqueteDe(laPieza.id)}`) || null;

  const pie = h('div', null);

  // 1. LA FICHA.
  if (guardado.ficha) {
    leidas.add(laPieza.id);
    pie.appendChild(pintarLaFicha(guardado.ficha));
  } else if (enLaColaFicha && estaEnMarcha(enLaColaFicha)) {
    pie.appendChild(espera('Escribiendo el título, la descripción y las etiquetas…'));
  } else {
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto suave' },
        'Todavía no tiene ficha. Es una llamada al modelo de texto: escribe el título con el que se ' +
          'sube, la descripción y las etiquetas, leyendo lo que esta pieza enseña y lo que se dice ' +
          'en ella.'
      )
    );
  }

  if (enLaColaFicha && enLaColaFicha.error) {
    pie.appendChild(aviso(enLaColaFicha.error, { tono: 'error', detalle: enLaColaFicha.detalle }));
  }

  // 2. EL MONTAJE. Sin él no hay nada que empaquetar, y decirlo con palabras es
  // mejor que un botón apagado sin motivo.
  pie.appendChild(
    h(
      'p',
      { clase: montado ? 'tenue' : 'tarjeta-texto' },
      montado
        ? `Montada el ${fecha(montado.cuando)}${pesoDe(montado.ruta) ? ` · ${bytes(pesoDe(montado.ruta))}` : ''}.`
        : 'Todavía no está montada. El paquete lleva el vídeo dentro, así que hasta que no haya ' +
          'vídeo no hay paquete: eso se hace en la pantalla de Montaje.'
    )
  );

  // 3. EL PAQUETE.
  if (paquete) {
    const url = enlaceDe(paquete.ruta);
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto' },
        `Paquete hecho el ${fecha(paquete.cuando)}` +
          `${pesoDe(paquete.ruta) ? `, ${bytes(pesoDe(paquete.ruta))}` : ''}. Dentro van el vídeo y ` +
          'la ficha en texto plano, para copiarla y pegarla sin abrir nada raro.'
      )
    );
    if (url) {
      pie.appendChild(
        h(
          'p',
          { clase: 'tarjeta-texto' },
          h('a', { href: url, download: '', clase: 'enlace' }, 'Descargar el paquete')
        )
      );
    }
  }

  if (enLaColaPaquete && estaEnMarcha(enLaColaPaquete)) {
    pie.appendChild(espera('Empaquetando en la nube. Tarda, y no hace falta tener esto abierto.'));
  }
  if (enLaColaPaquete && enLaColaPaquete.error) {
    pie.appendChild(aviso(enLaColaPaquete.error, { tono: 'error', detalle: enLaColaPaquete.detalle }));
  }

  // Los botones.
  const acciones = h('div', { clase: 'tarjeta-acciones' });

  acciones.appendChild(
    boton(
      guardado.ficha ? 'Rehacer la ficha' : 'Escribir la ficha',
      () => pedirLaFicha(ctx, laPieza),
      {
        tono: guardado.ficha ? 'suave' : 'principal',
        desactivado: enLaColaFicha && estaEnMarcha(enLaColaFicha)
          ? 'Ya se está escribiendo. Se paga una vez.'
          : null
      }
    )
  );

  if (guardado.ficha) {
    acciones.appendChild(
      guardado.ficha_aprobada
        ? boton('Quitar el visto bueno', () => aprobarLaFicha(ctx, laPieza.id, false), { tono: 'suave' })
        : boton('Aprobar la ficha', () => aprobarLaFicha(ctx, laPieza.id, true), {
            tono: 'principal',
            desactivado: leidas.has(laPieza.id)
              ? null
              : 'Primero hay que leerla: una descripción que cuenta el final se publica una vez y ' +
                'ya no se recoge.'
          })
    );
  }

  acciones.appendChild(
    boton(
      paquete ? 'Rehacer el paquete' : 'Descargar todo en un zip',
      () => empaquetar(ctx, laPieza, montado),
      {
        tono: paquete ? 'suave' : 'principal',
        desactivado: porQueNoSePuedeEmpaquetar(guardado, montado, enLaColaPaquete)
      }
    )
  );

  return tarjeta({
    titulo: laPieza.titulo,
    estado: comoVaLaPieza(guardado, montado, paquete),
    pie,
    acciones
  });
}

/** Por qué todavía no se puede empaquetar, con palabras. Null si se puede. */
function porQueNoSePuedeEmpaquetar(guardado, montado, enLaCola) {
  if (enLaCola && estaEnMarcha(enLaCola)) return 'Ya se está empaquetando.';
  if (!montado) return 'Falta montar la pieza: el paquete lleva el vídeo dentro.';
  if (!guardado.ficha) return 'Falta la ficha: es lo que va dentro del zip al lado del vídeo.';
  if (!guardado.ficha_aprobada) {
    return 'Falta darle el visto bueno a la ficha. Léela: con ella se sube el vídeo.';
  }
  return null;
}

/** El punto de estado de una pieza. */
function comoVaLaPieza(guardado, montado, paquete) {
  if (paquete) return { tipo: 'listo', texto: 'Lista para subir' };
  if (!montado) return { tipo: 'pendiente', texto: 'Sin montar' };
  if (!guardado.ficha) return { tipo: 'pendiente', texto: 'Sin ficha' };
  if (!guardado.ficha_aprobada) return { tipo: 'por-aprobar', texto: 'Ficha por aprobar' };
  return { tipo: 'pendiente', texto: 'Lista para empaquetar' };
}

/** La ficha, tal y como se va a copiar. */
function pintarLaFicha(ficha) {
  const caja = h('div', null);

  caja.appendChild(h('p', { clase: 'tarjeta-texto suave', estilo: { margin: '0' } }, 'Título'));
  caja.appendChild(h('p', { estilo: { margin: '0 0 var(--espacio-2)' } }, soloTexto(ficha.titulo)));

  caja.appendChild(h('p', { clase: 'tarjeta-texto suave', estilo: { margin: '0' } }, 'Descripción'));
  caja.appendChild(
    h(
      'p',
      { estilo: { margin: '0 0 var(--espacio-2)', 'white-space': 'pre-wrap' } },
      soloTexto(ficha.descripcion)
    )
  );

  const etiquetas = Array.isArray(ficha.etiquetas) ? ficha.etiquetas : [];
  caja.appendChild(
    h(
      'p',
      { clase: 'tarjeta-texto suave', estilo: { margin: '0' } },
      `${plural(etiquetas.length, 'etiqueta', 'etiquetas')}`
    )
  );
  caja.appendChild(
    h('p', { clase: 'mono', estilo: { margin: '0', 'font-size': '13px' } }, comoTexto(etiquetas))
  );

  return caja;
}

/** Las etiquetas tal y como se pegan: con almohadilla y separadas por espacios. */
function comoTexto(etiquetas) {
  return etiquetas.map((una) => `#${String(una).replace(/^#/, '')}`).join(' ');
}

// ---------------------------------------------------------------------------
// Los reels
// ---------------------------------------------------------------------------

/**
 * Un reel por pieza: treinta segundos en vertical, armados solos.
 *
 * No genera NADA. Coge los clips que ya están elegidos y la música que ya está
 * aprobada y los pone uno detrás de otro. Por eso el botón puede estar apagado
 * teniendo todo bien escrito: lo que falta no es una decisión, es material.
 *
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionReels(ctx) {
  const { serie, piezas } = ctx;
  const ajustes = ajustesDelReel(serie);
  const partes = [];

  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      `Un reel por pieza: ${ajustes.duracionS} segundos en vertical, armados solos con los clips ` +
        'que YA están elegidos y la música que YA está aprobada. No genera vídeo nuevo y no cuesta ' +
        'ni un céntimo de modelo: es un montaje de material que ya está pagado.'
    ),
    h(
      'p',
      { clase: 'tenue' },
      `Salen a ${ajustes.formato.ancho} × ${ajustes.formato.alto} con barras negras arriba y ` +
        'abajo. El material está rodado apaisado, y recortarlo a vertical dejaría media cara ' +
        'fuera de cuadro en casi todos los planos.'
    ),
    h(
      'p',
      { clase: 'tenue' },
      'Los planos van en el orden del guion. Los que duran menos de ' +
        `${ajustes.minimoS} s se saltan —parpadean—, y los que duran más de ${ajustes.maximoS} s ` +
        'se cortan por el final: en medio minuto caben diez o doce planos, no cuatro. Sin voz ni ' +
        'subtítulos: en treinta segundos, el diálogo o no se entiende o cuenta el capítulo.'
    )
  );

  if (!piezas.length) return seccion('Reels', partes);

  for (const una of piezas) partes.push(tarjetaDeReel(ctx, una));

  return seccion('Reels', partes);
}

/**
 * Una pieza y su reel: lo que ya se puede armar, lo que falta y el botón.
 * @param {object} ctx
 * @param {{id:string, titulo:string}} laPieza
 * @returns {HTMLElement}
 */
function tarjetaDeReel(ctx, laPieza) {
  const { serie, estado, montajes, trabajos } = ctx;

  const version = siguienteVersionDeReel(montajes, laPieza.id);
  const armado = manifiestoDelReel(serie, estado, laPieza.id, version);
  const hecho = elReelDe(montajes, laPieza.id);
  const enLaCola = trabajos.get(`montaje:${nombreDelReel(laPieza.id, version)}`) || null;
  const enMarcha = Boolean(enLaCola && estaEnMarcha(enLaCola));

  const pie = h('div', null);

  if (armado.corte.planos.length) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto' },
        `Se armaría con ${plural(armado.corte.planos.length, 'plano', 'planos')} y duraría ` +
          `${segundosCortos(armado.corte.duracionS)}.`
      )
    );
  }

  for (const falta of armado.faltas) {
    pie.appendChild(h('p', { clase: 'tarjeta-texto' }, falta));
  }
  for (const nota of armado.notas) {
    pie.appendChild(h('p', { clase: 'tenue' }, nota));
  }

  if (enMarcha) {
    pie.appendChild(espera('Montándose en la nube. Tarda, y no hace falta tener esto abierto.'));
  }
  if (enLaCola && enLaCola.error) {
    pie.appendChild(aviso(enLaCola.error, { tono: 'error', detalle: enLaCola.detalle }));
  }

  let media = null;
  if (hecho) {
    const url = enlaceDe(hecho.ruta);
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto' },
        `Reel hecho el ${fecha(hecho.cuando)}` +
          `${pesoDe(hecho.ruta) ? `, ${bytes(pesoDe(hecho.ruta))}` : ''}.`
      )
    );
    if (url) {
      media = h('video', { src: url, controls: true, playsinline: true, preload: 'metadata' });
      pie.appendChild(
        h(
          'p',
          { clase: 'tarjeta-texto' },
          h('a', { href: url, download: '', clase: 'enlace' }, 'Descargar el reel')
        )
      );
    }
  }

  const acciones = h('div', { clase: 'tarjeta-acciones' });
  acciones.appendChild(
    boton(
      hecho ? 'Rehacer el reel' : 'Armar el reel',
      () => armarElReel(ctx, laPieza, armado),
      {
        tono: hecho ? 'suave' : 'principal',
        desactivado: porQueNoSeArmaElReel(armado, enMarcha)
      }
    )
  );

  return tarjeta({
    titulo: `Reel · ${laPieza.titulo}`,
    estado: comoVaElReel(armado, hecho, enMarcha),
    media,
    // Vertical, como sale: enseñarlo en un marco apaisado sería enseñar otra cosa.
    proporcion: media ? `${ajustesDelReel(serie).formato.ancho}:${ajustesDelReel(serie).formato.alto}` : null,
    pie,
    acciones
  });
}

/** Por qué todavía no se puede armar el reel, con palabras. Null si se puede. */
function porQueNoSeArmaElReel(armado, enMarcha) {
  if (enMarcha) return 'Ya se está montando.';
  if (!armado.manifiesto) return armado.faltas[0] || 'Todavía falta material.';
  return null;
}

/** El punto de estado de un reel. */
function comoVaElReel(armado, hecho, enMarcha) {
  if (enMarcha) return { tipo: 'en_curso', texto: 'Montándose' };
  if (hecho) return { tipo: 'listo', texto: 'Listo para subir' };
  if (!armado.manifiesto) return { tipo: 'pendiente', texto: 'Falta material' };
  return { tipo: 'pendiente', texto: 'Listo para armar' };
}

/** «28,5 s», que es como se leen los segundos en una tarjeta. */
function segundosCortos(n) {
  const numero = Number(n) || 0;
  return `${String(Math.round(numero * 10) / 10).replace('.', ',')} s`;
}

// ---------------------------------------------------------------------------
// Los pósters y las miniaturas
// ---------------------------------------------------------------------------

/**
 * El póster oficial y las doce miniaturas, en el formato que se haya elegido.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionPosters(ctx) {
  const { serie, forma, repintar } = ctx;
  const piezas = piezasDePoster(serie);

  if (!piezas.length) {
    return seccion(
      'Pósters y miniaturas',
      aviso(
        'No hay ningún póster escrito en difusion.posters.piezas de datos/serie.json, así que no ' +
          'hay nada que generar.',
        { tono: 'error' }
      )
    );
  }

  const formatos = formatosDePoster(serie);
  const partes = [];

  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      'El póster oficial de la serie y la miniatura de cada episodio. No son fotogramas del ' +
        'capítulo: se generan aquí con las placas ya aprobadas de los personajes delante, para ' +
        'que sea la misma cara, la misma luz y el mismo estilo.'
    )
  );

  // EL SELECTOR DE FORMATO. Va arriba y uno solo para toda la sección: lo que se
  // elija aquí es lo que se genera y lo que se mira debajo.
  if (formatos.length > 1) {
    const botones = h('div', { clase: 'tarjeta-acciones' });
    for (const uno of formatos) {
      botones.appendChild(
        boton(
          `${uno}${uno === '9:16' ? ' · vertical' : uno === '16:9' ? ' · horizontal' : ''}`,
          () => {
            formaElegida = uno;
            repintar();
          },
          { tono: uno === forma ? 'principal' : 'suave' }
        )
      );
    }
    partes.push(botones);
    partes.push(
      h(
        'p',
        { clase: 'tenue' },
        soloTexto(ajustesDePoster(serie).nota_formato) ||
          'Se elige antes de generar. Cada formato es su propia imagen.'
      )
    );
  }

  if (ajustesDePoster(serie).titulo_en_la_imagen === true) {
    partes.push(
      h(
        'p',
        { clase: 'tenue' },
        `El título «${soloTexto(ajustesDePoster(serie).titulo)}» se le pide al modelo escrito ` +
          'DENTRO de la imagen. Con las tildes suele fallar: míralo antes de aprobarlo y, si sale ' +
          'con letras inventadas, dale a «Otro intento».'
      )
    );
  }

  if (!forma) {
    partes.push(
      aviso(
        'No hay ningún formato escrito en difusion.posters.formatos de datos/serie.json, así que ' +
          'no se sabe en qué proporción generarlos.',
        { tono: 'error' }
      )
    );
    return seccion('Pósters y miniaturas', partes);
  }

  for (const uno of piezas) partes.push(tarjetaDePoster(ctx, uno));

  return seccion('Pósters y miniaturas', partes);
}

/**
 * Un póster: lo que se está mirando de él, cómo va y sus botones.
 * @param {object} ctx
 * @param {object} elPoster la entrada de `difusion.posters.piezas`
 * @returns {HTMLElement}
 */
function tarjetaDePoster(ctx, elPoster) {
  const { estado, forma, trabajos, repintar } = ctx;

  const id = soloTexto(elPoster.id);
  const clave = claveDePoster(id, forma);
  const guardado = posterGuardado(estado, id, forma);
  const enLaCola = trabajos.get(`poster:${clave}`) || null;
  const enMarcha = Boolean(enLaCola && estaEnMarcha(enLaCola));

  const ruta = rutaQueSeMira(id, forma, guardado);
  const pie = h('div', null);

  if (soloTexto(elPoster.uso)) {
    pie.appendChild(h('p', { clase: 'tarjeta-texto suave' }, soloTexto(elPoster.uso)));
  }

  // Lo que le falta para poder generarse: las placas de sitio y las de cara que
  // todavía no están aprobadas. Se dice con nombres, porque un botón apagado sin
  // explicación se lee como un fallo del estudio.
  const faltan = refsQueFaltan(ctx, elPoster);
  if (faltan.length) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto' },
        faltan.length === 1
          ? `Para generarlo hace falta «${faltan[0]}» aprobada, y todavía no lo está. Se aprueba ` +
            'en la pantalla del Banco, mirándola.'
          : `Para generarlo hacen falta ${plural(faltan.length, 'placa', 'placas')} aprobadas que ` +
            `todavía no lo están: ${enumerarCorto(faltan)}. Se aprueban en la pantalla del Banco, ` +
            'mirándolas.'
      )
    );
  }

  if (enMarcha) pie.appendChild(espera('Generándose ahora. No hace falta tener esto abierto.'));
  if (enLaCola && enLaCola.error) {
    pie.appendChild(aviso(enLaCola.error, { tono: 'error', detalle: enLaCola.detalle }));
  }

  // Los intentos: cuántos hay y cuál se está mirando. Ninguno se borra, porque
  // cada uno está pagado y el bueno puede ser el tercero.
  if (guardado.intentos.length > 1) {
    const cual = guardado.intentos.indexOf(ruta);
    const fila = h('div', { clase: 'tarjeta-acciones' });
    fila.appendChild(
      boton('Anterior', () => moverIntento(clave, guardado, -1, repintar), {
        tono: 'suave',
        desactivado: cual > 0 ? null : 'Es el primero.'
      })
    );
    fila.appendChild(
      boton('Siguiente', () => moverIntento(clave, guardado, 1, repintar), {
        tono: 'suave',
        desactivado: cual >= 0 && cual < guardado.intentos.length - 1 ? null : 'Es el último.'
      })
    );
    pie.appendChild(fila);
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue' },
        `Intento ${cual >= 0 ? cual + 1 : '?'} de ${guardado.intentos.length}` +
          `${ruta && ruta === guardado.aprobada ? ' · es el aprobado' : ''}.`
      )
    );
  }

  if (ruta && pesoDe(ruta)) {
    pie.appendChild(h('p', { clase: 'tenue' }, `Pesa ${bytes(pesoDe(ruta))}.`));
  }

  const url = ruta ? enlaceDe(ruta) : null;
  if (url) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto' },
        h('a', { href: url, download: '', clase: 'enlace' }, 'Descargar esta imagen')
      )
    );
  }

  // Los botones.
  const acciones = h('div', { clase: 'tarjeta-acciones' });

  acciones.appendChild(
    boton(
      guardado.intentos.length ? 'Otro intento' : 'Generar',
      () => generarPoster(ctx, id, forma),
      {
        tono: guardado.aprobada ? 'suave' : 'principal',
        desactivado: porQueNoSeGeneraElPoster(faltan, enMarcha)
      }
    )
  );

  if (ruta) {
    acciones.appendChild(
      ruta === guardado.aprobada
        ? boton('Quitar el visto bueno', () => aprobarPoster(ctx, id, forma, null), {
            tono: 'suave'
          })
        : boton('Aprobar esta', () => aprobarPoster(ctx, id, forma, ruta), { tono: 'principal' })
    );
  }

  return tarjeta({
    titulo: `${soloTexto(elPoster.nombre) || id} · ${forma}`,
    estado: comoVaElPoster(guardado, enMarcha),
    media: marcoDePoster(ruta, guardado, `${soloTexto(elPoster.nombre) || id}, ${forma}`),
    // El marco toma la forma del póster. Sin esto, un 9:16 se enseña dentro de
    // un hueco 16:9 y se recorta justo la banda del título, que es lo único que
    // hay que mirar antes de aprobarlo.
    proporcion: forma,
    pie,
    acciones
  });
}

/** Por qué todavía no se puede generar un póster, con palabras. Null si se puede. */
function porQueNoSeGeneraElPoster(faltan, enMarcha) {
  if (enMarcha) return 'Ya se está generando. Se paga una vez.';
  if (faltan.length) {
    return `Falta aprobar ${enumerarCorto(faltan)}. Sin esa imagen delante no hay contra qué ` +
      'generar el póster.';
  }
  return null;
}

/** El punto de estado de un póster. */
function comoVaElPoster(guardado, enMarcha) {
  if (guardado.aprobada) return { tipo: 'aprobada', texto: 'Aprobada' };
  if (enMarcha) return { tipo: 'en_curso', texto: 'Generándose' };
  if (guardado.intentos.length) return { tipo: 'por-aprobar', texto: 'Por aprobar' };
  return { tipo: 'pendiente', texto: 'Sin generar' };
}

/**
 * Las placas de referencia de un póster que todavía no están aprobadas. El
 * servidor también lo comprueba —es él quien manda—, pero decirlo aquí evita
 * encolar un trabajo que ya se sabe que va a fallar.
 * @param {object} ctx
 * @param {object} elPoster
 * @returns {string[]}
 */
function refsQueFaltan(ctx, elPoster) {
  const banco = esObjeto(ctx.estado.banco) ? ctx.estado.banco : {};
  const escenarios = esObjeto(ctx.estado.escenarios) ? ctx.estado.escenarios : {};

  const sinAprobar = (mapa) => (una) =>
    Boolean(una) && !soloTexto(esObjeto(mapa[una]) ? mapa[una].aprobada : '');

  // Las dos clases de referencia, y las dos hacen falta: la cara sale del banco
  // y el sitio de los escenarios. Un póster de la cripta sin la placa de la
  // cripta dibuja UNA cripta, no LA cripta.
  return [
    ...(Array.isArray(elPoster.escenarios) ? elPoster.escenarios : [])
      .map((una) => soloTexto(una))
      .filter(sinAprobar(escenarios)),
    ...(Array.isArray(elPoster.refs) ? elPoster.refs : [])
      .map((una) => soloTexto(una))
      .filter(sinAprobar(banco))
  ];
}

/** Lo guardado de un póster en un formato, con la forma del contrato §5. */
function posterGuardado(estado, id, forma) {
  const mapa = esObjeto(estado.posters) ? estado.posters : {};
  const entrada = esObjeto(mapa[claveDePoster(id, forma)]) ? mapa[claveDePoster(id, forma)] : {};
  const intentos = Array.isArray(entrada.intentos) ? entrada.intentos.filter(soloTexto) : [];
  return { aprobada: soloTexto(entrada.aprobada) || null, intentos };
}

/**
 * Qué imagen se está mirando de un póster: la que se haya elegido con los
 * botones, y si no la aprobada, y si no el último intento.
 */
function rutaQueSeMira(id, forma, guardado) {
  const puesta = mirandoPoster.get(claveDePoster(id, forma));
  if (puesta && guardado.intentos.includes(puesta)) return puesta;
  if (guardado.aprobada) return guardado.aprobada;
  return guardado.intentos[guardado.intentos.length - 1] || null;
}

/** Pasa al intento anterior o al siguiente. */
function moverIntento(clave, guardado, cuanto, repintar) {
  const ruta = mirandoPoster.get(clave);
  const desde = guardado.intentos.indexOf(
    ruta && guardado.intentos.includes(ruta)
      ? ruta
      : guardado.aprobada || guardado.intentos[guardado.intentos.length - 1]
  );
  const hasta = desde + cuanto;
  if (hasta < 0 || hasta >= guardado.intentos.length) return;
  mirandoPoster.set(clave, guardado.intentos[hasta]);
  repintar();
}

/** La imagen de un póster, o un cuadro con palabras cuando no hay ninguna. */
function marcoDePoster(ruta, guardado, alt) {
  if (!ruta) return huecoDePoster('Todavía no se ha generado.');

  const url = enlaceDe(ruta);
  if (!url) {
    return huecoDePoster(
      sinEnlace.has(ruta)
        ? 'Esta imagen está en el bucket pero no se ha conseguido enlace para verla. Prueba con ' +
          '«Volver a pedir los enlaces», arriba del todo.'
        : 'Pidiendo el enlace para verla…'
    );
  }

  const img = h('img', {
    src: url,
    alt: `${alt}. ${ruta === guardado.aprobada ? 'Imagen aprobada' : 'Intento sin aprobar'}.`,
    loading: 'lazy',
    decoding: 'async'
  });

  img.addEventListener('error', () => {
    const fallo = huecoDePoster(
      'Esta imagen no se ha podido cargar. Los enlaces para mirar duran seis horas: prueba con ' +
        '«Volver a pedir los enlaces», arriba del todo.'
    );
    if (img.parentNode) img.replaceWith(fallo);
  });

  return img;
}

/** El cuadro con una frase dentro, para cuando no hay imagen que enseñar. */
function huecoDePoster(texto) {
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

/** «a, b y c», para meterlo en una frase. */
function enumerarCorto(lista) {
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Las acciones
// ---------------------------------------------------------------------------

/** Encola la escritura de la ficha. */
function pedirLaFicha(ctx, laPieza) {
  try {
    encolar('ficha', { pieza: laPieza.id });
    leidas.delete(laPieza.id);
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/**
 * Encola el reel de una pieza. El manifiesto ya está armado —se armó para
 * decidir si el botón se enciende—, así que aquí solo se manda.
 */
async function armarElReel(ctx, laPieza, armado) {
  if (!armado.manifiesto) return;

  const cuantos = armado.corte.planos.length;
  const pregunta =
    `¿Armo el reel de «${laPieza.titulo}»? Son ${plural(cuantos, 'plano', 'planos')} y ` +
    `${segundosCortos(armado.corte.duracionS)} de vídeo. No genera nada nuevo: usa los clips que ` +
    'ya están elegidos. Tarda unos minutos de máquina.';

  if (!(await confirmar(pregunta))) return;

  try {
    encolar('montaje', {
      trabajo: armado.manifiesto.trabajo,
      capa: CAPA_DEL_REEL,
      id: armado.manifiesto.trabajo,
      manifiesto: armado.manifiesto
    });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/** Encola un póster o una miniatura en el formato elegido. */
function generarPoster(ctx, id, forma) {
  // CON EL MODELO BUENO, SIEMPRE, y sin mirar lo que esté elegido en Salud. Son
  // trece imágenes en toda la serie y son las únicas que va a ver alguien que no
  // ha visto nada: ahorrar aquí no ahorra nada. Y es además el modelo que más
  // referencias admite, que es lo que hace falta para llevar el sitio Y las
  // caras a la vez. El nivel sale de los datos, no está escrito aquí.
  const nivel = soloTexto(ajustesDePoster(ctx.serie).nivel);
  try {
    encolar('poster', nivel ? { id, proporcion: forma, nivel } : { id, proporcion: forma });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/**
 * Da o quita el visto bueno a un póster. Aprobar es MIRAR: por eso solo se puede
 * aprobar la imagen que está delante, y no una de una lista.
 * @param {object} ctx
 * @param {string} id
 * @param {string} forma
 * @param {string|null} ruta la que se aprueba, o null para quitar el visto bueno
 */
function aprobarPoster(ctx, id, forma, ruta) {
  const clave = claveDePoster(id, forma);
  cambiar((borrador) => {
    if (!esObjeto(borrador.posters)) borrador.posters = {};
    if (!esObjeto(borrador.posters[clave])) borrador.posters[clave] = { aprobada: null, intentos: [] };
    const entrada = borrador.posters[clave];
    entrada.aprobada = ruta;
    // El intento aprobado tiene que seguir estando en la lista: este cambio se
    // puede aplicar dos veces si el bucket contesta 409, y las dos veces tiene
    // que dejar lo mismo.
    if (!Array.isArray(entrada.intentos)) entrada.intentos = [];
    if (ruta && !entrada.intentos.includes(ruta)) entrada.intentos.push(ruta);
  })
    .then(() => {
      if (ruta) mirandoPoster.set(clave, ruta);
      queja = null;
      ctx.repintar();
    })
    .catch((fallo) => {
      queja = comoErrorDeCara(fallo);
      ctx.repintar();
    });
}

/** Da o quita el visto bueno a una ficha. */
function aprobarLaFicha(ctx, idPieza, si) {
  cambiar((borrador) => {
    if (!esObjeto(borrador.difusion)) borrador.difusion = {};
    if (!esObjeto(borrador.difusion[idPieza])) borrador.difusion[idPieza] = {};
    borrador.difusion[idPieza].ficha_aprobada = Boolean(si);
  }).catch((fallo) => {
    queja = comoErrorDeCara(fallo);
    ctx.repintar();
  });
}

/** Encola el paquete: el vídeo y la ficha juntos en un zip. */
async function empaquetar(ctx, laPieza, montado) {
  const guardado = difusionDe(ctx.estado, laPieza.id);

  const peso = pesoDe(montado.ruta);
  const aviso1 =
    `El paquete lleva el vídeo entero dentro${peso ? `, que pesa ${bytes(peso)}` : ''}. ` +
    'En el teléfono hay que descargarlo Y luego dejar el mismo espacio libre otra vez para ' +
    'abrirlo. ¿Lo hago?';

  if (!(await confirmar(aviso1))) return;

  const nombre = `${laPieza.id}${extensionDe(montado.ruta)}`;

  const manifiesto = {
    trabajo: paqueteDe(laPieza.id),
    salida: `${CARPETA}/${laPieza.id}/${laPieza.id}.zip`,
    empaquetar: {
      archivos: [
        { nombre, origen: montado.ruta },
        { nombre: 'ficha.txt', texto: fichaEnTexto(laPieza, guardado.ficha) }
      ]
    }
  };

  try {
    encolar('montaje', {
      trabajo: manifiesto.trabajo,
      capa: CAPA_DEL_PAQUETE,
      id: manifiesto.trabajo,
      manifiesto
    });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/**
 * La ficha en texto plano, que es lo que va dentro del zip.
 *
 * Se escribe para COPIAR Y PEGAR desde el móvil, no para leerla bonita: cada
 * cosa debajo de su rótulo y separada por una línea en blanco, de manera que
 * seleccionar un bloque entero sea un gesto y no una pelea con el dedo.
 *
 * @param {{id:string, titulo:string}} laPieza
 * @param {{titulo:string, descripcion:string, etiquetas:string[]}} ficha
 * @returns {string}
 */
function fichaEnTexto(laPieza, ficha) {
  const etiquetas = Array.isArray(ficha.etiquetas) ? ficha.etiquetas : [];
  return [
    'TÍTULO',
    soloTexto(ficha.titulo),
    '',
    'DESCRIPCIÓN',
    soloTexto(ficha.descripcion),
    '',
    'ETIQUETAS',
    comoTexto(etiquetas),
    '',
    '---',
    `Pieza: ${laPieza.id}. Ficha escrita por el estudio, no a mano.`,
    'Las etiquetas son generales de animé: salen de la lista de datos/serie.json y no hay ninguna',
    'propia de esta serie, porque una etiqueta propia solo la busca quien ya la conoce.',
    ''
  ].join('\n');
}

/** `.mp4` de una ruta, o `.mp4` si no se entiende. */
function extensionDe(ruta) {
  const punto = String(ruta || '').lastIndexOf('.');
  const barra = String(ruta || '').lastIndexOf('/');
  if (punto > barra && punto >= 0) return String(ruta).slice(punto);
  return '.mp4';
}

// ---------------------------------------------------------------------------
// El estado y la cola
// ---------------------------------------------------------------------------

function elEstado() {
  try {
    return actual() || {};
  } catch {
    return { difusion: {}, posters: {}, banco: {}, montajes: [], cola: [] };
  }
}

/** Lo guardado de la difusión de una pieza. */
function difusionDe(estado, idPieza) {
  const mapa = esObjeto(estado.difusion) ? estado.difusion : {};
  const entrada = esObjeto(mapa[idPieza]) ? mapa[idPieza] : {};
  return {
    ficha: esObjeto(entrada.ficha) ? entrada.ficha : null,
    ficha_aprobada: Boolean(entrada.ficha_aprobada)
  };
}

/** Los trabajos de la cola, por «tipo:cual». */
function indexarCola(estado) {
  const mapa = new Map();
  const cola = Array.isArray(estado.cola) ? estado.cola : [];
  for (const trabajo of cola) {
    if (!esObjeto(trabajo)) continue;
    const tipo = soloTexto(trabajo.tipo);
    const args = esObjeto(trabajo.args) ? trabajo.args : {};
    if (tipo === 'ficha') mapa.set(`ficha:${soloTexto(args.pieza)}`, trabajo);
    if (tipo === 'montaje') mapa.set(`montaje:${soloTexto(args.trabajo)}`, trabajo);
    if (tipo === 'poster') {
      mapa.set(`poster:${claveDePoster(soloTexto(args.id), soloTexto(args.proporcion))}`, trabajo);
    }
  }
  return mapa;
}

/** Si un trabajo de la cola sigue vivo. */
function estaEnMarcha(trabajo) {
  const estado = soloTexto(trabajo && trabajo.estado);
  return estado === 'pendiente' || estado === 'en_curso';
}

// ---------------------------------------------------------------------------
// Enlaces y pesos
// ---------------------------------------------------------------------------

function enlaceDe(ruta) {
  const guardado = enlaces.get(ruta);
  if (!guardado) return null;
  if (guardado.hasta <= Date.now()) {
    enlaces.delete(ruta);
    return null;
  }
  return guardado.url;
}

function pedirEnlacesQueFalten(rutas, repintar) {
  if (pidiendoEnlaces) return;

  const faltan = [...new Set(rutas)].filter((ruta) => ruta && !enlaceDe(ruta) && !sinEnlace.has(ruta));
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

/** Lo que pesa algo, si se sabe. */
function pesoDe(ruta) {
  const guardado = pesos.get(ruta);
  return guardado ? guardado : 0;
}

/**
 * Pregunta lo que pesan los paquetes y los montajes. Una sola llamada por
 * carpeta: el peso es lo único que dice, antes de pulsar, si esa descarga cabe
 * en el teléfono.
 */
function pedirLosPesos(repintar) {
  if (pesosPedidos) return;
  pesosPedidos = true;

  (async () => {
    for (const carpeta of [CARPETA, 'montaje']) {
      let respuesta;
      try {
        respuesta = await llamar('listar', { prefijo: `${carpeta}/` });
      } catch {
        continue; // no saber lo que pesa no impide descargarlo
      }
      const lista = esObjeto(respuesta) && Array.isArray(respuesta.objetos) ? respuesta.objetos : [];
      for (const uno of lista) {
        const ruta = soloTexto(uno && uno.ruta);
        const cuanto = Number(uno && uno.bytes);
        if (ruta && Number.isFinite(cuanto)) pesos.set(ruta, cuanto);
      }
    }
  })().finally(repintar);
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function esObjeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

function soloTexto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function mensajeDe(fallo) {
  if (!fallo) return '';
  if (typeof fallo === 'string') return fallo;
  return soloTexto(fallo.mensaje) || soloTexto(fallo.message) || String(fallo);
}

function comoErrorDeCara(fallo) {
  if (fallo instanceof ErrorDeCara) return fallo;
  return new ErrorDeCara(
    'Algo ha fallado en la pantalla de Difusión y no se ha podido decir mejor. Debajo está lo que ' +
      'dijo el navegador, palabra por palabra.',
    { detalle: mensajeDe(fallo), reintentable: false, http: 0 }
  );
}
