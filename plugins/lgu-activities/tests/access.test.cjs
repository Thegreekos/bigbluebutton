const test = require('node:test');
const assert = require('node:assert/strict');
const { isTeacher } = require('../src/access');

test('loaded moderator is the only teacher presentation role', () => {
  assert.equal(isTeacher({ loading: false, data: { role: 'MODERATOR' } }), true);
});
for (const [name, result] of [
  ['undefined', undefined], ['null', null], ['empty', {}],
  ['loading', { loading: true, data: { role: 'MODERATOR' } }],
  ['error', { loading: false, error: new Error('unavailable'), data: { role: 'MODERATOR' } }],
  ['viewer', { loading: false, data: { role: 'VIEWER', presenter: true } }],
  ['lowercase', { loading: false, data: { role: 'moderator' } }],
  ['missing role', { loading: false, data: {} }],
]) {
  test(`fail closed: ${name}`, () => assert.equal(isTeacher(result), false));
}