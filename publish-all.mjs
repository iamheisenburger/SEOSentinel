import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');

const siteId = 'jh732ef22mtzdpscfjv3252kq57wy5pt';
const articleIds = [
  'j579zdj0ze9ebtjnnngtkdhym17x54f4',
  'j57dmettpeh4j4qadzqc6q0zdh7x4459',
  'j576tfpgxdwcrfn82j7y9zjs0x7x4xcs',
  'j5748ya6vhn3yg64tm67yd350n7x52pn',
  'j5745e3w0feckpb1rm7427z9g97x5xjj'
];

for (const articleId of articleIds) {
  try {
    const result = await client.action(api.publisher.publishArticle, { siteId, articleId });
    console.log('Published:', articleId, result.prUrl);
  } catch (err) {
    console.error('Failed:', articleId, err.message);
  }
}

