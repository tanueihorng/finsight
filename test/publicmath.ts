// The browser's pure math files in public/ (classic UMD scripts, untyped JS
// that S1 leaves unchanged) loaded for their unit tests. public/package.json
// keeps them CommonJS for Node. They have no declarations, so this bridge is
// deliberately loose: the tests check their behaviour, the types do not.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
type UntypedModule = Record<string, any>;

export const indicators: UntypedModule = require('../public/indicators.js');
export const strategy: UntypedModule = require('../public/strategy.js');
export const strategies: UntypedModule = require('../public/strategies.js');
