import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorInfo } from '../lib/safe-error.js';

test('erro do Google OAuth: tokens, segredo e dados da conta nunca saem no resumo', () => {
  // formato de um GaxiosError da google-auth-library ao renovar o token
  const err = Object.assign(new Error('invalid_grant'), {
    name: 'GaxiosError',
    code: '400',
    config: {
      url: 'https://oauth2.googleapis.com/token',
      headers: { Authorization: 'Bearer ya29.ACCESS-TOKEN' },
      data: 'refresh_token=1%2F%2FREFRESH-TOKEN&client_secret=APP-SECRET&grant_type=refresh_token'
    },
    response: {
      status: 400,
      headers: { 'content-type': 'application/json' },
      data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.', email: 'pessoa@gmail.com' }
    }
  });
  const info = safeErrorInfo(err);
  assert.deepEqual(info, { name: 'GaxiosError', message: 'invalid_grant', code: '400', status: 400, apiError: 'invalid_grant' });
  const text = JSON.stringify(info);
  for (const secret of ['ACCESS-TOKEN', 'REFRESH-TOKEN', 'APP-SECRET', 'pessoa@gmail.com', 'Authorization']) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test('erro do Supabase mantém código e detalhes técnicos', () => {
  const info = safeErrorInfo({ message: 'duplicate key value', code: '23505', details: 'Key (id)=(x) already exists.', hint: '' });
  assert.deepEqual(info, { message: 'duplicate key value', code: '23505', details: 'Key (id)=(x) already exists.' });
});

test('valores que não são objeto viram mensagem', () => {
  assert.deepEqual(safeErrorInfo('falhou'), { message: 'falhou' });
  assert.deepEqual(safeErrorInfo(undefined), { message: 'undefined' });
});
