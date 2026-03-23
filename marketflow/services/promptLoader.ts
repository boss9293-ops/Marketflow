import fs from 'node:fs';
import path from 'node:path';

function resolvePromptPath(promptPath: string): string {
  const normalizedPath = promptPath.replace(/^[/\\]+/, '');
  const rootCandidates = [
    path.resolve(process.cwd(), 'marketflow'),
    path.resolve(process.cwd()),
  ];

  for (const root of rootCandidates) {
    const candidate = path.resolve(root, normalizedPath);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Prompt file not found: ${promptPath}`);
}

export function loadPrompt(promptPath: string): string {
  const resolvedPath = resolvePromptPath(promptPath);
  return fs.readFileSync(resolvedPath, 'utf8');
}

export function loadEnginePrompt(fileName: string): string {
  return loadPrompt(path.join('prompts', 'engines', fileName));
}
