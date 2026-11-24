import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentDossiers} from '../lib/document-dossier.mjs';
import {nextReviewDate} from '../lib/operation-flow.mjs';
import {buildActionQueue} from '../lib/work-queue.mjs';
test('dossiê não mistura unidades, contratos, competências ou versões substituídas',()=>{
 const groups=documentDossiers([{id:'old',unit_id:'a',gerdau_contract:'c',competence:'2026-10',status:'Substituído',revision:1,rejection_reason:'Arquivo ilegível'},{id:'new',unit_id:'a',gerdau_contract:'c',competence:'2026-10',status:'Pendente',revision:2},{id:'other-unit',unit_id:'b',gerdau_contract:'c',competence:'2026-10'},{id:'other-contract',unit_id:'a',gerdau_contract:'d',competence:'2026-10'},{id:'other-month',unit_id:'a',gerdau_contract:'c',competence:'2026-11'}]);
 assert.equal(groups.length,4);assert.deepEqual(groups[0].current.map(item=>item.id),['new']);assert.equal(groups[0].returns.length,1);assert.equal(groups[0].revisions.length,1);
});
test('espera aparece na fila e nunca adia prazo existente',()=>{
 assert.equal(nextReviewDate({waiting_until:'2026-11-10'},'2026-11-01'),'2026-11-01');
 assert.equal(nextReviewDate({waiting_until:'2026-10-30'},'2026-11-01'),'2026-10-30');
 const queue=buildActionQueue({units:[{id:'u',waiting_reason:'Cliente confirmará acesso',waiting_until:'2026-11-02'}]});
 assert.equal(queue.length,1);assert.equal(queue[0].due_date,'2026-11-02');
});
