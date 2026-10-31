import { describe, expect, it } from 'vitest';
import { nextContract, type ContractRotation } from './rotation';
import { progressionStake } from './progressions';
const primary={contractType:'DIGITEVEN' as const};
const recovery={contractType:'DIGITOVER' as const,barrier:4};
const cfg=(mode:ContractRotation['mode'],alternateTimes=1):ContractRotation=>({mode,recovery,alternateTimes});
const outcomes=(...values:number[])=>values.map((profit)=>({profit}));
describe('settlement-driven contract rotation',()=>{
  it('starts on the primary leg even when rotation is enabled',()=>{expect(nextContract(primary,cfg('alternate'),[])).toEqual(primary);});
  it('stays on recovery through non-wins and returns on a positive settlement',()=>{expect(nextContract(primary,cfg('return-after-recovery'),outcomes(-1,-2))).toEqual(recovery);expect(nextContract(primary,cfg('return-after-recovery'),outcomes(-1,-2,.5))).toEqual(primary);});
  it('switch-on-loss toggles on non-wins only',()=>{expect(nextContract(primary,cfg('switch-on-loss'),outcomes(-1,1))).toEqual(recovery);expect(nextContract(primary,cfg('switch-on-loss'),outcomes(-1,1,0))).toEqual(primary);});
  it('alternates after the configured number of settled contracts',()=>{expect(nextContract(primary,cfg('alternate',2),outcomes(1))).toEqual(primary);expect(nextContract(primary,cfg('alternate',2),outcomes(1,1))).toEqual(recovery);expect(nextContract(primary,cfg('alternate',2),outcomes(1,1,1,1))).toEqual(primary);});
  it('disabled rotation never changes the requested contract',()=>{expect(nextContract(primary,undefined,outcomes(-1,-1))).toEqual(primary);});
  it('caps martingale steps and resets on a win',()=>{const c={kind:'martingale' as const,unit:1,multiplier:2.1,stepLimit:2};expect(progressionStake(c,outcomes(-1,-2,-3).map((t)=>({...t,won:false})))).toBe(4.41);expect(progressionStake(c,[{won:false,profit:-1},{won:true,profit:.9}])).toBe(1);});
});
