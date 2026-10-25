import { decodeFit } from '../fit/decode';

self.onmessage = async (event: MessageEvent<{ files: Array<{ id: string; name: string; buffer: ArrayBuffer }> }>) => {
  const results = await Promise.all(event.data.files.map(async ({ id, name, buffer }) => {
    try {
      return { id, name, decoded: await decodeFit(buffer) };
    } catch (error) {
      return { id, name, error: error instanceof Error ? error.message : 'Could not parse this file.' };
    }
  }));
  self.postMessage(results);
};