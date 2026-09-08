import test from 'node:test';
import assert from 'node:assert/strict';
import {toDate} from '../worker/static-machine-toolkit-service.mjs';
test('Muse API time boundaries retain actual calendar month ends and reject invalid dates',()=>{
 for(const [input,expected] of [['2024-01','2024-01-31'],['2024-02','2024-02-29'],['2023-02','2023-02-28'],['2100-02','2100-02-28'],['2000-02','2000-02-29']])assert.equal(toDate(input,'end'),expected);
 for(const invalid of ['2024-00','2024-13','2024-02-30','2023-02-29','2024-01-00'])assert.equal(toDate(invalid,'end'),null);
 assert.equal(toDate('2024-02','start'),'2024-02-01');
});
