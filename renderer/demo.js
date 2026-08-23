/**
 * The worked example Prism opens with.
 *
 * Deliberately a *flow* rather than a bag of requests: a login that captures a
 * token, two requests that spend it, and one that is wired to a value the
 * login does not return — so the chain, the variable wires and a real failing
 * assertion are all visible before anyone imports anything.
 *
 * Written in the Rebind workspace shape and read back through the ordinary
 * importer. That is on purpose: the demo exercises the same path a real file
 * takes, so a bug in the importer shows up the moment the app opens rather
 * than the first time somebody has a file to load.
 */
export function demoWorkspace() {
  const at = Date.now() - 1000 * 60 * 8

  return {
    rebind: 'workspace',
    project: 'Northwind — checkout',
    environments: [
      {
        id: 'env-dev',
        name: 'Development',
        values: {
          base_url: 'https://api.northwind.dev',
          user_email: 'ada@northwind.test',
          tenant: 'northwind'
        }
      },
      {
        id: 'env-prod',
        name: 'Production',
        values: { base_url: 'https://api.northwind.com', user_email: 'ops@northwind.com', tenant: 'northwind' }
      }
    ],
    suites: [
      {
        id: 'flow-auth',
        name: 'Authentication',
        tests: [
          {
            id: 'req-login',
            name: 'Log in',
            method: 'POST',
            url: '{{base_url}}/api/auth/login',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email: '{{user_email}}', password: '{{password}}' }, null, 2),
            assertions: [
              { id: 'a-l1', kind: 'status', expected: '200' },
              { id: 'a-l2', kind: 'contentType', expected: 'json' },
              { id: 'a-l3', kind: 'jsonExists', target: 'data.token' },
              { id: 'a-l4', kind: 'responseTime', expected: '1500' }
            ],
            extract: [
              { name: 'auth_token', from: 'body', path: 'data.token' },
              { name: 'user_id', from: 'body', path: 'data.user.id' }
            ]
          },
          {
            id: 'req-refresh',
            name: 'Refresh token',
            method: 'POST',
            url: '{{base_url}}/api/auth/refresh',
            headers: { Accept: 'application/json' },
            auth: { kind: 'bearer', token: '{{auth_token}}' },
            assertions: [
              { id: 'a-r1', kind: 'status', expected: '200' },
              { id: 'a-r2', kind: 'jsonExists', target: 'data.token' }
            ],
            extract: []
          }
        ]
      },
      {
        id: 'flow-user',
        name: 'User journey',
        tests: [
          {
            id: 'req-profile',
            name: 'Get profile',
            method: 'GET',
            url: '{{base_url}}/api/users/:userId',
            pathParams: [{ key: 'userId', value: '{{user_id}}' }],
            query: [{ key: 'include', value: 'orders,addresses' }],
            headers: { Accept: 'application/json' },
            auth: { kind: 'bearer', token: '{{auth_token}}' },
            assertions: [
              { id: 'a-p1', kind: 'status', expected: '200' },
              { id: 'a-p2', kind: 'jsonEquals', target: 'data.id', expected: '{{user_id}}' },
              { id: 'a-p3', kind: 'responseTime', expected: '800' }
            ],
            extract: [{ name: 'default_address_id', from: 'body', path: 'data.addresses.0.id' }]
          },
          {
            id: 'req-update',
            name: 'Update profile',
            method: 'PATCH',
            url: '{{base_url}}/api/users/:userId',
            pathParams: [{ key: 'userId', value: '{{user_id}}' }],
            headers: { 'Content-Type': 'application/json' },
            auth: { kind: 'bearer', token: '{{auth_token}}' },
            body: JSON.stringify({ displayName: 'Ada L.' }, null, 2),
            assertions: [{ id: 'a-u1', kind: 'status', expected: '200' }],
            extract: []
          }
        ]
      },
      {
        id: 'flow-orders',
        name: 'Orders',
        tests: [
          {
            id: 'req-create',
            name: 'Create order',
            method: 'POST',
            url: '{{base_url}}/api/orders',
            headers: { 'Content-Type': 'application/json' },
            auth: { kind: 'bearer', token: '{{auth_token}}' },
            body: JSON.stringify(
              { customerId: '{{user_id}}', addressId: '{{default_address_id}}', items: [{ sku: 'NW-1042', qty: 2 }] },
              null,
              2
            ),
            assertions: [
              { id: 'a-o1', kind: 'status', expected: '201' },
              { id: 'a-o2', kind: 'jsonExists', target: 'data.orderId' },
              { id: 'a-o3', kind: 'responseTime', expected: '2000' }
            ],
            extract: [{ name: 'order_id', from: 'body', path: 'data.orderId' }]
          },
          {
            id: 'req-pay',
            name: 'Take payment',
            method: 'POST',
            url: '{{base_url}}/api/orders/:orderId/payment',
            pathParams: [{ key: 'orderId', value: '{{order_id}}' }],
            headers: { 'Content-Type': 'application/json' },
            auth: { kind: 'bearer', token: '{{auth_token}}' },
            body: JSON.stringify({ method: 'card', token: '{{payment_token}}' }, null, 2),
            assertions: [
              { id: 'a-y1', kind: 'status', expected: '200' },
              { id: 'a-y2', kind: 'jsonEquals', target: 'data.state', expected: 'captured' }
            ],
            extract: []
          },
          {
            id: 'req-invoice',
            name: 'Fetch invoice',
            method: 'GET',
            url: '{{base_url}}/api/orders/:orderId/invoice',
            pathParams: [{ key: 'orderId', value: '{{order_id}}' }],
            headers: { Accept: 'application/pdf' },
            auth: { kind: 'bearer', token: '{{auth_token}}' },
            assertions: [
              { id: 'a-i1', kind: 'status', expected: '200' },
              { id: 'a-i2', kind: 'contentType', expected: 'pdf' }
            ],
            extract: []
          }
        ]
      }
    ],
    /**
     * Traffic as it would arrive from a Rebind recording: some of it worth
     * testing, some of it plainly not. The excluded asset is left in so the
     * filter that drops it is exercised rather than assumed.
     */
    calls: [
      {
        id: 'call-1',
        at,
        method: 'GET',
        url: 'https://api.northwind.dev/api/catalogue/products',
        path: 'https://api.northwind.dev/api/catalogue/products',
        query: { page: '1', limit: '20' },
        requestHeaders: { Accept: 'application/json', host: 'api.northwind.dev' },
        status: 200,
        statusText: 'OK',
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({
          data: [
            { id: 'NW-1042', name: 'Chai', price: 18, inStock: true },
            { id: 'NW-1043', name: 'Chang', price: 19, inStock: false }
          ],
          page: 1,
          total: 77
        }),
        durationMs: 214,
        requestBytes: 0,
        responseBytes: 186,
        contentType: 'application/json',
        kind: 'rest'
      },
      {
        id: 'call-2',
        at: at + 900,
        method: 'GET',
        url: 'https://api.northwind.dev/api/cart',
        path: 'https://api.northwind.dev/api/cart',
        query: {},
        requestHeaders: { Accept: 'application/json' },
        status: 200,
        statusText: 'OK',
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ data: { items: [], subtotal: 0, currency: 'GBP' } }),
        durationMs: 96,
        requestBytes: 0,
        responseBytes: 62,
        contentType: 'application/json',
        authScheme: 'Bearer',
        kind: 'rest'
      },
      {
        id: 'call-3',
        at: at + 1400,
        method: 'POST',
        url: 'https://api.northwind.dev/graphql',
        path: 'https://api.northwind.dev/graphql',
        query: {},
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: JSON.stringify({ query: '{ recommendations(limit: 4) { id name } }' }),
        status: 200,
        statusText: 'OK',
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ data: { recommendations: [{ id: 'NW-1051', name: 'Aniseed Syrup' }] } }),
        durationMs: 412,
        requestBytes: 58,
        responseBytes: 84,
        contentType: 'application/json',
        kind: 'graphql'
      },
      {
        id: 'call-4',
        at: at + 2100,
        method: 'GET',
        url: 'https://api.northwind.dev/api/shipping/quotes',
        path: 'https://api.northwind.dev/api/shipping/quotes',
        query: { postcode: 'SW1A 1AA' },
        requestHeaders: { Accept: 'application/json' },
        status: 503,
        statusText: 'Service Unavailable',
        responseHeaders: { 'content-type': 'application/json', 'retry-after': '30' },
        responseBody: JSON.stringify({ error: 'carrier unavailable' }),
        durationMs: 3120,
        requestBytes: 0,
        responseBytes: 34,
        contentType: 'application/json',
        kind: 'rest'
      },
      {
        id: 'call-5',
        at: at + 200,
        method: 'GET',
        url: 'https://cdn.northwind.dev/assets/hero.webp',
        path: 'https://cdn.northwind.dev/assets/hero.webp',
        query: {},
        requestHeaders: {},
        status: 200,
        statusText: 'OK',
        responseHeaders: { 'content-type': 'image/webp' },
        durationMs: 61,
        requestBytes: 0,
        responseBytes: 84210,
        contentType: 'image/webp',
        kind: 'asset',
        include: false
      }
    ]
  }
}
