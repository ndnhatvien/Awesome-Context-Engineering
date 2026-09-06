/**
 * TypeScript/JavaScript Graph Extractor
 *
 * Extracts graph nodes and edges from TypeScript/JavaScript files using Tree-sitter.
 * Supports: functions, classes, methods, imports, calls, and test nodes.
 */

import Parser from 'tree-sitter';
import TypeScriptBinding from 'tree-sitter-javascript';
import type { GraphEdge, GraphNode } from '../types.js';
import {
  makeFileNodeId,
  makeImportNodeId,
  makeSymbolNodeId,
  makeTestNodeId,
  makeUnresolvedNodeId,
} from '../types.js';

export interface GraphExtractionInput {
  filePath: string;
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx';
  source: string;
  fileHash: string;
}

export interface GraphExtractionDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  line?: number;
}

export interface GraphExtractionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: GraphExtractionDiagnostic[];
}

/**
 * Extract graph from TypeScript/JavaScript file.
 */
export async function extractTsJsGraph(
  input: GraphExtractionInput,
): Promise<GraphExtractionResult> {
  const { filePath, language, source, fileHash } = input;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const diagnostics: GraphExtractionDiagnostic[] = [];

  // Create file node
  nodes.push({
    id: makeFileNodeId(filePath),
    kind: 'file',
    name: filePath.split('/').pop() || filePath,
    filePath,
    language,
    fileHash,
  });

  try {
    // Initialize Tree-sitter parser
    const parser = new Parser();
    parser.setLanguage(TypeScriptBinding as unknown as Parser.Language);

    const tree = parser.parse(source);
    const rootNode = tree.rootNode;

    // Extract nodes and edges
    extractNodes(rootNode, filePath, language, fileHash, nodes, edges, diagnostics, source);
  } catch (error) {
    diagnostics.push({
      level: 'error',
      message: `Parser error: ${(error as Error).message}`,
    });
  }

  return { nodes, edges, diagnostics };
}

function extractNodes(
  node: Parser.SyntaxNode,
  filePath: string,
  language: string,
  fileHash: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  diagnostics: GraphExtractionDiagnostic[],
  source: string,
): void {
  const fileNodeId = makeFileNodeId(filePath);

  // Function declarations
  if (node.type === 'function_declaration' || node.type === 'function') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      const name = source.substring(nameNode.startIndex, nameNode.endIndex);
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const symbolId = makeSymbolNodeId(filePath, name, startLine, endLine);

      nodes.push({
        id: symbolId,
        kind: 'function',
        name,
        filePath,
        startLine,
        endLine,
        language,
        fileHash,
      });

      // Contains edge: file -> function
      edges.push({
        id: `${fileNodeId}->${symbolId}`,
        fromId: fileNodeId,
        toId: symbolId,
        kind: 'contains',
        filePath,
        confidence: 'exact',
        fileHash,
      });

      // Extract call edges within function body
      const bodyNode = node.childForFieldName('body');
      if (bodyNode) {
        extractCalls(bodyNode, symbolId, filePath, fileHash, edges, source);
      }
    }
  }

  // Class declarations
  if (node.type === 'class_declaration' || node.type === 'class') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      const name = source.substring(nameNode.startIndex, nameNode.endIndex);
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const symbolId = makeSymbolNodeId(filePath, name, startLine, endLine);

      nodes.push({
        id: symbolId,
        kind: 'class',
        name,
        filePath,
        startLine,
        endLine,
        language,
        fileHash,
      });

      // Contains edge: file -> class
      edges.push({
        id: `${fileNodeId}->${symbolId}`,
        fromId: fileNodeId,
        toId: symbolId,
        kind: 'contains',
        filePath,
        confidence: 'exact',
        fileHash,
      });

      // Extract methods
      const bodyNode = node.childForFieldName('body');
      if (bodyNode) {
        extractMethods(bodyNode, name, filePath, language, fileHash, nodes, edges, source);
      }
    }
  }

  // Test nodes (describe, it, test, specify)
  if (node.type === 'call_expression') {
    const functionNode = node.childForFieldName('function');
    if (functionNode) {
      const funcName = source.substring(functionNode.startIndex, functionNode.endIndex);
      if (['describe', 'it', 'test', 'specify'].includes(funcName)) {
        const argsNode = node.childForFieldName('arguments');
        if (argsNode && argsNode.childCount > 0) {
          const firstArg = argsNode.child(0);
          if (firstArg && firstArg.type === 'string') {
            const label = source.substring(firstArg.startIndex, firstArg.endIndex).slice(1, -1);
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const testId = makeTestNodeId(filePath, label, startLine, endLine);

            nodes.push({
              id: testId,
              kind: 'test',
              name: label,
              filePath,
              startLine,
              endLine,
              language,
              fileHash,
              metadata: { framework: funcName },
            });

            // Contains edge: file -> test
            edges.push({
              id: `${fileNodeId}->${testId}`,
              fromId: fileNodeId,
              toId: testId,
              kind: 'contains',
              filePath,
              confidence: 'exact',
              fileHash,
            });

            // Extract calls within test body
            if (argsNode.childCount > 1) {
              const bodyNode = argsNode.child(1);
              if (bodyNode) {
                extractCalls(bodyNode, testId, filePath, fileHash, edges, source);
              }
            }
          }
        }
      }
    }
  }

  // Import statements
  if (node.type === 'import_statement') {
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) {
      const importPath = source.substring(sourceNode.startIndex, sourceNode.endIndex).slice(1, -1);
      const importNodeId = makeImportNodeId(filePath, importPath);

      // Try to resolve import (simple relative path resolution)
      const resolvedPath = resolveImport(filePath, importPath);
      const toId = resolvedPath ? makeFileNodeId(resolvedPath) : makeUnresolvedNodeId(importPath);
      const confidence = resolvedPath ? 'exact' : 'unresolved';

      edges.push({
        id: importNodeId,
        fromId: fileNodeId,
        toId,
        kind: 'imports',
        filePath,
        confidence,
        fileHash,
        metadata: { importPath },
      });
    }
  }

  // Recursively process children
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      extractNodes(child, filePath, language, fileHash, nodes, edges, diagnostics, source);
    }
  }
}

function extractMethods(
  classBodyNode: Parser.SyntaxNode,
  className: string,
  filePath: string,
  language: string,
  fileHash: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  source: string,
): void {
  const _fileNodeId = makeFileNodeId(filePath);

  for (let i = 0; i < classBodyNode.childCount; i++) {
    const child = classBodyNode.child(i);
    if (child && (child.type === 'method_definition' || child.type === 'public_field_definition')) {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        const name = source.substring(nameNode.startIndex, nameNode.endIndex);
        const startLine = child.startPosition.row + 1;
        const endLine = child.endPosition.row + 1;
        const methodId = makeSymbolNodeId(filePath, `${className}.${name}`, startLine, endLine);

        nodes.push({
          id: methodId,
          kind: 'method',
          name,
          filePath,
          startLine,
          endLine,
          breadcrumb: className,
          language,
          fileHash,
        });

        // Contains edge: class -> method
        const classId = makeSymbolNodeId(
          filePath,
          className,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
        );
        edges.push({
          id: `${classId}->${methodId}`,
          fromId: classId,
          toId: methodId,
          kind: 'contains',
          filePath,
          confidence: 'exact',
          fileHash,
        });

        // Extract call edges within method body
        const bodyNode = child.childForFieldName('body');
        if (bodyNode) {
          extractCalls(bodyNode, methodId, filePath, fileHash, edges, source);
        }
      }
    }
  }
}

function extractCalls(
  bodyNode: Parser.SyntaxNode,
  enclosingSymbolId: string,
  filePath: string,
  fileHash: string,
  edges: GraphEdge[],
  source: string,
): void {
  const queue: Parser.SyntaxNode[] = [bodyNode];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;

    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (functionNode) {
        const funcName = source.substring(functionNode.startIndex, functionNode.endIndex);

        // Extract simple function name (ignore method calls for MVP)
        const simpleName = funcName.split('.').pop() || funcName;

        // Create call edge (heuristic - may not resolve to exact symbol)
        const callId = `${enclosingSymbolId}->call:${simpleName}:${node.startPosition.row}`;
        edges.push({
          id: callId,
          fromId: enclosingSymbolId,
          toId: makeUnresolvedNodeId(simpleName),
          kind: 'calls',
          filePath,
          confidence: 'heuristic',
          fileHash,
          metadata: { calledName: simpleName },
        });
      }
    }

    // Add children to queue
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        queue.push(child);
      }
    }
  }
}

/**
 * Resolve import path (simple relative path resolution for MVP).
 */
function resolveImport(fromFilePath: string, importPath: string): string | null {
  // Only handle relative imports for MVP
  if (!importPath.startsWith('.')) {
    return null;
  }

  const fromDir = fromFilePath.substring(0, fromFilePath.lastIndexOf('/'));
  let resolved = `${fromDir}/${importPath}`;

  // Normalize path (remove ./ and ../)
  const parts = resolved.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      stack.pop();
    } else if (part !== '.' && part !== '') {
      stack.push(part);
    }
  }
  resolved = stack.join('/');

  // Add common extensions if missing
  if (!resolved.match(/\.(ts|tsx|js|jsx)$/)) {
    // Try common extensions (MVP - no file system check)
    return `${resolved}.ts`;
  }

  return resolved;
}
