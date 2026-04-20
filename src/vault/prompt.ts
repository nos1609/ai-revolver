/**
 * Prompt for password with hidden input (****)
 * Works in any terminal — no native deps.
 */
export async function promptPassword(message = "Master password: "): Promise<string> {
  return new Promise((resolve) => {
    const stdout = process.stdout;
    let password = "";

    stdout.write(message);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const onData = (ch: string) => {
      const c = ch.toString();

      if (c === "\n" || c === "\r" || c === "\u0004") {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(password);
      } else if (c === "\u0003") {
        process.stdin.setRawMode?.(false);
        process.exit(0);
      } else if (c === "\u007F" || c === "\b") {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write("\b \b");
        }
      } else {
        password += c;
        stdout.write("*");
      }
    };

    process.stdin.on("data", onData);
  });
}
