// El plazo de la petición: cuánto tiempo le queda a la función antes de que la
// plataforma la mate.
//
// POR QUÉ EXISTE, Y ES EL FALLO QUE MÁS CARO SALIÓ DE MIRAR. Cada paso de una
// generación tenía su propio límite —45 s para llamar a Vertex, 45 s para
// escribir en el bucket, 20 s para canjear el token— y ninguno sabía nada de los
// demás. Sumados se pasan del techo de la plataforma, y cuando eso ocurre no hay
// error, ni excepción, ni una línea en los registros: Vercel corta la función y
// devuelve un 504 en bruto. En pantalla eso se lee como «se ha roto algo» sin
// más, y en los registros del servidor no aparece NADA, que es lo que hace que
// se busque el fallo en el sitio equivocado durante horas.
//
// Se comprobó con los registros de producción: siete 504 seguidos, cero errores
// de servidor. La función no fallaba. La mataban.
//
// LO QUE HACE ESTO. La puerta abre el plazo al empezar la petición. A partir de
// ahí, cada llamada que iba a esperar 45 s espera lo que le dejen: el mínimo
// entre su límite y lo que queda de plazo. Y cuando no queda nada, en vez de
// seguir hasta que corten se lanza un error de cara, en español, diciendo qué se
// estaba haciendo cuando se acabó el tiempo.
//
// Un módulo con estado, sí, y a propósito: en una función serverless cada
// petición es un proceso nuevo o un proceso reutilizado que atiende una petición
// cada vez, así que la variable de aquí es de esta petición y de ninguna otra.

import { ErrorDeCara } from './errores.js';

/**
 * El margen que se reserva SIEMPRE para componer la respuesta y escribirla.
 * Sin esto, agotar el plazo justo en la última llamada dejaría a la función sin
 * tiempo para contar lo que ha pasado, que es justo lo que hay que evitar.
 */
const MARGEN_MS = 5_000;

/** Cuándo se acaba el plazo de esta petición, en milisegundos. Null si no se abrió. */
let seAcaba = null;

/** Qué se estaba haciendo, para poder decirlo si se agota. */
let haciendo = '';

/**
 * Abre el plazo de una petición. Lo llama la puerta, una vez, al principio.
 *
 * @param {number} presupuestoMs lo que la plataforma le da a la función. Tiene
 *   que ser el mismo número que `maxDuration` en vercel.json.
 */
export function abrirPlazo(presupuestoMs) {
  const total = Number(presupuestoMs);
  seAcaba = Number.isFinite(total) && total > 0 ? Date.now() + total : null;
  haciendo = '';
}

/** Deja constancia de qué se está haciendo, por si el plazo se agota mientras. */
export function haciendoAhora(que) {
  if (typeof que === 'string' && que.trim()) haciendo = que.trim();
}

/**
 * Cuánto queda de plazo, ya descontado el margen de la respuesta.
 * @returns {number} milisegundos; `Infinity` si no hay plazo abierto.
 */
export function loQueQueda() {
  if (seAcaba === null) return Infinity;
  return seAcaba - Date.now() - MARGEN_MS;
}

/**
 * El límite que de verdad le toca a una llamada: el suyo, o lo que quede de
 * plazo si es menos.
 *
 * Si ya no queda nada, no devuelve un número: lanza. Salir aquí con un mensaje
 * en español es infinitamente mejor que salir a los diez segundos por un corte
 * de la plataforma que no deja ni rastro.
 *
 * @param {number} suyo el límite que pedía esa llamada
 * @param {string} [que] qué se está intentando hacer, para el mensaje
 * @returns {number}
 */
export function plazoPara(suyo, que) {
  if (que) haciendoAhora(que);

  const queda = loQueQueda();
  if (queda === Infinity) return suyo;

  if (queda <= 0) {
    throw new ErrorDeCara(
      'Se ha agotado el tiempo que la plataforma le da a esta llamada' +
        (haciendo ? `, y se ha agotado ${haciendo}` : '') +
        '. No se ha perdido nada de lo que ya estuviera guardado, y lo que se estuviera generando ' +
        'en Google puede haberse generado igual: si aparece un archivo nuevo en la carpeta de esa ' +
        'toma, es este. Vuelve a pedirlo; la cola lo reintenta sola. Si pasa siempre con lo mismo, ' +
        'es que ese paso tarda más de lo que cabe en una petición y hay que partirlo en dos.',
      { reintentable: true, http: 504 }
    );
  }

  return Math.max(1, Math.min(Number(suyo) || 0, queda));
}
