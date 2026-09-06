// EL REEL: treinta segundos en vertical, armados solos.
//
// Un reel no genera nada. No llama a ningún modelo, no cuesta un céntimo de
// Vertex y no espera a nada: coge los clips que YA están aprobados y la música
// que YA está aprobada, y los pone uno detrás de otro. Lo único que gasta es un
// rato de máquina en el montador, igual que cualquier otro montaje.
//
// POR QUÉ ES UN MÓDULO APARTE Y NO UN TROZO DE LA PANTALLA. Porque el corte se
// puede comprobar sin navegador. La pantalla enseña botones; lo que decide qué
// planos entran, cuánto dura cada uno y dónde empieza la música son funciones
// puras, y `npm run reel` las ejecuta con estados de mentira. Un reel mal
// cortado no da ningún error: da un vídeo con un parpadeo, o con un negro de
// tres segundos al final, y eso solo se ve mirándolo, después de haber esperado
// los minutos del montador.
//
// LAS CUATRO DECISIONES, y las cuatro están escritas en datos/serie.json para
// que se cambien ahí y no aquí:
//
//   1. EL ORDEN ES EL DEL GUION. No hay ninguna nota en los datos que diga qué
//      plano es «el bueno», así que inventarse un orden sería inventarse un
//      criterio. En el orden del guion, un reel del teaser es el teaser contado
//      corto, que es exactamente lo que se quiere.
//
//   2. LOS PLANOS MUY CORTOS SE SALTAN. Por debajo del mínimo, un plano
//      parpadea y se lee como un fallo de reproducción, no como montaje.
//
//   3. LOS PLANOS MUY LARGOS SE CORTAN, y se cortan por el FINAL: se coge su
//      principio. En treinta segundos caben diez o doce planos; con cuatro
//      planos de ocho segundos no es un reel, es un vídeo lento.
//
//   4. EL ÚLTIMO PLANO ATERRIZA EXACTAMENTE EN LOS TREINTA. Y si al recortarlo
//      quedara por debajo del mínimo, no se recorta: se deja fuera y el reel
//      dura un poco menos. Un parpadeo al final es peor que dos segundos menos.
//
//      Cuando de ese ajuste sobra un pico —queda un segundo y no cabe ni el
//      plano más corto que se acepta—, ese pico NO se deja como está: se reparte
//      estirando planos desde el último hacia atrás, hasta donde llegue el
//      material de cada clip. Un reel de veintinueve segundos no es «casi
//      treinta»: es un vídeo que se corta antes de tiempo, y eso se nota. Un
//      plano que respira un segundo más al final no lo nota nadie.
//
//      Ese pico nunca puede pasar del mínimo —el corte se para justo cuando lo
//      que queda es menor que el plano más corto que se acepta—, así que ningún
//      plano se estira más de eso. Y solo se estira si el reel se LLENÓ: cuando
//      lo que se acabaron fueron los clips, el hueco no es un pico, es que no
//      hay material, y el reel se queda corto y ya está.
//
// LO QUE UN REEL NO LLEVA: voz ni subtítulos. Con el diálogo en japonés no se
// entiende en el móvil de nadie, y con el diálogo en español un reel de treinta
// segundos cuenta el capítulo entero. Va la música y nada más.
//
// Y LAS BARRAS NEGRAS SON A PROPÓSITO. El material está rodado en 16:9. El
// montador escala cada plano hasta que quepa entero dentro del 1080 × 1920 y
// rellena el resto de negro. Recortar a vertical dejaría media cara fuera de
// cuadro en casi todos los planos, que es peor que una franja negra.

import { claveDelMaterial } from './planos.js';

// ---------------------------------------------------------------------------
// Números y palabras fijas
// ---------------------------------------------------------------------------

/**
 * La capa con la que se le encarga al montador. Un reel ES una capa «pieza»:
 * planos con su audio y sin capas ya montadas debajo. Se dice así a propósito y
 * no con una capa nueva, porque el montador que está desplegado hoy comprueba la
 * capa contra su propia lista: una capa inventada haría fallar el trabajo en la
 * nube, después de los minutos de espera, y obligaría a volver a desplegarlo.
 */
export const CAPA_DEL_REEL = 'pieza';

/** Dónde deja el montador lo que monta. La misma carpeta que el resto. */
const CARPETA = 'montaje';

/** Margen para comparar segundos, igual que en el montaje. */
const MARGEN_S = 0.02;

/** Los valores que se usan si en los datos no hay nada escrito. */
const POR_DEFECTO = {
  duracion_s: 30,
  formato: { ancho: 1080, alto: 1920, fps: 24 },
  minimo_plano_s: 1.2,
  maximo_plano_s: 3.5,
  ganancia_musica_db: -3
};

// ---------------------------------------------------------------------------
// Los ajustes, leídos de la serie
// ---------------------------------------------------------------------------

/**
 * Los ajustes del reel tal como están en `difusion.reels`, con los huecos
 * rellenados. No se inventa nada raro: si falta un número, se usa el de arriba,
 * que es el que estaba escrito el día que esto se hizo.
 *
 * @param {object} serie
 * @returns {{duracionS:number, formato:{ancho:number,alto:number,fps:number},
 *            minimoS:number, maximoS:number, gananciaDb:number}}
 */
export function ajustesDelReel(serie) {
  const difusion = esObjeto(serie && serie.difusion) ? serie.difusion : {};
  const reels = esObjeto(difusion.reels) ? difusion.reels : {};
  const formato = esObjeto(reels.formato) ? reels.formato : {};

  return {
    duracionS: numeroBueno(reels.duracion_s, POR_DEFECTO.duracion_s),
    formato: {
      ancho: enteroPar(formato.ancho, POR_DEFECTO.formato.ancho),
      alto: enteroPar(formato.alto, POR_DEFECTO.formato.alto),
      fps: Math.round(numeroBueno(formato.fps, POR_DEFECTO.formato.fps))
    },
    minimoS: numeroBueno(reels.minimo_plano_s, POR_DEFECTO.minimo_plano_s),
    maximoS: numeroBueno(reels.maximo_plano_s, POR_DEFECTO.maximo_plano_s),
    gananciaDb: Number.isFinite(Number(reels.ganancia_musica_db))
      ? Number(reels.ganancia_musica_db)
      : POR_DEFECTO.ganancia_musica_db
  };
}

// ---------------------------------------------------------------------------
// El corte
// ---------------------------------------------------------------------------

/**
 * Qué planos entran en el reel y con qué recorte, en el orden del guion.
 *
 * Devuelve la lista lista para el manifiesto: cada entrada ya trae su `origen`
 * —el clip aprobado que existe en el bucket—, su recorte y el segundo en el que
 * entra, que aquí siempre es «justo detrás del anterior»: un reel no tiene línea
 * de tiempo propia, se va pegando.
 *
 * @param {object} serie
 * @param {object} estado
 * @param {string} idPieza
 * @returns {{planos:object[], duracionS:number, cuantosHay:number, cuantosSeSaltan:number,
 *            saltados:string[], sinClip:number}}
 */
export function cortarElReel(serie, estado, idPieza) {
  const ajustes = ajustesDelReel(serie);
  const piezas = esObjeto(serie && serie.piezas) ? serie.piezas : {};
  const laPieza = esObjeto(piezas[idPieza]) ? piezas[idPieza] : {};
  const tomas = Array.isArray(laPieza.tomas) ? laPieza.tomas : [];

  const planos = [];
  const elegidos = [];
  const saltados = [];
  let sinClip = 0;
  let cuantosHay = 0;
  let usado = 0;
  // Si el corte se paró porque ya no cabía nada más, y no porque se acabaran los
  // clips. Es la diferencia entre un pico de un segundo, que se rellena, y un
  // reel de diez, que se deja corto: estirar tres planos hasta treinta segundos
  // no daría un reel, daría tres planos lentísimos.
  let lleno = false;

  for (const laToma of tomas) {
    if (!esObjeto(laToma) || !soloTexto(laToma.id)) continue;

    // Lo que queda por llenar. Cuando ya no cabe ni el plano más corto que se
    // acepta, se para: seguir buscando no encontraría nada que meter.
    const queda = ajustes.duracionS - usado;
    if (queda <= ajustes.minimoS + MARGEN_S) {
      lleno = true;
      break;
    }

    const origen = clipAprobado(estado, claveDelMaterial(idPieza, laToma));
    if (!origen) {
      sinClip += 1;
      continue;
    }
    cuantosHay += 1;

    const recorte = recorteDeLaToma(laToma);
    const suyo = recorte.hasta - recorte.desde;
    if (!(suyo > 0)) {
      saltados.push(`${laToma.id} (su recorte no coge nada)`);
      continue;
    }

    if (suyo + MARGEN_S < ajustes.minimoS) {
      saltados.push(`${laToma.id} (dura ${redondear(suyo)} s y parpadearía)`);
      continue;
    }

    // Se coge el principio del plano, cortado al máximo y a lo que quede.
    const largo = redondear(Math.min(suyo, ajustes.maximoS, queda));

    // Si al ajustarlo a lo que queda se ha quedado por debajo del mínimo, no
    // entra: un parpadeo al final es peor que un reel dos segundos más corto.
    if (largo + MARGEN_S < ajustes.minimoS) {
      lleno = true;
      break;
    }

    // De cada plano se guarda cuánto se le coge y hasta dónde llega su material.
    // El segundo en el que entra NO se calcula todavía: el reparto de abajo
    // puede alargar cualquiera de ellos, y entonces todos los siguientes se
    // corren. Se pone al final, de una vez, y así no hay dos sitios que puedan
    // desacordarse.
    elegidos.push({
      id: laToma.id,
      origen,
      desde: redondear(recorte.desde),
      largo,
      tope: redondear(recorte.hasta)
    });
    usado = redondear(usado + largo);
  }

  // EL PICO QUE SOBRA. Cuando ya no cabe ni el plano más corto que se acepta,
  // quedan uno o dos segundos sin llenar, y un reel que se corta antes de tiempo
  // se nota. Ese pico se reparte estirando planos, empezando por el ÚLTIMO y
  // yendo hacia atrás: el final es donde un plano que respira un segundo más
  // parece intención y no descuido. Solo se estira lo que el clip tenga de
  // material: pedirle a ffmpeg un segundo que no está congelaría la imagen.
  //
  // SOLO SI EL REEL SE LLENÓ. Si lo que se acabaron fueron los clips, el hueco
  // no es un pico: es que no hay material, y estirar lo poco que hay para
  // taparlo daría un vídeo lentísimo en vez de un reel corto y honrado. Como el
  // corte se para en cuanto lo que queda es menor que el plano más corto que se
  // acepta, este pico nunca pasa de ese mínimo: ningún plano crece más de eso.
  let sobra = lleno ? redondear(ajustes.duracionS - usado) : 0;
  for (let i = elegidos.length - 1; i >= 0 && sobra > MARGEN_S; i -= 1) {
    const uno = elegidos[i];
    const puede = redondear(uno.tope - (uno.desde + uno.largo));
    const estira = Math.min(sobra, puede > 0 ? puede : 0);
    if (estira <= MARGEN_S) continue;
    uno.largo = redondear(uno.largo + estira);
    usado = redondear(usado + estira);
    sobra = redondear(sobra - estira);
  }

  // Y ahora sí, el segundo en el que entra cada uno: pegados, en orden.
  let en = 0;
  for (const uno of elegidos) {
    planos.push({
      id: uno.id,
      origen: uno.origen,
      desde: uno.desde,
      hasta: redondear(uno.desde + uno.largo),
      en: redondear(en),
      paso_de_dos: false
    });
    en = redondear(en + uno.largo);
  }

  return {
    planos,
    duracionS: redondear(usado),
    cuantosHay,
    cuantosSeSaltan: saltados.length,
    saltados,
    sinClip
  };
}

/**
 * El recorte de un plano tal como está escrito en los datos. `recorte` es un par
 * `[desde, hasta]`; si no está, se usa lo que dure el plano desde el principio.
 * @param {object} laToma
 * @returns {{desde:number, hasta:number}}
 */
function recorteDeLaToma(laToma) {
  const par = Array.isArray(laToma.recorte) ? laToma.recorte : null;
  const desde = par && Number.isFinite(Number(par[0])) ? Math.max(0, Number(par[0])) : 0;
  const dur = Number(laToma.dur);
  const hasta =
    par && Number.isFinite(Number(par[1]))
      ? Number(par[1])
      : desde + (Number.isFinite(dur) ? dur : 0);
  return { desde, hasta };
}

// ---------------------------------------------------------------------------
// La música
// ---------------------------------------------------------------------------

/**
 * La pista de música del reel: la primera pieza de música de esa pieza que esté
 * generada Y aprobada, desde su segundo cero y recortada a lo que dure el reel.
 *
 * Devuelve null si no hay ninguna. Un reel sin música se puede montar —sale
 * mudo— y esta función no decide si eso vale: lo decide la pantalla.
 *
 * @param {object} serie
 * @param {object} estado
 * @param {string} idPieza
 * @param {number} duracionS
 * @returns {object|null}
 */
export function musicaDelReel(serie, estado, idPieza, duracionS) {
  const ajustes = ajustesDelReel(serie);
  const musica = esObjeto(serie && serie.musica) ? serie.musica : {};
  const lista = Array.isArray(musica.piezas) ? musica.piezas : [];

  for (const una of lista) {
    if (!esObjeto(una) || soloTexto(una.pieza) !== idPieza) continue;
    const guardado = musicaGuardada(estado, soloTexto(una.id));
    if (!guardado.ruta || !guardado.aprobada) continue;

    const largo = guardado.durS > 0 ? Math.min(guardado.durS, duracionS) : duracionS;
    return {
      pista: 'musica',
      origen: guardado.ruta,
      desde: 0,
      hasta: redondear(largo),
      en: 0,
      ganancia_db: ajustes.gananciaDb,
      // No hay voz debajo, así que no hay nada a lo que agacharse. Ponerlo en
      // true haría que el montador buscase una pista de voz que no existe.
      agacha: false
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// El manifiesto
// ---------------------------------------------------------------------------

/**
 * El manifiesto entero del reel de una pieza, listo para encolar. Si no se puede
 * armar, devuelve `manifiesto: null` y una lista de lo que falta, cada cosa
 * dicha con palabras.
 *
 * @param {object} serie
 * @param {object} estado
 * @param {string} idPieza
 * @param {number} version qué número de reel es este, para no pisar el anterior
 * @returns {{manifiesto:object|null, faltas:string[], notas:string[], corte:object}}
 */
export function manifiestoDelReel(serie, estado, idPieza, version) {
  const ajustes = ajustesDelReel(serie);
  const corte = cortarElReel(serie, estado, idPieza);
  const faltas = [];
  const notas = [];

  if (!corte.planos.length) {
    faltas.push(
      corte.sinClip > 0
        ? `Ningún plano de esta pieza tiene clip elegido todavía (hay ${corte.sinClip} sin él). Un ` +
          'clip se elige reproduciéndolo, en la pantalla de Tomas, y el reel se arma con los que ' +
          'ya estén elegidos: no genera vídeo nuevo.'
        : 'Esta pieza no tiene ni un plano que sirva para un reel.'
    );
  }

  const musica = musicaDelReel(serie, estado, idPieza, corte.duracionS);
  if (!musica) {
    faltas.push(
      'No hay música aprobada de esta pieza, y un reel mudo no se sube a ninguna parte. Se genera ' +
        'y se escucha en la pantalla de Audio.'
    );
  }

  if (corte.saltados.length) {
    notas.push(
      `Se han dejado fuera ${corte.saltados.length} plano${corte.saltados.length === 1 ? '' : 's'}: ` +
        `${corte.saltados.join(', ')}.`
    );
  }
  if (corte.duracionS + MARGEN_S < ajustes.duracionS && corte.planos.length) {
    notas.push(
      `El reel va a durar ${redondear(corte.duracionS)} s en vez de ${ajustes.duracionS}: no hay ` +
        'más clips elegidos con los que llenarlo. En cuanto haya más, se rehace.'
    );
  }
  if (corte.sinClip && corte.planos.length) {
    notas.push(
      `${corte.sinClip} plano${corte.sinClip === 1 ? '' : 's'} de esta pieza todavía no ` +
        `${corte.sinClip === 1 ? 'tiene' : 'tienen'} clip elegido y no ` +
        `${corte.sinClip === 1 ? 'entra' : 'entran'} en el reel.`
    );
  }

  if (faltas.length) return { manifiesto: null, faltas, notas, corte };

  const trabajo = nombreDelReel(idPieza, version);
  const manifiesto = {
    trabajo,
    capa: CAPA_DEL_REEL,
    salida: `${CARPETA}/${trabajo}.mp4`,
    formato: ajustes.formato,
    video: corte.planos,
    audio: [musica],
    silencios: [],
    // Sin subtítulos a propósito: en el reel no hay voz que subtitular.
    subtitulos: [],
    capas_previas: []
  };

  // El acabado de la pieza, para que el reel se vea como la serie y no como
  // material en bruto. El paso de dos va vacío: los planos ya están montados con
  // el suyo, y volver a pisarlos aquí los dejaría a seis fotogramas.
  const acabado = acabadoDeLaPieza(serie, idPieza);
  if (acabado) manifiesto.acabado = { cadena: acabado, paso_de_dos: [] };

  return { manifiesto, faltas, notas, corte };
}

/** «reel-teaser-2»: la pieza y su versión, para que rehacerlo no pise lo hecho. */
export function nombreDelReel(idPieza, version) {
  const numero = Number(version);
  return `reel-${idPieza}-${Number.isFinite(numero) && numero > 0 ? Math.round(numero) : 1}`;
}

/** Si una ruta de montaje es el reel de esta pieza. */
export function esReelDe(ruta, idPieza) {
  const nombre = String(ruta || '');
  return nombre.startsWith(`${CARPETA}/reel-${idPieza}-`) && /\.mp4$/i.test(nombre);
}

/** La cadena de acabado de una pieza, si la tiene escrita. */
function acabadoDeLaPieza(serie, idPieza) {
  const piezas = esObjeto(serie && serie.piezas) ? serie.piezas : {};
  const laPieza = esObjeto(piezas[idPieza]) ? piezas[idPieza] : {};
  const acabado = esObjeto(laPieza.acabado) ? laPieza.acabado : {};
  return soloTexto(acabado.cadena_ffmpeg) || null;
}

// ---------------------------------------------------------------------------
// Lo que se lee del estado
// ---------------------------------------------------------------------------

/** El clip elegido de un plano, si lo hay. */
function clipAprobado(estado, clave) {
  const tomas = esObjeto(estado && estado.tomas) ? estado.tomas : {};
  const entrada = esObjeto(tomas[clave]) ? tomas[clave] : {};
  return soloTexto(entrada.clip_elegido) || null;
}

/** Lo guardado de una pieza de música. */
function musicaGuardada(estado, id) {
  const audio = esObjeto(estado && estado.audio) ? estado.audio : {};
  const mapa = esObjeto(audio.musica) ? audio.musica : {};
  const entrada = esObjeto(mapa[id]) ? mapa[id] : {};
  const dur = Number(entrada.dur_s);
  return {
    ruta: soloTexto(entrada.ruta) || null,
    aprobada: entrada.aprobada === true,
    durS: Number.isFinite(dur) && dur > 0 ? dur : 0
  };
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

/** Un número que vale, y si no el de reserva. Nunca cero ni negativo. */
function numeroBueno(valor, reserva) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : reserva;
}

/** Un lado de vídeo tiene que ser entero y par: los códecs no aceptan impares. */
function enteroPar(valor, reserva) {
  const numero = Math.round(numeroBueno(valor, reserva));
  return numero % 2 === 0 ? numero : numero + 1;
}

/** Dos decimales, que es la precisión con la que se escriben los segundos. */
function redondear(n) {
  return Math.round(Number(n) * 100) / 100;
}
