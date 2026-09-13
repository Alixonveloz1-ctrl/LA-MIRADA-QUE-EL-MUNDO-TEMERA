// Un mapa para toda la temporada, construido desde el guion sin reescribirlo.
// Los enlaces añadidos aquí están contrastados con la acción, no solo con la
// placa del banco: dos habitaciones pueden compartir esa placa y ser distintas.
import { segmentosDeEscena } from './segmentos.js';

const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const NOMBRES = {
  cripta:'Cripta · sala del ritual', 'cripta-celda':'Celda de la cripta',
  tuneles:'Refugio de Saharis bajo la ciudad', 'elserath-salon':'Salón de la casa Elserath',
  'elserath-despacho':'Despacho de la casa Elserath', 'elserath-cocina':'Cocina de la casa Elserath',
  'elserath-jardin':'Jardín de la casa Elserath', 'vharn-jardin':'Jardín de la casa Vharn',
  consejo:'Consejo de Comercio', registros:'Sala de registros de la casa Vharn',
  orilla:'Orilla del río', campamento:'Campamento de refugiados',
  'bosque-lago':'Lago del bosque', 'bosque-cabana':'Cabaña del bosque',
  'casa-juego':'Casa de juego', 'puerta-ciudad':'Puerta norte de Feyrond'
};

function espacioDeEscena(ep, s) {
  const clave=`${ep}/${s.escena}`, lugar=normalizar(s.lugar), base=s.escenario;
  const sub=(id,nombre)=>({espacio:`${base}/${id}`,lugar:nombre});
  if (['1/23','1/24','2/1','12/7'].includes(clave)) return sub('puerta-cripta','Puerta de piedra bajo la ciudad · exterior');
  if (['8/23','8/24','9/1'].includes(clave)) return sub('cuarto-acolita','Cripta · habitación de la acólita anciana');
  if (clave==='12/15') return sub('acceso','Acceso al refugio · escalera y pasillo');
  if (ep===12 && ['12','13','14'].includes(String(s.escena))) return sub('portal','Portal del Barrio de Humo');
  if (base==='elserath-despacho') {
    if (lugar.includes('BIBLIOTECA')) return sub('biblioteca','Biblioteca de la casa Elserath');
    if (lugar.includes('ARCHIVO')) return sub('archivo','Archivo de la casa Elserath');
  }
  if (base==='cripta' && lugar.includes('PASILLO')) return sub('pasillo','Cripta · pasillo de las celdas');
  if (base==='academia') {
    for (const [palabra,nombre] of [['PATIO','Patio de la academia'],['ALTAR','Altar de la academia'],['AULA','Aula de la academia']]) {
      if (lugar.includes(palabra)) return sub(palabra.toLowerCase(),nombre);
    }
  }
  if (['casa-renn','casa-vharn','casa-ilmen'].includes(base)) {
    const casa={'casa-renn':'Renn','casa-vharn':'Vharn','casa-ilmen':'Ilmen'}[base];
    const partes=[['EXTERIOR','exterior','Exterior'],['TEJADO','tejado','Tejado'],['SOTANO','sotano','Sótano'],
      ['CALLEJON','callejon','Callejón junto a la casa'],['DESPACHO','despacho','Despacho'],
      ['COMEDOR','comedor','Comedor'],['PASILLO','pasillo','Pasillo'],
      ['HABITACION','habitacion','Dormitorio'],['ESCALERA','escalera','Escalera'],
      ['COCINA','cocina','Cocina'],['MESA','cocina','Cocina · mesa familiar'],['PUERTA','puerta','Puerta']];
    for (const [palabra,id,nombre] of partes) if (lugar.includes(palabra)) {
      if (base==='casa-ilmen' && id==='puerta') return sub('exterior','Puerta de la casa Ilmen · exterior');
      return sub(id,`${nombre} de la casa ${casa}`);
    }
  }
  if (base==='kadre') {
    if (lugar.includes('POSADA')) return sub('posada','Posada de Kadre · interior');
    if (lugar.includes('CALLE')) return sub('calle','Calle de Kadre');
    return sub('entrada','Entrada del pueblo de Kadre');
  }
  if (base==='barrio-humo' || base==='calle' || base==='bosque' || base==='casa-juego') {
    const alias={CALLEJONES:'CALLEJON', 'PUERTA':'PUERTA BAJO LA CIUDAD', 'CLARO DEL BOSQUE':'CLARO',
      SENDERO:'SENDERO DEL BOSQUE'};
    const id=alias[lugar] || lugar;
    return sub(id,String(s.lugar || NOMBRES[base] || base).toLocaleLowerCase('es').replace(/^./,x=>x.toUpperCase()));
  }
  return {espacio:base,lugar:NOMBRES[base] || s.lugar || base};
}

// Continuaciones que la cabecera no expresa con CONTINUO. Se incluyen los
// retornos tras recuerdos y los límites de capítulo que sí continúan la acción.
const ENLACES = {
  '1/2':'1/1', '1/16':'1/14', '1/18':'1/16', '1/21':'1/20',
  '2/1':'1/24', '2/15':'2/13', '2/24':'2/23',
  '3/20':'3/18', '4/1':'3/24', '4/8':'4/7', '4/17':'4/15',
  '6/18':'6/13', '6/23':'6/22', '6/24':'6/23',
  '7/11':'7/10', '7/12':'7/11',
  '8/7':'8/6', '9/1':'8/24', '9/23':'9/22',
  '10/7':'10/6', '10/17':'10/16', '10/19':'10/18',
  '12/19':'12/17'
};

// Un tiempo distinto no congela la iluminación de la referencia. Un enlace
// solo conserva lo que sigue vigente, nunca devuelve objetos o personas.
const ACLARACIONES = {
  '1/1':'La historia empieza en el pasado, con el nacimiento de Saharis.',
  '1/2':'Seguimos en la misma cripta, la misma noche, inmediatamente después de la escena 1.',
  '1/3':'Saltamos dieciséis años al presente. Saharis ya está sentado en la cena de la casa Elserath.',
  '1/5':'Sigue la misma reunión, más tarde. Saharis y Livia están ahora junto a una ventana del salón.',
  '1/8':'Sigue la misma cena. Saharis se ha cambiado de asiento y ahora está junto al invitado del anillo.',
  '1/15':'Volvemos al pasado. El ritual ha terminado y una acólita sostiene al bebé.',
  '2/1':'Continúa la vigilancia ante la puerta de piedra del final del capítulo 1. Saharis permanece fuera.',
  '4/1':'Continúa la investigación en el archivo de Elserath del final del capítulo 3.',
  '8/6':'Seguimos en el pasado, pero ahora es de día. La situación de Sura ha cambiado.',
  '9/1':'Continúa la conversación con la acólita anciana del final del capítulo 8. Llevan horas hablando.',
  '10/1':'El viaje hacia Kadre dura tres semanas. Esta escena recorre distintos puntos del camino.',
  '10/15':'Ahora es de noche. Saharis cena en casa Ilmen con la familia: once personas a la mesa.',
  '10/16b':'La canción alterna un recuerdo de la madre en la celda con la niña que canta durante la cena. Son lugares y tiempos separados.',
  '10/17':'Seguimos en la cena de casa Ilmen. Tras escuchar la canción, Saharis le pregunta a la niña qué cantaba.',
  '11/14':'Ha pasado la noche. Iven ha muerto y ahora se celebra su velatorio; la casa está llena de gente.',
  '12/1':'Han pasado seis meses. Saharis ocupa ahora la presidencia del Consejo.',
  '12/15':'Saharis vuelve al refugio tras un año sin bajar. Primero vemos la reja, la escalera y el pasillo.',
  '12/16':'Entramos en la habitación del refugio. La mesa tiene polvo y las preguntas que Saharis arrancó siguen ausentes.'
};

export function construirMapaDeEscenas(datos) {
  const mapa={}, orden=[];
  for (const e of datos.guiones) for (const s of e.escenas) {
    const clave=`${e.episodio}/${s.escena}`, previa=mapa[orden.at(-1)];
    const segmentos=segmentosDeEscena(e.episodio,s.escena);
    const espacio=espacioDeEscena(e.episodio,s);
    const momento=/CONTINUO|MÁS TARDE/.test(s.momento || '') ? previa?.momento || s.momento : s.momento;
    const item={episodio:e.episodio,escena:String(s.escena),escenario:s.escenario,...espacio,
      flashback:Boolean(s.flashback),momento,secuencia:`ep${e.episodio}/${s.escena}`,
      anterior:orden.at(-1) || null,siguiente:null,enlace:null,tipo:'cambio',transicion:''};
    const auto=previa && previa.episodio===e.episodio && /CONTINUO|MÁS TARDE/.test(s.momento || '') &&
      previa.espacio===item.espacio && previa.flashback===item.flashback &&
      !segmentos.length && !segmentosDeEscena(previa.episodio,previa.escena).length;
    const enlace=ENLACES[clave] || (auto ? item.anterior : null);
    if (enlace) {
      const fuente=mapa[enlace];
      if (!fuente || fuente.espacio!==item.espacio || fuente.flashback!==item.flashback) {
        throw new Error(`Enlace de historia incompatible: ${enlace} → ${clave}`);
      }
      item.enlace=enlace;
      item.secuencia=fuente.secuencia;
    }
    if (previa) previa.siguiente=clave;
    if (segmentos.length) {
      item.tipo='alternancia';
      item.transicion='Esta escena cambia de lugar entre tomas. Cada imagen corresponde solo al lugar y a la parte de la historia indicados debajo.';
    } else if (!previa) {
      item.tipo='inicio';
      item.transicion=`La historia empieza ${item.flashback?'en el pasado':'en el presente'}.`;
    } else if (item.enlace && item.enlace!==item.anterior) {
      item.tipo='regreso';
      const origen=mapa[item.enlace];
      item.transicion=`Volvemos ${item.flashback?'al recuerdo':'al presente'}: ${item.lugar}. Retomamos la acción de la escena ${origen.escena}${origen.episodio!==item.episodio?` del capítulo ${origen.episodio}`:''}.`;
    } else if (item.enlace) {
      item.tipo=(previa.momento!==item.momento || /MÁS TARDE/.test(s.momento))?'mas-tarde':'continua';
      item.transicion=item.tipo==='continua' ? `Continúa la acción de la escena ${previa.escena}, en el mismo lugar y momento.` :
        `Seguimos en el mismo lugar: ${item.lugar}. Ha pasado tiempo; ahora: ${String(item.momento).toLowerCase()}.`;
    } else if (previa.flashback!==item.flashback) {
      item.tipo=item.flashback?'recuerdo':'presente';
      item.transicion=`${item.flashback?'Entramos en un recuerdo':'Volvemos al presente'}. Lugar: ${item.lugar}.`;
    } else if (previa.espacio!==item.espacio) {
      item.tipo='lugar';
      item.transicion=`Cambiamos de lugar: de «${previa.lugar}» a «${item.lugar}».`;
    } else {
      item.tipo='otro-momento';
      item.transicion=`Comienza otra escena en «${item.lugar}». Ahora: ${String(item.momento).toLowerCase()}.`;
    }
    item.transicion=ACLARACIONES[clave] || item.transicion;
    mapa[clave]=item;orden.push(clave);
  }
  return mapa;
}

export function serializarMapaDeEscenas(mapa) {
  return '// Generado desde guiones.json y construir-mapa-escenas.js con npm run datos.\n'+
    'export const MAPA_ESCENAS = {\n'+Object.entries(mapa).map(([k,v])=>`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')+'\n};\n';
}
