import { MarkdownIt } from 'react-native-markdown-display'

// markdown-it rejects file: by default. Allow host-file citations while
// retaining its protection against javascript:, vbscript: and unsafe data:.
export const hostMarkdown = new MarkdownIt({ html: false })
const validateLink = hostMarkdown.validateLink.bind(hostMarkdown)
hostMarkdown.validateLink = (url: string) => /^file:\/\//i.test(url) || validateLink(url)
