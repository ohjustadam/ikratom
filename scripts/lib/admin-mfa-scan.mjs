// Scans "use server" files for exported actions that reach an admin guard
// (getAdminContext / getCreatorContext) and reports whether each one also
// reaches the 2FA gate (requireMfaForMutation / requireMfaEnrolled).
//
// Used by tests/admin-mfa-coverage.test.ts. Since #1159 an admin or owner with
// no verified factor is blocked by the gate, but only where an action calls
// it; this scan is how an ungated admin mutation gets caught in CI.
//
// Calls are followed through same-file helpers, so `const ctx = await guard()`
// where `guard()` calls both counts as guarded and gated.

import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const GUARDS = new Set(["getAdminContext", "getCreatorContext"]);
export const GATES = new Set(["requireMfaForMutation", "requireMfaEnrolled"]);

/** Supabase query-builder writes, plus the audit log every admin write calls. */
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);
const WRITE_CALLS = new Set(["recordAdminAction"]);

function isUseServer(sf) {
  const first = sf.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function hasExport(node) {
  return !!ts.getModifiers?.(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Top-level functions: declarations and `const x = async (...) => ...`. */
function topLevelFunctions(sf) {
  const out = new Map();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      out.set(st.name.text, { node: st.body, exported: hasExport(st) });
    } else if (ts.isVariableStatement(st)) {
      const exported = hasExport(st);
      for (const d of st.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          out.set(d.name.text, { node: d.initializer.body, exported });
        }
      }
    }
  }
  return out;
}

/** Direct calls inside a body: plain names and `.method(` names. */
function directCalls(body) {
  const names = new Set();
  const methods = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) names.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) methods.add(callee.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return { names, methods };
}

/**
 * Analyse one source text. Returns one entry per EXPORTED action of a
 * "use server" file (an empty list for any other file).
 */
export function analyseSource(text, fileName = "file.ts") {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (!isUseServer(sf)) return [];
  const fns = topLevelFunctions(sf);
  const direct = new Map([...fns].map(([name, f]) => [name, directCalls(f.node)]));

  // Union of calls reachable through same-file helpers.
  const reach = (name, seen = new Set()) => {
    const acc = { names: new Set(), methods: new Set() };
    const walk = (n) => {
      if (seen.has(n)) return;
      seen.add(n);
      const d = direct.get(n);
      if (!d) return;
      for (const x of d.names) {
        acc.names.add(x);
        if (fns.has(x)) walk(x);
      }
      for (const m of d.methods) acc.methods.add(m);
    };
    walk(name);
    return acc;
  };

  const out = [];
  for (const [name, f] of fns) {
    if (!f.exported) continue;
    const r = reach(name);
    const guarded = [...GUARDS].some((g) => r.names.has(g));
    const gated = [...GATES].some((g) => r.names.has(g));
    const writes = [
      ...[...r.methods].filter((m) => WRITE_METHODS.has(m)).map((m) => `.${m}()`),
      ...[...r.names].filter((n) => WRITE_CALLS.has(n)).map((n) => `${n}()`),
    ];
    out.push({ name, guarded, gated, writes });
  }
  return out;
}

function walkTs(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walkTs(p, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Every exported action under `srcDir` that reaches an admin guard. */
export function scanAdminActions(rootDir, srcDir = "src") {
  const rows = [];
  for (const abs of walkTs(join(rootDir, srcDir))) {
    const text = readFileSync(abs, "utf8");
    if (!text.includes("use server")) continue;
    const file = relative(rootDir, abs).split(sep).join("/");
    for (const a of analyseSource(text, file)) {
      if (a.guarded) rows.push({ file, ...a });
    }
  }
  return rows;
}
