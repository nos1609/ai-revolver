import { generateCompletionScript, parseCompletionShell } from "../completion/generate.js";
import { listProviders } from "../providers/loader.js";

export async function completionCommand(shellArg: string | undefined): Promise<void> {
  const shell = parseCompletionShell(shellArg);
  const providers = await listProviders();
  console.log(generateCompletionScript({ shell, providers }));
}
