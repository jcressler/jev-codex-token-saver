import { createHash, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function reviewId(seed, index, answer) {
  return createHash('sha256')
    .update(`${seed}:${index}:${JSON.stringify(answer)}`)
    .digest('hex')
    .slice(0, 12);
}

export function anonymizeAnswers(runs, seed = 'jev-codex-review') {
  const answers = [];
  const mapping = [];
  runs.forEach((run, index) => {
    const id = reviewId(seed, index, run.answer);
    answers.push({ id, taskId: run.taskId, answer: run.answer });
    mapping.push({ id, runId: run.runId, arm: run.arm, repetition: run.repetition });
  });
  return {
    review: { schemaVersion: 1, blinded: true, answers },
    mapping: { schemaVersion: 1, seed, labels: mapping },
  };
}

export async function reproduceKnownDefect(taskId, fixtureRoot) {
  const nonce = `${Date.now()}-${Math.random()}`;
  if (taskId === 'tenant-cache-isolation') {
    const catalog = await import(`${pathToFileURL(`${fixtureRoot}/src/catalog.mjs`).href}?oracle=${nonce}`);
    const cache = await import(`${pathToFileURL(`${fixtureRoot}/src/cache.mjs`).href}?oracle=${nonce}`);
    cache.resetPrices();
    let loads = 0;
    const north = await catalog.catalogPrice('north', 'rose-1', async () => { loads += 1; return 14.99; });
    const south = await catalog.catalogPrice('south', 'rose-1', async () => { loads += 1; return 19.99; });
    return { reproduced: north === 14.99 && south === 14.99 && loads === 1, observed: { north, south, loads } };
  }
  if (taskId === 'webhook-raw-body-signature') {
    const route = await import(`${pathToFileURL(`${fixtureRoot}/src/route.mjs`).href}?oracle=${nonce}`);
    const secret = 'fixture-webhook-secret';
    const rawBody = Buffer.from('{ "status": "paid", "id": 7 }');
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      await route.receiveWebhook(rawBody, signature, secret);
      return { reproduced: false, observed: 'accepted' };
    } catch (error) {
      return { reproduced: /signature/i.test(String(error?.message ?? error)), observed: String(error?.message ?? error) };
    }
  }
  throw new Error(`unknown task oracle: ${taskId}`);
}
