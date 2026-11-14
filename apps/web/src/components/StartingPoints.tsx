import {Link} from 'react-router-dom'
import {startingPoints,STARTING_POINTS_GENERATION} from '../data/startingPoints'
export function StartingPoints({generation}:{generation:string}) {
 if(generation!==STARTING_POINTS_GENERATION)return <section aria-label="Starting points"><h2>Starting points</h2><p>The producer-selected starting points belong to a different inventory generation and are unavailable here. Browse the inventory below.</p></section>
 return <section className="starting-points" aria-labelledby="starting-points-heading"><h2 id="starting-points-heading">Starting points</h2><p>Begin with these hospital data sources. Check their coverage, access requirements and limitations before choosing one.</p><ul>{startingPoints.map(item=><li key={item.asset_id}><h3><Link to={`/datasets/${encodeURIComponent(item.asset_id)}`}>{item.title}</Link></h3><p>{item.rationale}</p><p><strong>Unresolved:</strong> suitability for your question, usable geography, current acquisition requirements and joins.</p></li>)}</ul><p>Source inventory version <code>{generation}</code>.</p></section>
}
