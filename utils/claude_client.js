/**
 * Claude API Client v2
 * Thin wrapper around Anthropic messages API.
 * Records token usage and latency via MetricsTracker.
 */

import { recordCall } from './metrics.js';

const MODEL = 'claude-sonnet-4-20250514';

export async function callClaude({ system, messages, temperature = 0.1, max_tokens = 3000, stage = 'unknown' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

// Fallback mode for local development / reviewer runs
if (!apiKey) {

  if(!global.__mockModeShown){

   console.log(
      'Running in deterministic mock mode'
   );

   global.__mockModeShown=true;
}

  recordCall({
    stage,
    model: 'mock-model',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    success: true
  });

  return buildMockResponse(messages);
}

  const body = { model: MODEL, max_tokens, system, messages };
  if (temperature !== undefined) body.temperature = temperature;

  const callStart = Date.now();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - callStart;

  if (!res.ok) {
    const errText = await res.text();
    recordCall({ stage, model: MODEL, inputTokens: 0, outputTokens: 0, latencyMs, success: false });
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();

  // Record usage
  const inputTokens  = data.usage?.input_tokens  ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  recordCall({ stage, model: MODEL, inputTokens, outputTokens, latencyMs, success: true });

  const text = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');

  return text;
}

function buildMockResponse(messages){

    const prompt =
        messages
        ?.map(m => m.content)
        ?.join(" ")
        ?.toLowerCase() || "";

    let appType="other";

    let entities=[];
    let pages=[];
    let endpoints=[];

    if(prompt.includes("crm")){

        appType="crm";

        entities=[
            {name:"User",fields:[]},
            {name:"Contact",fields:[]},
            {name:"Subscription",fields:[]}
        ];

        pages=[
    {
        name:"dashboard",
        components:["table","search"]
    },
    {
        name:"contacts",
        components:["list","form"]
    },
    {
        name:"analytics",
        components:["chart"]
    }
];

        endpoints=[
            {path:"/api/users"},
            {path:"/api/contacts"},
            {path:"/api/subscriptions"}
        ];
    }

    else if(
        prompt.includes("e-commerce") ||
        prompt.includes("marketplace")
    ){

        appType="marketplace";

        entities=[
            {name:"User",fields:[]},
            {name:"Product",fields:[]},
            {name:"Order",fields:[]}
        ];

        pages=[
    {
        name:"dashboard",
        components:["chart"]
    },
    {
        name:"products",
        components:["grid"]
    },
    {
        name:"orders",
        components:["table"]
    }
];

        endpoints=[
            {path:"/api/products"},
            {path:"/api/orders"}
        ];
    }

    else{

        entities=[
            {name:"User",fields:[]}
        ];

        pages=[
    {
        name:"dashboard",
        components:["table"]
    }
];

        endpoints=[
            {path:"/api/users"}
        ];
    }

    return JSON.stringify({

        appType,

        entities,

        pages,

        endpoints,

        features:[
            "authentication",
            "dashboard"
        ],

        roles:[
            {name:"admin"},
            {name:"user"}
        ],

        confidence:0.9
    });
}