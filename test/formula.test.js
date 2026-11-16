'use strict';

const assert = require('node:assert/strict');
const F = require('../src/js/formula.js');

function sheet(obj) {
  const cells = {};
  for (const [a, v] of Object.entries(obj)) cells[a] = { v };
  const values = F.compute(cells);
  return (a) => {
    const v = values.get(a);
    return v instanceof F.FError ? v.code : v;
  };
}

let count = 0;
function test(name, fn) {
  fn();
  count++;
}

test('literais', () => {
  const v = sheet({ A1: '12', A2: '1,5', A3: 'olá', A4: '50%', A5: 'verdadeiro', A6: "'123" });
  assert.equal(v('A1'), 12);
  assert.equal(v('A2'), 1.5);
  assert.equal(v('A3'), 'olá');
  assert.equal(v('A4'), 0.5);
  assert.equal(v('A5'), true);
  assert.equal(v('A6'), '123');
});

test('aritmética e precedência', () => {
  const v = sheet({ A1: '=1+2*3', A2: '=(1+2)*3', A3: '=2^3^2', A4: '=-2^2', A5: '=10/4', A6: '=50%*200', A7: '=1.5e2' });
  assert.equal(v('A1'), 7);
  assert.equal(v('A2'), 9);
  assert.equal(v('A3'), 512);
  assert.equal(v('A4'), -4);
  assert.equal(v('A5'), 2.5);
  assert.equal(v('A6'), 100);
  assert.equal(v('A7'), 150);
});

test('referências e intervalos', () => {
  const v = sheet({ A1: '1', A2: '2', A3: '3', B1: 'texto', C1: '=A1+A2', C2: '=SUM(A1:A3)', C3: '=SOMA(A1:B3;10)', C4: '=$A$1*2' });
  assert.equal(v('C1'), 3);
  assert.equal(v('C2'), 6);
  assert.equal(v('C3'), 16);
  assert.equal(v('C4'), 2);
});

test('funções', () => {
  const v = sheet({
    A1: '4',
    A2: '8',
    A3: '',
    B1: '=AVERAGE(A1:A3)',
    B2: '=MÉDIA(A1:A2)',
    B3: '=MIN(A1:A2)&"-"&MAX(A1:A2)',
    B4: '=COUNT(A1:A3)',
    B5: '=IF(A1>3,"sim","não")',
    B6: '=SE(A1>10;1;2)',
    B7: '=ROUND(2.345,2)',
    B8: '=ARRED(-2.5)',
    B9: '=CONCAT("a",1,TRUE)',
    B10: '=AND(A1>1,A2>1)',
    B11: '=OU(A1>100;A2>100)',
    B12: '=SQRT(16)+ABS(-1)+MOD(7,3)+INT(2.9)',
    B13: '=LEN("olá")',
    B14: '=UPPER("abc")',
    B15: '=IFERROR(1/0,"erro")',
    B16: '=E(VERDADEIRO;A1=4)'
  });
  assert.equal(v('B1'), 6);
  assert.equal(v('B2'), 6);
  assert.equal(v('B3'), '4-8');
  assert.equal(v('B4'), 2);
  assert.equal(v('B5'), 'sim');
  assert.equal(v('B6'), 2);
  assert.equal(v('B7'), 2.35);
  assert.equal(v('B8'), -3);
  assert.equal(v('B9'), 'a1VERDADEIRO');
  assert.equal(v('B10'), true);
  assert.equal(v('B11'), false);
  assert.equal(v('B12'), 8);
  assert.equal(v('B13'), 3);
  assert.equal(v('B14'), 'ABC');
  assert.equal(v('B15'), 'erro');
  assert.equal(v('B16'), true);
});

test('erros', () => {
  const v = sheet({
    A1: '=1/0',
    A2: '=A1+1',
    A3: '=NAOEXISTE(1)',
    A4: '="a"+1',
    A5: '=B5',
    B5: '=A5',
    A6: '=1+',
    A7: '=ZZ1',
    A8: '=SUM(A1:A2)',
    A9: '=C1:C2',
    A10: '=IF(TRUE,1,1/0)',
    A11: '=constructor(1)'
  });
  assert.equal(v('A1'), '#DIV/0!');
  assert.equal(v('A2'), '#DIV/0!');
  assert.equal(v('A3'), '#NOME?');
  assert.equal(v('A4'), '#VALOR!');
  assert.equal(v('A5'), '#CICLO!');
  assert.equal(v('B5'), '#CICLO!');
  assert.equal(v('A6'), '#ERRO!');
  assert.equal(v('A7'), '#REF!');
  assert.equal(v('A8'), '#DIV/0!');
  assert.equal(v('A9'), '#VALOR!');
  assert.equal(v('A10'), 1);
  assert.equal(v('A11'), '#NOME?');
});

test('comparações', () => {
  const v = sheet({ A1: '=1<2', A2: '="a"="A"', A3: '=2<>2', A4: '=B9=0', A5: '=3>=3' });
  assert.equal(v('A1'), true);
  assert.equal(v('A2'), true);
  assert.equal(v('A3'), false);
  assert.equal(v('A4'), true);
  assert.equal(v('A5'), true);
});

test('formatação', () => {
  assert.equal(F.format(1.5), '1,5');
  assert.equal(F.format(0.1 + 0.2), '0,3');
  assert.equal(F.format(1234567), '1234567');
  assert.equal(F.format(true), 'VERDADEIRO');
  assert.equal(F.format(null), '');
  assert.equal(F.format(new F.FError('#REF!')), '#REF!');
});

test('deslocar fórmulas', () => {
  assert.equal(F.shiftFormula('=A1+B2', 1, 1), '=B2+C3');
  assert.equal(F.shiftFormula('=$A$1+A$1+$A1', 2, 2), '=$A$1+C$1+$A3');
  assert.equal(F.shiftFormula('=SUM(A1:A3)&"A1"', 0, 1), '=SUM(B1:B3)&"A1"');
  assert.equal(F.shiftFormula('=A1', -1, 0), '=#REF!');
  assert.equal(F.shiftFormula('=LOG10(A1)', 1, 0), '=LOG10(A2)');
  assert.equal(F.shiftFormula('texto A1', 1, 1), 'texto A1');
});

test('nomes de colunas', () => {
  assert.equal(F.colName(0), 'A');
  assert.equal(F.colName(25), 'Z');
  assert.equal(F.colName(26), 'AA');
  assert.deepEqual(F.parseAddr('C7'), { c: 2, r: 6 });
});

test('procura e funções condicionais', () => {
  const v = sheet({
    A1: 'maçã', B1: '3', C1: '0,5',
    A2: 'pera', B2: '10', C2: '0,8',
    A3: 'maçã', B3: '7', C3: '0,6',
    E1: '=SOMA.SE(A1:A3;"maçã";B1:B3)',
    E2: '=SUMIF(B1:B3,">5")',
    E3: '=CONTAR.SE(A1:A3;"maçã")',
    E4: '=COUNTIF(B1:B3,"<>10")',
    E5: '=PROCV("pera";A1:C3;3;FALSO)',
    E6: '=VLOOKUP("kiwi",A1:C3,2,FALSE)',
    E7: '=VLOOKUP(8,B1:C3,2)',
    E8: '=PROCV("pera";A1:C3;9;FALSO)'
  });
  assert.equal(v('E1'), 10);
  assert.equal(v('E2'), 17);
  assert.equal(v('E3'), 2);
  assert.equal(v('E4'), 2);
  assert.equal(v('E5'), 0.8);
  assert.equal(v('E6'), '#N/D');
  assert.equal(v('E7'), 0.5);
  assert.equal(v('E8'), '#REF!');
});

test('MIN e MAX em intervalos grandes', () => {
  const cells = {};
  const total = 110000;
  for (let row = 1; row <= total; row++) cells[`A${row}`] = { v: String(row) };
  cells.B1 = { v: `=MIN(A1:A${total})` };
  cells.B2 = { v: `=MAX(A1:A${total})` };
  const values = F.compute(cells, total, 2);
  assert.equal(values.get('B1'), 1);
  assert.equal(values.get('B2'), total);
});

console.log(`${count} grupos de testes passaram.`);
