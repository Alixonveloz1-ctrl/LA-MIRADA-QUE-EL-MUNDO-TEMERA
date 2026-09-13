// Dirección de la escena 3 contrastada con el guion y el maestro aprobado
// escenarios/elserath-salon/2.png. No cambia diálogo, duración ni la historia.
// La mesa es una pieza continua y las lámparas cuelgan de cadenas. Los cuatro
// personajes con ficha pertenecen a la reunión incluso antes de intervenir.
export const MAESTRO_CENA = 'escenarios/elserath-salon/2.png';
export const REVISION_CENA = 'comedor-unico-reparto-v1';
const posicionesMesa='One single continuous rectangular banquet table, in exactly the position and proportions of the approved room. All diners share its two long sides and ends. The table does not split into separate islands. The established hanging lamps remain attached to their chains above, not on the tabletop.';
const cena='Night dinner. One continuous long table with a mended tablecloth and mismatched wine glasses. Nearby visible seats remain occupied. Hanging oil lamps match the approved room; windows are dark.';

export const CORRECCION_CENA = {
  '3-1':{
    refs:['saharis-noble','iven-noble','rothar-noble','livia-noble'],
    imagen:'Wide establishing view of the SAME approved Elserath hall, with its single continuous long banquet table in the same place. The dinner has twenty seated guests including the four referenced characters: sixteen-year-old Saharis in his approved noble coat at the near end; Lord Iven at the opposite head; Rothar and Livia among the diners on the long sides. Show their approved faces, hair and clothing, not anonymous substitutes. A female guest sits across from Saharis. Other diners converse naturally and servants stand by the walls. Preserve the table dimensions and chair arrangement from the set, adding the scripted mended tablecloth and mismatched wine glasses. The EXISTING hanging oil lamps stay suspended from their chains in the same positions. Night beyond the windows. Everyone attends to the dinner, not the viewer.',
    historia:'Saharis, Iven, Rothar y Livia están entre los veinte invitados sentados en una sola mesa larga. Conversan durante la cena; los criados permanecen junto a las paredes.',
    direccion:{visibles:['saharis','iven','rothar','livia','invitada','invitados','criados'],fuera_de_campo:[],
      posiciones:posicionesMesa+' Saharis sits at the near end, Iven at the far head, Rothar and Livia along the sides, and the female guest opposite Saharis. Extras fill the remaining dinner seats; they do not replace the named diners. Servants stand by the walls.',
      miradas:'The guests look at their conversation partners. Saharis listens to the people beside and across from him.',
      camara:'Wide establishing shot of the whole dinner, preserving the room reference perspective and a single long table.',
      estado_inicial:cena+' All named characters are already seated.',estado_final:'Everyone remains at the same place during this shot.'}
  },
  '3-2':{
    refs:[],
    imagen:'Close detail of the nearest right-side HANGING oil lamp already visible in the approved Elserath hall. Preserve its broad metal shade, curved support, glass chamber and suspension chain. It remains suspended in its existing place above the dinner; it is not standing on a table. The camera looks slightly upward so the lamp, chain and upper timber structure fill the frame. The table, chairs and diners are entirely below the crop. The warm flame burns at night. Do not create a new lamp or relocate this fixture.',
    video:'The flame in the same suspended oil lamp flickers gently. The lamp remains fixed to its chain in the same place. Camera locked.',
    historia:'Vemos de cerca una de las lámparas que cuelgan sobre la cena. La mesa y los invitados quedan por debajo de la imagen.',
    direccion:{visibles:[],fuera_de_campo:['saharis','iven','rothar','livia','invitada','invitados','criados'],
      posiciones:'The existing nearest right-side oil lamp stays suspended from its chain, in the same place shown by the approved set. The seated guests and table remain below the crop.',
      miradas:'No faces visible.',camara:'Close detail angled slightly upward toward the existing hanging lamp; no tabletop or seats in frame.',
      estado_inicial:'The same hanging lamp is lit at night.',estado_final:'Same suspended lamp, only a small flame flicker.'}
  },
  '3-3':{
    refs:['saharis-noble'],
    imagen:'Medium three-quarter view of Saharis seated at the near end of the ONE continuous long banquet table from the approved room. The tabletop extends unbroken from his place toward the other end of the hall. Nearby guests occupy the seats along the same two long edges; their chairs face this shared surface. No separate tables or aisles between groups. Saharis wears his approved noble coat and listens to a guest across the table, with his untouched red wine glass on the mended tablecloth. Use the approved room for furniture and hanging lamps; ignore the furniture or lamp in the character portrait. Frame tightly enough that Iven, Rothar and Livia at the farther places are outside the crop. Warm light from the existing hanging lamps; dark night windows.',
    historia:'Saharis escucha sentado en el extremo de la misma mesa larga. Se ven los invitados de los asientos cercanos, compartiendo esa misma mesa.',
    direccion:{visibles:['saharis','invitados'],fuera_de_campo:['iven','rothar','livia','invitada','criados'],
      posiciones:posicionesMesa+' Saharis stays at the near end. Nearby guests remain on the two edges of this same surface. The far head and its occupants are outside the tight crop.',
      miradas:'Saharis looks toward the guest across the table, outside the crop.',camara:'Medium three-quarter shot at seated eye level, looking along the unbroken table edge. The table continues beyond the crop.',
      estado_inicial:cena+' Saharis is seated, listening, his red wine untouched.',estado_final:'Same seats, same continuous table. Nobody arrives or leaves.'}
  },
  '3-4':{
    refs:[],
    imagen:'Medium close view of the same female guest established across from Saharis at the single long banquet table. She remains seated and turns toward him to ask his opinion. Preserve her established hairstyle and dress from the approved sequence. The mended tablecloth and a small continuous part of their shared table occupy the lower crop, with nearby guests at its edges. Do not show empty occupied seats or another table. Hanging lamps light the scene from above; their design and position belong to the approved room.',
    historia:'La invitada, sentada frente a Saharis, le pide su opinión. Los invitados cercanos siguen sentados a la misma mesa.',
    direccion:{visibles:['invitada','invitados'],fuera_de_campo:['saharis','iven','rothar','livia','criados'],
      posiciones:posicionesMesa+' The female guest remains across from Saharis. Nearby diners remain at the same shared table edges; the farther diners are outside this crop.',
      miradas:'She looks toward Saharis across the table, outside the crop.',camara:'Medium close view of the seated guest from the side of the same table occupied by Saharis.',
      estado_inicial:cena+' The same woman is seated opposite Saharis.',estado_final:'She remains seated and addresses Saharis.'}
  },
  '3-5':{
    refs:['saharis-noble'],
    imagen:'Return to Saharis in the SAME seat and camera side established in shot 3-3. Medium three-quarter view as he responds warmly to the female guest across the ONE continuous long table. Keep the same neighboring seated diners, the same unbroken table edge, mended tablecloth and untouched wine glass. Do not import tables or lamps from the character portrait. The far end and its named diners are outside this crop; the nearby guests remain visible at the same table.',
    historia:'Saharis responde a la invitada sin cambiar de asiento. Los invitados cercanos siguen alrededor de la misma mesa larga.',
    direccion:{visibles:['saharis','invitados'],fuera_de_campo:['iven','rothar','livia','invitada','criados'],
      posiciones:posicionesMesa+' Use the same seat, nearby diners and wine glass as Saharis in shot 3-3.',
      miradas:'Toward the same female guest across the table.',camara:'Medium three-quarter view, same camera side as the earlier listening shot of Saharis.',
      estado_inicial:cena+' Saharis responds from his seat.',estado_final:'Same place, no standing or seat change.'}
  },
  '3-6':{
    refs:['saharis-noble-nuca'],
    imagen:'Over the shoulder of Saharis, who remains seated at the same end of the ONE continuous long banquet table. Across its shared surface, the SAME female guest from shot 3-4 laughs, wearing the same dress and hairstyle. Saharis is visible only from behind in his approved noble coat. Nearby diners remain seated on this table\'s edges. Preserve the continuous tabletop, width, mended tablecloth, wine glasses and hanging lamps from the approved room and dinner. No separate dining tables or empty occupied seats.',
    historia:'Miramos por encima del hombro de Saharis hacia la misma invitada, que se ríe. Ambos siguen sentados a la misma mesa con los demás invitados.',
    direccion:{visibles:['saharis','invitada','invitados'],fuera_de_campo:['iven','rothar','livia','criados'],
      posiciones:posicionesMesa+' Saharis stays in his seat, seen from behind. The same female guest sits opposite him across this table. Nearby guests keep their seats.',
      miradas:'The female guest looks at Saharis as she laughs.',camara:'Medium over-the-shoulder view across the width of the single table; the distant head remains outside the crop.',
      estado_inicial:cena+' Same woman and Saharis in their established seats.',estado_final:'The woman laughs without changing seats.'}
  },
  '3-7':{
    refs:['saharis-manos'],
    imagen:'Tight detail of Saharis\'s hands beside the SAME untouched red wine glass already established at his seat. His hands rest naturally on the mended tablecloth covering the ONE long dinner table. Match that glass and tablecloth from the dinner shots; the hand reference supplies only hand anatomy, skin and ring design, not its props or hand-display pose. The tight crop contains only hands, glass and tablecloth. All diners and chairs are outside the crop. Warm light from the existing overhead oil lamps, with no new tabletop lamp.',
    historia:'Vemos solo las manos de Saharis junto a su misma copa de vino, sobre el mantel. Todavía no ha bebido.',
    direccion:{visibles:['saharis'],fuera_de_campo:['iven','rothar','livia','invitada','invitados','criados'],
      posiciones:'His hands rest naturally at his established seat on the mended cloth, beside his same red wine glass. The table is still the single continuous banquet table, shown only in close detail.',
      miradas:'No face in frame.',camara:'Tight close detail, cropping out every chair, diner and lamp.',
      estado_inicial:'Hands relaxed beside the same untouched wine glass.',estado_final:'The glass remains in place; he does not drink.'}
  }
};
for (const toma of Object.values(CORRECCION_CENA)) {
  toma.direccion.presentes=['saharis','iven','rothar','livia','invitada','invitados','criados'];
}
