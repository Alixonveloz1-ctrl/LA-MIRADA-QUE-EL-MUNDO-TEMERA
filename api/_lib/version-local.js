import { ErrorDeCara } from './errores.js';
import { firmaDeToma, conservaMontaje, invalidarMontajes } from '../../app/continuidad.js';

/** Una versión pertenece a ESTE uso. Nunca mueve punteros del archivo. */
export function aplicarVersionLocal(estado,idPieza,antes,nueva,metadata={}) {
  const pieza=estado.piezas?.[idPieza];
  const indice=pieza?.tomas?.findIndex(t=>t.id===antes.id) ?? -1;
  if (indice<0 || !antes.de_archivo || firmaDeToma(pieza.tomas[indice])!==firmaDeToma(antes)) {
    throw new ErrorDeCara('Esta toma cambió mientras se preparaba. No se ha sustituido tu trabajo.',{http:409,reintentable:false});
  }
  if (!conservaMontaje([antes],[nueva]) || nueva.de_archivo || (nueva.segmento ?? null)!==(antes.segmento ?? null)) {
    throw new ErrorDeCara('La versión debe conservar esta toma y sus tiempos.',{http:409,reintentable:false});
  }
  if ((estado.cola || []).some(j=>j.args?.pieza===idPieza && j.args?.id===antes.id && ['pendiente','en_curso'].includes(j.estado))) {
    throw new ErrorDeCara('Espera a que termine el trabajo de esta toma antes de cambiarla.',{http:409,reintentable:false});
  }
  pieza.tomas[indice]={...antes,...nueva,inicio:antes.inicio,escena:antes.escena,
    de_archivo:null,archivo_original:antes.de_archivo,version_local:metadata,
    // Preservar una decisión explícita. Si no la había, la búsqueda habitual
    // solo elegirá una imagen aprobada del mismo lugar y momento.
    referencia_anterior:antes.referencia_anterior ?? true};
  const material=estado.tomas?.[`${idPieza}/${antes.id}`];
  if (material) {
    if (material.keyframe_aprobado || material.intentos_keyframe?.length) material.revision_pendiente=true;
    if (material.clip_elegido || material.intentos_clip?.length) material.clip_revision_pendiente=true;
  }
  invalidarMontajes(estado,idPieza);
}
