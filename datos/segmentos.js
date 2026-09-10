// Segmentos en orden de montaje; no son escenas nuevas ni cambian el guion.
const segmento=(id,escenario,luz,lugar,flashback,personajes,accion)=>({
  id,escenario,luz,lugar,flashback,personajes:personajes.split(',').filter(Boolean),accion,
  interior:true,momento:'NOCHE'
});
const madre=id=>segmento(id,'cripta-celda','BARRIO','CELDA',true,'madre',
  'Past cell. The mother sings a remembered fragment with a broken voice. Frame her alone; no present-day Saharis or northern girl. No visible injuries.');
const nina=(id,final=false)=>segmento(id,'casa-ilmen','NOBLE','COCINA ILMEN',false,'nina-kadre,saharis,familia-ilmen',
  'Present warm family dinner, eleven people including Saharis. The six-year-old girl plays with bread and hums the same tune badly. Keep the occupied table outside the close-up. '+
  (final?'She becomes bored and stops mid-phrase.':'She hums absent-mindedly.'));
const SEGMENTOS={
  '10/16b':[madre('madre-1'),nina('nina-1'),madre('madre-2'),nina('nina-2',true)],
  '6/3':[
    segmento('planos','elserath-despacho','NOBLE','DESPACHO',false,'saharis','Saharis studies the river plans at his desk.'),
    segmento('ingeniero','elserath-despacho','NOBLE','SALA DE CONSULTA',false,'saharis,ingeniero','Saharis pays the engineer for a technical report. A private consultation, not a party.'),
    segmento('inspector','elserath-despacho','NOBLE','SALA PEQUEÑA',false,'saharis,inspector','Small meeting room. Focus on the inspector reacting to Saharis; the words are not heard. No child or mother is physically present.'),
    segmento('fiesta','elserath-salon','NOBLE','FIESTA',false,'saharis,mujer-concejal,invitados','Saharis addresses the councillor\'s wife at a party. Other guests remain in the background.')
  ],
  '8/8':[
    segmento('taberna','ciudad','NOBLE','INTERIOR TABERNA',false,'saharis,socio-vharn,clientes','Tavern interior in Feyrond. Saharis speaks with a Vharn associate, who leaves worried. City reference supplies local materials, not an aerial view.'),
    segmento('banco','ciudad','NOBLE','INTERIOR BANCO',false,'saharis,empleado-banco','Bank interior. Saharis moves a bill of exchange. No tavern, party or outdoor city view in this shot.'),
    segmento('fiesta','elserath-salon','NOBLE','FIESTA',false,'saharis,anciana,invitados','Saharis whispers to an elderly guest; she laughs. Keep other party guests. No violence.')
  ].map(s=>({...s,momento:'DÍAS'})),
  '12/6':[
    {...segmento('puerto','puerto','BARRIO','PUERTO EXTERIOR',false,'trabajadores','Workers unload cargo in order at the port.'),interior:false},
    segmento('juez','ciudad','NOBLE','DESPACHO DEL JUEZ',false,'juez','Interior civic office. Close view of a judge signing. City reference supplies architectural materials only.'),
    {...segmento('carro','puerta-ciudad','BARRIO','PUERTA NORTE',false,'carretero,escolta','A grain cart enters the north gate with an escort.'),interior:false},
    {...segmento('pan','calle','BARRIO','COLA DE PAN',false,'vecinos,repartidores','An orderly queue receives bread at a fixed price. No Saharis physically present.'),interior:false}
  ].map(s=>({...s,momento:'DÍA'}))
};

export function segmentosDeEscena(episodio,escena) {
  return (SEGMENTOS[`${Number(episodio)}/${escena}`] || []).map(s=>({...s,personajes:[...s.personajes]}));
}

export function puedeRedistribuir(episodio,escena) {
  return segmentosDeEscena(episodio,escena).length>0;
}
