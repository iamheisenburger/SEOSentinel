import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');

console.log('Processing one pending job...\n');
try {
  const result = await client.action(api.actions.pipeline.processNextJob, {});
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
}
