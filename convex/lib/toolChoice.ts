/** How a structured call makes the model answer through its one tool.
 *
 * Forcing a named tool (tool_choice "tool" or "any") is refused by some Claude
 * models: Claude Sonnet 5.5 answers 400 'tool_choice: type "tool" and "any"
 * are not supported for this model' (verified Oct 15 2026), while Haiku and the
 * Claude 3 and 4 models accept it. Any other Claude model gets "auto" with the
 * tool as its only option and an explicit instruction to call it; a reply
 * without the tool is still rejected as an invalid response, never parsed from
 * text. Names outside the claude- family (fixtures, compatible gateways) keep
 * the forced choice they always had. */
const FORCED_TOOL_CHOICE_MODEL = /^claude-(haiku-|3|(opus|sonnet)-[34](-|$))/;

export function forcedToolChoiceSupported(model: string) {
  return !model.startsWith("claude-") || FORCED_TOOL_CHOICE_MODEL.test(model);
}

export function structuredToolChoice(model: string, toolName: string) {
  return forcedToolChoiceSupported(model)
    ? { type: "tool" as const, name: toolName, disable_parallel_tool_use: true }
    : { type: "auto" as const, disable_parallel_tool_use: true };
}

/** Added to the system prompt only when the tool cannot be forced. */
export function toolOnlyInstruction(toolName: string) {
  return `Answer only by calling the ${toolName} tool once, with the complete result in its fields. Do not answer in plain text.`;
}
