if (process.env.RAG_EVAL_OPENAI !== '1') {
  throw new Error('Refusing a real embedding evaluation. Set RAG_EVAL_OPENAI=1 explicitly and provide the staging Gateway configuration.');
}

if (!process.env.RAG_EVAL_GATEWAY_URL || !process.env.RAG_EVAL_WORKLOAD_TOKEN) {
  throw new Error('RAG_EVAL_GATEWAY_URL and RAG_EVAL_WORKLOAD_TOKEN are required for the staging-only OpenAI evaluation.');
}

throw new Error('The real embedding evaluator intentionally requires a staging workload runner; it is never part of the default suite.');
