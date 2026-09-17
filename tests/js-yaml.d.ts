/**
 * js-yaml is a real dependency (package.json), but it ships no types and
 * `@types/js-yaml` is not installed. The scripts that use it are .mjs and are
 * never typechecked, so this gap only shows up from a .ts file —
 * tests/egress-gate-wiring.test.ts, which parses the workflow YAML.
 *
 * Declaring the one function it calls is cheaper than adding a devDependency
 * for a single `load()`, and `unknown` (not `any`) keeps the caller honest
 * about validating the shape it gets back. If `@types/js-yaml` is ever added,
 * delete this file.
 */
declare module "js-yaml" {
  export function load(input: string): unknown;
}
