import { StyledText, type TextChunk } from "@opentui/core"

type Part = string | number | TextChunk | StyledText

export function st(strings: TemplateStringsArray, ...parts: Part[]): StyledText {
  const chunks: TextChunk[] = []
  const push = (p: Part) => {
    if (typeof p !== "object") {
      const str = String(p)
      if (str) {
        chunks.push({ __isChunk: true, text: str } as TextChunk)
      }
    } else if (p instanceof StyledText) {
      chunks.push(...p.chunks)
    } else {
      chunks.push(p)
    }
  }
  strings.forEach((str, i) => {
    push(str)
    if (i < parts.length) {
      push(parts[i]!)
    }
  })
  return new StyledText(chunks)
}
