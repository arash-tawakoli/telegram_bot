// Only configured transports on this exact project origin are in-process calls.
// Every external URL still uses native fetch and its original request options.
export async function fetchProvider(url: string, init: RequestInit, projectUrl: string): Promise<Response> {
  const target = new URL(url);
  if (target.origin === new URL(projectUrl).origin && (!init.method || init.method === 'GET')) {
    let handler;
    switch (target.pathname) {
      case '/functions/v1/covivio-feed': handler = (await import('../covivio-feed/handler.ts')).handle; break;
      case '/functions/v1/immobilie1-transport': handler = (await import('../immobilie1-transport/handler.ts')).handle; break;
      case '/functions/v1/immobilien-de-transport': handler = (await import('../immobilien-de-transport/handler.ts')).handle; break;
      case '/functions/v1/meravis-feed': handler = (await import('../meravis-feed/handler.ts')).handle; break;
      case '/functions/v1/noncoop-feed': handler = (await import('../noncoop-feed/handler.ts')).handle; break;
      case '/functions/v1/noncoop-new-feed': handler = (await import('../noncoop-new-feed/handler.ts')).handle; break;
      case '/functions/v1/spacest-feed': handler = (await import('../spacest-feed/handler.ts')).handle; break;
      case '/functions/v1/vonovia-transport': handler = (await import('../vonovia-transport/handler.ts')).handle; break;
      case '/functions/v1/wunderflats-transport': handler = (await import('../wunderflats-transport/handler.ts')).handle; break;
    }
    if (handler) {
      init.signal?.throwIfAborted();
      const response = await handler(new Request(url, init));
      init.signal?.throwIfAborted();
      return response;
    }
  }
  return fetch(url, init);
}
