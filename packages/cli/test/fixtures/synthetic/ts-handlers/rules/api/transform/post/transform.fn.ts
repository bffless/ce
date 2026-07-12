import type { HandlerContext } from 'bffless/handlers';
import { double } from './lib/shared.js';

export default function handler(ctx: HandlerContext) {
  const n = (ctx.request?.body as { n: number }).n;
  return { doubled: double(n) };
}
