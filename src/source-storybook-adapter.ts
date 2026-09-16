import traverseModule from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

type StorybookDeclaration = Readonly<{
  exportNode: t.ExportNamedDeclaration;
  declaration: t.VariableDeclaration;
  variable: t.VariableDeclarator;
}>;

export const storybookDeclarations = (ast: t.File): ReadonlyArray<StorybookDeclaration> => {
  const declarations: StorybookDeclaration[] = [];
  traverseModule(ast, {
    ExportNamedDeclaration(exportPath: NodePath<t.ExportNamedDeclaration>) {
      const declaration = exportPath.node.declaration;
      if (!t.isVariableDeclaration(declaration)) return;
      for (const variable of declaration.declarations) declarations.push({ exportNode: exportPath.node, declaration, variable });
    },
  });
  return declarations;
};
