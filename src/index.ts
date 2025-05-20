import { Processor } from './core/processor.js';

(async () => {
  try {
    await new Processor().run();
  } catch (e: any) {
    console.error('Error:', e);
    console.error('Fatal error:', e.message);
    process.exit(1);
  }
})();
