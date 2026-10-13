import MarkdownIt from "markdown-it";

// Keep quotes and symbols in command examples faithful to the stored answer.
export const studyMarkdownParser = new MarkdownIt({ typographer: false });
