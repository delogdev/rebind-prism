/**
 * Writing a request out in somebody else's language.
 *
 * ONE RULE ABOVE ALL OTHERS: no credential is ever inlined. A `{{token}}` in
 * a request becomes a read of an environment variable in the generated file,
 * in every target. Exported code gets committed, pasted into tickets and put
 * in front of screen shares; a resolved secret in one of them is a leak with a
 * very long tail. The variable is what the user wrote and the variable is what
 * comes out.
 */
import { buildUrl, buildHeaders, buildBody } from './request.js'

export const TARGETS = [
  { id: 'curl', label: 'cURL', ext: 'sh', group: 'Shell' },
  { id: 'python', label: 'Python · requests', ext: 'py', group: 'Code' },
  { id: 'pytest', label: 'Python · pytest', ext: 'py', group: 'Test' },
  { id: 'fetch', label: 'JavaScript · fetch', ext: 'js', group: 'Code' },
  { id: 'axios', label: 'JavaScript · axios', ext: 'js', group: 'Code' },
  { id: 'node', label: 'Node · undici', ext: 'mjs', group: 'Code' },
  { id: 'playwright', label: 'Playwright · APIRequest', ext: 'spec.ts', group: 'Test' },
  { id: 'java', label: 'Java · HttpClient', ext: 'java', group: 'Code' },
  { id: 'restassured', label: 'Java · REST Assured', ext: 'java', group: 'Test' },
  { id: 'csharp', label: 'C# · HttpClient', ext: 'cs', group: 'Code' },
  { id: 'go', label: 'Go · net/http', ext: 'go', group: 'Code' },
  { id: 'php', label: 'PHP · cURL', ext: 'php', group: 'Code' },
  { id: 'postman', label: 'Postman collection', ext: 'postman_collection.json', group: 'Collection' },
  { id: 'openapi', label: 'OpenAPI 3.1', ext: 'openapi.json', group: 'Collection' },
  { id: 'canvas', label: 'Prism flow', ext: 'canvas.json', group: 'Collection' }
]

export const GROUPS = ['Shell', 'Code', 'Test', 'Collection']
export const WHOLE_FLOW = new Set(['postman', 'openapi', 'canvas'])

const VAR = /\{\{\s*([\w.-]+)\s*\}\}/g
const ENV_NAME = (name) => name.replace(/[.-]/g, '_').toUpperCase()

/** Rewrites `{{name}}` as the target's way of reading an environment variable. */
function vars(text, style) {
  return String(text ?? '').replace(VAR, (_m, name) => style(name))
}

/** True when the text mentions a variable, so the file can note where to set it. */
function usesVars(text) {
  VAR.lastIndex = 0
  return VAR.test(String(text ?? ''))
}

const q = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const dq = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * The request laid out flat, with variables left as they were written.
 *
 * Passing an empty environment is the point: `buildUrl` leaves an unresolved
 * `{{name}}` verbatim, which is exactly what each generator then rewrites into
 * its own lookup.
 */
function parts(req) {
  return {
    method: (req.method || 'GET').toUpperCase(),
    url: buildUrl(req, {}),
    headers: buildHeaders(req, {}),
    body: buildBody(req, {})
  }
}

/** Every variable a request mentions, for the header comment. */
function mentioned(req) {
  const p = parts(req)
  const found = new Set()
  const scan = (t) => {
    for (const m of String(t ?? '').matchAll(VAR)) found.add(m[1])
  }
  scan(p.url)
  scan(p.body)
  for (const [k, v] of Object.entries(p.headers)) {
    scan(k)
    scan(v)
  }
  return [...found]
}

function note(req, comment, style) {
  const list = mentioned(req)
  if (!list.length) return ''
  const names = list.map((n) => style(n)).join(', ')
  return `${comment} Set before running: ${names}\n`
}

/* ------------------------------------------------------------------ targets */

function curl(req) {
  const p = parts(req)
  const style = (n) => `$${ENV_NAME(n)}`
  const lines = [`curl --request ${p.method} \\`, `  --url ${dq(vars(p.url, style))}`]
  for (const [key, value] of Object.entries(p.headers)) {
    lines.push(`  --header ${dq(`${key}: ${vars(value, style)}`)}`)
  }
  if (p.body) lines.push(`  --data ${dq(vars(p.body, style))}`)
  return note(req, '#', style) + lines.join(' \\\n').replace(/ \\\n  --url/, ' \\\n  --url')
}

function python(req) {
  const p = parts(req)
  const style = (n) => `{os.environ[${dq(ENV_NAME(n))}]}`
  const headers = Object.entries(p.headers)
    .map(([k, v]) => `    ${dq(k)}: f${dq(vars(v, style))},`)
    .join('\n')
  const body = p.body ? `\ndata = f${dq(vars(p.body, style))}\n` : ''
  return `import os
import requests

${note(req, '#', (n) => ENV_NAME(n)).trim()}
url = f${dq(vars(p.url, style))}
headers = {
${headers}
}${body}
response = requests.request(${dq(p.method)}, url, headers=headers${p.body ? ', data=data' : ''}, timeout=30)
print(response.status_code, response.elapsed.total_seconds())
print(response.text)
`
}

function pytest(req) {
  const p = parts(req)
  const style = (n) => `{os.environ[${dq(ENV_NAME(n))}]}`
  const name = slug(req.name || 'request').replace(/-/g, '_')
  return `import os
import requests

${note(req, '#', (n) => ENV_NAME(n)).trim()}

def test_${name}():
    response = requests.request(
        ${dq(p.method)},
        f${dq(vars(p.url, style))},
        headers=${pyDict(p.headers, style)},${p.body ? `\n        data=f${dq(vars(p.body, style))},` : ''}
        timeout=30,
    )
${assertionsFor(req, 'pytest')}
`
}

function pyDict(headers, style) {
  const entries = Object.entries(headers)
  if (!entries.length) return '{}'
  return `{\n${entries.map(([k, v]) => `            ${dq(k)}: f${dq(vars(v, style))},`).join('\n')}\n        }`
}

function jsFetch(req, typed) {
  const p = parts(req)
  const style = (n) => `\${process.env.${ENV_NAME(n)}}`
  const headers = Object.entries(p.headers)
    .map(([k, v]) => `    ${dq(k)}: \`${vars(v, style)}\`,`)
    .join('\n')
  return `${note(req, '//', (n) => `process.env.${ENV_NAME(n)}`)}const response = await fetch(\`${vars(p.url, style)}\`, {
  method: ${dq(p.method)},
  headers: {
${headers}
  }${p.body ? `,\n  body: \`${vars(p.body, style)}\`` : ''}
})

${typed ? 'const data: unknown = ' : 'const data = '}await response.json()
console.log(response.status, data)
`
}

function axios(req) {
  const p = parts(req)
  const style = (n) => `\${process.env.${ENV_NAME(n)}}`
  return `${note(req, '//', (n) => `process.env.${ENV_NAME(n)}`)}import axios from 'axios'

const response = await axios({
  method: ${q(p.method.toLowerCase())},
  url: \`${vars(p.url, style)}\`,
  headers: ${jsObject(p.headers, style, 2)}${p.body ? `,\n  data: \`${vars(p.body, style)}\`` : ''},
  timeout: 30000
})

console.log(response.status, response.data)
`
}

function nodeUndici(req) {
  const p = parts(req)
  const style = (n) => `\${process.env.${ENV_NAME(n)}}`
  return `${note(req, '//', (n) => `process.env.${ENV_NAME(n)}`)}import { request } from 'undici'

const { statusCode, headers, body } = await request(\`${vars(p.url, style)}\`, {
  method: ${dq(p.method)},
  headers: ${jsObject(p.headers, style, 2)}${p.body ? `,\n  body: \`${vars(p.body, style)}\`` : ''}
})

console.log(statusCode, headers['content-type'])
console.log(await body.text())
`
}

function playwright(req) {
  const p = parts(req)
  const style = (n) => `\${process.env.${ENV_NAME(n)}}`
  return `import { test, expect } from '@playwright/test'

${note(req, '//', (n) => `process.env.${ENV_NAME(n)}`)}test(${dq(req.name || 'request')}, async ({ request }) => {
  const response = await request.${p.method.toLowerCase()}(\`${vars(p.url, style)}\`, {
    headers: ${jsObject(p.headers, style, 4)}${p.body ? `,\n    data: \`${vars(p.body, style)}\`` : ''}
  })

${assertionsFor(req, 'playwright')}
})
`
}

function jsObject(headers, style, indent) {
  const pad = ' '.repeat(indent)
  const entries = Object.entries(headers)
  if (!entries.length) return '{}'
  return `{\n${entries.map(([k, v]) => `${pad}  ${dq(k)}: \`${vars(v, style)}\`,`).join('\n')}\n${pad}}`
}

function java(req) {
  const p = parts(req)
  const style = (n) => `" + System.getenv(${dq(ENV_NAME(n))}) + "`
  const headers = Object.entries(p.headers)
    .map(([k, v]) => `    .header(${dq(k)}, ${dq(vars(v, style))})`)
    .join('\n')
  return `${note(req, '//', (n) => ENV_NAME(n))}import java.net.URI;
import java.net.http.*;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(${dq(vars(p.url, style))}))
${headers}
    .method(${dq(p.method)}, ${p.body ? `HttpRequest.BodyPublishers.ofString(${dq(vars(p.body, style))})` : 'HttpRequest.BodyPublishers.noBody()'})
    .build();

HttpResponse<String> response = HttpClient.newHttpClient()
    .send(request, HttpResponse.BodyHandlers.ofString());

System.out.println(response.statusCode());
System.out.println(response.body());
`
}

function restAssured(req) {
  const p = parts(req)
  const style = (n) => `" + System.getenv(${dq(ENV_NAME(n))}) + "`
  const headers = Object.entries(p.headers)
    .map(([k, v]) => `        .header(${dq(k)}, ${dq(vars(v, style))})`)
    .join('\n')
  return `${note(req, '//', (n) => ENV_NAME(n))}import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;
import org.junit.jupiter.api.Test;

public class ${pascal(req.name || 'Request')}Test {

    @Test
    void ${camel(req.name || 'request')}() {
        given()
${headers}${p.body ? `\n            .body(${dq(vars(p.body, style))})` : ''}
        .when()
            .${p.method.toLowerCase()}(${dq(vars(p.url, style))})
        .then()
${assertionsFor(req, 'restassured')};
    }
}
`
}

function csharp(req) {
  const p = parts(req)
  const style = (n) => `{Environment.GetEnvironmentVariable(${dq(ENV_NAME(n))})}`
  const headers = Object.entries(p.headers)
    .filter(([k]) => k.toLowerCase() !== 'content-type')
    .map(([k, v]) => `request.Headers.Add(${dq(k)}, $${dq(vars(v, style))});`)
    .join('\n')
  return `${note(req, '//', (n) => ENV_NAME(n))}using System;
using System.Net.Http;

var client = new HttpClient();
var request = new HttpRequestMessage(new HttpMethod(${dq(p.method)}), $${dq(vars(p.url, style))});
${headers}${p.body ? `\nrequest.Content = new StringContent($${dq(vars(p.body, style))}, System.Text.Encoding.UTF8, ${dq(p.headers['Content-Type'] ?? 'application/json')});` : ''}

var response = await client.SendAsync(request);
Console.WriteLine((int)response.StatusCode);
Console.WriteLine(await response.Content.ReadAsStringAsync());
`
}

function go(req) {
  const p = parts(req)
  const style = (n) => `" + os.Getenv(${dq(ENV_NAME(n))}) + "`
  const headers = Object.entries(p.headers)
    .map(([k, v]) => `\treq.Header.Set(${dq(k)}, ${dq(vars(v, style))})`)
    .join('\n')
  return `${note(req, '//', (n) => ENV_NAME(n))}package main

import (
\t"fmt"
\t"io"
\t"net/http"
\t"os"${p.body ? '\n\t"strings"' : ''}
)

func main() {
\treq, err := http.NewRequest(${dq(p.method)}, ${dq(vars(p.url, style))}, ${p.body ? `strings.NewReader(${dq(vars(p.body, style))})` : 'nil'})
\tif err != nil {
\t\tpanic(err)
\t}
${headers}

\tres, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer res.Body.Close()

\tbody, _ := io.ReadAll(res.Body)
\tfmt.Println(res.StatusCode)
\tfmt.Println(string(body))
}
`
}

function php(req) {
  const p = parts(req)
  const style = (n) => `' . getenv(${dq(ENV_NAME(n))}) . '`
  const headers = Object.entries(p.headers)
    .map(([k, v]) => `    ${q(`${k}: `)} . ${q(vars(v, style))},`)
    .join('\n')
  return `<?php
${note(req, '//', (n) => ENV_NAME(n))}
$curl = curl_init();

curl_setopt_array($curl, [
    CURLOPT_URL => ${q(vars(p.url, style))},
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => ${q(p.method)},${p.body ? `\n    CURLOPT_POSTFIELDS => ${q(vars(p.body, style))},` : ''}
    CURLOPT_HTTPHEADER => [
${headers}
    ],
]);

$response = curl_exec($curl);
echo curl_getinfo($curl, CURLINFO_HTTP_CODE) . PHP_EOL;
echo $response;
curl_close($curl);
`
}

/* -------------------------------------------------------- collection formats */

export function toPostman(flow, environment) {
  return {
    info: {
      name: flow.name || 'Prism flow',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Exported from Rebind Prism. Variables are left as variables — set them in the environment.'
    },
    item: (flow.requests ?? []).map((req) => {
      const p = parts(req)
      const [bare, search] = p.url.split(/\?(.*)/s)
      return {
        name: req.name || 'Request',
        request: {
          method: p.method,
          header: Object.entries(p.headers).map(([key, value]) => ({ key, value, type: 'text' })),
          url: {
            raw: p.url,
            host: [bare],
            query: (search ?? '')
              .split('&')
              .filter(Boolean)
              .map((pair) => {
                const at = pair.indexOf('=')
                return { key: at < 0 ? pair : pair.slice(0, at), value: at < 0 ? '' : pair.slice(at + 1) }
              })
          },
          ...(p.body ? { body: { mode: 'raw', raw: p.body, options: { raw: { language: req.bodyKind === 'json' ? 'json' : 'text' } } } } : {})
        },
        event: req.assertions?.length
          ? [{ listen: 'test', script: { type: 'text/javascript', exec: postmanScript(req.assertions) } }]
          : []
      }
    }),
    // Names only, never values. A Postman collection is a file people commit
    // and share; writing the environment's live token into it is precisely the
    // leak the whole no-inlining rule exists to prevent. Postman prompts for
    // an empty variable, which is the right outcome.
    variable: Object.keys(environment?.values ?? {}).map((key) => ({
      key,
      value: '',
      description: 'Set this in Postman — Prism does not export values.'
    }))
  }
}

function postmanScript(assertions) {
  const lines = []
  for (const a of assertions.filter((x) => x.on !== false)) {
    if (a.subject === 'status' && a.op === 'equals') {
      lines.push(`pm.test(${dq(`Status is ${a.value}`)}, () => pm.response.to.have.status(${Number(a.value) || 200}));`)
    } else if (a.subject === 'time' && a.op === 'lessThan') {
      lines.push(`pm.test(${dq(`Under ${a.value}ms`)}, () => pm.expect(pm.response.responseTime).to.be.below(${Number(a.value) || 1000}));`)
    } else if (a.subject === 'contentType') {
      lines.push(`pm.test(${dq(`Content type contains ${a.value}`)}, () => pm.expect(pm.response.headers.get('content-type')).to.include(${dq(a.value)}));`)
    } else if (a.subject === 'json' && a.op === 'exists') {
      lines.push(`pm.test(${dq(`${a.path} exists`)}, () => pm.expect(pm.response.json()).to.have.nested.property(${dq(a.path)}));`)
    } else if (a.subject === 'json' && a.op === 'equals') {
      lines.push(`pm.test(${dq(`${a.path} is ${a.value}`)}, () => pm.expect(String(pm.response.json()${dotted(a.path)})).to.eql(${dq(a.value)}));`)
    } else if (a.subject === 'body' && a.op === 'contains') {
      lines.push(`pm.test(${dq(`Body contains ${a.value}`)}, () => pm.expect(pm.response.text()).to.include(${dq(a.value)}));`)
    }
  }
  return lines.length ? lines : ['// No assertions Postman can express were set on this request.']
}

function dotted(path) {
  return String(path ?? '')
    .split('.')
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? `[${part}]` : `[${dq(part)}]`))
    .join('')
}

export function toOpenApi(flow) {
  const paths = {}
  for (const req of flow.requests ?? []) {
    const p = parts(req)
    let route = p.url
    try {
      route = new URL(p.url).pathname
    } catch {
      // Built around a variable, so it will not parse. Dropping the leading
      // {{base_url}} recovers the path, which is the part OpenAPI describes.
      route = p.url.replace(/^\{\{[\w.-]+\}\}/, '').split('?')[0] || p.url
    }
    paths[route] = paths[route] ?? {}
    paths[route][p.method.toLowerCase()] = {
      summary: req.name || 'Request',
      responses: {
        [String(statusOf(req))]: { description: 'Recorded response' }
      }
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: flow.name || 'Prism flow', version: '1.0.0' },
    paths
  }
}

function statusOf(req) {
  const status = (req.assertions ?? []).find((a) => a.subject === 'status' && a.op === 'equals')
  return status ? Number(status.value) || 200 : req.recorded?.status || 200
}

/* ------------------------------------------------------ assertions per target */

function assertionsFor(req, target) {
  const list = (req.assertions ?? []).filter((a) => a.on !== false)
  if (!list.length) {
    return target === 'restassured' ? '            .statusCode(200)' : '    // No assertions were set on this request.'
  }
  const out = []
  for (const a of list) {
    if (target === 'pytest') {
      if (a.subject === 'status' && a.op === 'equals') out.push(`    assert response.status_code == ${Number(a.value) || 200}`)
      else if (a.subject === 'time' && a.op === 'lessThan') out.push(`    assert response.elapsed.total_seconds() * 1000 < ${Number(a.value) || 1000}`)
      else if (a.subject === 'contentType') out.push(`    assert ${dq(a.value)} in response.headers["content-type"]`)
      else if (a.subject === 'json' && a.op === 'exists') out.push(`    assert ${pyPath(a.path)} is not None`)
      else if (a.subject === 'json' && a.op === 'equals') out.push(`    assert str(${pyPath(a.path)}) == ${dq(a.value)}`)
      else if (a.subject === 'body' && a.op === 'contains') out.push(`    assert ${dq(a.value)} in response.text`)
    } else if (target === 'playwright') {
      if (a.subject === 'status' && a.op === 'equals') out.push(`  expect(response.status()).toBe(${Number(a.value) || 200})`)
      else if (a.subject === 'contentType') out.push(`  expect(response.headers()['content-type']).toContain(${dq(a.value)})`)
      else if (a.subject === 'json' && a.op === 'exists') out.push(`  expect(await response.json()).toHaveProperty(${dq(a.path)})`)
      else if (a.subject === 'json' && a.op === 'equals') out.push(`  expect(String((await response.json())${dotted(a.path)})).toBe(${dq(a.value)})`)
      else if (a.subject === 'body' && a.op === 'contains') out.push(`  expect(await response.text()).toContain(${dq(a.value)})`)
    } else if (target === 'restassured') {
      if (a.subject === 'status' && a.op === 'equals') out.push(`            .statusCode(${Number(a.value) || 200})`)
      else if (a.subject === 'time' && a.op === 'lessThan') out.push(`            .time(lessThan(${Number(a.value) || 1000}L))`)
      else if (a.subject === 'contentType') out.push(`            .contentType(containsString(${dq(a.value)}))`)
      else if (a.subject === 'json' && a.op === 'exists') out.push(`            .body(${dq(a.path)}, notNullValue())`)
      else if (a.subject === 'json' && a.op === 'equals') out.push(`            .body(${dq(a.path)}, equalTo(${dq(a.value)}))`)
    }
  }
  if (!out.length) {
    return target === 'restassured' ? '            .statusCode(200)' : '    // None of the assertions on this request map onto this target.'
  }
  return out.join(target === 'restassured' ? '\n' : '\n')
}

function pyPath(path) {
  return `response.json()${String(path ?? '')
    .split('.')
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? `[${part}]` : `[${dq(part)}]`))
    .join('')}`
}

/* -------------------------------------------------------------------- entry */

export function generate(target, { request, flow, environment }) {
  if (WHOLE_FLOW.has(target)) {
    const one = flow ?? { name: request?.name ?? 'Flow', requests: request ? [request] : [] }
    if (target === 'postman') return JSON.stringify(toPostman(one, environment), null, 2)
    if (target === 'openapi') return JSON.stringify(toOpenApi(one), null, 2)
    return JSON.stringify({ canvas: 'flow', version: 1, flow: one }, null, 2)
  }
  if (!request) return '// Pick a request to export.'
  switch (target) {
    case 'curl':
      return curl(request)
    case 'python':
      return python(request)
    case 'pytest':
      return pytest(request)
    case 'fetch':
      return jsFetch(request, false)
    case 'axios':
      return axios(request)
    case 'node':
      return nodeUndici(request)
    case 'playwright':
      return playwright(request)
    case 'java':
      return java(request)
    case 'restassured':
      return restAssured(request)
    case 'csharp':
      return csharp(request)
    case 'go':
      return go(request)
    case 'php':
      return php(request)
    default:
      return `// ${target} is not a target Prism can write.`
  }
}

export function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'request'
  )
}

function pascal(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Request'
}

function camel(name) {
  const p = pascal(name)
  return p.charAt(0).toLowerCase() + p.slice(1)
}
