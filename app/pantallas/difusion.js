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
// LO QUE TODAVÍA NO ESTÁ, y se dice para que no se busque: los reels de treinta
// segundos y los pósters. Van en esta misma pantalla y en este orden. El paquete
// de descarga va primero porque es lo primero que hace falta: en cuanto haya un
// teaser montado, ya se puede subir.

import { ErrorDeCara, llamar } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import { encolar } from '../cola.js';
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

  const ctx = { serie, estado, piezas, montajes, repintar, trabajos: indexarCola(estado) };

  // Las firmas y los pesos llegan solos.
  const rutas = [];
  for (const una of piezas) {
    const suyo = loMontadoDe(montajes, una.id);
    if (suyo) rutas.push(suyo.ruta);
    const paquete = elPaqueteDe(montajes, una.id);
    if (paquete) rutas.push(paquete.ruta);
  }
  pedirEnlacesQueFalten(rutas, repintar);
  pedirLosPesos(repintar);

  return pantalla('Difusión', seccionCabecera(ctx), seccionPiezas(ctx), seccionLoQueFalta());
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
// Lo que todavía no está
// ---------------------------------------------------------------------------

/**
 * Se dice con todas las letras, y no es un adorno: quien abre esta pantalla
 * buscando los reels tiene que saber que no están todavía y no ponerse a
 * buscarlos por las otras siete.
 */
function seccionLoQueFalta() {
  return seccion(
    'Lo que falta aquí',
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      'Esta pantalla va a llevar dos cosas más, y todavía no están:'
    ),
    h(
      'p',
      { clase: 'tarjeta-texto' },
      'Los REELS de treinta segundos, en vertical, armados solos con los clips y la música que ya ' +
        'existan. Necesitan clips aprobados: hoy hay muy pocos.'
    ),
    h(
      'p',
      { clase: 'tarjeta-texto' },
      'Los PÓSTERS: el oficial de la serie y las doce miniaturas de los episodios, generados con ' +
        'las placas de personajes y escenarios que ya están aprobadas.'
    )
  );
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
    return { difusion: {}, montajes: [], cola: [] };
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
