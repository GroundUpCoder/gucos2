export const PRICING_AS_OF='2026-08-10';
const RATES:Record<string,{miss:number;hit:number;output:number}>={
 'deepseek-v4-flash':{miss:0.14,hit:0.0028,output:0.28},
 'deepseek-v4-pro':{miss:0.435,hit:0.003625,output:0.87},
};
const amount=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:0;
export function estimateCostUsd(model:string|undefined,usage:Record<string,unknown>|undefined){const rates=model?RATES[model]:undefined;if(!rates||!usage)return null;const input=amount(usage.input_tokens),read=amount(usage.cache_read_input_tokens),write=amount(usage.cache_creation_input_tokens),output=amount(usage.output_tokens);return((input+write)*rates.miss+read*rates.hit+output*rates.output)/1_000_000}
export function formatCost(cost:number){if(cost<0.0001)return '<$0.0001';if(cost<0.01)return `$${cost.toFixed(4)}`;return `$${cost.toFixed(2)}`}
