import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedback } from '../lib/pilot-feedback.mjs';

test('relatar atrito aceita todas as novas áreas da operação', () => {
  for (const screen of ['prospects', 'leads', 'services', 'flights', 'team', 'profile', 'companies', 'contacts']) {
    assert.equal(validateFeedback({screen, category:'Dificuldade', impact:'Atrapalha', title:'Conferir fluxo', description:'Não encontrei a informação necessária.'}).screen, screen);
  }
});
