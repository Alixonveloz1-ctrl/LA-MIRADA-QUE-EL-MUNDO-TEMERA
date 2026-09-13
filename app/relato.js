// Relato para leer junto a una imagen. Nunca modifica el guion ni aprobaciones.
import { segmentosDeEscena } from '../datos/segmentos.js';
import { guiaDeEscena, guiaDePlano } from '../datos/escenas.js';
import { ESCENAS_EP01 } from '../datos/escenas-ep01.js';

function buscarEscena(guiones,numero,escena) {
  return guiones.guiones?.find(e=>Number(e.episodio)===Number(numero))?.escenas?.find(s=>String(s.escena)===String(escena));
}

// Un extracto de la acción sirve como contexto si aún no hay desglose. Nunca
// se presenta como descripción de una imagen concreta ni se traduce un prompt.
function extracto(texto,maximo=380) {
  const limpio=String(texto || '').trim();
  if (limpio.length<=maximo) return limpio;
  const parte=limpio.slice(0,maximo), corte=Math.max(parte.lastIndexOf('. '),parte.lastIndexOf('? '),parte.lastIndexOf('! '));
  return corte>80 ? parte.slice(0,corte+1) : parte.slice(0,parte.lastIndexOf(' '))+'…';
}

export function contextoDeEscena(pieza,escena,guiones={}) {
  const numero=Number(/^ep(\d+)$/.exec(pieza.id || '')?.[1]);
  const guia=guiaDeEscena(numero,escena);
  if (!guia) return null;
  const fuente=buscarEscena(guiones,numero,escena);
  const lectura=numero===1 ? ESCENAS_EP01[String(escena)] : null;
  const resumen=numero===12 && String(escena)==='1' ?
    'Seis meses después, Saharis preside el Consejo de Comercio. La sala está llena y él da paso al siguiente asunto.' :
    lectura?.resumen || extracto(fuente?.accion);
  return {...guia,titulo:lectura?.titulo || guia.lugar,resumen,
    tiempo:guia.tipo==='alternancia' && fuente?.flashback ? 'Alterna pasado y presente' :
      lectura?.tiempo || (guia.flashback?'Pasado · recuerdo':'Presente'),
    texto:fuente?.accion || ''};
}

export function notaDeToma(pieza, toma, notas = {}) {
  const n = pieza.id === 'ep01' ? notas[toma.id] : null;
  return n && ['imagen', 'video', 'de_archivo'].every(k => (n[k] || null) === (toma[k] || null)) ? n : null;
}

export function contextoDeToma(pieza, toma, guiones = {}, notas = {}) {
  const numero = /^ep(\d+)$/.exec(pieza.id || '')?.[1];
  if (!numero) return null;
  const escena=contextoDeEscena(pieza,toma.escena,guiones);
  const guia=guiaDePlano(numero,toma.escena,toma.segmento);
  const segmento = segmentosDeEscena(numero, toma.escena).find(s => s.id === toma.segmento);
  const tomas = pieza.tomas.filter(t => String(t.escena) === String(toma.escena));
  const posicion = tomas.findIndex(t => t.id === toma.id);
  const indice=pieza.tomas.findIndex(t=>t.id===toma.id);
  const nota = notaDeToma(pieza, toma, notas);
  const relato = t => t?.historia || (t && notaDeToma(pieza, t, notas)?.texto) || '';
  const vecina=(t,clave)=>{
    const [ep,id]=String(clave || '').split('/');
    const p=t ? pieza : {id:`ep${String(ep).padStart(2,'0')}`};
    const c=contextoDeEscena(p,t?.escena || id,guiones);
    return {texto:relato(t) || c?.resumen || '',titulo:t ? `Escena ${t.escena} · Toma ${pieza.tomas.filter(x=>String(x.escena)===String(t.escena)).findIndex(x=>x.id===t.id)+1}` :
      c ? `Capítulo ${c.episodio} · Escena ${c.escena}` : ''};
  };
  // Si todavía falta desglosar la escena vecina, se lee del guion. No se salta
  // a otra escena solo porque sea la última que tenga imágenes generadas.
  const previa=pieza.tomas[indice-1],proxima=pieza.tomas[indice+1];
  const esVecina=(t,clave)=>t && (`${Number(numero)}/${t.escena}`===clave || String(t.escena)===String(toma.escena));
  const antes=vecina(esVecina(previa,escena?.anterior)?previa:null,escena?.anterior);
  const despues=vecina(esVecina(proxima,escena?.siguiente)?proxima:null,escena?.siguiente);
  const cambiaSegmento=segmento && pieza.tomas[indice-1]?.segmento!==toma.segmento;
  return {
    titulo: `Escena ${toma.escena} · Toma ${posicion + 1} de ${tomas.length}`,
    lugar: guia?.lugar || escena?.lugar || '',
    tiempo: segmento ? (segmento.flashback ? 'Pasado · recuerdo' : 'Presente') : escena?.tiempo || '',
    momento:guia?.momento || escena?.momento || '',
    transicion: cambiaSegmento ? `Esta toma muestra ${segmento.flashback?'el recuerdo':'el presente'} en ${segmento.lugar}.` : posicion===0 ? escena?.transicion || '' : '',
    historia: relato(toma),
    resumen:escena?.resumen || '',
    escena: escena?.texto || '',
    antes: antes.texto, antesTitulo:antes.titulo,
    despues: despues.texto, despuesTitulo:despues.titulo,
    // Una observación pertenece a una RUTA de imagen, no al texto del encargo.
    // Cambiar las instrucciones no corrige mágicamente la imagen antigua.
    revision: (pieza.id === 'ep01' ? notas[toma.id]?.revision_visual : null) || null
  };
}
