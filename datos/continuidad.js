// Correcciones contrastadas con la acción del guion. No modifica el texto fuente.
export const VERSION_CONTINUIDAD = 3;

// Aclaraciones del autor: prevalecen sobre las inferencias de esta revisión y
// sobre anotaciones de edad antiguas. No se reescribe el guion importado.
const CANON_DEL_AUTOR = 'AUTHOR-CONFIRMED NARRATIVE: Saharis is sixteen in the present; younger ages belong to past scenes. The mother\'s death is shown in episode 1; her later appearances belong to memories or past scenes, never a return to life in the present. Saharis remembers fragments of the lullaby, never heard it complete, and does not know its language. Do not invent a completed song, a replacement mother, survival, extra birthdays or a new chronological explanation. Episode order is presentation order, not the chronological order of memories. These author instructions take precedence over legacy age annotations and reference portraits. Episode summaries and adjacent scenes explain context, not extra action to depict in this shot.';

export function reglasNarrativas(episodio, escena) {
  if (episodio === 10 && String(escena.escena) === '16b') {
    return CANON_DEL_AUTOR + ' This is an INTERCUT: mother in the past cell, girl in the present warm Ilmen kitchen, then alternating cuts. They do not share a room or a time. Never merge them into one tableau or give the girl the mother\'s appearance.';
  }
  return CANON_DEL_AUTOR + (escena.flashback
    ? ' This scene is PAST: use the childhood age and physical state specified in this memory. Do not apply the present-day age or costume. A later memory does not make its characters alive in the present.'
    : ' This scene is PRESENT: Saharis has the author-confirmed sixteen-year-old design. People recalled or mentioned are not physically present. Preserve explicit elapsed-time cues without inventing a birthday or recalculating his age from other scenes.');
}

const REPARTO_EP1 = [
  'celebrante,madre,saharis,acolitos', 'celebrante,saharis,acolitos',
  'saharis,iven,rothar,livia,invitada,invitados,criados',
  'saharis,iven,rothar,livia,invitados,criados',
  'saharis,livia,invitados,criado', 'saharis,iven,rothar,livia,invitados,criados',
  'saharis,invitado,iven,rothar,livia,invitados,criados',
  'saharis,invitado,iven,rothar,livia,invitados,criados',
  'saharis,cocinero', 'saharis,rothar', 'saharis,perro', 'saharis,hombres',
  'saharis', 'saharis', 'saharis,acolita,celebrante', 'saharis', 'madre,saharis',
  'saharis', 'saharis,vendedora,mozo,nino,vecinos', 'saharis',
  'saharis,hombre,criados', 'saharis,hombre', 'saharis,hombre', 'saharis'
];
const REPARTOS = {
  '2/18':'saharis', '2/24':'saharis', '3/18':'saharis', '3/22':'saharis,iven',
  '3/2':'consejeros', '3/11':'rothar,osk', '3/12':'saharis,rothar,osk',
  '3/14':'saharis,comerciantes', '3/15':'saharis,comerciantes', '3/16':'saharis,hombre,comerciantes',
  '6/3':'saharis,ingeniero,inspector,mujer-concejal,invitados',
  '8/8':'saharis,socio-vharn,empleado-banco,anciana,invitados,clientes',
  '12/6':'trabajadores,juez,carretero,escolta,vecinos,repartidores',
  '2/2': 'saharis,madre', '2/7': 'saharis,madre', '2/8': 'saharis,madre',
  '2/14': 'saharis,madre', '2/16': 'saharis,livia', '2/22': 'saharis,madre',
  '3/1': 'saharis,iven,secretario,consejeros', '3/3': 'saharis,ninos,padres',
  '3/4': 'saharis,anciano-academia,sacerdotes,acolito',
  '3/5': 'saharis,anciano-academia,sacerdotes,acolito',
  '3/8': 'saharis,ninos,maestro', '3/9': 'saharis,ninos,maestro',
  '3/19': 'saharis,sacerdotes', '4/5': 'saharis', '4/6': 'saharis,madre',
  '4/7': 'saharis,madre,celebrante', '4/8': 'saharis,madre',
  '4/11': 'saharis,celebrante,vharn,deras,invitados', '4/12': 'saharis,celebrante',
  '4/13': 'saharis,celebrante', '4/23': 'saharis',
  '5/6': 'saharis,eira', '5/9': 'eira,saharis,refugiados', '5/13': 'saharis',
  '6/9': 'saharis,eira', '6/10': 'saharis,eira', '6/14': 'saharis,kael',
  '6/15': 'saharis,kael,eira', '6/16': 'saharis,kael,eira', '6/17': 'saharis,kael,eira',
  '7/6': 'saharis,madre', '7/7': 'saharis,madre', '7/8': 'saharis,madre',
  '7/22': 'saharis,cautiva', '7/23': 'saharis,cautiva', '7/24': 'saharis,cautiva',
  '8/2': 'saharis,cautiva,encargados', '8/5': 'saharis,sura', '8/6': 'saharis,sura',
  '8/7': 'saharis,sura', '8/11': 'saharis,sura', '8/12': 'saharis,sura',
  '8/13': 'saharis,soldados', '9/13': 'saharis', '10/7': 'abuela,saharis',
  '10/16b': 'madre,saharis,nina-kadre', '11/21': 'saharis,celebrante',
  '11/22': 'saharis,celebrante', '11/23': 'saharis,celebrante', '12/18': 'saharis,madre'
};
const LUGARES = {
  '2/1': 'calle', '4/13': 'vharn-jardin', '12/7': 'calle',
  ...Object.fromEntries(['9','10','11','12','13','14','21'].map(e => [`10/${e}`, 'casa-ilmen']))
};
const INTERIORES = new Set(['cripta','cripta-celda','tuneles','elserath-salon',
  'elserath-cocina','elserath-despacho','casa-juego','consejo','registros']);
const EXTERIORES = new Set(['calle','elserath-jardin','vharn-jardin','orilla','bosque',
  'bosque-lago','campamento','camino-norte','puerta-ciudad','ciudad','kadre','barrio-humo']);

const EP1 = {
  '1': 'Ritual at night, six or seven hooded figures. The mother\'s death is shown here, as confirmed by the author. Non-graphic coverage: no visible birth anatomy or injury. Preserve the event through reaction, sound and off-screen action; do not invent survival.',
  '2': 'Same ritual and population; the newborn is held by the masked Celebrant. Do not invent a different baby.',
  '3': 'Night banquet, twenty guests, three conversations. Saharis sits at one end, Iven at the head. Mended tablecloth, mismatched cups. Saharis has not drunk his wine.',
  '4': 'Continue the occupied banquet. Rothar addresses the table; Iven stays at the head. Saharis answers Rothar; reactions and eyelines belong to the guests, never the audience.',
  '5': 'Later in the same occupied hall. Saharis and Livia have moved beside a window. Livia holds a small book. A servant crosses behind with a tray. Keep the party where visible.',
  '6': 'Later in the same occupied hall. Iven speaks from his chair; Saharis listens to him. Snow is in Iven\'s recollection, not falling in the present scene.',
  '7': 'Same banquet. The guest removes his glove to pour wine. His ring bears a circle, one eye, four teeth. Saharis notices it without changing expression. Other guests remain present.',
  '8': 'Saharis has moved to sit next to the ring-wearing guest. SAHARIS pours wine INTO THE GUEST\'S CUP, not the reverse. Preserve ring, hands, cups and the occupied banquet.',
  '9': 'Saharis stays at the kitchen doorframe and NEVER enters. The cook holds, then sets down a pot. Saharis leaves; the cook looks at the empty doorway. Daughter, steward and administrator are only mentioned.',
  '10': 'Cold night garden. Rothar is larger than Saharis at natural human scale. Saharis leaves; Rothar remains alone. No weather transition is written.',
  '11': 'Saharis walks alone downhill from the wealthy quarter at pre-dawn. A dog watches without barking. Keep noble clothing until scene 12.',
  '12': 'Saharis enters a doorway in noble clothing, emerges in a coarse coat with the good clothes rolled under his arm. Three men pass without looking at him. This wardrobe change is intentional.',
  '13': 'Dry small underground room: one lantern, pallet, table and wall of pinned maps and cords. Saharis in coarse clothing sits facing the wall. Preserve room geometry and paper layout.',
  '14': 'Same room and coarse clothing. Saharis draws the cult ring and pins the drawing to the wall. The clue SIETE belongs above the papers; do not replace it with random lettering.',
  '15': 'FLASHBACK to the ritual cripta: acolyte rocks the newborn, Celebrant looks at him then leaves. Not the present-day refuge. No visible injury.',
  '16': 'RETURN to the refuge of scenes 13-14 after the flashback. Saharis is still seated in the same position. Dawn. A single localized ceiling drip, not rainfall or a wet room.',
  '17': 'FLASHBACK. Mother holds Saharis aged three or four against her chest. Her face is NOT visible. Quiet lullaby. No present-day Saharis.',
  '18': 'Return to the refuge in daytime, same coarse coat. Saharis burns a note IN THE LANTERN, watches the note burn, then stands. He does not display fire to the viewer.',
  '19': 'Busy daytime market. Saharis wears poor clothing. Three SEPARATE encounters in order: vendor, porter, child. He gives the child a coin, then writes RENN. They are not one conversation.',
  '20': 'Renn exterior by day. Saharis sits on a step across the street with a bowl before him. Time passes; preserve house, step and bowl.',
  '21': 'Same Renn exterior at night. Cart brings SIX barrels. Same leather-apron man and servants. Barrels go around the house. Saharis stands, leaving the bowl behind.',
  '22': 'Empty cart departs. Saharis follows the SAME leather-apron man half a street behind, deeper into the lower city. No unexplained position exchange.',
  '23': 'Stone door low in a dead-end alley. Leather-apron man knocks, enters, door closes. Saharis emerges from shadow and approaches the carved cult symbol. He does NOT enter.',
  '24': 'Same closed stone door. Saharis rests his hand on the circle-eye-four-teeth symbol. Chanting is heard far behind the door. He does NOT enter.'
};
const RESUMENES = [
  'Ritual origin; Saharis infiltrates the Elserath dinner, learns about Renn, changes clothing and investigates a stone door below the city.',
  'Saharis buys influence, obtains the Elserath surname and investigates the active Renn cellar. Childhood memories of his mother interrupt the present.',
  'The cult is part of the commercial city, not merely below it. Saharis discovers his map was wrong. Childhood academy scenes have younger Saharis.',
  'Saharis recognizes the Celebrant as the Vharn adviser. Childhood memories of his mother\'s loss interrupt the present; they are not a new present-day death. He later accepts a place in the system.',
  'Saharis reunites with adult Eira and injured Kael in the refugee camp and learns the forest was burned. Forest memories have younger characters.',
  'He saves the camp through coercion involving the inspector\'s daughter. Eira rejects his arithmetic. He tears down and rebuilds his wall.',
  'Saharis decides to inherit the system. The underground pregnant captive is another woman, NOT his mother. The wall becomes an organization chart.',
  'Saharis takes control and investigates his mother\'s purchase. Sura belongs to childhood memories. An older child preceded his own birth.',
  'Saharis discovers his borrowed name and the Ilmen family in Kadre. His mother is absent from the present; texts in the registers are narrative clues.',
  'Journey north and snow; Ilmen farmhouse in Kadre. Warm family dinner with eleven people. Grandmother names Sera; the girl sings the same lullaby. Saharis leaves all his money.',
  'Takeover: Eira leaves, Iven dies, Rothar leaves the city, Saharis kills the Celebrant. Preserve departures and bodies; no restoration between shots.',
  'Six months later. Livia is pregnant. Elserath is renovated and empty. The old refuge is dusty; removed questions remain removed, while the separate charcoal question on the stone survives. Saharis can only sing remembered fragments of the lullaby. Keep the author-confirmed present-day design.'
];

export function corregirEscena(episodio, escena) {
  const clave = `${Number(episodio)}/${escena.escena}`;
  const reparto = Number(episodio) === 1 ? REPARTO_EP1[Number(escena.escena)-1] : REPARTOS[clave];
  return { ...escena, episodio: Number(episodio),
    personajes: reparto ? reparto.split(',') : [...(escena.personajes || [])],
    escenario: LUGARES[clave] || escena.escenario,
    luz: clave === '12/7' ? 'BARRIO' : escena.luz };
}

export function prepararGuiones(datos) {
  return { ...datos, guiones: datos.guiones.map(e => ({ ...e,
    escenas: e.escenas.map(s => corregirEscena(e.episodio, s)) })) };
}

export function marcoDeEscena(episodio, escenas, escena) {
  const n = Number(episodio), id = String(escena.escena), lugar = escena.lugar || '';
  const i = escenas.findIndex(s => String(s.escena) === id);
  const previo = escenas[i-1];
  const continuo = /CONTINUO|MÁS TARDE/.test(escena.momento || '');
  const momento = continuo && previo ? marcoDeEscena(n, escenas, previo).momento : escena.momento;
  let interior = INTERIORES.has(escena.escenario) ? true : EXTERIORES.has(escena.escenario) ? false : null;
  if (/EXTERIOR|TEJADO|CALLE|JARDÍN|PLAZA|PUERTA BAJO/.test(lugar)) interior = false;
  if (/COCINA|COMEDOR|CELDA|DESPACHO|SÓTANO|HABITACIÓN|POSADA|CABAÑA|ALMACÉN/.test(lugar)) interior = true;
  if (continuo && previo && escena.escenario === previo.escenario) interior = marcoDeEscena(n, escenas, previo).interior;
  const nieve = n === 10 && ['camino-norte','kadre'].includes(escena.escenario) && id !== '1';
  const goteo = (n === 1 && ['1','16'].includes(id)) || (n === 11 && id === '22');
  const noche = /NOCHE|MADRUGADA/.test(momento || '');
  const luz = interior === true
    ? (escena.luz === 'CRIPTA' ? 'Interior torchlight, consistent local warm sources and shadows.'
      : escena.escenario === 'tuneles' ? 'One warm lantern in a dry stone room; faint cool light from the grate only when daytime or dawn.'
      : 'Interior practical oil lamps, hearth or candles as written. At night windows are dark; daylight only when the scene calls for it.')
    : `${noche ? 'Night or pre-dawn' : 'Daytime or dawn'} light as written; preserve any local lamps or fires. Do not add weather to create atmosphere.`;
  let secuencia=`ep${n}/${id}`;
  if (continuo && previo && escena.escenario === previo.escenario && escena.flashback === previo.flashback) secuencia=marcoDeEscena(n,escenas,previo).secuencia;
  if (n===1 && ['3','4','5','6','7','8'].includes(id)) secuencia='ep1/banquete';
  if (n===1 && ['13','14','16','18'].includes(id)) secuencia='ep1/refugio';
  if (n===1 && ['20','21'].includes(id)) secuencia='ep1/renn';
  return {
    version: VERSION_CONTINUIDAD, episodio:n, escena:id, secuencia, momento, interior,
    precipitacion: nieve && interior === false ? 'nieve' : 'ninguna', goteo,
    luz, personajes: escena.personajes, resumen: RESUMENES[n-1] || '',
    reglas: [reglasNarrativas(n, escena), n === 1 ? EP1[id] || '' : ''].filter(Boolean).join('\n'),
    anterior: previo ? { escena:previo.escena, lugar:previo.lugar, flashback:previo.flashback, accion:previo.accion } : null,
    siguiente: escenas[i+1] ? { escena:escenas[i+1].escena, lugar:escenas[i+1].lugar, accion:escenas[i+1].accion } : null,
    notas: [
      'People mentioned in dialogue or memories are not physically present. Resolve pronouns from the preceding action.',
      'Preserve visible extras, relative positions, furniture scale, props and eyelines across a continuous scene. Off-screen people need not appear in every close-up.',
      'Allow only scripted movement and state changes. A flashback uses its own identity ages and location; returning resumes the interrupted present.',
      'Character plates supply identity, not camera gaze, age, costume or blocking. Follow the age, wardrobe and physical state written in the action.',
      'Rain, snow, localized dripping, surface dampness and recalled weather are different. If current weather is unspecified, do not invent precipitation.',
      n===10 ? 'Casa Ilmen is in Kadre, not Elserath. The eleven-person family dinner is warm and lively. Snow stays outdoors.' : '',
      n===6 ? 'In forest flashbacks Kael is younger and has NO crutch. Eira is younger. Preserve stated ages and distinguish the present-day injuries.' : ''
    ].filter(Boolean)
  };
}
