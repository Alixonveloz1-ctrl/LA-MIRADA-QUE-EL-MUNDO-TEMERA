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
//   3. LA FICHA SE ENSEÑA ENTERA ANTES DE EMPAQUETAR. Una descripción que
//      cuenta el final se publica una vez y ya no se puede recoger, así que la
//      tarjeta la pinta completa para leerla antes de descargar el paquete. No
//      hay visto bueno: la última ficha escrita es la que va en el zip.
//
//   4. UN PÓSTER NO ES UN FOTOGRAMA. El póster oficial y las doce miniaturas se
//      GENERAN aquí, con las placas generadas de los personajes delante como
//      referencia, para que sea la misma cara y la misma luz. No se sacan del
//      capítulo: un fotograma cualquiera no compone, y una miniatura tiene que
//      leerse del tamaño de una uña.
//
//      El FORMATO se elige antes de generar, y no se recorta después: 9:16 es lo
//      vertical y 16:9 es lo que pide una miniatura de YouTube. Recortar uno para
//      sacar el otro deja la cabeza fuera del cuadro, así que cada formato es su
//      propia imagen, con sus intentos.
//
//      El TÍTULO va escrito DENTRO de la imagen, pedido en el prompt. Es una
//      decisión tomada a sabiendas: los modelos de imagen escriben mal las tildes
//      y las eñes, así que puede salir con letras inventadas. Por eso el botón de
//      «Otro intento» está siempre a mano y cada intento se queda guardado.
//
//   5. UN REEL NO GENERA NADA. Los treinta segundos en vertical se arman con los
//      clips en uso y la música en uso, en el orden
//      del guion. Ni una llamada a un modelo, ni un céntimo: es un montaje de
//      material ya pagado. Por eso su botón puede estar apagado con todo bien
//      escrito —lo que falta no es una decisión, es material—, y por eso se
//      rehace sin pensarlo en cuanto hay un clip más.
//
//      Y las BARRAS NEGRAS son a propósito. Todo está rodado en 16:9; recortar
//      a vertical dejaría media cara fuera de cuadro en casi todos los planos.
//      Se escala el plano entero y lo que sobra se rellena de negro.
//
//   6. EL MATERIAL PARA MONTAR A MANO NO PASA POR EL MONTADOR. El paquete de
//      arriba lleva el vídeo YA MONTADO por el estudio. Quien prefiera montar
//      el capítulo en su editor —que es lo que se hace con los capítulos— no
//      necesita ese vídeo: necesita las piezas sueltas. Así que hay un segundo
//      paquete, el de material, que lleva TODO lo generado de la pieza en sus
//      carpetas: las imágenes clave en uso, los clips en uso con el mismo
//      nombre que su imagen, los bloques de voz, los efectos, la música, los
//      subtítulos en un .srt, una guía que dice en qué orden va cada plano,
//      cuánto dura y qué frase entra en él, y el guion de la pieza.
//
//      Y no pide nada a cambio: ni que la pieza esté montada, ni que tenga
//      ficha, ni que esté completa. Si falta material, el zip sale con lo que
//      hay y la guía dice lo que falta, plano a plano. Un zip a medias que se
//      puede abrir vale más que un botón apagado.
//
// EL ORDEN DE LA PANTALLA no es casual: primero el paquete de descarga, que es
// lo primero que hace falta —en cuanto haya un teaser montado ya se puede
// subir—, luego el material para montar a mano, luego los reels, que salen de
// ese mismo material, y al final los pósters, que son lo único de aquí que sí
// cuesta dinero.

import { ErrorDeCara, llamar } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import { crearActualizador } from '../ui.js';
import { encolar } from '../cola.js';
import { rutaClipEnUso, rutaKeyframeEnUso } from '../continuidad.js';
import { bloquesDeVoz, lineasDeVoz } from './audio.js';
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

/** Ruta lógica → `{ url, hasta }`, para MIRAR: la imagen o el vídeo en pantalla. */
const enlaces = new Map();

/**
 * Ruta lógica → `{ url, hasta }`, para DESCARGAR. Son otras URLs, y hacen falta.
 *
 * El atributo `download` de un enlace HTML NO SIRVE cuando el archivo está en
 * otro dominio, y aquí siempre lo está: todo vive en el bucket. El navegador se
 * lo salta sin decir nada y ABRE el archivo en una pestaña en vez de guardarlo.
 * Eso es lo que pasaba: se pulsaba «Descargar» y se abría el vídeo.
 *
 * Lo único que lo cambia es que Google mande `Content-Disposition: attachment`,
 * y eso se le pide al firmar. Se guardan aparte de las de mirar porque son dos
 * URLs distintas del mismo archivo, y porque una URL de descarga puesta en un
 * `<video>` es un riesgo que no hace falta correr.
 */
const enlacesDeDescarga = new Map();

/** Rutas por las que ya se preguntó y no hay enlace. */
const sinEnlace = new Set();

/**
 * Rutas para las que no ha salido la URL DE DESCARGA, que no es lo mismo.
 *
 * ESTO EXISTE PORQUE UN BOTÓN SE QUEDÓ «PREPARANDO LA DESCARGA…» PARA SIEMPRE.
 * Cuando fallaba la firma de mirar, la ruta se apuntaba aquí al lado y se dejaba
 * de insistir. Cuando fallaba la de descargar, no se apuntaba en ninguna parte:
 * ni había enlace, ni había queja, ni había manera de saber que se había
 * intentado. En pantalla solo quedaba ese texto en gris, quieto, sin decir nada.
 *
 * Con esto se sabe que ya se preguntó y no salió, y entonces se puede ofrecer lo
 * que sí hay —la de mirar— en vez de dejar a alguien esperando algo que no va a
 * llegar.
 */
const sinDescarga = new Set();

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

/**
 * Con qué modelo se generan los pósters en esta visita.
 *
 * Por defecto el que digan los datos, que es el bueno: son trece imágenes en
 * toda la serie y son las únicas que va a ver alguien que no ha visto nada.
 *
 * Pero se puede bajar aquí mismo, y eso NO es un adorno. El modelo bueno, a 2K y
 * con tres referencias delante, es la petición más pesada que hace este estudio
 * entera, y cuando Google contesta 502 con una página de error —no con un error
 * de la API— lo que ha fallado está delante del modelo, no en él. Con eso pasado,
 * la única salida era irse a Salud a cambiar el ajuste de TODO el estudio para
 * poder generar un póster. Ahora se baja un nivel, se genera, y se vuelve a
 * subir: dos toques, y sin tocar lo que usan las demás pantallas.
 */
let nivelElegido = null;

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

      const repintar = crearActualizador(marco,()=>construir(serie,repintar));

      repintar();
      const desapuntar=alCambiar(repintar);
      soltar = ()=>{desapuntar();repintar.destruir();};
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
    piezasMaterial: piezasDelMaterial(serie, estado),
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
  for (const una of ctx.piezasMaterial) {
    const material = elMaterialDe(montajes, una.id);
    if (material) rutas.push(material.ruta);
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
    seccionMaterial(ctx),
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

/**
 * Si una ruta apuntada es algo que se pueda ver o descargar.
 *
 * ESTO EXISTE POR UN ARCHIVO DE 107 BYTES. La cola apunta en `estado.montajes`
 * todo lo que el montador deja en la carpeta de un trabajo, y ahí dentro había
 * un índice interno con el nombre de la ejecución. Así que el botón de descargar
 * el paquete bajaba un texto de una línea en vez del zip, y la ficha decía
 * «paquete hecho, 107 bytes» tan tranquila.
 *
 * La función ya no ofrece ese archivo, pero LO QUE SE APUNTÓ EN SU DÍA SIGUE
 * APUNTADO: el estado es un archivo del bucket, no se rehace solo, y nadie va a
 * ir a mano a limpiarlo desde un teléfono. Por eso se filtra también AL LEER, y
 * con lista blanca: un montaje deja un vídeo y un paquete deja un zip; lo que se
 * cuele mañana en esa carpeta tampoco llegará a la pantalla.
 */
function esArchivoDeSalida(ruta) {
  return /\.(mp4|mov|mkv|webm|zip)$/i.test(String(ruta || ''));
}

/** El montaje entero de una pieza, si lo hay: el último que se hizo. */
function loMontadoDe(montajes, idPieza) {
  const suyos = montajes.filter(
    (uno) =>
      esObjeto(uno) &&
      soloTexto(uno.ruta) &&
      esArchivoDeSalida(uno.ruta) &&
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
      esArchivoDeSalida(uno.ruta) &&
      uno.capa === CAPA_DEL_PAQUETE &&
      soloTexto(uno.id) === paqueteDe(idPieza)
  );
  return suyos.length ? suyos[suyos.length - 1] : null;
}

/** El nombre del trabajo del paquete de una pieza. */
function paqueteDe(idPieza) {
  return `difusion-${idPieza}`;
}

/** El paquete de material de una pieza, si ya se ha hecho: el último. */
function elMaterialDe(montajes, idPieza) {
  const suyos = montajes.filter(
    (uno) =>
      esObjeto(uno) &&
      soloTexto(uno.ruta) &&
      esArchivoDeSalida(uno.ruta) &&
      uno.capa === CAPA_DEL_PAQUETE &&
      soloTexto(uno.id) === materialDe(idPieza)
  );
  return suyos.length ? suyos[suyos.length - 1] : null;
}

/** El nombre del trabajo del paquete de material de una pieza. */
function materialDe(idPieza) {
  return `material-${idPieza}`;
}

/**
 * Las piezas de las que se puede bajar el material, que son TODAS, no solo las
 * que se publican: también el archivo —es una biblioteca de planos, y su
 * material es material— y también los capítulos que solo viven en el estado
 * porque salieron del desglose y todavía no están escritos en los datos. Una
 * pieza del estado manda sobre la de los datos con el mismo id, como en el
 * resto de pantallas.
 * @param {object} serie
 * @param {object} estado
 * @returns {{id:string, titulo:string, datos:object}[]}
 */
function piezasDelMaterial(serie, estado) {
  const delEstado = esObjeto(estado.piezas) ? estado.piezas : {};
  const deLaSerie = esObjeto(serie.piezas) ? serie.piezas : {};
  const lista = [];
  const vistos = new Set();

  for (const id of Object.keys(deLaSerie)) {
    if (!esObjeto(deLaSerie[id])) continue;
    vistos.add(id);
    const datos = esObjeto(delEstado[id]) ? delEstado[id] : deLaSerie[id];
    lista.push({ id, titulo: soloTexto(datos.titulo) || soloTexto(deLaSerie[id].titulo) || id, datos });
  }
  for (const id of Object.keys(delEstado)) {
    if (vistos.has(id) || !esObjeto(delEstado[id])) continue;
    lista.push({ id, titulo: soloTexto(delEstado[id].titulo) || id, datos: delEstado[id] });
  }
  return lista;
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
          enlacesDeDescarga.clear();
          sinEnlace.clear();
          sinDescarga.clear();
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
          enlaceParaGuardar(paquete.ruta, 'Descargar el paquete')
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
  return null;
}

/** El punto de estado de una pieza. */
function comoVaLaPieza(guardado, montado, paquete) {
  if (paquete) return { tipo: 'listo', texto: 'Lista para subir' };
  if (!montado) return { tipo: 'pendiente', texto: 'Sin montar' };
  if (!guardado.ficha) return { tipo: 'pendiente', texto: 'Sin ficha' };
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
        'que están en uso y la música que está en uso. No genera vídeo nuevo y no cuesta ' +
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
          enlaceParaGuardar(hecho.ruta, 'Descargar el reel')
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
        'capítulo: se generan aquí con las placas generadas de los personajes delante, para ' +
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

  partes.push(...selectorDeModelo(ctx));

  if (ajustesDePoster(serie).titulo_en_la_imagen === true) {
    partes.push(
      h(
        'p',
        { clase: 'tenue' },
        `El título «${soloTexto(ajustesDePoster(serie).titulo)}» se le pide al modelo escrito ` +
          'DENTRO de la imagen. Con las tildes suele fallar: míralo bien y, si sale ' +
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

/** Los tres niveles, de caro a barato, tal como se leen en Salud. */
const NIVELES = [
  { id: 'calidad', nombre: 'Calidad' },
  { id: 'medio', nombre: 'Medio' },
  { id: 'economico', nombre: 'Económico' }
];

/**
 * El nivel con el que se generan los pósters: el elegido aquí, y si no el que
 * dicen los datos. Nunca el ajuste general de Salud: un póster no es un
 * keyframe, y bajar de nivel para que salga barato no ahorra nada cuando son
 * trece imágenes en toda la serie.
 * @param {object} serie
 * @returns {string}
 */
function nivelDePoster(serie) {
  if (nivelElegido && NIVELES.some((uno) => uno.id === nivelElegido)) return nivelElegido;
  const escrito = soloTexto(ajustesDePoster(serie).nivel);
  return NIVELES.some((uno) => uno.id === escrito) ? escrito : 'calidad';
}

/**
 * Las pastillas para elegir con qué modelo se genera, y por qué existen.
 *
 * NO es un ajuste de gusto: es la salida cuando el modelo bueno no contesta. La
 * combinación de modelo de calidad + 2K + tres referencias es la petición más
 * pesada de todo el estudio, y cuando Google devuelve un 502 con una página de
 * error —una página HTML, no un error de la API— lo que ha fallado está DELANTE
 * del modelo: un balanceador que se ha cansado de esperar. Eso no lo arregla
 * insistir muchas veces.
 *
 * @param {object} ctx
 * @returns {HTMLElement[]}
 */
function selectorDeModelo(ctx) {
  const { serie, repintar } = ctx;
  const familia = esObjeto(serie.modelos) && esObjeto(serie.modelos.imagen) ? serie.modelos.imagen : {};
  const hay = NIVELES.filter((uno) => esObjeto(familia[uno.id]) && soloTexto(familia[uno.id].id));
  if (hay.length < 2) return [];

  const puesto = nivelDePoster(serie);
  const botones = h('div', { clase: 'tarjeta-acciones' });
  for (const uno of hay) {
    botones.appendChild(
      boton(
        uno.nombre,
        () => {
          nivelElegido = uno.id;
          repintar();
        },
        { tono: uno.id === puesto ? 'principal' : 'suave' }
      )
    );
  }

  return [
    botones,
    h(
      'p',
      { clase: 'tenue' },
      `Se generan con el modelo de ${puesto === 'calidad' ? 'CALIDAD' : puesto}, que es lo que ` +
        'dicen los datos: son trece imágenes en toda la serie y son las únicas que va a ver ' +
        'alguien que no ha visto nada, así que ahorrar aquí no ahorra nada. Es además el que más ' +
        'imágenes de referencia admite, y un póster lleva el sitio Y las caras a la vez.'
    ),
    h(
      'p',
      { clase: 'tenue' },
      'Si el bueno contesta un 502 una y otra vez, baja un nivel y prueba: esa combinación —el ' +
        'modelo grande, a 2K y con tres referencias delante— es la petición más pesada de todo ' +
        'el estudio, y un 502 con página de error de Google es algo que se ha cansado de esperar ' +
        'antes de llegar al modelo. Esto solo cambia los pósters; el resto del estudio sigue con ' +
        'lo que haya elegido en Salud.'
    )
  ];
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
          ? `Para generarlo hace falta «${faltan[0]}» generada, y todavía no lo está. Se genera ` +
            'en la pantalla del Banco.'
          : `Para generarlo hacen falta ${plural(faltan.length, 'placa', 'placas')} generadas que ` +
            `todavía no lo están: ${enumerarCorto(faltan)}. Se generan en la pantalla del Banco.`
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
          `${ruta && ruta === guardado.aprobada ? ' · es el que se usa' : ''}.`
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
        enlaceParaGuardar(ruta, 'Descargar esta imagen')
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

  return tarjeta({
    titulo: `${soloTexto(elPoster.nombre) || id} · ${forma}`,
    estado: comoVaElPoster(guardado, enMarcha),
    media: marcoDePoster(ruta, guardado, `${soloTexto(elPoster.nombre) || id}, ${forma}`),
    // El marco toma la forma del póster. Sin esto, un 9:16 se enseña dentro de
    // un hueco 16:9 y se recorta justo la banda del título, que es lo único que
    // hay que mirar: ahí va el título.
    proporcion: forma,
    pie,
    acciones
  });
}

/** Por qué todavía no se puede generar un póster, con palabras. Null si se puede. */
function porQueNoSeGeneraElPoster(faltan, enMarcha) {
  if (enMarcha) return 'Ya se está generando. Se paga una vez.';
  if (faltan.length) {
    return `Falta generar ${enumerarCorto(faltan)}. Sin esa imagen delante no hay contra qué ` +
      'generar el póster.';
  }
  return null;
}

/** El punto de estado de un póster. */
function comoVaElPoster(guardado, enMarcha) {
  if (enMarcha) return { tipo: 'en_curso', texto: 'Generándose' };
  if (guardado.intentos.length) return { tipo: 'aprobada', texto: 'En uso' };
  return { tipo: 'pendiente', texto: 'Sin generar' };
}

/**
 * Las placas de referencia de un póster que todavía no están generadas. El
 * servidor también lo comprueba —es él quien manda—, pero decirlo aquí evita
 * encolar un trabajo que ya se sabe que va a fallar.
 * @param {object} ctx
 * @param {object} elPoster
 * @returns {string[]}
 */
function refsQueFaltan(ctx, elPoster) {
  const banco = esObjeto(ctx.estado.banco) ? ctx.estado.banco : {};
  const escenarios = esObjeto(ctx.estado.escenarios) ? ctx.estado.escenarios : {};

  const sinAprobar = (mapa) => (una) => {
    if (!una) return false;
    const entrada = esObjeto(mapa[una]) ? mapa[una] : {};
    const tiene =
      soloTexto(entrada.aprobada) ||
      (Array.isArray(entrada.intentos) && entrada.intentos.some(soloTexto));
    return !tiene;
  };

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
  return { aprobada: soloTexto(entrada.aprobada) || intentos[intentos.length - 1] || null, intentos };
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
    alt: `${alt}. ${ruta === guardado.aprobada ? 'Imagen en uso' : 'Otro intento'}.`,
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
  const nivel = nivelDePoster(ctx.serie);
  try {
    encolar('poster', nivel ? { id, proporcion: forma, nivel } : { id, proporcion: forma });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
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

// ---------------------------------------------------------------------------
// El material para montar a mano
// ---------------------------------------------------------------------------

function seccionMaterial(ctx) {
  const { piezasMaterial } = ctx;

  const partes = [
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      'Un zip por pieza con TODO lo generado, suelto y en sus carpetas, para montar el capítulo ' +
        'en tu editor: las imágenes clave, los clips, las voces, los efectos, la música, los ' +
        'subtítulos, una guía con el orden y los tiempos, y el guion. No hace falta que la pieza ' +
        'esté montada por el estudio, ni que tenga ficha, ni que esté completa: si falta ' +
        'material, el zip sale con lo que hay y la guía dice lo que falta.'
    ),
    h(
      'p',
      { clase: 'tenue' },
      'Lo que va dentro es siempre el material EN USO: la última imagen, el último clip y la ' +
        'última grabación de cada cosa. Si regeneras algo, rehaces el zip y sale lo nuevo.'
    )
  ];

  if (!piezasMaterial.length) {
    partes.push(aviso('No hay ninguna pieza, así que no hay material que bajar.', { tono: 'error' }));
    return seccion('Para montar a mano', partes);
  }

  for (const una of piezasMaterial) partes.push(tarjetaDeMaterial(ctx, una));

  return seccion('Para montar a mano', partes);
}

/**
 * Una pieza y su zip de material: cuánto hay, cuánto falta y el botón.
 * @param {object} ctx
 * @param {{id:string, titulo:string, datos:object}} laPieza
 * @returns {HTMLElement}
 */
function tarjetaDeMaterial(ctx, laPieza) {
  const { serie, estado, montajes, trabajos, repintar } = ctx;

  const plan = planDelMaterial(serie, estado, laPieza);
  const hecho = elMaterialDe(montajes, laPieza.id);
  const enLaCola = trabajos.get(`montaje:${materialDe(laPieza.id)}`) || null;
  const enMarcha = Boolean(enLaCola && estaEnMarcha(enLaCola));
  const { conteos } = plan;

  const pie = h('div', null);

  pie.appendChild(
    h(
      'p',
      { clase: 'tarjeta-texto' },
      `${plural(conteos.tomas, 'plano', 'planos')} · la serie para montar lleva ` +
        `${conteos.clips + conteos.imagenes} archivos en orden ` +
        `(${conteos.clips} vídeos y ${conteos.imagenes} imágenes) · ` +
        `${conteos.efectos} con efecto · ` +
        `${plural(conteos.bloquesVoz, 'archivo', 'archivos')} de diálogos de ${conteos.bloquesTotal} · ` +
        `${conteos.musica} de ${plural(conteos.musicaTotal, 'pista', 'pistas')} de música · ` +
        `${plural(conteos.lineas, 'frase', 'frases')} de diálogo.`
    )
  );

  // Lo que falta se dice aquí en corto y en la guía entero, plano a plano. Y no
  // apaga el botón: el zip sale con lo que hay.
  if (plan.faltas.length) {
    const unas = plan.faltas.slice(0, 3).join(' ');
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto' },
        `Falta material, y el zip sale igual: ${unas}` +
          (plan.faltas.length > 3
            ? ` Y ${plan.faltas.length - 3} cosas más, todas escritas en la guía del zip.`
            : '')
      )
    );
  }

  if (hecho) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tarjeta-texto' },
        `Zip hecho el ${fecha(hecho.cuando)}` +
          `${pesoDe(hecho.ruta) ? `, ${bytes(pesoDe(hecho.ruta))}` : ''}. Si has regenerado algo ` +
          'desde entonces, rehacerlo trae lo nuevo.'
      )
    );
    if (enlaceDe(hecho.ruta)) {
      pie.appendChild(
        h('p', { clase: 'tarjeta-texto' }, enlaceParaGuardar(hecho.ruta, 'Descargar el material'))
      );
    }
  }

  if (enMarcha) {
    pie.appendChild(espera('Preparando el zip en la nube. Tarda, y no hace falta tener esto abierto.'));
  }
  if (enLaCola && enLaCola.error) {
    pie.appendChild(aviso(enLaCola.error, { tono: 'error', detalle: enLaCola.detalle }));
  }

  const acciones = h('div', { clase: 'tarjeta-acciones' });
  acciones.appendChild(
    boton(
      hecho ? 'Rehacer el zip del material' : 'Descargar todo el material en un zip',
      () => empaquetarMaterial(ctx, laPieza),
      {
        tono: hecho ? 'suave' : 'principal',
        desactivado: enMarcha ? 'Ya se está preparando.' : null
      }
    )
  );

  return tarjeta({
    titulo: laPieza.titulo,
    estado: enMarcha
      ? { tipo: 'en_curso', texto: 'Preparándose' }
      : hecho
        ? { tipo: 'listo', texto: 'Zip hecho' }
        : { tipo: 'pendiente', texto: 'Sin hacer' },
    pie,
    acciones
  });
}

/** Encola el zip de material de una pieza: todo lo generado, en sus carpetas. */
async function empaquetarMaterial(ctx, laPieza) {
  const plan = planDelMaterial(ctx.serie, ctx.estado, laPieza);
  const { conteos } = plan;

  const pregunta =
    `¿Preparo el zip con todo el material de «${laPieza.titulo}»? Dentro va todo numerado ` +
    `en el orden de montaje: ${plural(conteos.imagenes + conteos.clips + conteos.efectos + conteos.bloquesVoz + conteos.musica, 'archivo', 'archivos')} ` +
    'de imagen, vídeo y sonido, más los subtítulos, la guía y el guion. Lleva lo que haya: si ' +
    'falta material, sale igual y la guía lo dice. Puede pesar mucho: descárgalo con wifi y deja ' +
    'el mismo espacio libre otra vez para abrirlo.';

  if (!(await confirmar(pregunta))) return;

  const archivos = [
    ...plan.archivos,
    { nombre: 'guia-de-montaje.md', texto: guiaDelMaterial(ctx.serie, ctx.estado, laPieza, plan) }
  ];

  const manifiesto = {
    trabajo: materialDe(laPieza.id),
    salida: `${CARPETA}/${laPieza.id}/${laPieza.id}-material.zip`,
    empaquetar: { tipo: 'material', archivos }
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
 * El plan del zip de material de una pieza: qué archivos van, qué falta y el
 * detalle plano a plano del que sale la guía.
 *
 * Es una función de datos, sin pantalla: se comprueba ejecutándola
 * (herramientas/probar-difusion.mjs).
 *
 * @param {object} serie
 * @param {object} estado
 * @param {{id:string, titulo:string, datos:object}} laPieza
 */
function planDelMaterial(serie, estado, laPieza) {
  const datos = esObjeto(laPieza.datos) ? laPieza.datos : {};
  const tomas = (Array.isArray(datos.tomas) ? datos.tomas : []).filter(esObjeto);
  const inicios = iniciosDe(tomas);
  const lineas = lineasDeVoz(datos);
  const tomasDelEstado = esObjeto(estado.tomas) ? estado.tomas : {};

  const archivos = [];
  const faltas = [];
  const detalle = [];
  const conteos = {
    tomas: tomas.length,
    imagenes: 0,
    clips: 0,
    efectos: 0,
    bloquesVoz: 0,
    bloquesTotal: 0,
    musica: 0,
    musicaTotal: 0,
    lineas: lineas.length
  };

  // LOS DIÁLOGOS, NUMERADOS EN EL ORDEN EN QUE SUENAN. La numeración manda en
  // todo el paquete: la serie visual, los diálogos y los efectos se llaman por
  // su número de montaje, no por los códigos internos de plano o de bloque,
  // que es lo que hace que en el editor baste con ponerlo todo en orden. El
  // número de cada línea se busca por su CONTENIDO —quién la dice, en qué
  // segundo entra y qué dice—, nunca por el objeto: cada ayudante compone
  // sus propias copias de las líneas, así que la misma frase llega como
  // objetos distintos según quién la traiga, y buscarla por referencia la
  // perdería. Si dos frases fueran idénticas en todo, comparten contenido y
  // se distinguen por el orden en que cada lista las trae (la «vez»).
  const claveDeLinea = (linea) =>
    [linea.quien, linea.t, linea.hasta, linea.es].join('\u0000');
  const numeroDeLinea = new Map();
  lineas.forEach((linea, i) => {
    const clave = claveDeLinea(linea);
    if (!numeroDeLinea.has(clave)) numeroDeLinea.set(clave, []);
    numeroDeLinea.get(clave).push(i + 1);
  });
  const dialogoDeLinea = (linea, vez) => {
    const suyos = numeroDeLinea.get(claveDeLinea(linea)) || [];
    return vez !== undefined && suyos[vez] !== undefined ? suyos[vez] : suyos[0] || 0;
  };
  const conDialogo = (linea, numero) =>
    numero ? { ...linea, dialogo: String(numero).padStart(3, '0') } : { ...linea, dialogo: null };

  tomas.forEach((toma, i) => {
    const id = soloTexto(toma.id) || `plano-${i + 1}`;
    const numero = String(i + 1).padStart(3, '0');
    const entrada = esObjeto(tomasDelEstado[`${laPieza.id}/${id}`])
      ? tomasDelEstado[`${laPieza.id}/${id}`]
      : {};
    const inicio = inicios[i];
    const dur = Number(toma.dur) || 0;
    const suyo = {
      id,
      numero,
      escena: toma.escena === undefined || toma.escena === null ? null : String(toma.escena),
      inicio,
      dur,
      recorte: Array.isArray(toma.recorte) && toma.recorte.length === 2
        ? [Number(toma.recorte[0]) || 0, Number(toma.recorte[1]) || 0]
        : null,
      imagen: null,
      video: null,
      visual: null,
      efecto: null,
      efectoTexto: '',
      frases: (() => {
        const vistas = new Map();
        return lineas
          .filter((linea) => linea.t >= inicio && linea.t < inicio + dur)
          .map((linea) => {
            const clave = claveDeLinea(linea);
            const vez = vistas.get(clave) || 0;
            vistas.set(clave, vez + 1);
            return conDialogo(linea, dialogoDeLinea(linea, vez));
          });
      })()
    };

    const clip = rutaClipEnUso(entrada);
    const keyframe = rutaKeyframeEnUso(entrada);
    if (clip) {
      // LA SERIE VISUAL: UN SOLO ARCHIVO POR NÚMERO. Si el plano tiene clip, el
      // archivo de su número ES el vídeo; si no lo tiene —cobertura, o vídeo
      // sin generar—, el de su número es su imagen. La serie no tiene huecos:
      // se importa ordenada y se coloca tal cual, sin buscar qué va dónde.
      suyo.video = `01-en-orden/${numero}-video${extensionDeArchivo(clip, '.mp4')}`;
      suyo.visual = suyo.video;
      archivos.push({ nombre: suyo.video, origen: clip });
      conteos.clips += 1;
      if (!keyframe) {
        faltas.push(`El plano ${numero} (${id}) tiene clip pero no imagen.`);
      }
    } else if (keyframe) {
      suyo.imagen = `01-en-orden/${numero}-imagen${extensionDeArchivo(keyframe, '.png')}`;
      suyo.visual = suyo.imagen;
      archivos.push({ nombre: suyo.imagen, origen: keyframe });
      conteos.imagenes += 1;
      if (soloTexto(toma.tipo) === 'cobertura') {
        // Un plano de cobertura ES una imagen quieta con la cámara moviéndose
        // en el editor: que no tenga clip no es una falta, es su forma.
        suyo.cobertura = true;
      } else {
        faltas.push(
          `El plano ${numero} (${id}) no tiene clip: en la serie va su imagen; ` +
            'cuando lo generes, rehacer el zip lo sustituye solo.'
        );
      }
    } else {
      faltas.push(`El plano ${numero} (${id}) no tiene ni imagen ni clip: su número queda vacío.`);
      if (soloTexto(toma.efecto)) {
        faltas.push(
          `El plano ${numero} (${id}) pide un efecto —«${soloTexto(toma.efecto)}»— y tampoco está generado.`
        );
      }
    }

    const efecto = esObjeto(entrada.efecto) ? entrada.efecto : {};
    const rutaEfecto = soloTexto(efecto.ruta);
    if (rutaEfecto) {
      suyo.efecto = `03-efectos/${numero}-efecto${extensionDeArchivo(rutaEfecto, '.mp3')}`;
      suyo.efectoTexto = soloTexto(efecto.texto);
      archivos.push({ nombre: suyo.efecto, origen: rutaEfecto });
      conteos.efectos += 1;
    } else if (soloTexto(toma.efecto) && (clip || keyframe)) {
      faltas.push(
        `El plano ${numero} (${id}) pide un efecto —«${soloTexto(toma.efecto)}»— y no está generado.`
      );
    }

    detalle.push(suyo);
  });

  // LAS VOCES: UNA SERIE DE DIÁLOGOS NUMERADA. La voz se graba por bloques,
  // y un bloque no se puede partir en frases sin cortar el audio de verdad
  // —eso lo hace el montaje automático, no este paquete—, así que cada
  // archivo de esta serie se llama por el número de su PRIMER diálogo
  // («dialogo-007», «dialogo-012»…) y dentro van sus frases seguidas, en
  // orden. La guía numera cada diálogo y dice el tramo exacto que ocupa
  // dentro de su archivo: montar es colocar los archivos por su número y,
  // si una frase tiene que ir suelta, cortarla por ese tramo.
  const bloques = [];
  for (const bloque of bloquesDeVoz(datos)) {
    conteos.bloquesTotal += 1;
    const guardado = guardadoDeVoz(estado, `${laPieza.id}/${bloque.id}`);
    const vistasBloque = new Map();
    const lineasNumeradas = bloque.lineas.map((linea, j) => {
      const clave = claveDeLinea(linea);
      const vez = vistasBloque.get(clave) || 0;
      vistasBloque.set(clave, vez + 1);
      const tramo = guardado.lineas[j];
      return {
        ...conDialogo(linea, dialogoDeLinea(linea, vez)),
        tramo:
          tramo && tramo.fin > tramo.inicio
            ? { inicio: tramo.inicio, fin: tramo.fin }
            : null
      };
    });
    const suyo = {
      id: bloque.id,
      personajes: bloque.personajes,
      archivo: null,
      primerDialogo: lineasNumeradas.length ? lineasNumeradas[0].dialogo : null,
      durS: guardado.durS,
      lineas: lineasNumeradas
    };
    if (guardado.ruta) {
      suyo.archivo =
        `02-dialogos/dialogo-${suyo.primerDialogo}${extensionDeArchivo(guardado.ruta, '.wav')}`;
      archivos.push({ nombre: suyo.archivo, origen: guardado.ruta });
      conteos.bloquesVoz += 1;
    } else {
      const desde = lineasNumeradas.length ? lineasNumeradas[0].dialogo : '???';
      const hasta = lineasNumeradas.length
        ? lineasNumeradas[lineasNumeradas.length - 1].dialogo
        : '???';
      faltas.push(
        `Los diálogos ${desde} a ${hasta} no están grabados: ` +
          `${plural(bloque.lineas.length, 'frase', 'frases')} sin voz.`
      );
    }
    bloques.push(suyo);
  }

  // LA MÚSICA DE LA PIEZA. Las pistas se emparejan como en Audio y en Montaje:
  // por el campo «pieza» o por el prefijo del id, porque en musica.piezas no
  // siempre viene escrito a qué pieza pertenece cada una.
  const pistas = [];
  const cuantasPiezas = piezasDelMaterial(serie, estado).length;
  for (const pista of musicaDelMaterial(serie, laPieza.id, cuantasPiezas)) {
    conteos.musicaTotal += 1;
    const guardado = guardadoDeMusica(estado, pista.id);
    const suya = { id: pista.id, archivo: null, durS: guardado.durS };
    if (guardado.ruta) {
      suya.archivo =
        `04-musica/musica-${String(pistas.length + 1).padStart(2, '0')}` +
        `${extensionDeArchivo(guardado.ruta, '.wav')}`;
      archivos.push({ nombre: suya.archivo, origen: guardado.ruta });
      conteos.musica += 1;
    } else {
      faltas.push(`La pista de música ${pistas.length + 1} no está generada.`);
    }
    pistas.push(suya);
  }

  // LOS TEXTOS. Los subtítulos salen de las mismas líneas que oye el montaje,
  // con sus segundos escritos en la pieza; el guion se compone de los planos y
  // las líneas, que es lo que hay escrito de la pieza.
  if (lineas.length) {
    archivos.push({ nombre: 'subtitulos.srt', texto: subtitulosEnSrt(lineas) });
  } else {
    faltas.push('La pieza no tiene diálogo escrito, así que no hay subtítulos.');
  }
  archivos.push({ nombre: 'guion.txt', texto: guionEnTexto(laPieza) });

  const ficha = difusionDe(estado, laPieza.id).ficha;
  if (ficha) archivos.push({ nombre: 'ficha.txt', texto: fichaEnTexto(laPieza, ficha) });

  return {
    archivos,
    faltas,
    conteos,
    detalle,
    bloques,
    pistas,
    duracionS: detalle.reduce((suma, una) => Math.max(suma, una.inicio + una.dur), 0)
  };
}

/** Lo guardado de un bloque de voz: su archivo en uso y los tiempos de línea. */
function guardadoDeVoz(estado, clave) {
  const audio = esObjeto(estado.audio) ? estado.audio : {};
  const mapa = esObjeto(audio.voz) ? audio.voz : {};
  const entrada = esObjeto(mapa[clave]) ? mapa[clave] : {};
  const lineas = Array.isArray(entrada.lineas) ? entrada.lineas : [];
  return {
    ruta: soloTexto(entrada.ruta) || null,
    durS: Number(entrada.dur_s) || 0,
    lineas: lineas.map((tramo) => ({
      inicio: Number(tramo && tramo.inicio) || 0,
      fin: Number(tramo && tramo.fin) || 0
    }))
  };
}

/** Lo guardado de una pista de música: su archivo en uso. */
function guardadoDeMusica(estado, idMusica) {
  const audio = esObjeto(estado.audio) ? estado.audio : {};
  const mapa = esObjeto(audio.musica) ? audio.musica : {};
  const entrada = esObjeto(mapa[idMusica]) ? mapa[idMusica] : {};
  return { ruta: soloTexto(entrada.ruta) || null, durS: Number(entrada.dur_s) || 0 };
}

/**
 * Las pistas de música de una pieza: las que dicen ser suyas en su campo
 * «pieza» y las que se llaman como ella, que es como se emparejan en Audio y
 * en Montaje. Si la serie tuviera una sola pieza con material, serían todas:
 * no habría otra a la que pertenecer.
 */
function musicaDelMaterial(serie, idPieza, cuantasPiezas) {
  const musica = esObjeto(serie.musica) ? serie.musica : {};
  const todas = (Array.isArray(musica.piezas) ? musica.piezas : []).filter(
    (una) => esObjeto(una) && soloTexto(una.id)
  );
  const suyas = todas.filter(
    (una) =>
      soloTexto(una.pieza) === idPieza ||
      una.id === idPieza ||
      String(una.id).startsWith(`${idPieza}-`)
  );
  if (suyas.length) return suyas;
  if (cuantasPiezas === 1) return todas;
  return [];
}

/** El segundo en que empieza cada toma: el escrito, o la suma de las de antes. */
function iniciosDe(tomas) {
  let cursor = 0;
  return tomas.map((toma) => {
    const escrito = Number(toma.inicio);
    const inicio = Number.isFinite(escrito) ? escrito : cursor;
    cursor = inicio + (Number(toma.dur) || 0);
    return inicio;
  });
}

/** Las tomas agrupadas por escena consecutiva, con su segundo de inicio. */
function gruposPorEscena(tomas, inicios) {
  const grupos = [];
  tomas.forEach((toma, i) => {
    const escena = toma.escena === undefined || toma.escena === null ? null : String(toma.escena);
    const ultimo = grupos[grupos.length - 1];
    if (!ultimo || ultimo.escena !== escena) grupos.push({ escena, tomas: [] });
    grupos[grupos.length - 1].tomas.push({ toma, inicio: inicios[i] });
  });
  return grupos;
}

/** Los tramos de silencio absoluto de una pieza, como pares de segundos. */
function silenciosDelMaterial(datos) {
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
 * Los subtítulos de una pieza en formato .srt, que es el que abre cualquier
 * editor. Salen de las líneas de voz con sus segundos escritos en la pieza:
 * el mismo texto que se oye, en español, que es el que se quema en pantalla.
 */
function subtitulosEnSrt(lineas) {
  const cues = lineas.map((linea, i) => {
    const desde = Math.max(0, linea.t);
    const hasta = linea.hasta > linea.t ? linea.hasta : linea.t + 1;
    return `${i + 1}\n${enTiempoSrt(desde)} --> ${enTiempoSrt(hasta)}\n${linea.es}\n`;
  });
  return cues.join('\n');
}

/** «1:09», como se leen los tiempos en la guía. */
function enTiempo(segundos) {
  const total = Math.max(0, Math.round(Number(segundos) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** «00:01:09,500», como lo pide un .srt. */
function enTiempoSrt(segundos) {
  let ms = Math.round(Math.max(0, Number(segundos) || 0) * 1000);
  const horas = Math.floor(ms / 3600000);
  ms -= horas * 3600000;
  const minutos = Math.floor(ms / 60000);
  ms -= minutos * 60000;
  const segs = Math.floor(ms / 1000);
  ms -= segs * 1000;
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(horas)}:${dos(minutos)}:${dos(segs)},${String(ms).padStart(3, '0')}`;
}

/** Un id convertido en nombre de archivo: lo que no vale en un nombre, fuera. */
function nombreSano(valor) {
  const limpio = String(valor || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return limpio || 'sin-nombre';
}

/** La extensión de una ruta —«.png», «.mp4»—, o la dada si no se entiende. */
function extensionDeArchivo(ruta, porDefecto) {
  const punto = String(ruta || '').lastIndexOf('.');
  const barra = String(ruta || '').lastIndexOf('/');
  if (punto > barra && punto >= 0) return String(ruta).slice(punto);
  return porDefecto;
}

/**
 * El guion de la pieza en texto plano: lo que se ve y lo que se dice, plano a
 * plano y en orden. Se compone de lo que la pieza trae escrito —sus planos y
 * sus líneas—, que es el guion con el que se ha producido.
 */
function guionEnTexto(laPieza) {
  const datos = esObjeto(laPieza.datos) ? laPieza.datos : {};
  const tomas = (Array.isArray(datos.tomas) ? datos.tomas : []).filter(esObjeto);
  const inicios = iniciosDe(tomas);
  const lineas = lineasDeVoz(datos);

  const partes = [
    `GUION — ${laPieza.titulo}`,
    `Pieza: ${laPieza.id}`,
    '',
    'Lo que se ve y lo que se dice, en el orden en que va montado.',
    ''
  ];

  const dichas = new Set();
  let numero = 0;
  for (const grupo of gruposPorEscena(tomas, inicios)) {
    if (grupo.escena !== null) partes.push(`ESCENA ${grupo.escena}`, '');
    const desde = grupo.tomas.length ? grupo.tomas[0].inicio : 0;
    const ultima = grupo.tomas[grupo.tomas.length - 1];
    const hasta = ultima ? ultima.inicio + (Number(ultima.toma.dur) || 0) : desde;

    for (const { toma } of grupo.tomas) {
      numero += 1;
      const suNumero = String(numero).padStart(3, '0');
      partes.push(`[Plano ${suNumero}] ${soloTexto(toma.imagen)}`);
      if (soloTexto(toma.video)) partes.push(`  Vídeo: ${soloTexto(toma.video)}`);
    }
    for (const linea of lineas) {
      if (linea.t < desde || linea.t >= hasta) continue;
      dichas.add(linea);
      partes.push(`  ${linea.quien} (${enTiempo(linea.t)}): ${linea.es}`);
      if (linea.ja) partes.push(`    En japonés: ${linea.ja}`);
    }
    partes.push('');
  }

  const sueltas = lineas.filter((linea) => !dichas.has(linea));
  if (sueltas.length) {
    partes.push('DIÁLOGO SIN PLANO ASIGNADO', '');
    for (const linea of sueltas) {
      partes.push(`  ${linea.quien} (${enTiempo(linea.t)}): ${linea.es}`);
      if (linea.ja) partes.push(`    En japonés: ${linea.ja}`);
    }
    partes.push('');
  }

  return partes.join('\n');
}

/**
 * La guía de montaje del zip: cómo se monta esta pieza a mano con lo que el
 * zip trae. El orden de los planos, cuánto dura cada uno, qué frase entra en
 * él y dónde está dentro de su bloque de voz, la música, los efectos, y lo
 * que falta —escrito aquí para no tener que volver a abrir el estudio.
 */
function guiaDelMaterial(serie, estado, laPieza, plan) {
  const datos = esObjeto(laPieza.datos) ? laPieza.datos : {};
  const audio = esObjeto(datos.audio) ? datos.audio : {};
  const { conteos, detalle } = plan;
  const partes = [];

  partes.push(`# Guía de montaje — ${laPieza.titulo}`, '');
  partes.push(
    'Todo lo de este zip es el material EN USO de la pieza: la última imagen, el último clip y ' +
      'la última grabación de cada cosa. Y todo viene NUMERADO en el orden en que se monta: no ' +
      'hay que buscar qué va dónde, solo ponerlo en orden.',
    '',
    '- `01-en-orden/` es la imagen de la pieza, plano a plano: 001, 002, 003… hasta el último. ' +
      'Cada número es UN solo archivo: si el plano tiene vídeo, es `NNN-video`; si no lo tiene ' +
      '—un plano de cobertura, o un vídeo aún sin generar—, en su número va `NNN-imagen`, su ' +
      'imagen quieta. Se importa la carpeta ordenada y se coloca tal cual.',
    '- `02-dialogos/` son las voces, también por su número: cada archivo se llama por el número ' +
      'de su primer diálogo y dentro lleva sus diálogos seguidos, en orden.',
    '- `03-efectos/` lleva cada efecto con el número de su plano: el 045 suena en el plano 045.',
    '- `04-musica/` es la música de fondo de la pieza.',
    '- `subtitulos.srt` se importa y queda colocado solo; `guion.txt` es la pieza escrita.',
    ''
  );

  partes.push('## La pieza en números', '');
  partes.push(
    `- Dura unos ${enTiempo(plan.duracionS)} (${plural(conteos.tomas, 'plano', 'planos')}).`,
    `- La serie de montaje lleva ${conteos.clips + conteos.imagenes} archivos: ` +
      `${conteos.clips} vídeos y ${conteos.imagenes} imágenes, un número tras otro.`,
    `- Van ${conteos.efectos} efectos, cada uno con el número de su plano.`,
    `- Los diálogos van en ${plural(conteos.bloquesVoz, 'archivo', 'archivos')} de ${conteos.bloquesTotal}, ` +
      `con ${plural(conteos.lineas, 'frase', 'frases')} numeradas en su orden.`,
    `- La música: ${conteos.musica} de ${plural(conteos.musicaTotal, 'pista', 'pistas')}.`,
    ''
  );

  if (plan.pistas.length) {
    partes.push('## Música', '');
    for (const pista of plan.pistas) {
      partes.push(
        pista.archivo
          ? `- \`${pista.archivo}\` — la música de fondo de la pieza${pista.durS ? `, ${segundosCortos(pista.durS)}` : ''}.`
          : `- La pista de música ${plan.pistas.indexOf(pista) + 1} no está generada: no va en el zip.`
      );
    }
    if (Number.isFinite(Number(audio.cancion_entra_s)) && audio.cancion_entra_s !== null) {
      partes.push(`- La canción entra en ${enTiempo(Number(audio.cancion_entra_s))}.`);
    }
    if (Number.isFinite(Number(audio.percusion_entra_s)) && audio.percusion_entra_s !== null) {
      partes.push(`- La percusión entra en ${enTiempo(Number(audio.percusion_entra_s))}.`);
    }
    for (const par of silenciosDelMaterial(datos)) {
      partes.push(`- Silencio absoluto de ${enTiempo(par[0])} a ${enTiempo(par[1])}: ahí no suena nada.`);
    }
    partes.push('');
  }

  if (plan.bloques.length) {
    partes.push('## Diálogos', '');
    partes.push(
      'Los diálogos están numerados en el orden en que suenan: diálogo 001, 002, 003… La voz ' +
        'se graba por grupos de frases, no frase a frase, así que cada archivo de `02-dialogos/` ' +
        'se llama por el número de su PRIMER diálogo y dentro lleva los suyos seguidos, en ' +
        'orden: se colocan los archivos por su número y los diálogos quedan en su sitio. Debajo ' +
        'va cada diálogo con su número, el segundo en que entra en la pieza y —si se midió— el ' +
        'tramo exacto que ocupa dentro de su archivo, por si quieres cortar uno suelto: ESE ' +
        'tramo es el diálogo, ni un segundo más.',
      ''
    );
    for (const bloque of plan.bloques) {
      const primero = bloque.lineas.length ? bloque.lineas[0].dialogo : null;
      const ultimo = bloque.lineas.length ? bloque.lineas[bloque.lineas.length - 1].dialogo : null;
      partes.push(
        bloque.archivo
          ? `### \`${bloque.archivo}\` — diálogos ${primero} a ${ultimo} (${bloque.personajes.join(', ')})`
          : `### Diálogos ${primero} a ${ultimo} (${bloque.personajes.join(', ')}) — NO GRABADOS`,
        ''
      );
      for (const linea of bloque.lineas) {
        partes.push(
          `- Diálogo ${linea.dialogo} · ${enTiempo(linea.t)} · ${linea.quien}: «${linea.es}»` +
            (linea.tramo
              ? ` — en el archivo, de ${enTiempo(linea.tramo.inicio)} a ${enTiempo(linea.tramo.fin)}.`
              : '')
        );
      }
      partes.push('');
    }
  }

  partes.push('## Orden de montaje', '');
  partes.push(
    'La serie completa, número a número: es el mismo orden de la carpeta `01-en-orden/`.',
    ''
  );
  const grupos = [];
  {
    let actual = null;
    for (const suyo of detalle) {
      if (!actual || actual.escena !== suyo.escena) {
        actual = { escena: suyo.escena, planos: [] };
        grupos.push(actual);
      }
      actual.planos.push(suyo);
    }
  }
  for (const grupo of grupos) {
    if (grupo.escena !== null) partes.push(`### Escena ${grupo.escena}`, '');
    for (const suyo of grupo.planos) {
      partes.push(
        `${suyo.numero}. **Plano ${suyo.numero}** — entra en ${enTiempo(suyo.inicio)}, dura ${segundosCortos(suyo.dur)}`
      );
      partes.push(
        suyo.video
          ? `   - Vídeo: \`${suyo.video}\``
          : suyo.imagen
            ? suyo.cobertura
              ? `   - Imagen: \`${suyo.imagen}\` — es un plano de cobertura: va la imagen, con la cámara moviéndose en el editor`
              : `   - Imagen: \`${suyo.imagen}\` — su vídeo no está generado: va la imagen en su número`
            : '   - SIN ARCHIVO: este número no tiene ni imagen ni clip todavía'
      );
      if (suyo.recorte && (suyo.recorte[0] > 0 || suyo.recorte[1] > suyo.dur)) {
        partes.push(
          `   - Del clip se monta el tramo de ${segundosCortos(suyo.recorte[0])} a ${segundosCortos(suyo.recorte[1])}.`
        );
      }
      if (suyo.efecto) {
        partes.push(
          `   - Efecto: \`${suyo.efecto}\`${suyo.efectoTexto ? ` — ${suyo.efectoTexto}` : ''}`
        );
      }
      for (const linea of suyo.frases) {
        partes.push(`   - Diálogo ${linea.dialogo} · dice ${linea.quien}: «${linea.es}»`);
      }
    }
    partes.push('');
  }

  partes.push('## Subtítulos', '');
  partes.push(
    conteos.lineas
      ? 'El archivo `subtitulos.srt` trae las frases en español con sus tiempos de la pieza: se ' +
        'importa en el editor y queda colocado solo.'
      : 'La pieza no tiene diálogo escrito, así que no hay subtítulos.',
    ''
  );

  partes.push('## Lo que falta', '');
  if (plan.faltas.length) {
    for (const falta of plan.faltas) partes.push(`- ${falta}`);
  } else {
    partes.push('No falta nada: está todo el material de la pieza.');
  }
  partes.push('');

  return partes.join('\n');
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
  return deLaCaja(enlaces, ruta);
}

/**
 * El enlace de guardar de una ruta. Si su URL de descarga todavía no ha llegado,
 * se dice con palabras en vez de poner un enlace que abriría el archivo: abrirlo
 * es justo lo que no se quiere.
 */
function enlaceParaGuardar(ruta, texto) {
  const url = enlaceDeDescarga(ruta);
  if (url) return h('a', { href: url, download: '', clase: 'enlace' }, texto);

  // SI NO HA SALIDO, SE DICE QUE NO HA SALIDO. La tentación es poner aquí la URL
  // de mirar, que sí está: se descartó, y con razón. Esa URL ABRE el archivo en
  // una pestaña en vez de guardarlo, y ese fue el fallo original —«le doy a
  // descargar y lo que hace es abrirse esta página»—. Un botón que no cumple lo
  // que dice es peor que ninguno.
  //
  // Lo que no puede volver a pasar es lo otro: quedarse en «preparando» para
  // siempre sin que nadie pueda saber si se está intentando o ya se rindió.
  if (sinDescarga.has(ruta)) {
    return h(
      'span',
      { clase: 'tenue' },
      'No se ha podido preparar la descarga de este archivo. Con el botón de volver a pedir los ' +
        'enlaces, arriba, se intenta otra vez.'
    );
  }
  return h('span', { clase: 'tenue' }, 'Preparando la descarga…');
}

/** El enlace con el que se DESCARGA una ruta, si ya se ha pedido. */
function enlaceDeDescarga(ruta) {
  return deLaCaja(enlacesDeDescarga, ruta);
}

function deLaCaja(caja, ruta) {
  const guardado = caja.get(ruta);
  if (!guardado) return null;
  if (guardado.hasta <= Date.now()) {
    caja.delete(ruta);
    return null;
  }
  return guardado.url;
}

function pedirEnlacesQueFalten(rutas, repintar) {
  if (pidiendoEnlaces) return;

  const todas = [...new Set(rutas)].filter(Boolean);
  const paraVer = todas.filter((ruta) => !enlaceDe(ruta) && !sinEnlace.has(ruta));
  const paraBajar = todas.filter(
    (ruta) => !enlaceDeDescarga(ruta) && !sinEnlace.has(ruta) && !sinDescarga.has(ruta)
  );
  if (!paraVer.length && !paraBajar.length) return;

  pidiendoEnlaces = true;
  quejaDeEnlaces = null;

  (async () => {
    // Dos tandas: las de mirar y las de descargar. Son URLs distintas del mismo
    // archivo, y hacen falta las dos: una se pone en el `<video>` y la otra en
    // el enlace de guardar.
    //
    // CADA UNA SE INTENTA PASE LO QUE PASE CON LA OTRA. Antes iban seguidas, así
    // que si fallaba la de mirar, la de descargar no llegaba a pedirse nunca y
    // el botón de guardar se quedaba en gris sin explicación. Son dos cosas
    // distintas y una no tiene por qué llevarse a la otra por delante.
    await pedirTanda(paraVer, enlaces, false).catch((fallo) => {
      quejaDeEnlaces = comoErrorDeCara(fallo);
      for (const ruta of paraVer) if (!enlaceDe(ruta)) sinEnlace.add(ruta);
    });
    await pedirTanda(paraBajar, enlacesDeDescarga, true).catch((fallo) => {
      if (!quejaDeEnlaces) quejaDeEnlaces = comoErrorDeCara(fallo);
      for (const ruta of paraBajar) if (!enlaceDeDescarga(ruta)) sinDescarga.add(ruta);
    });
  })()
    .catch((fallo) => {
      quejaDeEnlaces = comoErrorDeCara(fallo);
    })
    .finally(() => {
      pidiendoEnlaces = false;
      repintar();
    });
}

/** Pide una tanda de firmas y las guarda en su caja. */
async function pedirTanda(rutas, caja, descargar) {
  for (let i = 0; i < rutas.length; i += MAXIMO_POR_FIRMA) {
    const lote = rutas.slice(i, i + MAXIMO_POR_FIRMA);
    const respuesta = await llamar('firmar', descargar ? { rutas: lote, descargar: true } : { rutas: lote });
    const dadas = esObjeto(respuesta) && esObjeto(respuesta.urls) ? respuesta.urls : {};
    for (const ruta of lote) {
      const url = dadas[ruta];
      if (typeof url === 'string' && url) {
        caja.set(ruta, { url, hasta: Date.now() + VIDA_DE_URL_MS });
      } else if (descargar) {
        // Que falle la de descargar no impide ver el archivo, así que no se
        // apunta con las imposibles. Pero SÍ se apunta: si no, el botón se queda
        // «preparando la descarga» hasta que se cierre la pantalla.
        sinDescarga.add(ruta);
      } else {
        sinEnlace.add(ruta);
      }
    }
  }
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
