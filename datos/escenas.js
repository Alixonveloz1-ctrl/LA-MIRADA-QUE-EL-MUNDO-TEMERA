// Lectura común para la pantalla, el desglose y la generación de imágenes.
import { MAPA_ESCENAS } from './mapa-escenas.js';
import { segmentosDeEscena } from './segmentos.js';

export function guiaDeEscena(episodio, escena) {
  return MAPA_ESCENAS[`${Number(episodio)}/${escena}`] || null;
}

export function guiaDePlano(episodio, escena, segmento) {
  const guia=guiaDeEscena(episodio,escena);
  if (!guia) return null;
  const segmentos=segmentosDeEscena(episodio,escena);
  if (!segmentos.length) return segmento ? null : guia;
  const s=segmentos.find(s=>s.id===segmento);
  if (!s) return null; // Un montaje sin separar no comparte una referencia física.
  const grupo=s.id.replace(/-[12]$/,'');
  const cena=Number(episodio)===10 && String(escena)==='16b' && grupo==='nina';
  return {...guia,escenario:s.escenario,lugar:s.lugar,momento:s.momento,flashback:s.flashback,
    espacio:cena ? guiaDeEscena(10,'16').espacio : `ep${episodio}/${escena}/${grupo}`,
    secuencia:cena ? guiaDeEscena(10,'16').secuencia : `ep${episodio}/${escena}/${grupo}`};
}
