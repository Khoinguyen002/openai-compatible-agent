import { toolDeclarations } from "./declaration.js";

type SystemToolName = (typeof toolDeclarations)[number]["function"]["name"];

export const getBaseTools = (opts?: { excludedNames?: SystemToolName[] }) => {
  if (opts?.excludedNames) {
    return toolDeclarations.filter(
      (t) => !opts.excludedNames!.includes(t.function.name as SystemToolName),
    );
  }
  return toolDeclarations;
};

export * from "./declaration.js";
