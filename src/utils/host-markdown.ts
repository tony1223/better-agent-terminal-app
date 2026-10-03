import { MarkdownIt } from 'react-native-markdown-display'
import { performanceNow, recordPerformance } from './performance-diagnostics'

// markdown-it rejects file: by default. Allow host-file citations while
// retaining its protection against javascript:, vbscript: and unsafe data:.
export const hostMarkdown = new MarkdownIt({ html: false, linkify: true })
// Explicit URLs should open as a whole (including port, query and fragment).
// Don't guess that a bare host filename such as README.md is a web domain.
hostMarkdown.linkify.set({ fuzzyLink: false, fuzzyEmail: false })
const validateLink = hostMarkdown.validateLink.bind(hostMarkdown)
hostMarkdown.validateLink = (url: string) => /^file:\/\//i.test(url) || validateLink(url)

// Measure parsing only; this is not native layout/GPU time or battery usage.
const parse = hostMarkdown.parse.bind(hostMarkdown)
hostMarkdown.parse = (source: string, env: unknown) => {
  const started = performanceNow()
  try { return parse(source, env) }
  finally { recordPerformance('markdown-parse', source.length, performanceNow() - started) }
}
