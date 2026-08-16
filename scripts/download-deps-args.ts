export function selectToolsFromArgs(
  argv: readonly string[],
  availableToolNames: readonly string[],
): string[] {
  const toolOptions = argv.filter(
    (arg) => arg === "--tools" || arg.startsWith("--tools="),
  );

  if (toolOptions.length === 0) {
    return [...availableToolNames];
  }
  if (toolOptions.length > 1) {
    throw new Error("--tools may only be specified once");
  }

  const availableToolsSuffix = `Available tools: ${availableToolNames.join(", ")}`;

  const option = toolOptions[0];
  const optionIndex = argv.indexOf(option);
  const rawValue =
    option === "--tools"
      ? argv[optionIndex + 1]
      : option.slice("--tools=".length);

  if (!rawValue || rawValue.startsWith("--")) {
    throw new Error(
      `--tools requires a non-empty comma-separated value. ${availableToolsSuffix}`,
    );
  }

  const requestedTools = rawValue
    .split(",")
    .map((toolName) => toolName.trim())
    .filter(Boolean);
  if (requestedTools.length === 0) {
    throw new Error(
      `--tools requires a non-empty comma-separated value. ${availableToolsSuffix}`,
    );
  }

  const availableTools = new Set(availableToolNames);
  const unknownTools = [...new Set(requestedTools)].filter(
    (toolName) => !availableTools.has(toolName),
  );
  if (unknownTools.length > 0) {
    const unknownDescription =
      unknownTools.length === 1
        ? `Unknown tool "${unknownTools[0]}"`
        : `Unknown tools: ${unknownTools.map((name) => `"${name}"`).join(", ")}`;
    throw new Error(`${unknownDescription}. ${availableToolsSuffix}`);
  }

  const requestedToolSet = new Set(requestedTools);
  return availableToolNames.filter((toolName) =>
    requestedToolSet.has(toolName),
  );
}
