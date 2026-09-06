import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function hasImportStatement(content: string): boolean {
  return (
    /\bimport\s+(\{|\*|[a-zA-Z_$])/m.test(content) ||
    /\bimport\s*["'(]/m.test(content) ||
    /^\s*import\b/m.test(content)
  );
}

function hasExportStatement(content: string): boolean {
  return (
    /\bexport\s+(\{|\*|[a-zA-Z_$]|default\b)/m.test(content) ||
    /^\s*export\b/m.test(content)
  );
}

describe('verify-build rules', () => {
  it('correctly detects forbidden import statements', () => {
    expect(hasImportStatement('import { foo } from "./chunk.js";')).toBe(true);
    expect(hasImportStatement('import defaultExport from "module";')).toBe(true);
    expect(hasImportStatement('import * as all from "module";')).toBe(true);
    expect(hasImportStatement('import "side-effect";')).toBe(true);
    expect(hasImportStatement('import("./dynamic.js");')).toBe(true);
  });

  it('does not falsely trigger on identifiers or CSS containing !important', () => {
    expect(hasImportStatement('max-width: 280px !important;')).toBe(false);
    expect(hasImportStatement('const isImportant = true;')).toBe(false);
    expect(hasImportStatement('function handleImportantStuff() {}')).toBe(false);
  });

  it('correctly detects forbidden export statements', () => {
    expect(hasExportStatement('export { a, b };')).toBe(true);
    expect(hasExportStatement('export default function() {}')).toBe(true);
    expect(hasExportStatement('export const x = 1;')).toBe(true);
  });

  it('confirms dist/src/content/content-script.js is self-contained if built', () => {
    const csPath = path.resolve(__dirname, '../../dist/src/content/content-script.js');
    if (fs.existsSync(csPath)) {
      const content = fs.readFileSync(csPath, 'utf-8');
      expect(hasImportStatement(content)).toBe(false);
      expect(hasExportStatement(content)).toBe(false);
    }
  });

  it('confirms dist/src/page/bridge.js is self-contained if built', () => {
    const bridgePath = path.resolve(__dirname, '../../dist/src/page/bridge.js');
    if (fs.existsSync(bridgePath)) {
      const content = fs.readFileSync(bridgePath, 'utf-8');
      expect(hasImportStatement(content)).toBe(false);
      expect(hasExportStatement(content)).toBe(false);
    }
  });
});
