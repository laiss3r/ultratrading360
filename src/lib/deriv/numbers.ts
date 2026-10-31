/** API money/spots may be decimal strings. Never coerce null/empty/boolean to zero. */
export function brokerNumber(value:unknown):number|undefined{
 if(typeof value==='number')return Number.isFinite(value)?value:undefined;
 if(typeof value!=='string'||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))return undefined;
 const n=Number(value);return Number.isFinite(n)?n:undefined;
}
export function requiredBrokerNumber(value:unknown,label:string):number{
 const n=brokerNumber(value);if(n===undefined)throw new Error(`Broker ${label} is missing or invalid; no value is assumed.`);return n;
}
