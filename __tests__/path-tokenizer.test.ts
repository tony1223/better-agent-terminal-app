import { hasPaths, tokenizePaths } from '../src/utils/path-tokenizer'

test.each([
  'https://castleridge-ai1.tail0f9e5.ts.net:8452/l5-index.html',
  'http://localhost:8080/home/user/report.md?q=1#part',
  'https://example.com/tmp/image.png',
  'ftp://example.com/home/user/file.txt',
])('URL is never mistaken for a host file: %s', url => {
  expect(tokenizePaths(url)).toEqual([{ type: 'text', text: url }])
  expect(hasPaths(url)).toBe(false)
})

test('keeps URLs intact alongside real Windows and Unix file paths', () => {
  const source = 'https://example.com/tmp/page.md:8452/a?q=x#h\nC:\\project\\report.md\n/home/user/image.png'
  const tokens = tokenizePaths(source)
  expect(tokens.map(token => token.text).join('')).toBe(source)
  expect(tokens.filter(token => token.type === 'path').map(token => token.text)).toEqual(['C:\\project\\report.md', '/home/user/image.png'])
  expect(hasPaths(source)).toBe(true)
})
