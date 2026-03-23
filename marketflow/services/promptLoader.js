"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPrompt = loadPrompt;
exports.loadEnginePrompt = loadEnginePrompt;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function resolvePromptPath(promptPath) {
    const normalizedPath = promptPath.replace(/^[/\\]+/, '');
    const rootCandidates = [
        node_path_1.default.resolve(process.cwd(), 'marketflow'),
        node_path_1.default.resolve(process.cwd()),
    ];
    for (const root of rootCandidates) {
        const candidate = node_path_1.default.resolve(root, normalizedPath);
        if (node_fs_1.default.existsSync(candidate) && node_fs_1.default.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    throw new Error(`Prompt file not found: ${promptPath}`);
}
function loadPrompt(promptPath) {
    const resolvedPath = resolvePromptPath(promptPath);
    return node_fs_1.default.readFileSync(resolvedPath, 'utf8');
}
function loadEnginePrompt(fileName) {
    return loadPrompt(node_path_1.default.join('prompts', 'engines', fileName));
}
