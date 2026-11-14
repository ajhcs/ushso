import {expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {startingPoints} from './startingPoints'
it('every editorial starting point binds an exact existing source ID and preserved title',()=>{
 const records=[1,2,3].flatMap(n=>readFileSync(new URL(`../../../../packages/retrieval/versions/v1.2.0/corpus/records-000${n}.jsonl`,import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line)))
 for(const item of startingPoints){const record=records.find(record=>record.record_id===item.asset_id);expect(record).toBeDefined();expect(record.title).toBe(item.title)}
})
