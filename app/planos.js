// Dónde vive el material de un plano. Una regla, un sitio.
//
// Casi todos los planos guardan su keyframe y su clip a su propio nombre:
// «ep01/12-3». Pero hay planos que NO generan nada suyo porque apuntan al
// archivo —los planos de ambiente que se generan una vez para toda la temporada
// y se reutilizan en los doce episodios—, y esos leen el material del archivo:
// «archivo/arch-cripta-a».
//
// POR QUÉ ESTO ES UN MÓDULO Y NO DOS LÍNEAS EN CADA PANTALLA. La regla la
// necesitan tres sitios que no se hablan entre ellos: Tomas, para no ofrecer un
// botón de generar lo que ya está generado; Montaje, para poner en el manifiesto
// la ruta del clip que existe de verdad; y la cola, para no encolar trabajo de
// un plano que no lo tiene. Escrita tres veces, el día que cambie cambiará en
// dos, y el fallo sería que un episodio se monta con un hueco donde tenía que ir
// un plano de la cripta. Eso no se ve leyendo el código: se ve viendo el vídeo.
//
// LO QUE ESTE MÓDULO NO HACE. No decide si un plano DEBE apuntar al archivo:
// eso lo decide el desglose y lo escribe en los datos. Aquí solo se lee lo que
// esté escrito.

/** El nombre de la pieza que guarda el archivo de planos de ambiente. */
export const PIEZA_DEL_ARCHIVO = 'archivo';

/**
 * ¿Este plano apunta al archivo en vez de generar lo suyo?
 * @param {object} laToma
 * @returns {boolean}
 */
export function esDeArchivo(laToma) {
  return Boolean(laToma && typeof laToma.de_archivo === 'string' && laToma.de_archivo.trim());
}

/**
 * La clave del estado donde vive el material de un plano: su keyframe, su clip y
 * sus intentos.
 *
 * Para un plano normal es «pieza/toma». Para uno que apunta al archivo es la del
 * plano de archivo al que apunta, porque el material es ESE y no una copia: si
 * se copiara, habría que volver a pagarlo, que es justo lo que el archivo evita.
 *
 * @param {string} idPieza la pieza en la que está el plano
 * @param {object} laToma el plano tal cual está en los datos
 * @returns {string}
 */
export function claveDelMaterial(idPieza, laToma) {
  if (esDeArchivo(laToma)) return `${PIEZA_DEL_ARCHIVO}/${laToma.de_archivo.trim()}`;
  return `${idPieza}/${(laToma && laToma.id) || ''}`;
}

/**
 * La frase que explica, en pantalla, por qué un plano de archivo no tiene
 * botones. Se dice con palabras y no dejando el hueco en blanco: un botón que no
 * está y no se explica se lee como un fallo.
 *
 * @param {object} laToma
 * @returns {string}
 */
export function porQueNoSeGenera(laToma) {
  return (
    `Este plano no se genera aquí: usa «${laToma.de_archivo.trim()}» del archivo, que se genera ` +
    'una vez para toda la temporada y se reutiliza en los doce episodios. Si hay que rehacerlo, ' +
    'se rehace en el archivo y cambia en todos los sitios donde sale a la vez.'
  );
}
