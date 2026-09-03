import { runFixtureMatrix } from '../src/testing/fixture-matrix.mjs';
import { runDeliveryWaveFixtureMatrix } from '../src/testing/wave-fixtures.mjs';

const foundation = await runFixtureMatrix();
const deliveryWaves = await runDeliveryWaveFixtureMatrix();
const result = {
  status: foundation.status === 'PASS' && deliveryWaves.status === 'PASS' ? 'PASS' : 'FAIL',
  fixture_scope: 'fixture_only',
  integration_level: 'local_integration',
  suites: { foundation, delivery_waves: deliveryWaves },
  totals: {
    scenarios: foundation.totals.scenarios + deliveryWaves.totals.scenarios,
    assertions: foundation.totals.assertions + deliveryWaves.totals.assertions,
    recorded_delivery_wave_fixtures: deliveryWaves.recorded_fixtures,
  },
  zero_external_actions: deliveryWaves.zero_external_actions,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
