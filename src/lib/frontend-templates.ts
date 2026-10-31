import { createStrategy, type Strategy } from './engine/strategies';
import type { ConditionKind } from './engine/conditions';
import type { ContractType } from './deriv/contracts';

export const templates: { id: string; name: string; description: string; family: string; contract: ContractType; condition: ConditionKind; barrier?: number }[] = [
  { id:'even',name:'Even / Odd',family:'Digits',contract:'DIGITEVEN',condition:'even',description:'Enter an Even contract after an even last digit. A transparent parity gate, not a next-tick prediction.' },
  { id:'over',name:'Over / Under',family:'Digits',contract:'DIGITOVER',condition:'under',barrier:5,description:'Observe the last digit below your barrier before entering an Over contract. Customize the barrier and limits.' },
  { id:'differs',name:'Digit Differs',family:'Digits',contract:'DIGITDIFF',condition:'differ',barrier:4,description:'A configurable differs contract with a digit gate. High hit rates do not guarantee positive net returns.' },
  { id:'rsi',name:'RSI Reversal',family:'Indicators',contract:'CALL',condition:'rsiBelow',description:'Wait for tick-price RSI below a threshold before entering Rise. Indicators describe past prices, not certainty.' },
  { id:'bands',name:'Bollinger Entry',family:'Indicators',contract:'CALL',condition:'bbBelowLower',description:'Enter Rise when the observed tick price is below the lower Bollinger band. Requires enough live history.' },
  { id:'sma',name:'Moving Average',family:'Indicators',contract:'PUT',condition:'smaBelow',description:'Use a tick-price moving average as an entry filter before a Fall contract. Flat stake by default.' },
];
export function strategyFromTemplate(id: string): Strategy {
  const t=templates.find((x)=>x.id===id)??templates[0];
  return createStrategy({name:t.name,contractType:t.contract,barrier:t.barrier,entry:{id:'root',op:'AND',children:[{id:'entry-1',kind:t.condition,barrier:t.barrier,n:14,threshold:30}]},notes:t.description,progression:{kind:'flat',unit:.35}});
}
