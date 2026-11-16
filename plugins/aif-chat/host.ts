import { experimental_defineHostEntry } from '@vesnalia/plugin-sdk';
import { hostContract } from './contract.ts';
import { collectSnapshot } from './reader.ts';
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: { collect: (input, context) => collectSnapshot(input, context.signal) },
});
