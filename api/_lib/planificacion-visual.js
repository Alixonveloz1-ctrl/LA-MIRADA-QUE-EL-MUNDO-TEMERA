import { Buffer } from 'node:buffer';
import { escenaDeGuion } from './datos.js';
import { segmentosDeEscena } from '../../datos/segmentos.js';
import { ErrorDeCara } from './errores.js';

// Solo los escenarios aprobados de ESTA escena o de sus segmentos. No toma
// fotografías de otro lugar, de otro capítulo ni de intentos sin aprobar.
export function escenariosParaPlanificar(estado, episodio, escena) {
  const guion=escenaDeGuion(episodio,escena);
  const segmentos=segmentosDeEscena(episodio,escena);
  const ids=[...new Set(segmentos.length ? segmentos.map(s=>s.escenario) : [guion.escenario])];
  return ids.flatMap(id=>{
    const ruta=estado.escenarios?.[id]?.aprobada;
    return ruta ? [{escenario:id,ruta}] : [];
  });
}

export function partesConEscenarios(texto, referencias=[]) {
  const partes=[];
  for (const ref of referencias) {
    if (!ref.escenario || !ref.datos?.length) throw new ErrorDeCara('No se pudo leer el escenario aprobado para preparar las tomas.',{http:400,reintentable:false});
    const datos=Buffer.from(ref.datos);
    const mime=datos[0]===0x89 && datos[1]===0x50 ? 'image/png' :
      datos[0]===0xff && datos[1]===0xd8 ? 'image/jpeg' :
      datos.toString('ascii',0,4)==='RIFF' && datos.toString('ascii',8,12)==='WEBP' ? 'image/webp' : null;
    if (!mime) throw new ErrorDeCara('El escenario aprobado no contiene una imagen compatible.',{http:400,reintentable:false});
    partes.push({text:`APPROVED SET: ${ref.escenario}. Inspect this image before planning shots in this location. It fixes the physical architecture, furniture count, connected surfaces, object designs and their installed positions. A new camera only reframes this same set. A detail shot must select an object that exists here, keeping its mounting and position: a hanging lamp remains hanging, not a new tabletop lamp. The story controls time of day, occupancy and explicitly scripted changes. Do not copy incidental people or an empty-room state. For another segment use only its own matching set.`},
      {inlineData:{mimeType:mime,data:datos.toString('base64')}});
  }
  partes.push({text:texto});
  return partes;
}
