import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.[jt]sx?$/.test(entry.name) ? [entryPath] : [];
  });
}

test('arquivos "use server" exportam apenas funções assíncronas em tempo de execução', () => {
  const sourceRoot = path.join(process.cwd(), "src");
  for (const filename of sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"),
      ts.ScriptTarget.Latest, true);
    const first = source.statements[0];
    if (!first || !ts.isExpressionStatement(first) || !ts.isStringLiteral(first.expression) ||
        first.expression.text !== "use server") continue;

    for (const statement of source.statements) {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
      if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
      assert.ok(ts.isFunctionDeclaration(statement) &&
        modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
      `${path.relative(sourceRoot, filename)} exporta um valor que não é uma função assíncrona`);
    }
  }
});
