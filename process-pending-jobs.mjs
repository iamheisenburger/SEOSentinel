import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');

console.log('🚀 Processing all pending jobs...\n');

// Process jobs one by one
for (let i = 0; i < 15; i++) {
  try {
    console.log(`\n[${i + 1}] Checking for pending jobs...`);
    const result = await client.action(api.actions.pipeline.processNextJob, {});

    if (!result.processed) {
      console.log('✅ No more pending jobs! All done.');
      break;
    }

    console.log(`✅ Job ${result.jobId} processed successfully!`);

    if (result.error) {
      console.log(`⚠️  Warning: ${result.error}`);
    }

    // Wait 2 seconds between jobs to avoid overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (err) {
    console.error(`❌ Error processing job:`, err.message);
    // Continue to next job even if this one fails
  }
}

console.log('\n🎉 Batch processing complete!');
