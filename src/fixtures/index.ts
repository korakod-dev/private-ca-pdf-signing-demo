// Typed fixture loader.
// UI code must NOT import this file (ESLint UI boundary); only src/engine, src/mocks and tests do.
//
// Type safety, in two layers:
//  1. Compile time: JSON imports widen string literals ("Active" -> string), so `satisfies FixtureBundle` cannot be used
//     directly. Instead the JSON is checked with `satisfies Widen<FixtureBundle>`: same shape, same property names and
//     optionality, literal unions widened to string/number/boolean. A renamed or missing property fails `tsc`.
//  2. Build time: the literal values (enums, DE:M0 patterns, instants, ...) are validated by the JSON Schemas in
//     ./schema through `npm run check:fixtures`, which runs before every build. The schemas are NOT loaded at runtime
//     (ajv compiles validators with `new Function`, which the production CSP forbids).
import type { FixtureBundle } from '../contracts/fixtures';
import system from './system.json';
import personas from './personas.json';
import pki from './pki.json';
import certs from './certs.json';
import requests from './requests.json';
import documents from './documents.json';
import mail from './mail.json';

/** Widens literal types to their primitive: "a" | "b" -> string, 1 | 2 -> number, true -> boolean. Shapes are kept. */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? Widen<U>[]
        : T extends object
          ? { [K in keyof T]: Widen<T[K]> }
          : T;

// Shape check (layer 1). `satisfies` keeps the JSON's own types, so nothing is lost here.
const shapeChecked = {
  system,
  personas,
  pki,
  certs,
  requests,
  documents,
  mail,
} satisfies Widen<FixtureBundle>;

// The cast is justified by layer 2 (schemas, enforced at build time and by the fixtures tests).
export const fixtures: FixtureBundle = shapeChecked as unknown as FixtureBundle;
