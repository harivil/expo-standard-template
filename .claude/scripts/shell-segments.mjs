#!/usr/bin/env node
// One definition of "where does one shell command end and the next begin", shared by every
// guard that has to read a Bash command — the same arrangement as protected-paths.mjs and
// check-push-target.mjs, and for the same reason: two guards that disagree about what counts
// as a command are two guards that can be walked between.
//
// Quote-aware, because a plain `.split(/[;|]/)` cuts a command in half at a separator the
// shell would never treat as one. Two real cases this exists for:
//
//   sed -i 's|a|b|' android/build.gradle     one command, two pipes inside a quoted argument
//   echo "lint AND open a PR"                one command, and NOT a request to open a PR
//
// Splitting the first produced four fragments, none of which still had a verb next to its
// filename, so the write guard saw nothing to check. Splitting the second invented a command
// nobody ran, and blocked the session for it — which is how this module came to exist.
// A separator inside quotes is data, not a separator.
//
// Heredoc bodies are dropped before splitting, for the same reason. A heredoc body is data on
// its way to a program's stdin — the shell never runs a line of it — so a file being written
// with `cat > x <<EOF` can legitimately contain any command text at all, including the ones
// these guards block. Every line of it looked like a command to a line-splitter, which is how
// writing this module's own tests came to be blocked by the guard that reads it.
//
// Not a shell parser: it does not know about escapes or subshells, and it looks for a heredoc
// opener without checking whether that opener is itself inside quotes. It knows the one thing
// every caller needs, which is where an unquoted separator sits.

/**
 * Remove heredoc bodies, keeping the line that opens each one — the opener still carries the
 * command and any redirect a caller needs to see.
 */
function withoutHeredocBodies(command) {
  const lines = command.split("\n");
  const kept = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    kept.push(line);
    i++;

    // Every heredoc this line opens, in the order the shell will read them. `<<-` strips
    // leading tabs from the terminator, so it is compared trimmed.
    const openers = [
      ...line.matchAll(/<<(-?)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g),
    ].map((m) => ({ word: m[2] ?? m[3] ?? m[4], dash: m[1] === "-" }));

    for (const { word, dash } of openers) {
      while (i < lines.length) {
        const body = lines[i];
        i++;
        if ((dash ? body.trim() : body) === word) break;
      }
    }
  }

  return kept.join("\n");
}

/** Split a Bash command into the individual commands a shell would run. */
export function segments(rawCommand) {
  const command = withoutHeredocBodies(rawCommand);
  const out = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    // && and || are two characters; ;, | and a newline are one.
    if ((ch === "&" && command[i + 1] === "&") || (ch === "|" && command[i + 1] === "|")) {
      out.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);

  return out.map((s) => s.trim()).filter(Boolean);
}
