// Relato para leer junto a una imagen. Nunca modifica el guion ni aprobaciones.
import { segmentosDeEscena } from '../datos/segmentos.js';

export function notaDeToma(pieza, toma, notas = {}) {
  const n = pieza.id === 'ep01' ? notas[toma.id] : null;
  return n && ['imagen', 'video', 'de_archivo'].every(k => (n[k] || null) === (toma[k] || null)) ? n : null;
}

export function contextoDeToma(pieza, toma, guiones = {}, notas = {}) {
  const numero = /^ep(\d+)$/.exec(pieza.id || '')?.[1];
  if (!numero) return null;
  const episodio = guiones.guiones?.find(e => Number(e.episodio) === Number(numero));
  const escena = episodio?.escenas?.find(e => String(e.escena) === String(toma.escena));
  const segmento = segmentosDeEscena(numero, toma.escena).find(s => s.id === toma.segmento);
  const tomas = pieza.tomas.filter(t => String(t.escena) === String(toma.escena));
  const posicion = tomas.findIndex(t => t.id === toma.id);
  const nota = notaDeToma(pieza, toma, notas);
  const relato = t => t?.historia || (t && notaDeToma(pieza, t, notas)?.texto) || '';
  return {
    titulo: `Escena ${toma.escena} · Toma ${posicion + 1} de ${tomas.length}`,
    lugar: segmento?.lugar || escena?.lugar || '',
    tiempo: segmento ? (segmento.flashback ? 'Recuerdo' : 'Presente') :
      segmentosDeEscena(numero, toma.escena).length && escena?.flashback ? 'Alterna pasado y presente' :
      escena ? (escena.flashback ? 'Recuerdo' : 'Presente') : '',
    historia: relato(toma),
    escena: escena?.accion || '',
    antes: relato(tomas[posicion - 1]),
    despues: relato(tomas[posicion + 1]),
    revision: nota?.revision_visual || null
  };
}
